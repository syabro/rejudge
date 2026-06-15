# Tools — mdtask

# Tasks

- [ ] TOO-001 Scaffold pi-fusion-agents extension and register the fusion_agents tool		#poc
  Separate Pi extension `pi-fusion-agents` exposing exactly one external tool, `fusion_agents`.
  Constraints: explicit invocation only (no auto-invocation in the POC); tool result content is final answer text only.
  Acceptance: extension loads in Pi; `fusion_agents` is available; invoking it with a question reaches our handler and returns without crashing Pi.

- [ ] TOO-002 fusion_agents invocation contract		#poc
  Callers pass a question/instruction, optionally with output instructions (e.g. P0/P1/P2/P3 buckets or a requested structure — an example, not a fixed scheme).
  Constraint: the requested output format is carried end-to-end — both inner agents and synthesis are told to honor it.
  Acceptance: a call carrying output instructions reaches the panel agents and synthesis intact; the returned answer respects the requested format.

- [ ] TOO-003 Full local tools for inner agents		#poc
  In the POC, inner agents get full local capabilities in the trusted environment.
  Constraints: tools = read/list/search, bash, edit/write; bash is full write capability that can modify or break the project/environment (accepted for the POC, not production-safe); network goes through bash/local CLIs if needed.
  Acceptance: an inner agent can read/search the project, run bash, and edit/write files during a run.

- [ ] TOO-004 DeepSWE tool adapter		#deepswe @blocked_by:PNL-009
  Adapt the working POC to run DeepSWE as a panel model; DeepSWE expects its own tool surface, not the standard local tools.
  Constraints: tool surface = file_editor / execute_bash / search / finish; adapter details decided here (deferred until the POC works).
  Acceptance: a panel agent backed by a DeepSWE model ID runs through the adapter and returns an output usable by synthesis.
