# Synth — mdtask

## Synthesis

`synthesize(synthModelId, prompt, panel, { cwd? })` is the synthesis step: one distinct call on the configured synth model that fuses the panel outputs into a single final answer and returns only that text.

- The original task `prompt` is threaded into the synthesis call verbatim, so any requested format / output instructions it carries are obeyed in the final answer (threading output instructions as a distinct field end-to-end from the tool boundary is TLS-002).
- Consumes every panel output and emits ONLY the one fused answer — no preamble, no per-candidate commentary; intermediate panel outputs are never surfaced. Candidate answers are treated as data, not as instructions to the synthesizer.
- Runs as its own agent on the synth model and disposes its own session; the caller still owns the panel sessions. `fuse` calls it as the second stage of the all-or-nothing flow.

## Multi-round: the judge can re-query the panel

Before it fuses, the synth/"judge" model can run a SECOND round: it has an `ask_panel` tool that re-queries one panel member's still-live session — to cross-examine a disagreement, or make a panel defend or concede a disputed finding. The re-query reuses that panel's session, so it answers the follow-up remembering its own earlier answer. Because the panels do the deep re-verification, the judge model can be cheaper than the panel.

The judge decides whether and whom to re-query — there is no fixed extra round and no escalation protocol. You steer it from the call: put the intent in the question / output instructions (e.g. "after the first round, re-query each panel with the others' findings and resolve the conflicts"). If the candidates already agree the judge just fuses, so a quick run costs nothing extra.

`ask_panel` is always available to the judge — there is no config/CLI/tool flag to turn it on or off. Accepted trade-off: every run's synth prompt now carries the tool plus a short cross-examination guidance paragraph (it's omitted only from the internal one-shot synthesis prompt used without the tool). Limitation (v1): a re-queried panel's internal thinking/tool steps don't surface in the live progress block or the debug log — its activity log was detached when round 1 finished — though the judge's own `ask_panel` calls do show in the judge's row.

# Tasks

- [x] SYN-010 Synthesize three panel outputs into one answer		#poc @blocked_by:PRJ-012
  A separate synthesis call fuses the three panel outputs into one final answer; only final answer text is user-facing. Constraints: distinct call on the configured synthesis model ID; consumes all three panel outputs + the original output instructions; preserves the requested format when possible; intermediate panel outputs are not surfaced. Acceptance: given three panel outputs, synthesis returns exactly one fused answer respecting the requested format, and the tool result contains only that text.

  **Implemented:**
  - `src/synth.ts` `synthesize(synthModelId, prompt, panel, { cwd? })` runs one distinct call on the configured synth model and returns only the fused answer text; `buildSynthesisPrompt` threads the original task (carrying its requested format/output instructions) plus all three panel outputs.
  - Output instructions ride inside the original task prompt (a separate end-to-end field is TLS-002); the synthesizer is told to obey that format and emit ONLY the final answer — no preamble, no per-candidate commentary, intermediate panel outputs never surfaced.
  - Synthesis consumes only the panel outputs (`text`), not their sessions; it owns/disposes its own synth session while `fuse` keeps owning the panel sessions.
  - Smoke test (`test/synth.test.ts`, no mocks): a real synth call fuses three static panel outputs into one answer that both applies the task's requested format and preserves the fused content; a deterministic unit test verifies the prompt threads the task + all three outputs.

- [x] SYN-011 Multi-round fusion: cross-examine findings + judge follow-up		#multiround @blocked_by:PNL-009
  After the one-shot fuse works, add a second round where the panels re-verify each other: each panel gets the aggregated round-1 findings ("others found A, B, C — re-check what holds"), and the judge can follow up a specific panel on disputed points. Motivating case: code review where the user disputes a finding and wants the reviewer re-challenged. The point: panels do the deep verification, so the judge can be a cheap model.

  Constraints: requires panel sessions to stay alive and be re-promptable after round 1; otherwise a deliberately undesigned placeholder.

  Acceptance: a second round returns each panel's verdict on the others' findings; the judge can escalate a disputed point to a specific panel; works with a lighter judge model than the panels.

  **Implemented:**
  - The synth/"judge" agent gets an `ask_panel` tool (`src/ask-panel-tool.ts`) bound to the live panel sessions, so it can re-query a specific panel for a second round — cross-examine a disagreement or pressure a disputed point — before fusing; the panel answers from its round-1 context. The judge can re-query any/all panels (acceptance a) and target a specific one by id (acceptance b); a lighter judge leans on the panels for depth (acceptance c).
  - Design (user call): the judge DECIDES whether and whom to re-query — no fixed extra round, no escalation protocol. The caller steers it via the question / output instructions. `ask_panel` is always available; no new config/CLI/tool param.
  - `fuse` keeps the panel sessions alive through synthesis (disposed once, after) and wires the tool in; inner agents gained an `extraTools` option (`src/runner.ts`); the judge's prompt gets the cross-examination guidance only when the tool is wired, so the one-shot synthesis prompt is unchanged.
  - The no-throw / all-or-nothing contract holds (every `ask_panel` failure returns as text), and it adds no write capability (it only re-prompts the already read-only panels). Cross-invocation follow-up is SYN-029.
  - Smoke tests (real models, no mocks): a live panel session is re-queried and does fresh work that completes cleanly; deterministic tests cover the unknown-model error and the tool-activation wiring.

- [ ] SYN-029 Resumable fusion: new run vs context-restoring follow-up		@blocked_by:SYN-011
  Each fusion run is one-shot and cold — fine for an unrelated question. But a follow-up to a run just held is cold too: it restarts the panel and synth from scratch and loses what they already reasoned about. The follow-up often only surfaces later, in the ongoing chat with the main agent, when you want to put a sharper question back to the same panel.

  SYN-011 makes the judge able to keep prompting the panel sessions within a run. This task extends that: restore the judge and panel state so the caller can either start a NEW run (fresh panel + synth, no prior context) or send a FOLLOW-UP that resumes the same sessions and answers with their earlier context. Whether follow-up must also survive across separate invocations (a fresh CLI process or a later `fusion_agents` call) is not yet decided.

  User decision: the caller chooses per question — a new run, or a follow-up that resumes a specific prior run. Resuming is opt-in, not the implicit default for the next question.

  DoD: a question sent as a new run starts clean; a question sent as a follow-up to a named prior run resumes the same panel and synth sessions and its answer reflects the earlier round's context.
