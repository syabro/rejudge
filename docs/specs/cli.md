# CLI — mdtask

## Rejudge CLI

The public `rejudge` command and the Pi `rejudge` tool run the same review engine: separate reviewers investigate the request, the judge returns one answer, and the result includes a resumable run ID.

Install the prebuilt public command with Node 22.19.0 or newer:

```
npm install -g rejudge@0.1.0
```

Run it from the project whose files and config should be visible to reviewers:

```
rejudge "your question here"     # prompt as a positional argument
rejudge -f prompt.txt            # read the prompt from a file
rejudge <<'EOF' … EOF            # or use a heredoc/pipe
cmd | rejudge
rejudge --resume <run-id> "..."  # continue a saved review
rejudge --unsafe "..."           # let reviewers edit/write/run shell commands
rejudge --help
```

The prompt comes from exactly one source: a positional question, else `-f <file>`, else stdin. A bare terminal with no prompt prints usage instead of blocking; empty stdin and an empty prompt file are errors. `-f -` means a file literally named `-`, not stdin.

The review answer goes to stdout. Configuration, progress, diagnostics, and the run ID go to stderr. Exit status is `0` on success and non-zero on failure, with a readable reason.

Reviews are read-only by default. Reviewers get `read`/`grep`/`find`/`ls` plus read-only review tools; the judge gets only `ask_panel`. `--unsafe` and `--full` opt reviewers into editing and shell access.

Config resolves from `<cwd>/.rejudge/config.json`, then `~/.config/rejudge/config.json` (XDG-aware). See `config.md`. Provider credentials stay in environment variables such as `OPENCODE_API_KEY` or Pi's stored authentication; the CLI does not store them.

## Packaged workflows

Pi installs the same package with:

```
pi install npm:rejudge@0.1.0
```

The package manifest loads the bundled extension and recursively discovers `rejudge` and `rejudge-diff`. Inside Pi, `/skill:rejudge` uses the native tool; `/skill:rejudge-diff` reviews the selected Git diff through that tool. No checkout links are required. Outside Pi, a harness that loads the packaged skills uses the installed `rejudge` command.

## Source development

Bun is only the source build runner; built and published code runs on Node:

```
bun install
bun run build:cli      # → ./bin/rejudge.js (gitignored)
bun run build:ext      # → ./dist/extension.js (gitignored)
```

Install the source package globally with `npm install -g --ignore-scripts .`, and register the local Pi package with `pi install "$PWD"` after building.

### Testing knob: `--prompt-add-N` (force panel divergence)

A testing-only flag, not a product feature and never exposed by the Pi tool. The panel normally gets a byte-identical prompt; `--prompt-add-N "<text>"` appends text to reviewer `N` only, deliberately forcing divergence for judge/`ask_panel` scenarios.

```
bin/rejudge.js --prompt-add-1 "argue strongly for option A" \
               --prompt-add-2 "argue strongly for option B" "which option is better?"
bin/rejudge.js --prompt-add-3=… <<'EOF' … EOF
```

It combines with any prompt source and `--unsafe`. `N` is 1-based and must fit the reviewer count. It cannot be combined with `--resume`, because resume does not re-run the panel. The judge input is unchanged. The flag is omitted from `--help`.

# Tasks

- [x] CLI-015 Ship fusion as a standalone CLI binary on the Pi library
  Turn the fusion demo (scripts/demo.ts) into a real command-line utility built on the Pi library (@earendil-works/pi-coding-agent), shipped as a single distributable binary: ask a question, get the fused answer.

  Accept the prompt either as a positional argument or via `-f <file>` (read the prompt from a file), so long/multi-line prompts don't have to go through the shell.

  Document how to configure it (which panel/synth models) and where to keep the model API key (e.g. OPENCODE_API_KEY) — env or a config file, never baked into the binary.

  Open, decide later: how the binary is built (bun --compile / Node SEA / container) given the "runs on plain Node" rule, and the exact config + key layout.

  **Implemented:**
  - `src/cli.ts` is the bin entry (`bun run build:cli` → `./bin/fusion.js`, gitignored): a question as a positional arg or via `-f <file>`, the fused answer to stdout, diagnostics to stderr, exit codes `0`/`1`/`2`.
  - Built with `bun build --target=node --packages=external` — bun is only the dev build tool; the bin runs on plain Node and pulls deps from the repo's `node_modules` (local use, not published). `bun --compile` was verified to also work but isn't the chosen form.
  - Config resolves from `<cwd>/.pi/fusion-agents.json`, else the user-global `~/.config/fusion-agents.json` (XDG-aware); the key stays in `OPENCODE_API_KEY` (Pi reads it, the CLI never touches it).
  - The Pi extension keeps its cwd-only config loader (no global fallback); the fallback is CLI-only, via the new `resolveFusionConfig`.
  - Tests: `parseCliArgs` (pure) + `resolveFusionConfig` (real temp files: cwd-wins / global-fallback / neither-present); verified by real end-to-end runs through the built bin on a stub model (positional + `-f`, plus the `--help`/error exit paths).

