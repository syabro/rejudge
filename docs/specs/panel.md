# Panel — mdtask

## Reviewer runner

The reusable unit behind the panel is `runReviewer(modelId, prompt, { cwd?, signal? })`: one reviewer in its own session on one `provider/model`, returning finished review text plus the live session.

- Tools: read/grep/find/ls by default (edit/write/bash with `fullTools`), plus `git_diff` and `web_search` when the host offers it. Other host extensions do not load, so reviewers cannot re-enter `rejudge`.
- The session is in-memory — nothing is written to the host's resume list.
- Failure is loud, never silent: a malformed/unknown model id, a model/tool/runtime error, or an incomplete run (any stop reason other than a clean `stop`) returns a clear error instead of a partial answer. If a clean run has no visible assistant text, the runner retries once in the same session and still never uses hidden thinking as the answer; an empty or failed retry is a clear error.
- On success the reviewer session stays alive so the judge can re-query it through `ask_panel`; the caller disposes it after the judge finishes.

## Panel fan-out

`runPanel(models, prompt, { cwd?, signal? })` runs the whole panel: it dispatches the byte-identical prompt to every model concurrently — each as its own independent agent (own session, own tool-use path) — and collects one finished result per model.

- Every reviewer receives the exact same `prompt`; diversity comes from the model and its tool-use path. The testing-only `--prompt-add-N` flag can deliberately force divergence; the `rejudge` tool never uses it.
- Returns one result per reviewer in config order, with sessions left alive for the judge.
- Failure is loud and failure-driven: the first panel-agent failure aborts the shared panel signal, cancelling siblings that are still running; successful sessions are disposed, and the first failing model/error is surfaced (no partial-panel result).

## Review run (all-or-nothing)

`runReview(config, prompt, { cwd?, signal?, fullTools? })` runs the panel and judge, returning `Result<ReviewSuccess, ReviewFailure>` without throwing:

- `ok({ answer, runId })` only when the full panel and judge complete technically. Intermediate reviewer outputs stay internal.
- `err(failure)` on panel, judge, or resume failure. There is no partial-panel path. The failure carries `stage` (`panel` | `judge` | `resume`), model/run ID, error text, and `aborted`.

Success means technical completion, not answer quality. Judge behavior is described in `judge.md`.

**Cancellation.** The Pi `rejudge` tool and CLI thread an `AbortSignal` through every reviewer and the judge. Aborting stops in-flight work and returns a failure with `aborted: true`.

## Demo

Configure `.rejudge/config.json`, then run from the repository root:

    bun src/cli.ts "explain what Rejudge does and how its all-or-nothing review works"

Reviewers inspect the repository, the judge produces one answer on stdout, and progress goes to stderr. Any technical failure exits non-zero; there is no partial answer.

## Activity log

The engine writes nothing to stdout/stderr on its own. It emits structured progress events to an `activitySink`: model lifecycle, tool/thinking/writing steps, panel/judge stage timing, total time, and diagnostics. With no sink it stays silent.

The CLI renders these events to stderr. Reviewers run concurrently, so their lines interleave by model name; stdout remains reserved for the answer.

    19:41:13 deepseek-v4-pro thinking 11s
    19:41:13 deepseek-v4-pro read src/review.ts 00s
    19:44:33 deepseek-v4-pro done in 3m31s
    panel stage done in 10m02s
    rejudge done in 10m57s

A step line carries the tool's params (a read's path, a `web_search` query) after the step name. Durations are `NNs` under a minute, `NmNNs` at or past one.

The Pi `rejudge` tool renders the same events as a live in-place block; see `extension.md`.

## Debug log

Set `"debugLog": true` in `.rejudge/config.json` to write one JSONL file under `.rejudge/logs/<timestamp>.jsonl`. Every reviewer and the judge append records to the same file:

    {"t":1718620862123,"model":"deepseek-v4-pro","kind":"thinking","chars":4213,"lines":88,"content":"…"}
    {"t":1718620864501,"model":"deepseek-v4-pro","kind":"tool_result","tool":"bash","toolCallId":"…","isError":false,"chars":51200,"lines":900,"content":"…(truncated)…"}

