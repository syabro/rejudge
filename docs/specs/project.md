# Project — mdtask

## Setup

`pi-fusion-agents` is a Node-first TypeScript Pi extension. bun is the dev package manager and script runner; the code and types have no dependency on bun, so it also runs under npm + plain Node (Node ≥ 23.6 for TS type-stripping). `README.md` is the one-page overview (what it is, the commands, where keys go); this section is the fuller reference.

- Install: `bun install` (or `npm install`)
- Test: `npm test` / `bun run test` — runs **Vitest** (`vitest run`)
- Unit only: `npm run test:unit` — the deterministic tests, no model calls, no key (~1s)
- Typecheck: `npm run typecheck` (`tsc --noEmit`)

Tests are split into **deterministic** (parsing, config loading, prompt building — run anywhere) and **integration** (real model calls via a stub model — need credentials). `npm test` runs both; integration tests are skipped (not failed) unless `OPENCODE_API_KEY` is set, so a contributor without a key still gets a green run. Set `PI_TEST_INTEGRATION=1` to run integration when Pi auth comes from `pi login` instead of the env var, or `PI_TEST_UNIT_ONLY=1` (what `test:unit` does) to force the deterministic-only run even with a key.

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
  - Distributable-package layout: source in `src/`, entry `src/index.ts` declared in the `pi.extensions` manifest. Placeholder entry only — real `fusion_agents` registration deferred to TLS-001.

- [x] PRJ-020 Split tests into unit and integration, gate integration on the API key		!high
  Deterministic and real-model tests are mixed and all need OPENCODE_API_KEY, so a contributor without a key can't run anything. Split them, skip integration when no key, and add a test that loads the committed .pi/fusion-agents.json (today green tests never touch the real config).

  **Implemented:**
  - `test/integration.ts` exports `integrationTest` — `test` when a model is reachable (`OPENCODE_API_KEY`, or `PI_TEST_INTEGRATION=1` for `pi login` auth) and not forced unit-only, else `test.skip`. The 12 real-model tests use it; deterministic tests stay on plain `test`.
  - `npm run test:unit` (`PI_TEST_UNIT_ONLY=1`) runs the deterministic suite only — 33 tests, ~1s, no key; the integration tests show as skipped, never failed. `npm test` with a key runs all 45.
  - New deterministic test loads the committed `.pi/fusion-agents.json` and guards its shape (3 panel + non-empty synth + `debugLog`); model-ID validity stays an integration concern.

- [ ] PRJ-053 Rename product surfaces to Rejudge
  Rejudge has one host-neutral identity across the package, CLI, Pi tool, configuration, workflows, documentation, and tests.

  Replace the public `pi-fusion-agents` / `fusion` identity with Rejudge. The package becomes `@rejudge/pi`, the CLI artifact and command become `bin/rejudge.js` / `rejudge`, the Pi tool becomes `rejudge` with label `Rejudge for Pi`, and the workflows become `/rejudge` and `/rejudge-diff`.

  Use `reviewer`, `panel`, and `judge` consistently. Machine-facing configuration uses `reviewers` and `judge`; per-model runtime roles use `reviewer` and `judge`; `panel` names the reviewers collectively or the collective stage. Whole-run code and types use review terminology: move `src/fusion.ts` to `src/review.ts` and `src/synth.ts` to `src/judge.ts`, with matching test and spec renames. `fusion` may remain only as a private name for the judge's result-combination operation. `ask_panel` and its current targeting contract stay unchanged; stable reviewer identifiers remain the scope of SYN-042.

  Migrate project configuration to `.rejudge/config.json`, global configuration to `~/.config/rejudge/config.json`, debug logs to `.rejudge/logs/`, and temporary runs to `${TMPDIR}/rejudge/runs/<runId>/`. Keep the current flat model-string config shape and `debugLog`; old paths and the old `panel` / `synth` keys are not compatibility aliases. Existing logs and resumable runs are not migrated.

  Rename the two repository skills and their installed links, update the global Pi package entry to the renamed repository, and update current documentation in `README.md`, `AGENTS.md`, `docs/tech.md`, `docs/draft.md`, and `docs/specs/`. Completed task journals may retain historical names. Preserve the existing uncommitted skill edits and leave `PROJECT-AND-NAMING-BRIEF.md` untouched.

  User decisions:
  - limit this task to naming; do not add product capabilities, change review behavior, or split the code into new packages
  - use `.rejudge/config.json` for project configuration and `~/.config/rejudge/config.json` for global configuration
  - perform a clean migration without compatibility aliases

  DoD:
  - all public names, paths, config keys, runtime roles, progress/error text, current documentation, tests, build scripts, and installed local links use the agreed Rejudge terminology
  - whole-run implementation names use review terminology, while `fusion` is limited to the private combine step
  - old config schemas fail clearly, and old public CLI/tool/workflow names are not exposed as aliases
  - unit tests, typecheck, build, CLI smoke testing through `bin/rejudge.js`, and real Pi loading of the `rejudge` tool pass
  - no core contract, adapter, instrumentation, evaluation, `inspect`, resume redesign, stable reviewer-ID work, or diff-mode behavior is added

- [x] PRJ-021 Fix onboarding: dead justfile reference and no README
  AGENTS.md's first line says "read justfile", which doesn't exist, and there's no README. Remove the dead pointer and add a short README (what it is, the two commands, where keys go).

  **Implemented:**
  - AGENTS.md's opening no longer points at a non-existent justfile; it names the real npm/bun scripts (`test`, `test:unit`, `typecheck`, `build:cli`) and links `README.md`.
  - New `README.md`: what the extension is, install, the dev commands, the CLI (with the read-only default and `--unsafe`/`--full` opt-in), and where the model key + config live.
  - No remaining justfile references in the repo.
