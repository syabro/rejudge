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
bin/fusion.js <<'EOF' … EOF            # or pipe/heredoc the prompt on stdin
cmd | bin/fusion.js                    # (same — stdin) no temp file needed
bin/fusion.js --unsafe "..."           # opt into full tools (edit/write/bash)
bin/fusion.js --help
```

The prompt comes from exactly one source. Precedence: a positional question, else `-f <file>`,
else stdin — stdin is read only when there is no positional and no `-f`. A long multi-line
prompt is best handed over by heredoc/pipe (no throwaway file). On a bare terminal with no
pipe and no prompt, the CLI prints usage and exits instead of blocking on stdin; empty stdin
is a usage error, like an empty `-f` file. (`-f -` is a file literally named `-`, not a stdin
alias.)

The fused answer goes to stdout, progress/diagnostics to stderr. Exit codes: `0` answer,
`1` the panel or synthesis did not complete, `2` bad usage / missing-or-invalid config /
unreadable `-f` file / empty stdin.

**Read-only by default.** Every inner agent (panel and synthesis) runs with only the
SDK's read-only tools — `read`/`grep`/`find`/`ls`, no `edit`/`write`/`bash` — so a
fusion used as a code reviewer cannot modify files or run shell commands in the working
directory. Pass `--unsafe` (or its synonym `--full`) to give the agents the full local
tool set when you actually want them to change files or run commands; the CLI prints an
`unsafe:` warning when it does. The flag combines with either prompt source and is
order-independent.

Config: it reads `<cwd>/.pi/fusion-agents.json`, and if the project has none, falls back
to the user-global `~/.config/fusion-agents.json` (honoring `XDG_CONFIG_HOME`). Same format
as the extension (see `config.md`).

Key: the model API key lives in the `OPENCODE_API_KEY` environment variable (or Pi's stored
auth) — Pi reads it directly; the CLI never handles or bakes in a key.

Note: the built bin resolves its dependencies from this repo's `node_modules`, so it's for
local use from within the repo tree — not a portable/published artifact.

## `/fusion` skill

A Claude Code skill that lives in this repo at `docs/skills/fusion/SKILL.md` and is exposed
to Claude Code by a **directory** symlink into `~/.claude/skills/fusion` (the mdtask pattern,
so the repo can hold more than one skill). It runs the fusion bin: one invocation = one run
of `bin/fusion.js` = one fused panel answer (3-model panel + synth). Read-only by default;
foreground/blocking; the prompt is fed on stdin via a quoted heredoc (no temp file); the
fused answer is the result. Use it for a multi-model panel review or a fused multi-model answer.

Install the symlink once, from the repo root:

```
ln -s "$PWD/docs/skills/fusion" ~/.claude/skills/fusion
```

## `/fusion-review` skill

A Claude Code skill at `docs/skills/fusion-review/SKILL.md`, dir-symlinked into
`~/.claude/skills/fusion-review`. It runs `bin/fusion.js` (the same panel as `/fusion`) with a
code-review prompt: the inner agents use the `git_diff` tool to read the diff and review it,
read-only. The diff is taken against a ref (default `HEAD`). Use it for a multi-model code
review of a change; for a single-reviewer review use the global `code-review` skill.

Install the symlink once, from the repo root:

```
ln -s "$PWD/docs/skills/fusion-review" ~/.claude/skills/fusion-review
```

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

- [x] CLI-023 Read-only by default for the fusion CLI		@blocked_by:TLS-003
  Fusion is mostly used as a code reviewer (via ask-subagent), but inner agents (panel
  and synth) had edit/write/bash in the reviewed project's cwd — a review could modify or
  break files. Asking for an opinion should never change the project, so make read-only
  the default for the whole engine and require an explicit opt-in for write access.
  Constraints: read-only set = read/grep/find/ls (the SDK's read-only tools); the default
  (CLI, the fusion_agents tool, the demo) is read-only; full tools (edit/write/bash) are
  opt-in via a CLI flag whose name signals it enables shell, not just file writes.
  Acceptance: `fusion "…"` runs read-only — inner agents can only read/grep/find/ls (no
  file changes, no bash); `fusion --unsafe "…"` (or `--full`) gives the full tool set.

  **Implemented:**
  - Read-only is the engine default: `runPanelAgent` gives `READONLY_TOOLS` (read/grep/find/ls) unless the caller passes `fullTools`, which selects the full `PANEL_TOOLS`. `fuse` forwards the option to every panel and synth agent, so the fusion_agents tool and the demo are read-only by default too.
  - CLI opt-in: `--unsafe` and its synonym `--full` set `fullTools` (src/cli-args.ts → src/cli.ts); the CLI prints an `unsafe:` warning when on. Default (no flag) is read-only.
  - Tests: pure `parseCliArgs` (default read-only; `--unsafe`/`--full` enable full tools; order-independent); real-model runner tests asserting the default agent's active tools are exactly read/grep/find/ls and that `fullTools` yields the full set.
  - Verified end-to-end through the built bin: a default run's debug log shows only grep/read calls, zero edit/write/bash.

- [x] CLI-025 Dedicated `/fusion` skill, separate from `ask-subagent`
  `ask-subagent` was repurposed to run the fusion bin (panel + synth), which lost its real
  job — one external opinion from a single subagent.

  Add a separate `/fusion` skill that runs the bin, and return `ask-subagent` to
  single-agent use.

  Constraints: `/fusion` wraps `bin/fusion.js` (read-only default); `ask-subagent` goes back
  to one model / one subagent.

  Acceptance: two distinct skills — `/fusion` (3-panel + synth via the bin) and
  `ask-subagent` (single agent); neither's purpose bleeds into the other.

  **Implemented:**
  - New top-level `SKILL.md` (in-repo, symlinked into `~/.claude/skills/fusion/SKILL.md`)
    wraps `bin/fusion.js` (read-only default, foreground/blocking, prompt-to-file, strict
    3-section output under `### Fused answer`).
  - `~/.claude/skills/ask-subagent/SKILL.md` restored to single-subagent use (one model per
    invocation), modernized: dropped the hard-banned `ask-claude` routing, kept the
    codex/Agent-tool route and the tmux launch/poll protocol and the no-fanout ban clause.
  - Descriptions are word-disjoint (panel/fused → fusion; single reviewer/second opinion →
    ask-subagent), each naming the other, so the harness never cross-triggers.
  - The `/fusion` skill is version-controlled here; `ask-subagent` stays user-global (outside
    the repo), with its backup kept at `ask-subagent/SKILL.md.bak`.
  - Later update (skills restructure): the file moved from the repo root to
    `docs/skills/fusion/SKILL.md`, now exposed via a directory symlink
    `~/.claude/skills/fusion` → `docs/skills/fusion` (mdtask pattern), to make room for a
    second in-repo skill.

