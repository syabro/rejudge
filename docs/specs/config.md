# Config — mdtask

## .pi/fusion-agents.json

`fusion_agents` reads its config from `<project>/.pi/fusion-agents.json` and refuses to run without a valid one:

```json
{
  "panel": ["provider/model-a@xhigh", "provider/model-b@xhigh", "provider/model-c@xhigh"],
  "synth": "provider/model-d@medium",
  "debugLog": false
}
```

At least 2 `panel` model IDs + 1 `synth` model ID, full `provider/model@level` form (the example above uses 3 — the project default — but any panel of 2 or more is accepted). A missing file, malformed JSON, fewer than 2 panel models, or missing `synth` makes the tool error out with a clear message.

Config resolves from the project's `.pi/fusion-agents.json`, else the user-global `~/.config/fusion-agents.json` (honoring `XDG_CONFIG_HOME`); the project file, when present, wins. (The tool that consumes this config is described in `extension.md`; the CLI in `cli.md`.)

Every model ID carries its reasoning level as a required `@level` suffix — `provider/model@level`, for both panel models and `synth`. Valid levels: `minimal`, `low`, `medium`, `high`, `xhigh` (lowercase; `off` is not one). The suffix is required: a model ID with no `@level`, or an invalid level, is a config error and the tool refuses to start — so a forgotten level never silently runs a model with reasoning off. Each model can carry a different level (e.g. panel at `xhigh`, synth at `medium`). The old separate `thinking` block is gone; a config still carrying a `thinking` key is rejected with a migration hint.

`debugLog` is optional (default `false`) and must be a boolean. When `true`, each run writes a per-run JSONL debug log of inner-agent activity to `.pi/fusion-logs/<timestamp>.jsonl` (gitignored) for after-the-fact analysis of what bloats the context or slows the run — see the Debug log section in `panel.md`. A non-boolean value is a config error.

# Tasks

- [x] CFG-005 Load and validate .pi/fusion-agents.json and gate fusion_agents		#poc @blocked_by:PRJ-012
  `fusion_agents` starts only when a valid config exists at `<project>/.pi/fusion-agents.json` with full provider/model IDs (e.g. anthropic/claude-sonnet-4-5). Constraints: exactly 3 panel model IDs + 1 synthesis model ID; that list is the model selection; config shape beyond these IDs is deferred. Acceptance: valid config (3 panel + 1 synthesis) lets the tool proceed and exposes the four IDs to the runner; missing file / wrong panel count / missing synthesis ID -> refuse to start with a clear error.

  **Implemented:**
  - `src/config.ts` `loadFusionConfig(cwd)` reads `<cwd>/.pi/fusion-agents.json`, validates exactly 3 `panel` IDs + 1 `synth` ID, returns them; throws a clear error on missing file / malformed JSON / wrong panel count / missing synth.
  - `fusion_agents` execute gates on it — invalid config makes the tool error out (throws), it doesn't fabricate an answer.
  - Tests: real `.pi/fusion-agents.json` files in temp dirs (valid, missing, 2/4 panels, missing synth, malformed) — no mocks. typecheck + tests green.

- [x] CFG-014 Set thinking level per stage in the config		!high
  Thinking level is hardcoded "xhigh" for every inner agent; synth doesn't need max and wastes cost/time on it.

  Let .pi/fusion-agents.json set it per stage (e.g. panel "xhigh", synth "medium"), with a default when unset.

  **Implemented:**
  - `.pi/fusion-agents.json` takes an optional `thinking: { panel, synth }` block; `loadFusionConfig` resolves it to a fully-populated `FusionConfig.thinking`, defaulting panel `xhigh` / synth `medium` when omitted.
  - `fuse` threads the per-stage level: panel agents run at `thinking.panel`, synthesis at `thinking.synth` (config wins over any caller-supplied level). `runPanelAgent` gained an optional `thinkingLevel`, defaulting `xhigh` for direct callers.
  - Validation rejects a non-object `thinking` and any present-but-invalid level (case-sensitive list; `off` excluded); a missing block or sub-field falls back to the default. Omitting `thinking` lowers synth from the old hardcoded `xhigh` — a deliberate behavior change.
  - Tests (`test/config.test.ts`, pure): defaults, per-stage values, partial block, `null`, invalid level, non-object block; existing `fuse` smoke tests updated for the new field.

- [x] CFG-018 Allow panel sizes other than exactly 3		!low
  Config hardcodes panel.length === 3, though runPanel is generic. Accept a range (e.g. >= 2) so panel size isn't frozen in code.

  **Implemented:**
  - `loadFusionConfigFromPath` now validates `panel.length >= 2` (was `=== 3`); the error message reads "config \"panel\" must be at least 2 non-empty model IDs". No upper bound — a larger panel is the caller's cost/choice; a 1-model panel stays rejected (nothing to fuse).
  - The whole pipeline (`runPanel` → `synthesize` → `fuse`) was already array-generic over the panel, so no runtime code changed — only the validator and count-bearing comments (`config.ts`, `cli.ts`, `fusion.ts`) and the normative panel-size wording in the docs.
  - Tests: a panel of 1 or 0 is rejected; a panel of 2 and of 4 loads and returns the given IDs.

- [x] CFG-030 Encode reasoning level per model in the model ID (`provider/model@level`)
  Reasoning level is set today in a separate `thinking: { panel, synth }` block. Move it onto the model: each ID carries its level as an `@` suffix, e.g. `opencode-go/glm-5.1@high` — for both panel models and the synth (judge). This replaces the `thinking` block entirely.

  A missing `@level` is a config error, not a silent default — someone will forget it, silently get reasoning off, and not understand why fusion underperforms.

  User decisions:
  - reasoning level lives in the model ID via `@level` (panel models + synth);
  - it replaces the `thinking` block entirely;
  - the suffix is required — a model ID without `@level` is a config error.

  DoD:
  - `opencode-go/glm-5.1@high` runs that model at `high`, for a panel model and synth;
  - a model ID without `@level` fails config validation with a clear message;
  - the `thinking` block no longer exists in the config format.

  **Implemented:**
  - `loadFusionConfigFromPath` parses each `provider/model@level` string into a `ModelSpec { id, level }` (`config.ts`); `FusionConfig.panel: ModelSpec[]`, `synth: ModelSpec`, and the `thinking` block is gone. The `@level` suffix is required and the level validated; a missing/invalid suffix, a malformed `provider/model`, or a leftover `thinking` key each fail config-load with a clear, distinct message.
  - Each model runs at its own level: `runPanel` takes `ModelSpec[]` and threads each panel model's `level`; `fuse` runs synth at `config.synth.level`. A panel need not be uniform.
  - Resume (SYN-029) carries the level per session in the manifest (`RunSessionRef.level`), manifest bumped to version 2; a pre-CFG-030 manifest now reads as expired (runs are ephemeral, so no migration). The CLI prints `id@level`.
  - `.pi/fusion-agents.json`, the README config example, and the user-global config were migrated to the `@level` form.
  - Verified on real models: `@level` config file loads and runs (panel + synth at different levels), and a resume round-trip restores each session's level; deterministic config tests cover the required-suffix, invalid-level, empty-id, malformed-id, and leftover-`thinking` errors.
