# Synth — mdtask

# Tasks

- [ ] SYN-010 Synthesize three panel outputs into one answer		#poc
  A separate synthesis call fuses the three panel outputs into one final answer; only final answer text is user-facing.
  Constraints: distinct call on the configured synthesis model ID; consumes all three panel outputs + the original output instructions; preserves the requested format when possible; intermediate panel outputs are not surfaced.
  Acceptance: given three panel outputs, synthesis returns exactly one fused answer respecting the requested format, and the tool result contains only that text.

- [ ] SYN-011 Multi-round fusion: cross-examine findings + judge follow-up		#multiround @blocked_by:PNL-009
  After the one-shot fuse works, add a second round where the panels re-verify each other: each panel gets the aggregated round-1 findings ("others found A, B, C — re-check what holds"), and the judge can follow up a specific panel on disputed points. Motivating case: code review where the user disputes a finding and wants the reviewer re-challenged. The point: panels do the deep verification, so the judge can be a cheap model.

  Constraints: requires panel sessions to stay alive and be re-promptable after round 1; otherwise a deliberately undesigned placeholder.

  Acceptance: a second round returns each panel's verdict on the others' findings; the judge can escalate a disputed point to a specific panel; works with a lighter judge model than the panels.