- [x] CLI-027 Read the fusion CLI prompt from stdin
  Right now a long, multi-line prompt has to go through a temp file: write a heredoc into
  `/tmp`, then pass it with `-f`. The prompt is the payload — often 30+ lines — so making a
  throwaway file just to hand it over is pure friction. Let the prompt come from stdin
  instead, so `fusion <<'EOF' … EOF` or `cmd | fusion` works with no temp file.

  Read stdin only when there is no positional and no `-f`, so there is still one prompt from
  one source. On a terminal with no pipe and no prompt, print usage and exit instead of
  blocking on stdin; treat empty stdin as a usage error (exit `2`), like an empty `-f` file.

  Also update the `/fusion` skill and the CLI docs (`README.md`, `docs/specs/cli.md`) to
  teach the heredoc/stdin form for long prompts, replacing the current "write the prompt to
  a file, pass with `-f`" instruction.

  DoD:
  - `fusion <<'EOF' … EOF` and `cmd | fusion` run the piped text as the prompt
  - `fusion "question"` and `fusion -f file` behave exactly as before
  - bare `fusion` on a terminal with no pipe prints usage and exits, does not hang
  - empty stdin exits `2`
  - the `/fusion` skill shows the heredoc form for a long prompt

  **Implemented:**
  - `parseCliArgs` gained a `{kind:"stdin"}` intent: with no positional and no `-f` it now
    routes to stdin instead of erroring. The prompt still comes from exactly one source
    (positional → `-f` → stdin). `-f -` stays a file literally named `-`.
  - `src/cli.ts` reads stdin via a `readStdin()` helper; a `process.stdin.isTTY` guard prints
    usage and exits `2` on a bare terminal (no hang), and empty/whitespace stdin exits `2`,
    mirroring the empty-`-f` check. Read errors exit `2` with a clear message.
  - Docs teach the heredoc/stdin form: `README.md`, this file, and the `/fusion` skill (its
    launch steps switched from "write to /tmp + `-f`" to a heredoc piped to the bin).
  - Tests: `parseCliArgs` unit cases for the stdin routing, plus a real-bin smoke test
    (spawns the built bin, empty stdin → exit `2`, no key needed); verified end-to-end that a
    piped prompt reaches the panel.

- [ ] CLI-028 Drop the numeric exit-code scheme — one failure code + a readable error
  The fusion CLI exits `0` / `1` / `2` to mean success / panel-or-synth didn't complete / bad
  config or usage (`src/cli.ts`, documented in `cli.md`). These numeric codes are semaphores
  the caller has to decode instead of just reading what went wrong. A failure should be a
  single non-zero exit plus a clear, human-readable message in the output.

  User decision: collapse to `0` = success, one non-zero = failure; the reason goes in the
  output as plain text, not encoded in the exit number. Drop the 1-vs-2 distinction.

  DoD:
  - the CLI exits `0` on success and a single non-zero code on any failure;
  - the failure reason (bad/missing config, unreadable `-f` file, panel/synth didn't
    complete) is a clear message in the output — not inferred from the exit number;
  - `cli.md` and the in-repo skills (`fusion`, `fusion-review`) stop documenting exit 1 vs 2.
