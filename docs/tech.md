# Technical decisions

How it's built. Behavior → docs/specs/, product → docs/draft.md. Add tech decisions here. Auto-loaded into AGENTS.md.

## Testing
- Only necessary tests — don't smother trivial/scaffolding code; cover real logic and the end-to-end run, nothing more.
- Smoke tests only — real runs, no mocks/stubs of models, Pi, or the agent runner. No smoke test = no guarantee.
- Config: tested with real config files (real input → accept/reject).
- A working model is required to test anything past config.

## Agents
- Native `@earendil-works/pi-coding-agent` SDK (`createAgentSession`), in-process. Not `pi -p`, not third-party (pi-subagents, oh-my-pi).
- Keep panel sessions alive past synthesis (for later judge re-query).

## Runtime & layout
- bun = dev only (deps + tests). No Bun APIs (`bun:*`, `Bun.*`) in code; runs on npm + plain Node.
- Tests: Vitest.
- Package: source in `src/`, entry `src/index.ts` in package.json `pi.extensions`.
- Provider: `OPENCODE_GO` (not `opencode`).

## Error handling
- Expected failures are values, not exceptions: the fusion chain (`runPanelAgent` → `runPanel` → `synthesize` → `fuse`) returns a neverthrow `Result<T, E>` and never throws out of our code. SDK throws are caught at the `runPanelAgent` boundary and turned into `err`.
- Runtime dep: `neverthrow` (pure ESM, zero deps). The "only @earendil-works/pi-coding-agent" rule is about agent packages — a Result utility is fine.

## Models (provider `opencode-go`)
- Panel (3): `opencode-go/deepseek-v4-pro`, `opencode-go/mimo-v2.5-pro`, `opencode-go/minimax-m3`.
- Synth: `opencode-go/glm-5.1`.
- Stub/smoke runs (speed only, content irrelevant): `opencode-go/kimi-k2.6` — fastest reliable (~1.0s median, 10/10 on a 10-ping benchmark).
- Choosing a model: if you're not sure which model fits a task, ASK — don't guess. The labels above are scoped: `kimi-k2.6` as the stub/smoke pick means fast+reliable for a 10-ping latency test (content irrelevant), NOT fast or cheap for real agentic work — by the provider's request-rate limits it is actually one of the pricier models. Never assume a model's speed or cost without real data.