Each record carries `t` (epoch ms), `model`, `kind`, and `chars`/`lines` — the full size of the content even when the body is truncated, which is the actual context-cost signal. Thinking and assistant text are stored in full; tool args/results are truncated to the first and last few lines (with a char cap). Tool entries include `toolCallId` (to pair a call with its result and measure how long it took) and `isError`. The log also records the context/slowness signals — `compaction_start`/`compaction_end`, `retry_start`/`retry_end`, and a final `agent_end` per agent. A logging failure never breaks the run.

# Tasks

- [x] PNL-006 Inner-agent runner on a single model		#poc @blocked_by:PRJ-012
  The reusable unit: one panel agent running a given task + output instructions on one configured model in the trusted local environment. Acceptance: one inner agent runs end-to-end on a real question and returns finished text; a model/tool/runtime failure surfaces as a clear technical failure, not a silent partial result.

  **Implemented:**
  - `src/runner.ts` `runPanelAgent(modelId, prompt, { cwd? })` runs one agent in-process via the native SDK `createAgentSession` and returns `{ modelId, text, session }`; `resolveModel` turns a `"provider/model"` id into a model and throws on a malformed/unknown id.
  - Fixed tool set `read/edit/write/bash` only (no host global extensions); verified the agent actually invokes bash on a real run.
  - Failure is loud: an incomplete run (any stop reason other than `stop`), runtime/model error, or empty output throws — no silent partial result. Session left alive on success for a later judge re-query.
  - Smoke test (`test/runner.test.ts`, no mocks): real end-to-end run on `opencode-go/kimi-k2.6` returns finished text; `resolveModel` rejects malformed/unknown ids.

- [x] PNL-007 Fan out the identical task to three panel agents		#poc @blocked_by:PRJ-012
  Three inner agents run on the exact same task + output instructions; diversity comes only from different models/tool-use trajectories. Constraints: all three receive byte-identical input; each runs on its configured panel model ID. Acceptance: one invocation dispatches all three on the three models and collects three independent outputs.

  **Implemented:**
  - `src/panel.ts` `runPanel(models, prompt, { cwd? })` dispatches the byte-identical prompt to every model concurrently via `runPanelAgent` and collects one result per model in input order.
  - Each model runs as an independent agent (own session, own tool-use path); on success every session is returned alive for a later synthesis/judge re-query.
  - Loud failure, no silent partial panel: if any agent fails, the agents that did finish are disposed and the first error is surfaced (the binary fusion-result contract stays for PNL-008).
  - Smoke test (`test/panel.test.ts`, no mocks): a real run fans out to three `opencode-go/kimi-k2.6` agents and collects three independent outputs with three distinct sessions; a bad model id makes the panel reject instead of returning a partial.

- [x] PNL-008 All-or-nothing fusion success		#poc @blocked_by:PRJ-012
  A fusion result requires complete technical success across all three panels and synthesis. Constraints: success = technical completion (no model/tool/runtime error), not answer quality; no partial/degraded path (no 2-of-3, no synthesis-on-partial); failure-reporting detail (which stage failed) is deferred — keep it binary. Acceptance: a final answer is returned only when all three panels and synthesis complete without technical error; any technical failure yields a failure result and no final answer text.

  **Implemented:**
  - `src/fusion.ts` `fuse(config, prompt, { cwd? })` orchestrates panel fan-out + a synthesis call and returns a binary `FusionResult` (`{ ok: true, answer } | { ok: false }`).
  - A final answer is returned only when all three panels and synthesis complete technically; any failure (panel or synthesis) yields `{ ok: false }` with no answer text.
  - No partial/degraded path: runPanel's all-or-nothing means synthesis never runs on a partial panel; all sessions are disposed before returning (no leak). Failure detail (which stage) is deliberately omitted — binary only.
  - The synthesis step is a real but minimal call on the configured synth model; the real synthesis (format preservation, output-instruction threading) stays for SYN-010.
  - Smoke test (`test/fusion.test.ts`, no mocks): a real run with all four agents succeeding returns one answer; a panel failure and a synthesis failure each return `{ ok: false }` with no answer.

