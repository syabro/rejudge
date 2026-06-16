# Project — mdtask

## Setup

`pi-fusion-agents` is a Node-first TypeScript Pi extension. bun is the dev package manager and script runner; the code and types have no dependency on bun, so it also runs under npm + plain Node (Node ≥ 23.6 for TS type-stripping).

- Install: `bun install` (or `npm install`)
- Test: `npm test` / `bun run test` — runs the Node test runner (`node --test`, `node:test`)
- Typecheck: `npm run typecheck` (`tsc --noEmit`)

Source lives in `src/`; the extension entry is `src/index.ts`, declared in `package.json` under `pi.extensions`. It is a distributable package — installed into a target project via Pi's package mechanism (`pi install` / settings `packages`), where it operates on that project.

# Tasks

- [x] PRJ-012 Project bootstrap: package, TypeScript, bun test, deps, layout		#poc
  Stand up the project skeleton every other task builds on: a TypeScript project with bun test wired, the @earendil-works/pi-coding-agent dependency (the native Pi host SDK), and the extension entry layout under .pi/extensions/fusion-agents/. Throwaway-POC minimal — no lint / CI / release tooling.

  Constraints: TypeScript + bun test; depend only on @earendil-works/pi-coding-agent (native Pi SDK, no third-party agent packages); add deps via the package manager, never by hand.

  Acceptance: the project typechecks; `bun test` runs green on one trivial test (proves the harness works); dependencies install cleanly.

  **Implemented:**
  - Node-first ESM TypeScript project: `package.json` (`type: module`), `tsconfig.json` (`nodenext`, `strict`, `skipLibCheck`). bun is dev manager/runner only — no bun runtime/type coupling, so it runs under npm + plain Node too.
  - Runtime dep `@earendil-works/pi-coding-agent` (native Pi SDK); `typescript` + `@types/node` as devDeps; added via the package manager.
  - Tests use the Node test runner (`node:test`); one green smoke test. `npm test`, `bun run test`, and `tsc --noEmit` all pass.
  - Distributable-package layout: source in `src/`, entry `src/index.ts` declared in the `pi.extensions` manifest. Placeholder entry only — real `fusion_agents` registration deferred to TOO-001.
