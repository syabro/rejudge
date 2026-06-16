# CLI — mdtask

# Tasks

- [ ] CLI-015 Ship fusion as a standalone CLI binary on the Pi library		#user-required
  Turn the fusion demo (scripts/demo.ts) into a real command-line utility built on
  the Pi library (@earendil-works/pi-coding-agent), shipped as a single
  distributable binary: ask a question, get the fused answer.

  Accept the prompt either as a positional argument or via `-f <file>` (read the
  prompt from a file), so long/multi-line prompts don't have to go through the
  shell.

  Document how to configure it (which panel/synth models) and where to keep the
  model API key (e.g. OPENCODE_API_KEY) — env or a config file, never baked into
  the binary.

  Open, decide later: how the binary is built (bun --compile / Node SEA / container)
  given the "runs on plain Node" rule, and the exact config + key layout.
