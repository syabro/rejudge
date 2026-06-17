# CLI — mdtask

## fusion CLI

A local command-line wrapper around fusion: ask a question, get the single fused answer
(3-model panel + 1-model synthesis) — the same engine as the `fusion_agents` tool.

Build it (dev-only; bun is just the build tool, the bin runs on plain Node):

```
bun run build:cli      # → ./bin/fusion.js (gitignored)
```

Run it:

```
bin/fusion.js "your question here"     # prompt as a positional argument
bin/fusion.js -f prompt.txt            # or read the prompt from a file
bin/fusion.js --help
```

The fused answer goes to stdout, progress/diagnostics to stderr. Exit codes: `0` answer,
`1` the panel or synthesis did not complete, `2` bad usage / missing-or-invalid config /
unreadable `-f` file.

Config: it reads `<cwd>/.pi/fusion-agents.json`, and if the project has none, falls back
to the user-global `~/.config/fusion-agents.json` (honoring `XDG_CONFIG_HOME`). Same format
as the extension (see `config.md`).

Key: the model API key lives in the `OPENCODE_API_KEY` environment variable (or Pi's stored
auth) — Pi reads it directly; the CLI never handles or bakes in a key.

Note: the built bin resolves its dependencies from this repo's `node_modules`, so it's for
local use from within the repo tree — not a portable/published artifact.

# Tasks

- [x] CLI-015 Ship fusion as a standalone CLI binary on the Pi library
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

  **Implemented:**
  - `src/cli.ts` is the bin entry (`bun run build:cli` → `./bin/fusion.js`, gitignored):
    a question as a positional arg or via `-f <file>`, the fused answer to stdout,
    diagnostics to stderr, exit codes `0`/`1`/`2`.
  - Built with `bun build --target=node --packages=external` — bun is only the dev build
    tool; the bin runs on plain Node and pulls deps from the repo's `node_modules` (local
    use, not published). `bun --compile` was verified to also work but isn't the chosen form.
  - Config resolves from `<cwd>/.pi/fusion-agents.json`, else the user-global
    `~/.config/fusion-agents.json` (XDG-aware); the key stays in `OPENCODE_API_KEY` (Pi
    reads it, the CLI never touches it).
  - The Pi extension keeps its cwd-only config loader (no global fallback); the fallback is
    CLI-only, via the new `resolveFusionConfig`.
  - Tests: `parseCliArgs` (pure) + `resolveFusionConfig` (real temp files: cwd-wins /
    global-fallback / neither-present); verified by real end-to-end runs through the built
    bin on a stub model (positional + `-f`, plus the `--help`/error exit paths).

- [ ] CLI-023 Read-only mode for the fusion CLI		@blocked_by:TOO-003
  ask-subagent runs fusion as a code reviewer, but inner agents (panel and synth) have
  edit/write/bash in the reviewed project's cwd — a review can modify or break files, and
  read-only is only requested in the prompt, not enforced. Add a --readonly flag that limits
  inner agents to the read-only tool set.
  Constraints: read-only set = read/grep/find/ls (the SDK's read-only tools), no edit/write/bash;
  default without the flag stays full read/write as today.
  Acceptance: `fusion --readonly` runs a fusion where inner agents can only read/grep/find/ls
  (no file changes, no bash); without the flag, behavior is unchanged.
