# Rejudge

**Independent review before your agent acts.**

Rejudge is an independent multi-model review layer for AI agents. Separate tool-enabled reviewers investigate the same request, a judge can re-query them through `ask_panel`, and the caller receives one answer plus a resumable run ID.

This repository ships the Pi adapter (`@rejudge/pi`) and a local CLI (`bin/rejudge.js`) over the same engine. Pi registers the native tool `rejudge`; other agents can invoke the CLI.

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
