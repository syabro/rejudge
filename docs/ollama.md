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
