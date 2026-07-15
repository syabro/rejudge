# Rejudge

**Independent review before your agent acts.**

Rejudge is an independent multi-model review layer for AI agents. Separate tool-enabled reviewers investigate the same request, a judge can re-query them through `ask_panel`, and the caller receives one answer plus a resumable run ID.

The public release is one npm package, `rejudge`, containing the CLI, the Pi adapter, and the `/rejudge` and `/rejudge-diff` workflows over the same engine. Pi registers the native tool `rejudge`; other agents can invoke the CLI.

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

## Requirements

- Node.js 22.19.0 or newer.
- npm for the public package installation.
- An API key or Pi login accepted by every configured model provider. The examples below use OpenCode Go and `OPENCODE_API_KEY`.
- Pi for the Pi quickstart.

The npm package contains prebuilt CLI and extension files, so installing and using it does not require Bun. Building from source requires Bun.

Release checks run the packed artifact in Node 22.19.0 Docker containers. Source development is tested with Node 24.14.0, npm 11.14.1, and Bun 1.3.13. The Pi package path is tested with Pi 0.80.6.

## Configure Rejudge

Create a config in the project that reviewers should inspect:

```bash
mkdir -p .rejudge
cat > .rejudge/config.json <<'EOF'
{
  "reviewers": [
    "opencode-go/deepseek-v4-pro@high",
    "opencode-go/mimo-v2.5-pro@high",
    "opencode-go/minimax-m3@high"
  ],
  "judge": "opencode-go/glm-5.1@high",
  "debugLog": false
}
EOF

export OPENCODE_API_KEY="<your OpenCode key>"
```

A project config wins over the global fallback at `~/.config/rejudge/config.json` or `$XDG_CONFIG_HOME/rejudge/config.json`. Rejudge requires at least two reviewers. Every model must include one lowercase reasoning suffix: `minimal`, `low`, `medium`, `high`, or `xhigh`.

## CLI quickstart

Install the public package globally:

```bash
npm install -g rejudge@0.1.0
rejudge --help
```

Run Rejudge from the project containing `.rejudge/config.json`:

```bash
rejudge <<'EOF'
Review this project and identify the two most important risks.
EOF
```

The review answer goes to stdout. Configuration, progress, and the resumable run ID go to stderr. An interactive terminal shows both streams together in this shape; they remain separate when redirected:

```text
config: .../.rejudge/config.json
reviewers: ... | judge: ...
read-only: inner agents limited to read/grep/find/ls
...
<review answer>
run saved as <run-id> — follow up: rejudge --resume <run-id> "<question>"
```

Other prompt forms:

```bash
rejudge "review this decision"
rejudge -f prompt.txt
cmd | rejudge
rejudge --resume <run-id> "follow-up question"
rejudge --unsafe "..."   # also --full; lets reviewers edit and run shell commands
```

Reviews are read-only by default. `--unsafe` and `--full` remove that boundary for reviewers and should be used only when file changes and shell access are intended.

## Pi quickstart

Install Pi if it is not already available, then install the same Rejudge package through Pi:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.80.6
pi install npm:rejudge@0.1.0
pi list
```

Keep `OPENCODE_API_KEY` exported in the shell, enter the project containing `.rejudge/config.json`, and start Pi:

```bash
pi
```

Invoke the packaged workflow inside Pi:

```text
/skill:rejudge Review this project and identify the two most important risks.
```

Pi loads the native `rejudge` tool plus the `rejudge` and `rejudge-diff` skills from the package. A successful tool result shows the Rejudge progress block followed by an answer and a resumable ID:

```text
Rejudge Review this project...
  ...
Run ID: <run-id>. Follow up with resumeRunId: "<run-id>".
```

Use `/skill:rejudge-diff` for a review of the current working-tree diff. Restart Pi after package installation if it was already running.

## Install from source

Source installation needs Git, Node, npm, and Bun:

```bash
git clone https://github.com/max-prtsr/rejudge.git
cd rejudge
bun install
bun run build
npm install -g --ignore-scripts .
pi install "$PWD"
```

The npm command exposes the CLI globally. The Pi command registers the same local package's extension and skills. Rebuild after changing `src/`.

## Common setup failures

- **Unsupported Node version:** install Node 22.19.0 or newer, then reinstall Rejudge.
- **`rejudge: command not found`:** confirm `npm install -g rejudge@0.1.0` succeeded and that the `bin` directory under `npm prefix -g` is on `PATH`.
- **`rejudge: no config found`:** create `.rejudge/config.json` in the current project or a global config in the XDG path shown above.
- **Authentication failure:** export `OPENCODE_API_KEY` in the same shell that launches `rejudge` or Pi. For CLI runs, read the final stderr line; inside Pi, read the Rejudge tool result. It identifies the failed stage and usually contains `API key`, `authentication`, `credentials`, or `unauthorized`.
- **Pi does not show Rejudge:** run `pi list`, confirm `npm:rejudge@0.1.0` is installed, then restart Pi. The package should provide the `rejudge` tool and both skills.
- **A model or stage fails:** read the final stderr reason from the CLI or the Rejudge tool result inside Pi. Check the configured model ID, provider access, rate limits, and network before retrying.

## Development commands

Docker is required only for the package smoke checks, not for installing or using Rejudge.

```bash
bun run test                     # full Vitest suite; live tests need credentials
bun run test:unit                # deterministic tests only
bun run typecheck                # tsc --noEmit
bun run build                    # CLI + Pi extension
bun run build:cli                # bin/rejudge.js only
bun run smoke:package -- all     # live packaged CLI and Pi checks in Docker
bun run smoke:package -- all --no-key
bun run smoke:package -- all --tarball /tmp/rejudge-release-0.1.0/rejudge-0.1.0.tgz
bun run smoke:package -- all --source npm   # verify the published manifest version
```
