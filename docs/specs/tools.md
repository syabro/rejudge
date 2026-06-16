# Tools — mdtask

## fusion_agents

The extension registers one external tool, `fusion_agents`. Call it explicitly with a `question` (a question or instruction); it returns a single final answer, text only. The package loads as a Pi extension via the `pi.extensions` manifest (entry `src/index.ts`).

POC status: the tool is wired and reachable; the panel fan-out and synthesis that produce the fused answer arrive in the CFG/PNL/SYN tasks — for now the handler echoes the question.

# Tasks

- [x] TOO-001 Scaffold pi-fusion-agents extension and register the fusion_agents tool		#poc @blocked_by:PRJ-012
  Separate Pi extension `pi-fusion-agents` exposing exactly one external tool, `fusion_agents`.
  Constraints: explicit invocation only (no auto-invocation in the POC); tool result content is final answer text only.
  Acceptance: extension loads in Pi; `fusion_agents` is available; invoking it with a question reaches our handler and returns without crashing Pi.

  **Implemented:**
  - `src/index.ts` default export registers one external tool `fusion_agents` via `pi.registerTool` — typebox `question` param, explicit invocation, result is a single text block (final text only).
  - Placeholder handler echoes the question; panel fan-out + synthesis deferred to CFG/PNL/SYN.
  - Smoke test (no mocks): loads the extension through Pi's real loader (`discoverAndLoadExtensions`) and asserts `fusion_agents` registers on load; confirmed it fails when the extension throws on load. typecheck green.

- [ ] TOO-002 fusion_agents invocation contract		#poc @blocked_by:PRJ-012
  Callers pass a question/instruction, optionally with output instructions (e.g. P0/P1/P2/P3 buckets or a requested structure — an example, not a fixed scheme).
  Constraint: the requested output format is carried end-to-end — both inner agents and synthesis are told to honor it.
  Acceptance: a call carrying output instructions reaches the panel agents and synthesis intact; the returned answer respects the requested format.

- [ ] TOO-003 Full local tools for inner agents		#poc @blocked_by:PRJ-012
  In the POC, inner agents get full local capabilities in the trusted environment.
  Constraints: tools = read/list/search, bash, edit/write; bash is full write capability that can modify or break the project/environment (accepted for the POC, not production-safe); network goes through bash/local CLIs if needed.
  Acceptance: an inner agent can read/search the project, run bash, and edit/write files during a run.

- [ ] TOO-004 DeepSWE tool adapter		#deepswe @blocked_by:PNL-009
  Adapt the working POC to run DeepSWE as a panel model; DeepSWE expects its own tool surface, not the standard local tools.
  Constraints: tool surface = file_editor / execute_bash / search / finish; adapter details decided here (deferred until the POC works).
  Acceptance: a panel agent backed by a DeepSWE model ID runs through the adapter and returns an output usable by synthesis.
