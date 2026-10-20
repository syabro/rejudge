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
- Bun 1.3.13 = dev only (deps + tests). No Bun APIs (`bun:*`, `Bun.*`) in code; runs on npm + plain Node. Builds and release automation pin this version because the CLI build uses Bun's `--footer` marker.
- Tests: Vitest.
- Workflows: the root `justfile` is the human-facing repository interface. Recipes delegate to the scripts owned by the root and site packages. `just test` and `just test-unit` build the CLI and extension first so built-interface checks always run; `setup` is the lifecycle exception that installs both dependency trees.
- Package: one unscoped npm package, `rejudge`, containing the CLI, Pi extension, and both public workflows. Source lives in `src/`. `bin/rejudge.js` bundles the complete CLI runtime, so the global command runs without Pi installed. `pi.extensions` points at `dist/extension.js`, which bundles Rejudge code but leaves the Pi SDK, Pi TUI, and typebox external for the host. Pi registers the absolute global Rejudge package root instead of installing another copy. `just build` creates both artifacts; `prepare` rebuilds on `bun install`.
- Landing page: the separate Astro project in `site/` owns its components, styles, dependencies, and Astro configuration. Shared components and localized content in `site/src/` produce English at `/` and Russian at `/ru/`. `just site-dev`, `just site-build`, and `just site-deploy` delegate to the site package; the build writes deployable static HTML to `site/dist/`.
- Provider: `OPENCODE_GO` (not `opencode`).

## Automated Pi releases
- `.github/workflows/pi-autorelease.yml` checks the three pinned Pi packages nightly and through manual dispatch. It releases only when their stable `latest` tags match, are newer than the current exact pins, and remain on major 1. Divergent package tags produce a green warning; Pi 2, registry contradictions, failed checks, and failed peer-floor compatibility stop the release.
- Normal releases update only `package.json`, `bun.lock`, and `CHANGELOG.md`, bump Rejudge's patch version, run `just check`, and test one exact tarball in three fresh containers: standalone CLI, extension on the new Pi, and extension on the `1.3.0` peer floor. Automation never changes the peer range `>=1.3.0 <2`.
- The release commit is packed before anything is pushed. Its annotated tag records the tarball and manifest SRI digests and the completed smoke set. The commit and tag are pushed atomically, then the exact bytes are stored on a draft GitHub Release before npm Trusted Publishing runs. The GitHub Release becomes public only after npm serves the same digest.
- A pending release is recovered before considering a newer Pi version. Recovery reuses the bytes recorded by the tag from the draft Release, the original Actions artifact, or npm when npm already serves the recorded digest. It never repacks an unpublished version. Writing the tag requires `contents: write`; this recorded-by-push metadata is the durable trust anchor. Scheduled-run provenance is diagnostic because the triggering `github.sha` can be the commit before the generated release commit.
- `0.5.1` is the pre-automation baseline. Lightweight tag `v0.5.1`, `origin/main`, and npm `gitHead` resolve to `0c830b3be718a5537bad3bdf506903f9116cb5bd`; npm integrity is `sha512-UintvgNN4+TOnn+3qrcqZTVHAmFOpbLnue0munF2okZ9LnNm51JS9qUedLecrMuRIJ+TJtUz9s1PNURp4z/CPA==`. Later releases require annotated digest metadata.
- Publishing requires the public `syabro/rejudge` repository, the public `rejudge` package, a capped `OPENCODE_API_KEY` Actions secret, and an npm Trusted Publisher bound to `pi-autorelease.yml`. The workflow installs pinned `just` for repository commands and requires `unzip` only when restoring an Actions artifact. The publish job has OIDC but no npm token and installs no dependencies. A manual dry run stops before commit, tag, push, or publication.

## Error handling
- Expected failures are values, not exceptions: the review chain (`runReviewer` → `runPanel` → `runJudge` → `runReview`) returns a neverthrow `Result<T, E>` and never throws out of our code. SDK throws are caught at the `runReviewer` boundary and turned into `err`.
- Runtime dep: `neverthrow` (pure ESM, zero deps). The "only @earendil-works/pi-coding-agent" rule is about agent packages — a Result utility is fine.

## Models (provider `opencode-go`)
- Reviewers (3): `opencode-go/deepseek-v4-pro`, `opencode-go/mimo-v2.5-pro`, `opencode-go/minimax-m3`.
- Judge: `opencode-go/glm-5.3-flash`.
- Stub/smoke runs (speed only, content irrelevant): `opencode-go/glm-5.3-flash`.
- Choosing a model: if you're not sure which model fits a task, ASK — don't guess. The stub/smoke pick is scoped to content-irrelevant checks and makes no claim about speed, cost, or real agentic work. Never assume a model's speed or cost without real data.
