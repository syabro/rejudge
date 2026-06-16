# Panel — mdtask

# Tasks

- [ ] PNL-006 Inner-agent runner on a single model		#poc @blocked_by:PRJ-012
  The reusable unit: one panel agent running a given task + output instructions on one configured model in the trusted local environment.
  Acceptance: one inner agent runs end-to-end on a real question and returns finished text; a model/tool/runtime failure surfaces as a clear technical failure, not a silent partial result.

- [ ] PNL-007 Fan out the identical task to three panel agents		#poc @blocked_by:PRJ-012
  Three inner agents run on the exact same task + output instructions; diversity comes only from different models/tool-use trajectories.
  Constraints: all three receive byte-identical input; each runs on its configured panel model ID.
  Acceptance: one invocation dispatches all three on the three models and collects three independent outputs.

- [ ] PNL-008 All-or-nothing fusion success		#poc @blocked_by:PRJ-012
  A fusion result requires complete technical success across all three panels and synthesis.
  Constraints: success = technical completion (no model/tool/runtime error), not answer quality; no partial/degraded path (no 2-of-3, no synthesis-on-partial); failure-reporting detail (which stage failed) is deferred — keep it binary.
  Acceptance: a final answer is returned only when all three panels and synthesis complete without technical error; any technical failure yields a failure result and no final answer text.

- [ ] PNL-009 End-to-end demo on one project question		#poc @blocked_by:PRJ-012
  Prove the POC: run the three inner agents on one real research/answer question about the current project, synthesis returns one final answer.
  Constraints: research/answer task (not full SWE); uses the config's 3 panel + 1 synthesis models; runs in the current trusted environment; reproducible from documented config + invocation.
  Acceptance: a documented demo returns one coherent fused answer with all three panels and synthesis succeeding. This run is the trigger for the DeepSWE adaptation.
