# Panel — mdtask

## Panel agent runner

The reusable unit behind the panel: `runPanelAgent(modelId, prompt, { cwd?, signal? })`
runs one agent end-to-end on a single `"provider/model"` id (e.g. `opencode-go/kimi-k2.6`)
and returns its finished answer text.

- The agent runs in the trusted local environment with a fixed tool set — `read`, `edit`,
  `write`, `bash` — and nothing else. Host global extensions are not inherited (this keeps
  the run reproducible, dodges third-party tool schemas the provider rejects, and stops the
  agent from re-entering `fusion_agents`).
- Failure is loud, never silent: a malformed/unknown model id, a model/tool/runtime error,
  an incomplete run (any stop reason other than a clean `stop`), or empty output all throw a
  clear error instead of returning a partial answer.
- On success the agent's session is returned alive; the caller disposes it (kept open so a
  later synthesis/judge step can re-query the same agent).

## Panel fan-out

`runPanel(models, prompt, { cwd?, signal? })` runs the whole panel: it dispatches the
byte-identical prompt to every model concurrently — each as its own independent agent (own
session, own tool-use path) — and collects one finished result per model.

- Every agent receives the exact same `prompt`; diversity comes only from the model and the
  path it takes, never from the input.
- Returns one result per model in input order, each with its session left alive for a later
  synthesis/judge step (the caller disposes them).
- Failure is loud, never a silent partial panel: if any agent fails, the agents that did
  finish are disposed and the error is surfaced (no partial-panel result).

## Fusion (all-or-nothing)

`fuse(config, prompt, { cwd?, signal?, fullTools? })` runs the whole flow — panel fan-out
then one synthesis call — and returns a neverthrow `Result<string, FusionFailure>` (it never
throws):

- `ok(answer)` only when every panel **and** synthesis complete without a technical
  (model/tool/runtime) error. The value is the single final text; intermediate panel
  outputs are never surfaced.
- `err(failure)` on any technical failure. There is still no partial path: synthesis is
  never attempted on an incomplete panel, and there is no partial-panel result. The `failure`
  carries which `stage` broke (`"panel"` | `"synth"`), the `model` id, the `error` text, and
  `aborted` (true for a deliberate cancel rather than a model fault). `formatFailure(failure)`
  renders it as a one-line `<stage> (<model>) failed: <error>` (or `… aborted`) for CLI/tool
  output.

"Success" means technical completion, not answer quality. The synthesis stage itself
(output-instruction threading, format preservation) is described under Synthesis in
`synth.md`.

**Cancellation.** Pass an `AbortSignal` as `signal` (the `fusion_agents` tool forwards the
one it gets from Pi). It threads down to every panel agent and the synthesis agent;
aborting it stops the in-flight agents (and short-circuits any not yet started), so a
cancelled run returns `err(failure)` with `aborted: true` instead of leaving agents running
and burning credits.

## Demo

A reproducible end-to-end demo runs the real panel + synthesis on one research question
about this project. The config lives in `.pi/fusion-agents.json` (panel:
`deepseek-v4-pro`, `mimo-v2.5-pro`, `minimax-m3`; synth: `glm-5.1`, all on `opencode-go`).
Run it from the repo root:

    bun scripts/demo.ts

The three panel agents read the repo (full local tools) to answer the question, synthesis
fuses their answers, and the single final answer is printed to stdout (progress to stderr).
A successful run needs all three panels and synthesis to complete; any technical failure
prints a failure and exits non-zero — never a partial answer.

## Activity log

The engine writes nothing to stdout/stderr on its own. While a fusion runs it emits
structured progress events to a caller-supplied sink (`activitySink`): a model's start and
end (with its status and duration), each step's start and end (every tool call, plus the
`thinking`/`writing` phases — the end carries the step's duration), the panel/synth stage
times, the total run time, and diagnostics. With no sink the engine stays silent; each
consumer renders the events its own way.

