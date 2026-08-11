# Ollama

Pi has no built-in provider for Ollama, so Ollama models reach Rejudge as a provider you declare
once in `~/.pi/agent/models.json`. Nothing in Rejudge changes: the panel names Ollama models the way
it names any others.

The three settings that fail without an error are listed in the README. This is the rest of it — the
file, the model ids, where the numbers come from, and what the failures look like.

Both routes use the same provider. Cloud models go to `127.0.0.1:11434` and the daemon forwards them
to Ollama Cloud on your account; local weights are served by the same daemon. Either way no API key
reaches Rejudge, because the daemon holds the credentials.

## The provider

Create the directory if it is not there — a missing `models.json` is not an error, Pi simply reads no
providers and the failure arrives later as `Unknown model`:

```bash
mkdir -p ~/.pi/agent
```

If you already have a `models.json`, add the `ollama` key to its `providers` object rather than
replacing the file: that is also where your other providers' credentials and overrides live.

```json
{
  "providers": {
    "ollama": {
      "name": "Ollama",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "maxTokensField": "max_tokens"
      },
      "models": [
        {
          "id": "gpt-oss:120b-cloud",
          "name": "gpt-oss 120B",
          "reasoning": true,
          "thinkingLevelMap": {
            "off": "none",
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": "max",
            "max": "max"
          },
          "input": ["text"],
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 131072,
          "maxTokens": 32768
        }
      ]
    }
  }
}
```

Repeat the model block per model. A panel takes two reviewers at minimum plus a judge, and every id
named in your Rejudge config has to be declared here first.

`apiKey` is a placeholder rather than a secret, since the daemon authenticates. It cannot be empty
though: an empty string fails validation, the provider is dropped, and every model reads as unknown.

`cost` is required and stays at zero, because a subscription has no per-token price. Rejudge reports
`$0` for the run.

## Model ids

The id is the name the daemon accepts. For a cloud model the `-cloud` marker attaches differently
depending on whether the model carries a tag:

| Model in the catalogue | Id to write |
| --- | --- |
| `glm-5.2` (no tag) | `glm-5.2:cloud` |
| `gpt-oss:120b` (tagged) | `gpt-oss:120b-cloud` |
| `nemotron-3-nano:30b` (tagged) | `nemotron-3-nano:30b-cloud` |

Get it wrong and the daemon answers `model not found`. A local model is named exactly as
`ollama list` shows it.

Pulling a cloud model first is optional — the daemon proxies it on demand — but the stub is a few
hundred bytes and it puts the model in your local list, where the next section can read its numbers.

## Where `reasoning` and `contextWindow` come from

Read them off the daemon rather than guessing. `capabilities` decides `reasoning`, and
`details.context_length` is the window:

```bash
curl -s http://127.0.0.1:11434/api/tags | python3 -c '
import sys, json
for m in json.load(sys.stdin)["models"]:
    caps = m.get("capabilities") or []
    ctx = (m.get("details") or {}).get("context_length")
    print(m["name"], ctx, "thinking" if "thinking" in caps else "NO-THINKING")'
```

A model that does not report `thinking` has to be declared `reasoning: false`, and its `@level` then
drops to `off` without a word — so it is not one to put in a panel. Reviewers need `tools` as well,
since the work is reading the diff and the files around it.

Some builds leave `context_length` out of `/api/tags` — every MLX one does. `/api/show` still has it,
under a key named after the model's architecture:

```bash
curl -s http://127.0.0.1:11434/api/show -d '{"model":"qwen3.5:4b-mlx"}' \
  | python3 -c 'import sys, json; print({k: v for k, v in json.load(sys.stdin)["model_info"].items() if k.endswith(".context_length")})'
```

Rounding `contextWindow` down is safe — it only makes Pi compact earlier. Rounding up invites a
server-side error partway through a long review.

## The panel

Name the declared models in your Rejudge config, with the provider key as the prefix:

```json
{
  "reviewers": [
    "ollama/gpt-oss:120b-cloud@high",
    "ollama/qwen3.5:397b-cloud@high",
    "ollama/nemotron-3-super:cloud@high"
  ],
  "judge": "ollama/glm-5.2:cloud@high"
}
```

Ollama takes `low`, `medium`, `high` and `xhigh` through the map above. It rejects `minimal`
outright, so leave that one out of an Ollama panel.

Pick reviewers from different labs. Two models from one line share their blind spots, and a panel
that agrees for that reason has told you nothing.

## Local models

Local weights work through the same provider, with one difference that outweighs the rest: the
context window is a server setting, and an overflow is silent.

`num_ctx` cannot be set through the OpenAI-compatible endpoint — `max_tokens` is a different thing —
so it comes from the daemon:

```bash
OLLAMA_CONTEXT_LENGTH=65536 ollama serve
```

Set each local model's `contextWindow` to that number. Claim more and Ollama truncates the input
instead of compacting it, and Rejudge cannot tell: a truncated run still ends with a clean stop and
non-empty text, so it is reported as a success — a confident review of a diff the model never saw.

A reviewer needs the room. One `git_diff` in full mode returns up to 200 000 bytes in a single tool
result, before any file reads.

Reviewers also run concurrently, so a three-model panel needs three models resident at once.
`OLLAMA_NUM_PARALLEL` serves one request at a time by default, and models that do not all fit in
memory get evicted and reloaded on every step of the tool loop.

## When something goes wrong

| What you see | What it is |
| --- | --- |
| `Unknown model "ollama/…"`, before you wrote the file | No `~/.pi/agent/models.json`, or a file under another name. A missing one is not an error — Pi just reads no providers. |
| `Unknown model "ollama/…"`, with the file in place | Either the id is not declared in `models.json`, or the provider block is malformed: no `baseUrl`, no `api`, an empty `apiKey`, or a `cost` missing one of its four keys. Any of those drops the provider silently. |
| `model not found` | Wrong id — see [Model ids](#model-ids). |
| `410 … was retired at …` | The model is gone from the service. `ollama list` keeps stubs for retired cloud models, so trust the catalogue, not your local list. |
| `402 … extra usage only` | The model is outside your plan. |
| `invalid reasoning value` | `thinkingLevelMap` is missing or incomplete. Ollama's error names the values it takes. |
| Reviews arrive but ignore the task | `supportsDeveloperRole` is not `false`. |
| A message pointing at `/login` | `apiKey` is absent entirely. Add the placeholder. |

The config format itself is in `docs/specs/config.md`.
