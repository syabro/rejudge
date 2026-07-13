# Judge — mdtask

## Judge

`runJudge(judgeModelId, panel, askPanel, { cwd? })` runs one distinct judge call that fuses reviewer analyses into a single final answer and returns only that text.

- The judge works only from the panel's analyses; the task itself stays with the panel. It fuses them and writes the answer in its own voice — never referring to the analyses or to the fact a panel produced them, so only a standalone answer is surfaced. It gives back that final answer alone; intermediate panel outputs stay internal.
- The judge's only tool is `ask_panel` (see below): it reaches the task, its requirements, the files, the diff, and any check by re-querying the panel models. The requested output format reaches the final answer through the analyses themselves — the panel already applied it, and the judge mirrors it.
- Runs as its own agent on the configured judge model and disposes its session; `runReview` owns the reviewer sessions and calls the judge as the second all-or-nothing stage.

## Multi-round: the judge can re-query the panel

The judge's only tool is `ask_panel`: it re-queries still-live reviewer sessions to settle disagreement, confirm a load-bearing claim, or pressure a disputed finding. A call takes a batch of `{role, question}` queries and runs them in parallel. Reviewer sessions use stable keys (`panel-1`, `panel-2`, …), so the same provider/model can fill several slots without changing which session receives a follow-up. Model IDs remain display metadata. Each reviewer keeps its earlier context.

Consulting the panel is the default pre-answer step. The judge prompt requires `ask_panel` when material analyses disagree, a load-bearing claim is weak, a critical checkable claim may be wrong despite agreement, or task/output requirements are unclear. There is no fixed extra round or consensus requirement.

`ask_panel` is always the judge's tool — there is no config/CLI/tool flag to turn it on or off. During a re-query, the targeted panel row reopens in the live progress block, shows its current step and elapsed time, then returns to its terminal state when the re-query finishes.

## Resumable runs: follow up on a prior run

Every run is persisted so a later invocation can resume the same reviewer and judge sessions. A fresh run prints its ID; the CLI resumes by ID:

    rejudge "review my auth change"
    rejudge --resume <runId> "you missed the CSRF case — re-check it"

The follow-up goes to the run's restored judge — it already holds round 1 and can re-query the restored panels via `ask_panel`; the panel fan-out is not re-run. Resuming is opt-in at use: a run with no `--resume` always starts clean.

Runs live under `${TMPDIR}/rejudge/runs/<runId>/`, outside the project and Pi's own `/resume` list. They expire after about 24 hours and are bound to the original working directory. Resume is best-effort through CLI `--resume <runId>` or the `rejudge` tool's `resumeRunId` parameter.

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

