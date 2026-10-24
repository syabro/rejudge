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

## Tagged releases
- Release preparation happens on `main` before tagging. Set the Rejudge version with `npm pkg set version=$VERSION`. When all three Pi packages expose the same newer stable 1.x version, run `bun add --dev --exact @earendil-works/pi-ai@$PI_VERSION @earendil-works/pi-coding-agent@$PI_VERSION @earendil-works/pi-tui@$PI_VERSION`; commit the resulting `package.json` and `bun.lock`. Add the `## $VERSION — <date>` changelog entry, commit the release, create `git tag -a v$VERSION`, then push the commit and tag. The peer range remains `>=1.3.0 <2`; divergent Pi tags, stale pins, Pi 2, and registry contradictions stop release processing.
- Create an annotated `v<version>` tag on that commit and push it. The tagged commit must already contain the tag-triggered workflow because GitHub runs the workflow definition from the pushed ref. Automation validates the tag name, package version, target commit, and membership on `origin/main`; it never creates or moves release commits and tags.
- GitHub installs both frozen Bun dependency trees, runs `just check`, creates one tarball with package lifecycle scripts disabled, and tests that exact tarball in three fresh containers: standalone CLI, extension on the pinned current Pi, and extension on the `1.3.0` peer floor.
- The release manifest binds the tarball SRI digest and Pi version to the tag target commit. The current Actions artifact transfers the tested bytes to the isolated publish job. The draft GitHub Release is created only after that tarball passes all three live smokes; a complete draft therefore records tested bytes and later recovery downloads and verifies them instead of repacking. An incomplete draft reruns the complete build and smoke sequence before replacing or adding assets, using the tag's pinned Pi versions even when npm has since published a newer Pi 1.x. If a complete unpublished draft is corrupt, delete the bad asset with `gh release delete-asset v$VERSION <asset> --yes`, then dispatch this workflow with `mode: recover` and the version so the now-incomplete draft is repaired through the full sequence. Automation never reconstructs a missing asset after npm publication.
- The publish job receives OIDC permission but no npm token, installs no dependencies, runs no lifecycle scripts, and publishes the preserved tarball through npm Trusted Publishing with provenance. The GitHub Release becomes public after npm serves the same integrity; provenance is checked immediately afterward so a registry metadata discrepancy cannot strand a valid release in draft state.
- Manual dispatch supports a non-publishing dry run from `main` and recovery of a tagged release with draft assets. Recovery runs the current automation from `main` against the tagged source, then checks that the tag, source versions, pinned Pi packages, peer floor, manifest, and tarball still agree; it does not require the old pins to remain npm `latest`. If a tag run fails before creating a draft, rerun all jobs in that same tag-push run. The pre-transition `v0.5.2` release is recovered by dispatching this workflow with `mode: recover` and `version: 0.5.2`; fixed recorded digests bind its preserved draft assets to the original tested candidate after its 90-day Actions artifact expires.
- Publishing requires the public `syabro/rejudge` repository, the public `rejudge` package, a capped `OPENCODE_API_KEY` Actions secret, and an npm Trusted Publisher bound to `pi-autorelease.yml` with no GitHub environment restriction.

## Error handling
- Expected failures are values, not exceptions: the review chain (`runReviewer` → `runPanel` → `runJudge` → `runReview`) returns a neverthrow `Result<T, E>` and never throws out of our code. SDK throws are caught at the `runReviewer` boundary and turned into `err`.
- Runtime dep: `neverthrow` (pure ESM, zero deps). The "only @earendil-works/pi-coding-agent" rule is about agent packages — a Result utility is fine.

## Models (provider `opencode-go`)
- Reviewers (3): `opencode-go/deepseek-v4-pro`, `opencode-go/mimo-v2.5-pro`, `opencode-go/minimax-m3`.
- Judge: `opencode-go/glm-5.3-flash`.
- Stub/smoke runs (speed only, content irrelevant): `opencode-go/glm-5.3-flash`.
- Choosing a model: if you're not sure which model fits a task, ASK — don't guess. The stub/smoke pick is scoped to content-irrelevant checks and makes no claim about speed, cost, or real agentic work. Never assume a model's speed or cost without real data.
