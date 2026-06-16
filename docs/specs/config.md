# Config — mdtask

## .pi/fusion-agents.json

`fusion_agents` reads its config from `<project>/.pi/fusion-agents.json` and refuses to run without a valid one:

```json
{ "panel": ["provider/model-a", "provider/model-b", "provider/model-c"], "synth": "provider/model-d" }
```

Exactly 3 `panel` model IDs + 1 `synth` model ID, full provider/model form. A missing file, malformed JSON, wrong panel count, or missing `synth` makes the tool error out with a clear message.

# Tasks

- [x] CFG-005 Load and validate .pi/fusion-agents.json and gate fusion_agents		#poc @blocked_by:PRJ-012
  `fusion_agents` starts only when a valid config exists at `<project>/.pi/fusion-agents.json` with full provider/model IDs (e.g. anthropic/claude-sonnet-4-5).
  Constraints: exactly 3 panel model IDs + 1 synthesis model ID; that list is the model selection; config shape beyond these IDs is deferred.
  Acceptance: valid config (3 panel + 1 synthesis) lets the tool proceed and exposes the four IDs to the runner; missing file / wrong panel count / missing synthesis ID -> refuse to start with a clear error.

  **Implemented:**
  - `src/config.ts` `loadFusionConfig(cwd)` reads `<cwd>/.pi/fusion-agents.json`, validates exactly 3 `panel` IDs + 1 `synth` ID, returns them; throws a clear error on missing file / malformed JSON / wrong panel count / missing synth.
  - `fusion_agents` execute gates on it — invalid config makes the tool error out (throws), it doesn't fabricate an answer.
  - Tests: real `.pi/fusion-agents.json` files in temp dirs (valid, missing, 2/4 panels, missing synth, malformed) — no mocks. typecheck + tests green.
