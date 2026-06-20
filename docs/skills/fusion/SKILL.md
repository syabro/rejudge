---
name: fusion
description: Run the fusion panel — fan a question to a multi-model panel and fuse their replies into one answer (the fusion_agents tool when inside Pi, else the bin/fusion.js CLI; read-only). Use when the user says /fusion, wants a multi-model panel review, or wants a fused multi-model answer. For a single external reviewer (one model), use ask-subagent instead.
user_invocable: true
---

# Fusion

One invocation = one fused panel answer: the panel fans the question out to several models and
a synthesis model fuses their replies into one — that fused answer IS the result. Want two
runs? Invoke the skill twice. For ONE external opinion from a SINGLE subagent (one model), use
`ask-subagent` instead — this one is the multi-model panel.

## Pick the path by where you're running — THIS FIRST

- **Inside Pi** — if the `fusion_agents` tool is available to you, **call that tool** with the
  question (and any output instructions). Do NOT run the CLI: it spawns a whole separate
  process that re-runs the entire panel for nothing. The tool IS the fusion run; its result is
  the fused answer. Everything below about the bin DOES NOT APPLY — skip straight to
  "Output to the user".
- **Anywhere else** (Claude Code or any harness without the `fusion_agents` tool) — run the
  CLI bin as described below.

If you can see a `fusion_agents` tool in your available tools, you are in the first case. When
in doubt, prefer the tool; only fall back to the CLI when the tool genuinely isn't there.

## The binary

`/Users/syabro/code/pi-fusion-agents/bin/fusion.js` — plain Node, run by absolute path from
any project. It resolves its deps (`@earendil-works/pi-coding-agent`, `typebox`) from that
repo's `node_modules`, so that repo path must exist intact — you can't copy just the bin
elsewhere. The bin is a gitignored build artifact: (re)build it after a fresh checkout, any
`src/` change, or a `git pull` in the fusion repo:

    ( cd /Users/syabro/code/pi-fusion-agents && bun run build:cli )

## Prerequisites

- **Config**: fusion reads `<cwd>/.pi/fusion-agents.json`, else the user-global
  `~/.config/fusion-agents.json` (or `$XDG_CONFIG_HOME/fusion-agents.json`) — 3 panel + 1
  synth model IDs. The global file is set up, so it works in any project. ⚠️ A project that
  has its OWN `.pi/fusion-agents.json` silently shadows the global panel (different
  models) — check the `config: <path>` line fusion prints to stderr matches the file you
  expect before trusting the answer. If that project's config has `debugLog: true`, runs
  also write logs under its `.pi/fusion-logs/`. A non-zero exit means something went wrong;
  read the stderr message — if it names a config problem, tell the user, don't guess models.
- **Key**: `OPENCODE_API_KEY` exported (it's in `~/.zshrc`), or Pi's stored auth
  (`pi login`). Never baked in. A missing key isn't instant — all agents fail a minute or
  two in, so confirm auth before a long run.

## Read-only by default

Fusion is an *ask*: you want a verdict, not edits. The bin runs read-only — every inner
agent (3 panel + synth) gets only `read`/`grep`/`find`/`ls`, never `edit`/`write`/`bash` —
so a review cannot modify files or run shell commands in the reviewed cwd. Just run the bin;
do NOT pass `--unsafe`/`--full` (they enable write/bash and defeat the point of an ask).

## Launch — foreground, blocking (never tmux/background) — CLI path only

(Skip this whole section when inside Pi — call the `fusion_agents` tool instead.)

Run it in the foreground and wait. No tmux, no detached sessions, no polling, no background
jobs. The activity log streams to stderr (shown in the tool output); the fused answer goes
to stdout.

### Step 1 — feed the prompt on stdin via a quoted heredoc

The bin reads the prompt from stdin — no temp file. Use a **quoted** heredoc (`<<'EOF'`) so
nothing is escaped or interpolated. Never pass the prompt via `$(...)`, an unquoted heredoc,
or an inline argument. Run it from the project root you want reviewed (the cwd drives BOTH
config lookup and the panel agents' tools):

    # read-only by default — do NOT add --unsafe or --full (those enable write/bash)
    node /Users/syabro/code/pi-fusion-agents/bin/fusion.js > /tmp/fusion-<id>.md <<'EOF'
    ... full prompt body, multi-line, no escaping ...
    EOF
    echo "exit=$?"

- stdin (the heredoc) = the prompt; `> /tmp/fusion-<id>.md` captures the fused answer.
- stdout (`/tmp/fusion-<id>.md`) = the fused answer (the artifact).
- stderr (tool output) = progress + any error.
- Exit status: `0` = the fused answer; any non-zero = failure, with the reason printed to stderr.

(A prompt already sitting in a file still works with `-f <file>`; stdin is the no-temp-file path.)

A real run is minutes (the panel runs at xhigh), so set a generous timeout on the bash
command itself (the timeout is per-invocation). If a run is killed for time, report it and
re-run; never background it.

## Prompt content

Give the agents what to reason about:
- the user's goal
- relevant paths / context (for a code review: point at `git diff` and the specific files)
- the exact question to answer

## Output to the user (strict)

The full fused answer is the run's result — the `fusion_agents` tool result inside Pi, or the
artifact file (`/tmp/fusion-<id>.md`) from the CLI. Don't paste it verbatim unless asked. Read
it yourself, then output exactly three sections:

    ### Fused answer
    (CLI only) Full answer in: /tmp/fusion-<id>.md
    <3-7 concise bullets, no long quotes/diffs/logs>

    ### Summary
    <your own 1-3 sentence interpretation and what it changes>

    ### Next action
    <one line, or "none — waiting for user direction">

## Failure modes

A non-zero exit always prints why on stderr — read the message, don't decode the number:
- **config missing/invalid**: tell the user; don't invent models.
- **didn't complete** (a model/tool failed): report the stderr tail; don't retry without
  confirmation.
- **bin missing**: build it (`bun run build:cli` in the repo), then retry.
- **killed for time**: report and re-run; consider a lighter panel for that repo. Never
  background.
