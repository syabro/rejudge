# Rejudge

**Independent review before your agent acts.**

Rejudge is an independent multi-model review layer for AI agents. Separate tool-enabled reviewers investigate the same request, a judge can re-query them through `ask_panel`, and the caller receives one answer plus a resumable run ID.

This repository ships the Pi adapter (`@rejudge/pi`) and a local CLI (`bin/rejudge.js`) over the same engine. Pi registers the native tool `rejudge`; other agents can invoke the CLI.

## Before you run it

### Data sent to providers

A fresh review sends the request to every configured reviewer model. Reviewers can inspect files and diffs through their tools, and anything they read can become part of the model session. The judge model does not inspect the workspace directly: it receives the reviewer write-ups and can use `ask_panel` to ask reviewers follow-up questions. Those write-ups and replies may quote the request or project content. Treat sensitive text as potentially shared with every configured model provider.

If the host exposes `web_search` and a reviewer uses it, that query is also handled by the search tool's configured service. Read-only access prevents local changes; it does not keep file contents private. Instructions in a request or inspected file can steer a reviewer into reading or returning other content available through its tools.

### Calls and cost

A successful fresh review invokes every configured reviewer and then the judge. Tool loops, provider retries, one empty-output recovery attempt, and `ask_panel` follow-ups can add provider requests. A resumed review restores the saved sessions and sends its first new turn only to the judge; reviewers receive new turns only if the judge uses `ask_panel`.

Rejudge has no spending cap. Cost and rate limits come from the selected models and providers, so check their terms before running a large panel or high reasoning levels.

### Local records

Rejudge writes reviewer and judge session JSONL during execution under `${TMPDIR}/rejudge/runs/<run-id>/`. Failed or cancelled runs may leave session files; only a successful run with a manifest can be resumed. These files may contain the request, model messages, and tool calls or results. Run directories become eligible for best-effort cleanup after about 24 hours, checked only when a later fresh review starts. Deletion at that time is not guaranteed, and operating-system temp cleanup is separate.

`debugLog` is off by default. When enabled, it writes `.rejudge/logs/*.jsonl` with full model thinking and assistant text plus truncated tool arguments and results. Keep both storage locations out of version control and remove sensitive records according to your own retention policy.

### Permissions and result limits

By default, reviewers get `read`, `grep`, `find`, `ls`, the read-only `git_diff` tool, and optional `web_search`; they do not get `edit`, `write`, or `bash`. The judge gets only `ask_panel`, and the Pi tool never widens these permissions.

A CLI review created with `--unsafe` or `--full` gives every reviewer `edit`, `write`, and `bash` in your environment. This is not a sandbox. The judge still gets only `ask_panel`. Use this mode only when reviewer file changes and shell commands are intended.

Technical success means the required reviewers and judge completed, not that the result is correct. The initial reviews run in separate sessions, but their errors can still be correlated. Rejudge does not promise guaranteed correctness, truth from consensus, or measured improvement over a strong single-model review. Treat the result as advice and verify consequential claims.

## Install

```bash
bun install      # or: npm install
```

Bun is the development package manager and build runner; the built code runs on plain Node.

## Development commands

```bash
bun run test         # Vitest; integration tests need model credentials
bun run test:unit    # deterministic tests only
bun run typecheck    # tsc --noEmit
bun run build        # CLI + Pi extension
bun run build:cli    # bin/rejudge.js only
```

## CLI

```bash
bin/rejudge.js "your question"
bin/rejudge.js -f prompt.txt
bin/rejudge.js <<'EOF'
Review this plan.
EOF
cmd | bin/rejudge.js
bin/rejudge.js --resume <run-id> "follow-up question"
bin/rejudge.js --unsafe "..."   # or --full; lets reviewers edit and run bash
bin/rejudge.js --help
```

A prompt comes from one source: a positional argument, else `-f`, else stdin. The answer goes to stdout; progress and the run ID go to stderr. Reviews are read-only by default.

## Configuration and credentials

Project config: `.rejudge/config.json`. Global fallback: `~/.config/rejudge/config.json` (or `$XDG_CONFIG_HOME/rejudge/config.json`). The project file wins when both exist.

```json
{
  "reviewers": [
    "opencode-go/deepseek-v4-pro@xhigh",
    "opencode-go/mimo-v2.5-pro@xhigh",
    "openai-codex/gpt-5.4@high"
  ],
  "judge": "openai-codex/gpt-5.5@medium",
  "debugLog": false
}
```

Use at least two reviewers. Every model requires a lowercase reasoning suffix: `minimal`, `low`, `medium`, `high`, or `xhigh`.

Set `OPENCODE_API_KEY` in the environment or use Pi's stored `pi login` authentication. Credentials are never stored in this repository.
