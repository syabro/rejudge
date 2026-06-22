# pi-fusion-agents

A [Pi](https://pi.dev) extension that exposes one tool, `fusion_agents`: it fans an identical question out to a panel of 3 models, then fuses their answers with a 4th (synthesis) model into a single answer. The same engine ships as a local CLI (`bin/fusion.js`).

## Install

```
bun install      # or: npm install
```

bun is the dev package manager / script runner; the code itself runs on plain Node too.

## Commands

```
bun run test         # Vitest — full suite (integration tests need a key, see below)
bun run test:unit    # deterministic tests only — no key, ~1s
bun run typecheck    # tsc --noEmit
bun run build:cli    # build the local CLI → ./bin/fusion.js (gitignored)
```

## CLI

```
bin/fusion.js "your question"     # the fused answer to stdout
bin/fusion.js -f prompt.txt       # read the prompt from a file
bin/fusion.js <<'EOF' … EOF       # or pipe/heredoc the prompt on stdin (no temp file)
cmd | bin/fusion.js               # (same — stdin)
bin/fusion.js --unsafe "..."      # (or --full) opt into write tools; default is read-only
bin/fusion.js --help
```

The prompt comes from one source — a positional, else `-f`, else stdin (read only when there is neither). A bare terminal with no pipe prints usage instead of blocking; empty stdin is a usage error.

## Configuration & keys

Models are set in `.pi/fusion-agents.json` (project) or `~/.config/fusion-agents.json` (user-global) — a panel of ≥2 model IDs + 1 synth. Each ID carries its reasoning level as a required `@level` suffix (`minimal`/`low`/`medium`/`high`/`xhigh`); a model ID without one is a config error:

```json
{
  "panel": [
    "opencode-go/deepseek-v4-pro@xhigh",
    "opencode-go/mimo-v2.5-pro@xhigh",
    "opencode-go/minimax-m3@xhigh"
  ],
  "synth": "opencode-go/glm-5.1@medium"
}
```

The model API key lives in the `OPENCODE_API_KEY` environment variable (or Pi's stored `pi login` auth) — never baked into the code. Without a key the deterministic tests still run (`bun run test:unit`); the integration tests skip.
