# Panel — mdtask

## Panel agent runner

The reusable unit behind the panel: `runPanelAgent(modelId, prompt, { cwd? })` runs one
agent end-to-end on a single `"provider/model"` id (e.g. `opencode-go/kimi-k2.6`) and
returns its finished answer text.

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

`runPanel(models, prompt, { cwd? })` runs the whole panel: it dispatches the byte-identical
prompt to every model concurrently — each as its own independent agent (own session, own
tool-use path) — and collects one finished result per model.

- Every agent receives the exact same `prompt`; diversity comes only from the model and the
  path it takes, never from the input.
- Returns one result per model in input order, each with its session left alive for a later
  synthesis/judge step (the caller disposes them).
- Failure is loud, never a silent partial panel: if any agent fails, the agents that did
  finish are disposed and the error is surfaced (no 2-of-3 result).

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

- [ ] PNL-008 All-or-nothing fusion success		#poc @blocked_by:PRJ-012
  A fusion result requires complete technical success across all three panels and synthesis.
  Constraints: success = technical completion (no model/tool/runtime error), not answer quality; no partial/degraded path (no 2-of-3, no synthesis-on-partial); failure-reporting detail (which stage failed) is deferred — keep it binary.
  Acceptance: a final answer is returned only when all three panels and synthesis complete without technical error; any technical failure yields a failure result and no final answer text.

- [ ] PNL-009 End-to-end demo on one project question		#poc @blocked_by:PRJ-012
  Prove the POC: run the three inner agents on one real research/answer question about the current project, synthesis returns one final answer.
  Constraints: research/answer task (not full SWE); uses the config's 3 panel + 1 synthesis models; runs in the current trusted environment; reproducible from documented config + invocation.
  Acceptance: a documented demo returns one coherent fused answer with all three panels and synthesis succeeding. This run is the trigger for the DeepSWE adaptation.
