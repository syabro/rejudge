# Project — mdtask

## Setup

`pi-fusion-agents` is a Node-first TypeScript Pi extension. bun is the dev package manager and script runner; the code and types have no dependency on bun, so it also runs under npm + plain Node (Node ≥ 23.6 for TS type-stripping).

- Install: `bun install` (or `npm install`)
- Test: `npm test` / `bun run test` — runs **Vitest** (`vitest run`)
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
  - Tests use **Vitest** (`vitest run`); one green smoke test. `npm test`, `bun run test`, and `tsc --noEmit` all pass.
  - Distributable-package layout: source in `src/`, entry `src/index.ts` declared in the `pi.extensions` manifest. Placeholder entry only — real `fusion_agents` registration deferred to TOO-001.

- [ ] PRJ-020 Split tests into unit and integration, gate integration on the API key		!high
  Deterministic and real-model tests are mixed and all need OPENCODE_API_KEY, so a
  contributor without a key can't run anything. Split them, skip integration when no
  key, and add a test that loads the committed .pi/fusion-agents.json (today green
  tests never touch the real config).

- [ ] PRJ-021 Fix onboarding: dead justfile reference and no README
  AGENTS.md's first line says "read justfile", which doesn't exist, and there's no
  README. Remove the dead pointer and add a short README (what it is, the two
  commands, where keys go).
