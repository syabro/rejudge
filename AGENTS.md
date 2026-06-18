# pi-fusion-agents

Dev commands are npm/bun scripts in `package.json` — `bun run test`, `bun run test:unit`, `bun run typecheck`, `bun run build:cli`. See @README.md for what this is and how to run it.

## Release publishing

Do not run npm publish yourself. The user must run the publish step manually because npm requires interactive two-factor authentication.

## File Paths in Prompts

Use `@` prefix for file paths in skill prompts (e.g., `@README.md`). This is Claude Code file inclusion syntax.

## Code style

No linter is configured — these are upheld by reading the code (and by LLM code review).
Keep code readable like prose:

- **Blank lines as paragraphs.** Group related statements into paragraphs separated by
  blank lines, the way prose breaks into paragraphs. Don't write walls of code with no
  breaks — a reader should see the steps.
- **Inline `if` only for control jumps.** A one-line `if (cond) <stmt>` is allowed only
  when `<stmt>` is `return`, `throw`, `continue`, or `break`. For an assignment or a call,
  put the body on its own line in braces.

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