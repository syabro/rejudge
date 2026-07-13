# Rejudge

Dev commands are npm/bun scripts in `package.json` — `bun run test`, `bun run test:unit`, `bun run typecheck`, `bun run build:cli`. See @README.md for what this is and how to run it.

After committing code changes, rebuild: `bun run build` (CLI + extension). `bin/rejudge.js` (from `src/cli.ts`) and `dist/extension.js` (from `src/index.ts`, with `neverthrow` inlined) are gitignored bundles that won't reflect `src/` changes until rebuilt; `bun install` also rebuilds them via the `prepare` script. The Pi extension is loaded as the built bundle, not from `src/` — Pi 0.80's loader only resolves the pi SDK + typebox, so third-party deps must be bundled in.

## Release publishing

Do not run npm publish yourself. The user must run the publish step manually because npm requires interactive two-factor authentication.

## File Paths in Prompts

Use `@` prefix for file paths in skill prompts (e.g., `@README.md`). This is Claude Code file inclusion syntax.

## Code style

No linter is configured — these are upheld by reading the code (and by LLM code review). Keep code readable like prose:

- **Blank lines as paragraphs.** Group related statements into paragraphs separated by blank lines, the way prose breaks into paragraphs. Don't write walls of code with no breaks — a reader should see the steps.
- **Inline `if` only for control jumps.** A one-line `if (cond) <stmt>` is allowed only when `<stmt>` is `return`, `throw`, `continue`, or `break`. For an assignment or a call, put the body on its own line in braces.

## Reviews (mdtask)

For the two review steps in the `mdtask-do` / `mdtask-next` skills, use Rejudge as the reviewer (no hardcoded command — the skill knows how to launch it): code review → the `rejudge-diff` skill; plan review → the `rejudge` skill with a plan-review prompt. The judge's answer is the review. This runs the `rejudge` tool or CLI in real use ("боевой режим").

## Technical decisions

How the project is built — tooling, architecture, testing approach, and any technical decision that isn't behavior. Read and keep current: @docs/tech.md

---

`CLAUDE.md` is `ln -s AGENTS.md` — Claude Code only reads `CLAUDE.md`, not `AGENTS.md`.