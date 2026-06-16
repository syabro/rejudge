# pi-fusion-agents

**Always read @justfile at the start of every session.** It defines project commands — use `just` instead of raw bun/npm for build, test, release, etc.

## Release publishing

Do not run npm publish yourself. The user must run the publish step manually because npm requires interactive two-factor authentication.

## File Paths in Prompts

Use `@` prefix for file paths in skill prompts (e.g., `@README.md`). This is Claude Code file inclusion syntax.

## Technical decisions

How the project is built — tooling, architecture, testing approach, and any technical decision that isn't behavior. Read and keep current: @docs/tech.md

---

`CLAUDE.md` is `ln -s AGENTS.md` — Claude Code only reads `CLAUDE.md`, not `AGENTS.md`.