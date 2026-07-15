# Technical decisions

How it's built. Behavior → docs/specs/, product → docs/draft.md. Add tech decisions here. Auto-loaded into AGENTS.md.

## Testing
- Only necessary tests — don't smother trivial/scaffolding code; cover real logic and the end-to-end run, nothing more.
- Smoke tests only — real runs, no mocks/stubs of models, Pi, or the agent runner. No smoke test = no guarantee.
- Config: tested with real config files (real input → accept/reject).
- A working model is required to test anything past config.
- Packaged interfaces use one extensible Docker smoke runner: `bun run smoke:package -- <cli|pi|all>` performs live checks with allowlisted runtime credentials. `--no-key` verifies installation and the handled authentication failure without credentials; the default `all` target also proves CLI startup and Pi discovery. Every target receives a tarball and isolated Node 22.19 environment; the container never mounts the source checkout. By default the runner builds a temporary artifact; `--tarball <path>` skips rebuilding and verifies that exact immutable release candidate.

## Agents
- Native `@earendil-works/pi-coding-agent` SDK (`createAgentSession`), in-process. Not `pi -p`, not third-party (pi-subagents, oh-my-pi).
- Keep reviewer sessions alive through the judge step so `ask_panel` can re-query them.
- Address agent slots internally by stable role key (`judge`, `panel-1`, `panel-2`, …). Provider/model IDs are configuration and display metadata, never routing keys. Persisted manifest version 4 stores these keys and rejects older ambiguous runs.

## Runtime & layout
- bun = dev only (deps + tests). No Bun APIs (`bun:*`, `Bun.*`) in code; runs on npm + plain Node.
- Tests: Vitest.
- Package: one unscoped npm package, `rejudge`, containing the CLI, Pi extension, and both public workflows. Source lives in `src/`; `pi.extensions` points at `dist/extension.js` (a bundled build of `src/index.ts` with `neverthrow` inlined; Pi SDK + typebox external/host-provided). `bun run build` creates the extension and `bin/rejudge.js`; `prepare` rebuilds on `bun install`. Pi loads the bundle, not `src/`, because Pi 0.80's loader resolves the Pi SDK + typebox but not arbitrary project dependencies.
- Provider: `OPENCODE_GO` (not `opencode`).

## Error handling
- Expected failures are values, not exceptions: the review chain (`runReviewer` → `runPanel` → `runJudge` → `runReview`) returns a neverthrow `Result<T, E>` and never throws out of our code. SDK throws are caught at the `runReviewer` boundary and turned into `err`.
- Runtime dep: `neverthrow` (pure ESM, zero deps). The "only @earendil-works/pi-coding-agent" rule is about agent packages — a Result utility is fine.

## Models (provider `opencode-go`)
- Reviewers (3): `opencode-go/deepseek-v4-pro`, `opencode-go/mimo-v2.5-pro`, `opencode-go/minimax-m3`.
- Judge: `opencode-go/glm-5.1`.
- Stub/smoke runs (speed only, content irrelevant): `opencode-go/kimi-k2.6` — fastest reliable (~1.0s median, 10/10 on a 10-ping benchmark).
- Choosing a model: if you're not sure which model fits a task, ASK — don't guess. The labels above are scoped: `kimi-k2.6` as the stub/smoke pick means fast+reliable for a 10-ping latency test (content irrelevant), NOT fast or cheap for real agentic work — by the provider's request-rate limits it is actually one of the pricier models. Never assume a model's speed or cost without real data.
