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