- [x] PNL-009 End-to-end demo on one project question		#poc @blocked_by:PRJ-012
  Prove the POC: run the three inner agents on one real research/answer question about the current project, synthesis returns one final answer. Constraints: research/answer task (not full SWE); uses the config's 3 panel + 1 synthesis models; runs in the current trusted environment; reproducible from documented config + invocation. Acceptance: a documented demo returns one coherent fused answer with all three panels and synthesis succeeding. This run is the trigger for the DeepSWE adaptation.

  **Implemented:**
  - `scripts/demo.ts` + committed `.pi/fusion-agents.json` run the real 3-panel (`deepseek-v4-pro`, `mimo-v2.5-pro`, `minimax-m3`) + synthesis (`glm-5.1`) fusion on a research question about this project; the panel agents read the repo to answer.
  - A real run completed with all three panels and synthesis succeeding and returned one coherent fused answer that correctly describes the extension and its two all-or-nothing gates — the POC proof.
  - Reproducible from the committed config + `bun scripts/demo.ts` (no mocks). This run is the trigger for the DeepSWE adaptation (TLS-004).

- [x] PNL-013 Log inner-agent activity on change		!high
  Right now we start a panel/synth agent and just wait — nothing prints until it finishes. We can't tell what each agent is doing or which one is slow.

  Subscribe to each agent's events and log to stderr only on activity change — kind = thinking | tool:<name> | writing | done, so read→bash logs while thinking→thinking and read→read collapse. Show the concrete tool with an emoji, e.g. "[deepseek] 👨‍💻 bash"; no timer. Pattern adapted from pi-telegram lib/activity.ts.

  No auto hang-detection: a stuck agent just shows up as the log going quiet.

  **Implemented:**
  - `src/activity.ts` `attachActivityLog(session, modelId)` subscribes one agent and logs `HH:MM:SS <model> <activity>` to stderr each time the activity changes (`thinking` / the concrete tool / `writing` / `done`); no emoji, no in-place redraw, no timer/TUI. The timestamp marks the change, so the gap to the next line is the previous activity's duration.
  - Wired into `runPanelAgent` (the single chokepoint for panel and synth agents), so every fusion stage is traced; detached in a `finally`. The three panel agents run concurrently, so their lines interleave and are told apart by the model name.
  - Verified live on the real 4-model demo; the existing real-run smoke tests (runner/panel/fusion) exercise it end-to-end — no separate unit test (it's logging over the runner, guaranteed by the real runs).

- [x] PNL-016 Forward the cancel signal through fusion		!high
  The tool receives an AbortSignal but drops it — fuse/runPanel/runPanelAgent don't take one. Cancelling a call leaves every agent running and burning credits. Thread the signal end-to-end so cancel actually stops the in-flight agents.

  **Implemented:**
  - `RunPanelAgentOptions` gained `signal?: AbortSignal`; `fuse` forwards it (via the options it already spreads) to every panel agent and the synthesis agent — no changes needed in `fuse`/`runPanel`/`synthesize` themselves.
  - `runPanelAgent` honors it: `throwIfAborted()` before starting, a `session.abort()` listener for the in-flight run, and a re-check inside the try (a signal that fires during session creation throws there, because `session.abort()` is a no-op before the run exists). An abort surfaces as a thrown error, so the fusion returns `{ ok: false }`.
  - `src/index.ts` now passes the tool's real `AbortSignal` into `fuse` (was dropped).
  - Tests (`test/fusion.test.ts`, real runs): an already-aborted signal fails fast with no model call; a mid-run abort cancels the fusion to `{ ok: false }`.

- [x] PNL-017 Report which stage and model failed on a fusion failure
  Fusion returns a bare {ok:false}; on failure you can't tell which panel/synth model broke or why. Surface the failing stage, model, and error (relaxing the binary result) so failures are debuggable.

  **Implemented:**
  - `fuse` returns a neverthrow `Result<string, FusionFailure>`; `err(failure)` carries `{ stage, model, error, aborted }` — still all-or-nothing, just with the reason attached.
  - `runPanelAgent` returns `Result<PanelAgentResult, AgentFailure>` (model + error) and never throws, so `fuse` reports the failing model as structured data rather than parsing a message. `aborted` is read from the cancel signal, so a user cancel reads as an abort, not a model fault.
  - The CLI, the `fusion_agents` tool, and the demo all surface the stage/model/error via a shared `formatFailure` one-liner.
  - Tests: a deterministic pre-abort assert (`stage:"panel"`, `aborted:true`, first model) plus integration asserts that a bad panel/synth model surfaces its stage + id with `aborted:false`.

- [x] PNL-022 Persist a debug log of inner-agent activity		!high
  The live activity log only goes to stderr and vanishes with the run. Write it to a debug log on disk so we can trace afterwards what each agent did and where the time went.

  Decided: per-run file, JSONL, gated by a `debugLog` flag in the config (default off).

  **Implemented:**
  - `src/debug-log.ts`: when `config.debugLog` is on, `fuse` opens one per-run JSONL file (`.pi/fusion-logs/<timestamp>.jsonl`, gitignored) and threads it to every agent; `attachDebugLog` records thinking/text in full and tool args/results truncated (head/tail + char cap), each with the full `chars`/`lines` size — the context-cost signal — plus `compaction`/`retry`/`agent_end` for the slowness picture.
  - Records are epoch-ms timestamped and tagged with `model`, `kind`, and (for tools) `toolCallId`/`isError`, so a postmortem can pair calls with results and see per-tool timing and which agent did what.
  - Hardened: a logging failure (mkdir, write, circular stringify) never breaks a run — it warns to stderr and the run continues.
  - Config: `debugLog: boolean` (default false), validated; documented in `config.md`.
  - Tests: pure truncation test; config parse test; a real run with `debugLog:true` that reads back the produced JSONL and checks it's valid and populated.

- [x] PNL-041 Stop the panel on the first model failure
  A fusion run can keep sibling panel agents waiting or running after one panel model has already failed. In the observed run, `opencode-go/kimi-k2.7` failed as an unknown model while the other panel models continued showing as in progress until the run was cancelled several seconds later.

  The panel should be failure-driven: when any panel agent fails during start or execution, that failure ends the whole panel run and aborts the other panel agents. Do not add a separate preflight that resolves or checks all models before normal launch; the important behavior is that the first real failure stops the remaining work.

  User decision: if one panel model fails, stop the panel run and cancel the remaining panel agents instead of letting them continue.

  DoD:
  - the first panel-agent failure returns a clear panel failure with the offending model ID;
  - already-started sibling panel agents are aborted/disposed, and not-yet-started siblings are not allowed to keep running;
  - CLI and `fusion_agents` stop showing unrelated panel models as still in progress after the failure;
  - tests cover the generic behavior by making one panel agent fail while at least one sibling is in progress, not by fitting only the exact `kimi-k2.7` unknown-model case.

  **Implemented:**
  - Panel fan-out now aborts the shared panel run as soon as one agent returns a failure.
  - Sibling agents finish their cancellation cleanup, so progress rows end as cancelled instead of staying in progress.
  - The returned panel failure keeps the original offending model ID and error.
  - A deterministic regression test covers one failing panel agent while a sibling is already in progress.

- [x] PNL-048 Retry empty visible model output once		#bug !high
  A `runPanelAgent` turn can finish with `stopReason: "stop"` but still have no visible assistant text. One observed case put the whole answer only into hidden thinking, so the run correctly failed instead of using that hidden content as the answer.

  When `runPanelAgent` sees a clean stop but `getLastAssistantText()` is empty, retry once in that same session with a short prompt that asks for the final answer in visible text only. Never use hidden thinking as the answer. Do not retry non-clean stops, and do not add a second recovery attempt.

  This task only changes the shared `runPanelAgent` path, so normal panel and synth runs get the recovery automatically. `ask_panel` re-queries are out of scope here.

  User decision: hidden thinking must not be used as the answer; recovery is one visible-text-only retry in the same session.

  DoD:
  - `runPanelAgent` retries exactly once after a clean stop with empty visible text;
  - a successful retry returns the visible answer and keeps the normal session lifecycle;
  - if the retry still returns empty visible text, the run fails with an explicit empty-output-after-retry error;
  - if the retry does not stop cleanly, the run fails loudly with that retry failure instead of masking it;
  - tests deterministically cover the successful recovery path, the still-empty-after-retry path, and the non-clean retry path.

  **Implemented:**
  - Clean empty visible output now triggers one same-session retry with a visible-text-only prompt.
  - Successful retry output is returned as the answer while keeping the session alive for normal caller disposal.
  - Empty retry output fails with `empty-output-after-retry`; non-clean retry output reports the retry stop reason and error.
  - Deterministic tests cover retry success, still-empty retry failure, non-clean retry failure, and no retry on an initially non-clean stop.