The CLI (and demo) render them to **stderr** as a plain append log — a line per step as it
finishes (with its duration), then per-model, per-stage, and total times. The panel agents
run concurrently, so their lines interleave, told apart by the model name. stderr keeps the
log off stdout, where the fused answer goes.

    19:41:13 deepseek-v4-pro thinking 11.0s
    19:41:13 deepseek-v4-pro read 0.2s
    19:44:33 deepseek-v4-pro done in 3:31
    panel stage done in 10:02
    fusion done in 10:57

The `fusion_agents` Pi tool renders the same events as a live in-place block instead — see
`extension.md`.

## Debug log

For after-the-fact analysis of what bloats the context window or slows a run, set
`"debugLog": true` in `.pi/fusion-agents.json` (default off). Each run then writes one
JSONL file under `.pi/fusion-logs/<timestamp>.jsonl` (gitignored; the path is printed to
stderr at the start of the run). Every inner agent (panel + synthesis) appends records to
the same file, one JSON object per line:

    {"t":1718620862123,"model":"deepseek-v4-pro","kind":"thinking","chars":4213,"lines":88,"content":"…"}
    {"t":1718620864501,"model":"deepseek-v4-pro","kind":"tool_result","tool":"bash","toolCallId":"…","isError":false,"chars":51200,"lines":900,"content":"…(truncated)…"}

Each record carries `t` (epoch ms), `model`, `kind`, and `chars`/`lines` — the full size of
the content even when the body is truncated, which is the actual context-cost signal.
Thinking and assistant text are stored in full; tool args/results are truncated to the
first and last few lines (with a char cap). Tool entries include `toolCallId` (to pair a
call with its result and measure how long it took) and `isError`. The log also records the
context/slowness signals — `compaction_start`/`compaction_end`, `retry_start`/`retry_end`,
and a final `agent_end` per agent. A logging failure never breaks the run.

# Tasks

- [x] PNL-006 Inner-agent runner on a single model		#poc @blocked_by:PRJ-012
  The reusable unit: one panel agent running a given task + output instructions on one configured model in the trusted local environment.
  Acceptance: one inner agent runs end-to-end on a real question and returns finished text; a model/tool/runtime failure surfaces as a clear technical failure, not a silent partial result.

  **Implemented:**
  - `src/runner.ts` `runPanelAgent(modelId, prompt, { cwd? })` runs one agent in-process via the native SDK `createAgentSession` and returns `{ modelId, text, session }`; `resolveModel` turns a `"provider/model"` id into a model and throws on a malformed/unknown id.
  - Fixed tool set `read/edit/write/bash` only (no host global extensions); verified the agent actually invokes bash on a real run.
  - Failure is loud: an incomplete run (any stop reason other than `stop`), runtime/model error, or empty output throws — no silent partial result. Session left alive on success for a later judge re-query.
  - Smoke test (`test/runner.test.ts`, no mocks): real end-to-end run on `opencode-go/kimi-k2.6` returns finished text; `resolveModel` rejects malformed/unknown ids.

- [x] PNL-007 Fan out the identical task to three panel agents		#poc @blocked_by:PRJ-012
  Three inner agents run on the exact same task + output instructions; diversity comes only from different models/tool-use trajectories.
  Constraints: all three receive byte-identical input; each runs on its configured panel model ID.
  Acceptance: one invocation dispatches all three on the three models and collects three independent outputs.

  **Implemented:**
  - `src/panel.ts` `runPanel(models, prompt, { cwd? })` dispatches the byte-identical prompt to every model concurrently via `runPanelAgent` and collects one result per model in input order.
  - Each model runs as an independent agent (own session, own tool-use path); on success every session is returned alive for a later synthesis/judge re-query.
  - Loud failure, no silent partial panel: if any agent fails, the agents that did finish are disposed and the first error is surfaced (the binary fusion-result contract stays for PNL-008).
  - Smoke test (`test/panel.test.ts`, no mocks): a real run fans out to three `opencode-go/kimi-k2.6` agents and collects three independent outputs with three distinct sessions; a bad model id makes the panel reject instead of returning a partial.