- [x] CLI-023 Read-only by default for the fusion CLI		@blocked_by:TLS-003
  Fusion is mostly used as a code reviewer (via ask-subagent), but inner agents (panel and synth) had edit/write/bash in the reviewed project's cwd — a review could modify or break files. Asking for an opinion should never change the project, so make read-only the default for the whole engine and require an explicit opt-in for write access. Constraints: read-only set = read/grep/find/ls (the SDK's read-only tools); the default (CLI, the fusion_agents tool, the demo) is read-only; full tools (edit/write/bash) are opt-in via a CLI flag whose name signals it enables shell, not just file writes. Acceptance: `fusion "…"` runs read-only — inner agents can only read/grep/find/ls (no file changes, no bash); `fusion --unsafe "…"` (or `--full`) gives the full tool set.

  **Implemented:**
  - Read-only is the engine default: `runPanelAgent` gives `READONLY_TOOLS` (read/grep/find/ls) unless the caller passes `fullTools`, which selects the full `PANEL_TOOLS`. `fuse` forwards the option to every panel and synth agent, so the fusion_agents tool and the demo are read-only by default too.
  - CLI opt-in: `--unsafe` and its synonym `--full` set `fullTools` (src/cli-args.ts → src/cli.ts); the CLI prints an `unsafe:` warning when on. Default (no flag) is read-only.
  - Tests: pure `parseCliArgs` (default read-only; `--unsafe`/`--full` enable full tools; order-independent); real-model runner tests asserting the default agent's active tools are exactly read/grep/find/ls and that `fullTools` yields the full set.
  - Verified end-to-end through the built bin: a default run's debug log shows only grep/read calls, zero edit/write/bash.

- [x] CLI-025 Dedicated `/fusion` skill, separate from `ask-subagent`
  `ask-subagent` was repurposed to run the fusion bin (panel + synth), which lost its real job — one external opinion from a single subagent.

  Add a separate `/fusion` skill that runs the bin, and return `ask-subagent` to single-agent use.

  Constraints: `/fusion` wraps `bin/fusion.js` (read-only default); `ask-subagent` goes back to one model / one subagent.

  Acceptance: two distinct skills — `/fusion` (3-panel + synth via the bin) and `ask-subagent` (single agent); neither's purpose bleeds into the other.

  **Implemented:**
  - New top-level `SKILL.md` (in-repo, symlinked into `~/.claude/skills/fusion/SKILL.md`) wraps `bin/fusion.js` (read-only default, foreground/blocking, prompt-to-file, strict 3-section output under `### Fused answer`).
  - `~/.claude/skills/ask-subagent/SKILL.md` restored to single-subagent use (one model per invocation), modernized: dropped the hard-banned `ask-claude` routing, kept the codex/Agent-tool route and the tmux launch/poll protocol and the no-fanout ban clause.
  - Descriptions are word-disjoint (panel/fused → fusion; single reviewer/second opinion → ask-subagent), each naming the other, so the harness never cross-triggers.
  - The `/fusion` skill is version-controlled here; `ask-subagent` stays user-global (outside the repo), with its backup kept at `ask-subagent/SKILL.md.bak`.
  - Later update (skills restructure): the file moved from the repo root to `docs/skills/fusion/SKILL.md`, now exposed via a directory symlink `~/.claude/skills/fusion` → `docs/skills/fusion` (mdtask pattern), to make room for a second in-repo skill.

