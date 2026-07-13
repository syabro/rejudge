---
name: rejudge
description: Run Rejudge — send a question to separate reviewers and a judge, returning one reviewed result (the rejudge tool inside Pi, else the bin/rejudge.js CLI; read-only). Use when the user says /rejudge or wants a multi-model review. For one external reviewer, use ask-subagent instead.
user_invocable: true
---

# Rejudge

One invocation = one review result: separate reviewers investigate the question and a judge returns one answer. Want two runs? Invoke the skill twice. For one external opinion from one model, use `ask-subagent` instead.

## Pick the path by where you're running — THIS FIRST

- **Inside Pi** — if the `rejudge` tool is available, **call that tool** with the question and any output instructions. Do not run the CLI: it would repeat the whole panel in a separate process. Skip straight to "Output to the user".
- **Anywhere else** (Claude Code or any harness without the `rejudge` tool) — run the CLI as described below.

If `rejudge` appears in the available tools, use it. Fall back to the CLI only when the tool genuinely is not exposed.

## The binary

`/Users/syabro/code/rejudge/bin/rejudge.js` — plain Node, run by absolute path from any project. It resolves dependencies from that repository's `node_modules`, so do not copy the bin alone. The bin is a gitignored build artifact: rebuild it after a fresh checkout, any `src/` change, or a pull:

    ( cd /Users/syabro/code/rejudge && bun run build:cli )

## Prerequisites

- **Config**: Rejudge reads `<cwd>/.rejudge/config.json`, else `~/.config/rejudge/config.json` (or `$XDG_CONFIG_HOME/rejudge/config.json`). It contains `reviewers` and `judge` model IDs. A project config shadows the global config, so check the `config: <path>` line before trusting the result. With `debugLog: true`, logs go under `.rejudge/logs/`. On a non-zero exit, report the stderr reason; do not guess models.
- **Key**: `OPENCODE_API_KEY` exported (it's in `~/.zshrc`), or Pi's stored auth (`pi login`). Never baked in. A missing key isn't instant — all agents fail a minute or two in, so confirm auth before a long run.

## Read-only by default

Rejudge is an ask: reviewers run read-only with `read`/`grep`/`find`/`ls`, and the judge gets only `ask_panel`. A review cannot modify files or run shell commands in the reviewed cwd. Do not pass `--unsafe`/`--full`; they enable write/bash for reviewers.

## Launch — foreground, blocking (never tmux/background) — CLI path only

(Skip this whole section when inside Pi — call the `rejudge` tool instead.)

Run it in the foreground and wait. No tmux, detached sessions, polling, or background jobs. Progress streams to stderr; the review result goes to stdout.

### Step 1 — feed the prompt on stdin via a quoted heredoc

The bin reads the prompt from stdin — no temp file. Use a **quoted** heredoc (`<<'EOF'`) so nothing is escaped or interpolated. Never pass the prompt via `$(...)`, an unquoted heredoc, or an inline argument. Run it from the project root you want reviewed (the cwd drives BOTH config lookup and the panel agents' tools):

    # read-only by default — do NOT add --unsafe or --full (those enable write/bash)
    node /Users/syabro/code/rejudge/bin/rejudge.js > /tmp/rejudge-<id>.md <<'EOF'
    ... full prompt body, multi-line, no escaping ...
    EOF
    echo "exit=$?"

- stdin (the heredoc) = the prompt; `> /tmp/rejudge-<id>.md` captures the result.
- stdout (`/tmp/rejudge-<id>.md`) = the review result.
- stderr = progress and any error.
- Exit status: `0` = success; any non-zero = failure, with the reason on stderr.

(A prompt already sitting in a file still works with `-f <file>`; stdin is the no-temp-file path.)

A real run is minutes (the panel runs at xhigh), so set a generous timeout on the bash command itself (the timeout is per-invocation). If a run is killed for time, report it and re-run; never background it.

## Prompt content

Give the agents what to reason about:
- the user's goal
- relevant paths / context (for a code review: point at `git diff` and the specific files)
- the exact question to answer

## Output to the user (strict)

The full review answer is the run's result — the `rejudge` tool result inside Pi, or `/tmp/rejudge-<id>.md` from the CLI. Do not paste it verbatim unless asked. Translate reviewer wording into plain language and first give enough context to understand what was reviewed. If Rejudge answered your own prompt, state what you asked and what inputs you provided.

Use this structure:

    ### Context
    <1-3 concise bullets: the exact question you asked Rejudge, the important files/diff/data you provided, and any key assumption>

    ### Rejudge result
    (CLI only) Full answer in: /tmp/rejudge-<id>.md
    <3-7 concise bullets in plain user-facing language, no raw reviewer jargon, no long quotes/diffs/logs>

    ### Summary
    <your own 1-3 sentence interpretation and what it changes>

    ### Next action
    <one line, or "none — waiting for user direction">

## Failure modes

A non-zero exit always prints why on stderr — read the message, don't decode the number:
- **config missing/invalid**: tell the user; don't invent models.
- **didn't complete** (a model/tool failed): report the stderr tail; don't retry without confirmation.
- **bin missing**: build it (`bun run build:cli` in the repo), then retry.
- **killed for time**: report and re-run; consider a lighter panel for that repo. Never background.