- [x] PNL-008 All-or-nothing fusion success		#poc @blocked_by:PRJ-012
  A fusion result requires complete technical success across all three panels and synthesis.
  Constraints: success = technical completion (no model/tool/runtime error), not answer quality; no partial/degraded path (no 2-of-3, no synthesis-on-partial); failure-reporting detail (which stage failed) is deferred — keep it binary.
  Acceptance: a final answer is returned only when all three panels and synthesis complete without technical error; any technical failure yields a failure result and no final answer text.

  **Implemented:**
  - `src/fusion.ts` `fuse(config, prompt, { cwd? })` orchestrates panel fan-out + a synthesis call and returns a binary `FusionResult` (`{ ok: true, answer } | { ok: false }`).
  - A final answer is returned only when all three panels and synthesis complete technically; any failure (panel or synthesis) yields `{ ok: false }` with no answer text.
  - No partial/degraded path: runPanel's all-or-nothing means synthesis never runs on a partial panel; all sessions are disposed before returning (no leak). Failure detail (which stage) is deliberately omitted — binary only.
  - The synthesis step is a real but minimal call on the configured synth model; the real synthesis (format preservation, output-instruction threading) stays for SYN-010.
  - Smoke test (`test/fusion.test.ts`, no mocks): a real run with all four agents succeeding returns one answer; a panel failure and a synthesis failure each return `{ ok: false }` with no answer.

- [x] PNL-009 End-to-end demo on one project question		#poc @blocked_by:PRJ-012
  Prove the POC: run the three inner agents on one real research/answer question about the current project, synthesis returns one final answer.
  Constraints: research/answer task (not full SWE); uses the config's 3 panel + 1 synthesis models; runs in the current trusted environment; reproducible from documented config + invocation.
  Acceptance: a documented demo returns one coherent fused answer with all three panels and synthesis succeeding. This run is the trigger for the DeepSWE adaptation.

  **Implemented:**
  - `scripts/demo.ts` + committed `.pi/fusion-agents.json` run the real 3-panel (`deepseek-v4-pro`, `mimo-v2.5-pro`, `minimax-m3`) + synthesis (`glm-5.1`) fusion on a research question about this project; the panel agents read the repo to answer.
  - A real run completed with all three panels and synthesis succeeding and returned one coherent fused answer that correctly describes the extension and its two all-or-nothing gates — the POC proof.
  - Reproducible from the committed config + `bun scripts/demo.ts` (no mocks). This run is the trigger for the DeepSWE adaptation (TLS-004).

- [x] PNL-013 Log inner-agent activity on change		!high
  Right now we start a panel/synth agent and just wait — nothing prints until it
  finishes. We can't tell what each agent is doing or which one is slow.

  Subscribe to each agent's events and log to stderr only on activity change —
  kind = thinking | tool:<name> | writing | done, so read→bash logs while
  thinking→thinking and read→read collapse. Show the concrete tool with an emoji,
  e.g. "[deepseek] 👨‍💻 bash"; no timer. Pattern adapted from pi-telegram
  lib/activity.ts.

  No auto hang-detection: a stuck agent just shows up as the log going quiet.

  **Implemented:**
  - `src/activity.ts` `attachActivityLog(session, modelId)` subscribes one agent and logs
    `HH:MM:SS <model> <activity>` to stderr each time the activity changes (`thinking` /
    the concrete tool / `writing` / `done`); no emoji, no in-place redraw, no timer/TUI.
    The timestamp marks the change, so the gap to the next line is the previous activity's
    duration.
  - Wired into `runPanelAgent` (the single chokepoint for panel and synth agents), so
    every fusion stage is traced; detached in a `finally`. The three panel agents run
    concurrently, so their lines interleave and are told apart by the model name.
  - Verified live on the real 4-model demo; the existing real-run smoke tests
    (runner/panel/fusion) exercise it end-to-end — no separate unit test (it's logging
    over the runner, guaranteed by the real runs).

