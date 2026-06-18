# pi-fusion-agents

A [Pi](https://pi.dev) extension that exposes one tool, `fusion_agents`: it fans an
identical question out to a panel of 3 models, then fuses their answers with a 4th
(synthesis) model into a single answer. The same engine ships as a local CLI
(`bin/fusion.js`).

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
bin/fusion.js --unsafe "..."      # (or --full) opt into write tools; default is read-only
bin/fusion.js --help
```

## Configuration & keys

Models are set in `.pi/fusion-agents.json` (project) or `~/.config/fusion-agents.json`
(user-global) — 3 panel model IDs + 1 synth:

```json
{
  "panel": [
    "opencode-go/deepseek-v4-pro",
    "opencode-go/mimo-v2.5-pro",
    "opencode-go/minimax-m3"
  ],
  "synth": "opencode-go/glm-5.1"
}
```

The model API key lives in the `OPENCODE_API_KEY` environment variable (or Pi's stored
`pi login` auth) — never baked into the code. Without a key the deterministic tests still
run (`bun run test:unit`); the integration tests skip.
