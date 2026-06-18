# pi-fusion-agents

Dev commands are npm/bun scripts in `package.json` — `bun run test`, `bun run test:unit`, `bun run typecheck`, `bun run build:cli`. See @README.md for what this is and how to run it.

## Release publishing

Do not run npm publish yourself. The user must run the publish step manually because npm requires interactive two-factor authentication.

## File Paths in Prompts

Use `@` prefix for file paths in skill prompts (e.g., `@README.md`). This is Claude Code file inclusion syntax.

## Reviews (mdtask)

For the two review steps in the `mdtask-do` / `mdtask-next` skills — plan
review and code review — use our own fusion demo script as the reviewer:
`bun scripts/demo.ts "<review request>"`. Feed it the plan (or the diff) plus
the task and the relevant files; the fused panel answer is the review. This
runs fusion_agents in real use ("боевой режим").

## Technical decisions

How the project is built — tooling, architecture, testing approach, and any technical decision that isn't behavior. Read and keep current: @docs/tech.md

---

`CLAUDE.md` is `ln -s AGENTS.md` — Claude Code only reads `CLAUDE.md`, not `AGENTS.md`.