- [x] PNL-016 Forward the cancel signal through fusion		!high
  The tool receives an AbortSignal but drops it — fuse/runPanel/runPanelAgent don't
  take one. Cancelling a call leaves every agent running and burning credits.
  Thread the signal end-to-end so cancel actually stops the in-flight agents.

  **Implemented:**
  - `RunPanelAgentOptions` gained `signal?: AbortSignal`; `fuse` forwards it (via the
    options it already spreads) to every panel agent and the synthesis agent — no changes
    needed in `fuse`/`runPanel`/`synthesize` themselves.
  - `runPanelAgent` honors it: `throwIfAborted()` before starting, a `session.abort()`
    listener for the in-flight run, and a re-check inside the try (a signal that fires
    during session creation throws there, because `session.abort()` is a no-op before the
    run exists). An abort surfaces as a thrown error, so the fusion returns `{ ok: false }`.
  - `src/index.ts` now passes the tool's real `AbortSignal` into `fuse` (was dropped).
  - Tests (`test/fusion.test.ts`, real runs): an already-aborted signal fails fast with no
    model call; a mid-run abort cancels the fusion to `{ ok: false }`.

- [x] PNL-017 Report which stage and model failed on a fusion failure
  Fusion returns a bare {ok:false}; on failure you can't tell which panel/synth model
  broke or why. Surface the failing stage, model, and error (relaxing the binary
  result) so failures are debuggable.

  **Implemented:**
  - `fuse` returns a neverthrow `Result<string, FusionFailure>`; `err(failure)` carries
    `{ stage, model, error, aborted }` — still all-or-nothing, just with the reason attached.
  - `runPanelAgent` returns `Result<PanelAgentResult, AgentFailure>` (model + error) and
    never throws, so `fuse` reports the failing model as structured data rather than parsing
    a message. `aborted` is read from the cancel signal, so a user cancel reads as an abort,
    not a model fault.
  - The CLI, the `fusion_agents` tool, and the demo all surface the stage/model/error via a
    shared `formatFailure` one-liner.
  - Tests: a deterministic pre-abort assert (`stage:"panel"`, `aborted:true`, first model)
    plus integration asserts that a bad panel/synth model surfaces its stage + id with
    `aborted:false`.

- [x] PNL-022 Persist a debug log of inner-agent activity		!high
  The live activity log only goes to stderr and vanishes with the run. Write it to a
  debug log on disk so we can trace afterwards what each agent did and where the time
  went.

  Decided: per-run file, JSONL, gated by a `debugLog` flag in the config (default off).

  **Implemented:**
  - `src/debug-log.ts`: when `config.debugLog` is on, `fuse` opens one per-run JSONL file
    (`.pi/fusion-logs/<timestamp>.jsonl`, gitignored) and threads it to every agent;
    `attachDebugLog` records thinking/text in full and tool args/results truncated
    (head/tail + char cap), each with the full `chars`/`lines` size — the context-cost
    signal — plus `compaction`/`retry`/`agent_end` for the slowness picture.
  - Records are epoch-ms timestamped and tagged with `model`, `kind`, and (for tools)
    `toolCallId`/`isError`, so a postmortem can pair calls with results and see per-tool
    timing and which agent did what.
  - Hardened: a logging failure (mkdir, write, circular stringify) never breaks a run — it
    warns to stderr and the run continues.
  - Config: `debugLog: boolean` (default false), validated; documented in `config.md`.
  - Tests: pure truncation test; config parse test; a real run with `debugLog:true` that
    reads back the produced JSONL and checks it's valid and populated.