- [x] SYN-029 Resumable fusion: new run vs context-restoring follow-up		@blocked_by:SYN-011
  Each fusion run is one-shot and cold — fine for an unrelated question. But a follow-up to a run just held is cold too: it restarts the panel and synth from scratch and loses what they already reasoned about. The follow-up often only surfaces later, in the ongoing chat with the main agent, when you want to put a sharper question back to the same panel.

  SYN-011 makes the judge able to keep prompting the panel sessions within a run. This task extends that: restore the judge and panel state so the caller can either start a NEW run (fresh panel + synth, no prior context) or send a FOLLOW-UP that resumes the same sessions and answers with their earlier context. Whether follow-up must also survive across separate invocations (a fresh CLI process or a later `fusion_agents` call) is not yet decided.

  User decision: the caller chooses per question — a new run, or a follow-up that resumes a specific prior run. Resuming is opt-in, not the implicit default for the next question.

  DoD: a question sent as a new run starts clean; a question sent as a follow-up to a named prior run resumes the same panel and synth sessions and its answer reflects the earlier round's context.

  **Implemented:**
  - Decided the open question: follow-up DOES survive across separate processes. Every run is persisted (by the SDK's SessionManager) to the OS temp dir — `${TMPDIR}/fusion-agents-sessions/<runId>/` — so a fresh CLI process can resume it; the host's `/resume` list is untouched (a different directory entirely).
  - `src/run-store.ts` owns the run id (sortable timestamp + rand), the per-run dir, a `manifest.json` (cwd + config + model→file map, written last as the commit marker), and 24h TTL GC (by dir mtime, only on runId-shaped dirs). All best-effort — persistence never breaks a run.
  - `fuse` now returns `{answer, runId}`. A fresh run persists each session and writes the manifest on success; `resumeRunId` reopens the panels (live, for `ask_panel`) and the synth and prompts the synth with the RAW follow-up (round 1 is already in its history — no re-synthesis). Guards: the run's cwd must match, and every session file must still exist, else a clean `resume`-stage failure.
  - CLI `--resume <id>`: a fresh run prints its id; a resume extends the same run. The runner gained `createInnerSession` + `sessionManager`/`existingSession` options; the engine is otherwise unchanged.
  - Scope: resume is CLI-only in v1; the `fusion_agents` tool's `resumeRunId` is a planned follow-up.
  - Smoke tests (real models, no mocks): a fresh run plants a fact, a separate `--resume` follow-up recalls it, a no-resume control can't; deterministic tests cover the run-store (id/manifest/GC) and the resume guards (unknown run, cwd mismatch, missing files).

- [x] SYN-039 Give the synth/judge only the `ask_panel` tool
  The synth/"judge" agent currently gets the same tools as a panel agent — `read`/`grep`/`find`/`ls`, `git_diff`, `web_search`, and (under `fullTools`) `edit`/`write`/`bash` — plus `ask_panel`. With those tools it stops delegating: instead of re-querying the panel authors through `ask_panel`, it re-fetches the diff and reads the source itself to check their claims. That duplicates the panel's work, slows synthesis, and lets instructions inside the task text (e.g. "fetch the diff yourself") pull the judge into investigating instead of fusing.

  The judge should run with `ask_panel` as its only tool. It fuses the panel's analyses and routes any verification back to the authors, who still have file access and their round-1 context; if none can confirm something, it reports the uncertainty instead of checking it itself. The synthesis prompt should also tell the judge it has no direct file or diff access.

  DoD:
  - the judge runs with `ask_panel` as its only tool — no `read`/`grep`/`find`/`ls`, `git_diff`, `web_search`, or `edit`/`write`/`bash` — on the fresh-run, resume, and one-shot synthesis paths (the one-shot path wires no `ask_panel`, so the judge has no tools there)
  - `fullTools` widens only the panel agents; the judge never gets `edit`/`write`/`bash`
  - panel agents' tool set is unchanged
  - the judge's tool set is asserted deterministically, not left to model behavior

  **Implemented:**
  - The judge runs with `ask_panel` as its only tool on both the fresh-run and resume paths. `ask_panel` is an explicit required input to the judge, so every judge is built with it.
  - User decision: `ask_panel` is always the judge's tool, and the judge's prompt carries only the panel's analyses — it reaches the task, the files, the diff, and any check through the panel via `ask_panel`. The requested output format reaches the answer through the analyses (the panel applied it; the judge mirrors it).
  - `fullTools` widens only the panel; the judge's tool policy follows its `synth` role, set per stage by `fuse`, so it stays scoped to the synth stage. Panel agents' tool set is unchanged.
  - Deterministic smoke test: a `synth`-role session activates exactly `[ask_panel]`, and `fullTools` leaves that set unchanged.

- [x] SYN-040 Show live panel activity while the judge re-queries via ask_panel
  When the judge re-queries the panel sessions through `ask_panel`, those sessions run again, but their rows in the live progress block stay at the round-1 "done" state and show no new activity. Only the judge's row updates. This is the v1 limitation noted in this spec's "Multi-round" section.

  A re-queried panel's row must show its activity during the re-query — its current step and elapsed time — and return to "done" when the re-query completes. The re-query stays read-only, the no-throw / all-or-nothing flow is unchanged, and this applies to both fresh and resumed runs.

  DoD: during an `ask_panel` re-query, the re-queried panel's row shows the running state with its steps and returns to "done" on completion.

  **Implemented:**
  - Panel re-queries now appear in the live progress tree instead of leaving panel rows frozen as done.
  - A re-queried row shows the current step and elapsed time, then returns to done, cancelled, or error when the follow-up ends.
  - Fresh and resumed runs use the same behavior; cancelled and error re-queries still return as tool text rather than breaking fusion.

- [x] SYN-042 Use stable role keys for judge ↔ panel communication		#release
  Duplicate model choices should not make the judge talk to the wrong panel session.

  Internal fusion communication currently identifies judge and panel sessions by model slug. That breaks when the same model is used in more than one role, for example `gpt-5.5` as both judge and a panel member. The UI and logs may show the right model names, but internal routing needs stable role identities.

  Use role keys for internal addressing: `judge`, `panel-1`, `panel-2`, `panel-3`, and so on. Model IDs stay as provider/model configuration and display metadata, not as communication keys.

  User decision: internal judge/panel communication must not be keyed by model slugs; use stable role keys instead.

  DoD: judge re-queries and progress/debug routing address sessions by role key, so duplicate model IDs across judge and panel slots do not collide or misroute.

  **Implemented:**
  - Reviewer slots use stable `panel-N` keys and the judge uses `judge`; provider/model IDs remain display metadata.
  - `ask_panel` targets reviewer role keys, so duplicate model choices re-query the intended live or resumed session.
  - Pi progress and debug logs keep duplicate-model slots separate across initial runs and follow-ups.
  - New persisted runs retain role keys; older incompatible temporary runs expire instead of resuming ambiguously.

- [ ] SYN-050 Expose explicit fresh/resume mode for Fusion reviews		@blocked_by:EXT-051
  Review follow-ups should make the cost and context choice explicit instead of rerunning full panels by accident.

  Fusion review launchers need the same mode contract: `fresh` starts a new full review, and `resume` continues a selected prior run by `runId`. Existing review launchers should use that contract before calling either the Pi tool or the CLI. Future review launchers should reuse the same contract instead of inventing command-specific behavior.

  User decisions:
  - Support both Pi tool and CLI-driven review launches.
  - Follow-up/resume is optional, not mandatory.
  - Do not hardcode today’s entry points; future review launchers should reuse the same mechanism.

  DoD:
  - Review launch flow has an explicit `fresh` vs `resume` choice.
  - `resume` requires a concrete prior run id.
  - Existing review launchers pass the selected mode to the Pi tool or CLI without reimplementing resume behavior.
  - User-visible output includes enough run id/context to make a later follow-up possible.
