# Technical decisions

How it's built. Behavior → docs/specs/, product → docs/draft.md. Add tech decisions here. Auto-loaded into AGENTS.md.

## Testing
- Only necessary tests — don't smother trivial/scaffolding code; cover real logic and the end-to-end run, nothing more.
- Smoke tests only — real runs, no mocks/stubs of models, Pi, or the agent runner. No smoke test = no guarantee.
- Config: tested with real config files (real input → accept/reject).
- A working model is required to test anything past config.
- Packaged interfaces use one extensible Docker smoke runner: `just smoke-package -- <cli|pi|all>` performs live checks with allowlisted runtime credentials. `--no-key` verifies installation and the handled authentication failure without credentials; the default `all` target also proves CLI startup and Pi discovery. Tarball mode receives only a package artifact in an isolated Node 22.19 environment; `--tarball <path>` skips rebuilding and verifies an exact immutable candidate. `--source npm` mounts no product artifact and instead verifies the manifest's exact published version through global npm and isolated Pi installs.

## Agents
- Native `@earendil-works/pi-coding-agent` SDK (`createAgentSession`), in-process. Not `pi -p`, not third-party (pi-subagents, oh-my-pi).
- Keep reviewer sessions alive through the judge step so `ask_panel` can re-query them.
- Address agent slots internally by stable role key (`judge`, `panel-1`, `panel-2`, …). Provider/model IDs are configuration and display metadata, never routing keys. Persisted manifest version 4 stores these keys and rejects older ambiguous runs.
- Run history reads optional metadata from the same manifests; malformed history fields are shown as missing rather than invalidating resume routing. CLI and Pi share the lookup result. A successful follow-up refreshes the manifest timestamp without changing the original conversation, question, or title.

## Runtime & layout
- bun = dev only (deps + tests). No Bun APIs (`bun:*`, `Bun.*`) in code; runs on npm + plain Node.
- Tests: Vitest.
- Workflows: the root `justfile` is the human-facing repository interface. Recipes delegate to the scripts owned by the root and site packages. `just test` and `just test-unit` build the CLI and extension first so built-interface checks always run; `setup` is the lifecycle exception that installs both dependency trees.
- Package: one unscoped npm package, `rejudge`, containing the CLI, Pi extension, and both public workflows. Source lives in `src/`. `bin/rejudge.js` bundles the complete CLI runtime, so the global command runs without Pi installed. `pi.extensions` points at `dist/extension.js`, which bundles Rejudge code but leaves the Pi SDK, Pi TUI, and typebox external for the host. Pi registers the absolute global Rejudge package root instead of installing another copy. `just build` creates both artifacts; `prepare` rebuilds on `bun install`.
- Landing page: the separate Astro project in `site/` owns its components, styles, dependencies, and Astro configuration. Shared components and localized content in `site/src/` produce English at `/` and Russian at `/ru/`. `just site-dev`, `just site-build`, and `just site-deploy` delegate to the site package; the build writes deployable static HTML to `site/dist/`.
- Provider: `OPENCODE_GO` (not `opencode`).

## Error handling
- Expected failures are values, not exceptions: the review chain (`runReviewer` → `runPanel` → `runJudge` → `runReview`) returns a neverthrow `Result<T, E>` and never throws out of our code. SDK throws are caught at the `runReviewer` boundary and turned into `err`.
- Runtime dep: `neverthrow` (pure ESM, zero deps). The "only @earendil-works/pi-coding-agent" rule is about agent packages — a Result utility is fine.

## Models (provider `opencode-go`)
- Reviewers (3): `opencode-go/deepseek-v4-pro`, `opencode-go/mimo-v2.5-pro`, `opencode-go/minimax-m3`.
- Judge: `opencode-go/glm-5.3-flash`.
- Stub/smoke runs (speed only, content irrelevant): `opencode-go/glm-5.3-flash`.
- Choosing a model: if you're not sure which model fits a task, ASK — don't guess. The stub/smoke pick is scoped to content-irrelevant checks and makes no claim about speed, cost, or real agentic work. Never assume a model's speed or cost without real data.
