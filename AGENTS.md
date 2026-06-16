# pi-fusion-agents

Use **pnpm** for package operations.

**Always read @justfile at the start of every session.** It defines project commands — use `just` instead of raw pnpm/npm for build, test, release, etc.

## Release publishing

Do not run npm publish yourself. The user must run the publish step manually because npm requires interactive two-factor authentication.

## File Paths in Prompts

Use `@` prefix for file paths in skill prompts (e.g., `@README.md`). This is Claude Code file inclusion syntax.

## Model provider

This environment's pi model provider is `OPENCODE_GO`, not `opencode`. Use the `OPENCODE_GO` provider for model IDs and credentials (e.g. in `.pi/fusion-agents.json` and API-key resolution).

---

`CLAUDE.md` is `ln -s AGENTS.md` — Claude Code only reads `CLAUDE.md`, not `AGENTS.md`.