- [x] CLI-027 Read the fusion CLI prompt from stdin
  Right now a long, multi-line prompt has to go through a temp file: write a heredoc into `/tmp`, then pass it with `-f`. The prompt is the payload — often 30+ lines — so making a throwaway file just to hand it over is pure friction. Let the prompt come from stdin instead, so `fusion <<'EOF' … EOF` or `cmd | fusion` works with no temp file.

  Read stdin only when there is no positional and no `-f`, so there is still one prompt from one source. On a terminal with no pipe and no prompt, print usage and exit instead of blocking on stdin; treat empty stdin as a usage error (exit `2`), like an empty `-f` file.

  Also update the `/fusion` skill and the CLI docs (`README.md`, `docs/specs/cli.md`) to teach the heredoc/stdin form for long prompts, replacing the current "write the prompt to a file, pass with `-f`" instruction.

  DoD:
  - `fusion <<'EOF' … EOF` and `cmd | fusion` run the piped text as the prompt
  - `fusion "question"` and `fusion -f file` behave exactly as before
  - bare `fusion` on a terminal with no pipe prints usage and exits, does not hang
  - empty stdin exits `2`
  - the `/fusion` skill shows the heredoc form for a long prompt

  **Implemented:**
  - `parseCliArgs` gained a `{kind:"stdin"}` intent: with no positional and no `-f` it now routes to stdin instead of erroring. The prompt still comes from exactly one source (positional → `-f` → stdin). `-f -` stays a file literally named `-`.
  - `src/cli.ts` reads stdin via a `readStdin()` helper; a `process.stdin.isTTY` guard prints usage and exits `2` on a bare terminal (no hang), and empty/whitespace stdin exits `2`, mirroring the empty-`-f` check. Read errors exit `2` with a clear message.
  - Docs teach the heredoc/stdin form: `README.md`, this file, and the `/fusion` skill (its launch steps switched from "write to /tmp + `-f`" to a heredoc piped to the bin).
  - Tests: `parseCliArgs` unit cases for the stdin routing, plus a real-bin smoke test (spawns the built bin, empty stdin → exit `2`, no key needed); verified end-to-end that a piped prompt reaches the panel.

- [x] CLI-028 Drop the numeric exit-code scheme — one failure code + a readable error
  The fusion CLI exits `0` / `1` / `2` to mean success / panel-or-synth didn't complete / bad config or usage (`src/cli.ts`, documented in `cli.md`). These numeric codes are semaphores the caller has to decode instead of just reading what went wrong. A failure should be a single non-zero exit plus a clear, human-readable message in the output.

  User decision: collapse to `0` = success, one non-zero = failure; the reason goes in the output as plain text, not encoded in the exit number. Drop the 1-vs-2 distinction.

  DoD:
  - the CLI exits `0` on success and a single non-zero code on any failure;
  - the failure reason (bad/missing config, unreadable `-f` file, panel/synth didn't complete) is a clear message in the output — not inferred from the exit number;
  - `cli.md` and the in-repo skills (`fusion`, `fusion-review`) stop documenting exit 1 vs 2.

  **Implemented:**
  - `src/cli.ts` now exits `0` on success and `1` on every failure (the old `2` paths — parse/usage error, unreadable or empty `-f`, stdin TTY guard / read error / empty stdin, config resolve error — all collapsed to `1`). Each path already prints a clear `fusion: <reason>` line to stderr, so the reason is read, not decoded.
  - **Breaking**: a caller testing `$? -eq 2` no longer sees `2`; any non-zero is now `1`. This is the intended change — branch on zero/non-zero and read the message.
  - Docs stripped of the 1-vs-2 mapping: the `cli.md` feature section, and the `fusion` skill (Prerequisites, launch step, Failure modes) now describe exit status as 0 / non-zero with the reason on stderr; `fusion-review` says "exit status", not "exit codes".
  - Tests: the real-bin smoke test now asserts empty stdin exits `1`. Only that one failure path is covered by an automated test (pre-existing gap, unchanged here); the others were verified by hand against the built bin.

- [x] CLI-031 Remove scripts/demo.ts — superseded by the CLI
  `scripts/demo.ts` is the old POC demo; the CLI (`bin/fusion.js` / `bun src/cli.ts`) does everything it does plus `-f`/stdin and config fallback. It lacks `-f`, which forced `$(cat …)` for fusion reviews.

  User decision: delete `scripts/demo.ts`; run fusion reviews via `bun src/cli.ts -f <file>`.

  DoD:
  - `scripts/demo.ts` removed;
  - the review rule in AGENTS.md and the `panel.md` Demo mention use `bun src/cli.ts -f`, not `bun scripts/demo.ts`.

  **Implemented:**
  - Deleted `scripts/demo.ts` (the `scripts/` dir is now empty/gone); the CLI fully replaces it.
  - `panel.md`'s Demo section now runs `bun src/cli.ts "<question>"`.
  - The AGENTS.md review rule no longer hardcodes a command — to avoid the same staleness it now delegates to the skills: code review → `fusion-review`, plan review → `fusion`.
