# Synth — mdtask

# Tasks

- [ ] SYN-010 Synthesize three panel outputs into one answer		#poc
  A separate synthesis call fuses the three panel outputs into one final answer; only final answer text is user-facing.
  Constraints: distinct call on the configured synthesis model ID; consumes all three panel outputs + the original output instructions; preserves the requested format when possible; intermediate panel outputs are not surfaced.
  Acceptance: given three panel outputs, synthesis returns exactly one fused answer respecting the requested format, and the tool result contains only that text.
