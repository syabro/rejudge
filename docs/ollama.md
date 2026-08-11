# Ollama as a Rejudge provider

Ollama is not one of Pi's built-in providers, so Rejudge reaches it the way Pi reaches any
OpenAI-compatible endpoint: through a provider you declare once in `~/.pi/agent/models.json`.
No Rejudge code or flag is involved — the panel then names Ollama models like any others.

Two setups are worth having, and they share one file:

- **Cloud models through the local daemon.** Requests go to `127.0.0.1:11434`, the daemon forwards
  them to Ollama Cloud on your account. Your subscription pays, and no API key touches Rejudge.
- **Models on your own machine.** Same endpoint, local weights. Read
  [Purely local models](#purely-local-models) first — the default context window will quietly
  ruin a review.

Three settings in that file are load-bearing. Each one is wrong by default for Ollama, and each one
fails without saying so. They are explained in [Why those three settings](#why-those-three-settings);
copy them even if the reason looks academic.

## Before you start

Ollama installed and signed in, so cloud models resolve. The `run` also starts the daemon if it is
not up yet, which is what the rest of this guide talks to:

```bash
ollama --version
ollama run gpt-oss:120b-cloud "ping"     # any cloud model; proves the account is connected
```

Pi's agent directory has to exist. A missing `models.json` is not an error — Pi reads no providers
and the failure arrives later as `Unknown model`, which names the wrong problem:

```bash
mkdir -p ~/.pi/agent
```

## Cloud models through the local daemon

Write `~/.pi/agent/models.json`. If you already have one, add the `ollama` key to the existing
`providers` object instead of replacing the file — this is also where your other providers'
keys and overrides live.

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

That block is one model. A panel needs at least three reviewers and a judge, so repeat it per model
before you go on — **every id you name in the Rejudge config has to be declared here**, or the run
fails with `Unknown model` for the ones that are missing.

`name` is cosmetic: it is the label Pi shows when listing models.

`apiKey` is a placeholder, not a secret: the daemon holds your credentials. It cannot be empty
though — an empty string fails validation, the provider is dropped, and the run reports
`Unknown model`. Ollama's own examples use the same placeholder.

`cost` stays at zero because a subscription has no per-token price. Rejudge will report `$0` for the
run. All four of its keys are required.

Then name the models in `.rejudge/config.json` for one project, or `~/.config/rejudge/config.json`
for all of them, with the provider key you chose as the prefix:

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

Pick reviewers from different labs. Models that share weights share their blind spots, and a panel
that agrees for that reason tells you nothing.

## Naming a cloud model

The id is the name the daemon accepts, and the `-cloud` marker attaches differently depending on
whether the model carries a tag:

| Model in the catalog | Id to write |
| --- | --- |
| `glm-5.2` (no tag) | `glm-5.2:cloud` |
| `gpt-oss:120b` (tagged) | `gpt-oss:120b-cloud` |
| `nemotron-3-nano:30b` (tagged) | `nemotron-3-nano:30b-cloud` |

Get the spelling wrong and the daemon answers `model not found`, not a hint.

You do not have to `ollama pull` a cloud model to use it — the daemon proxies it on demand. Pull it
anyway: the stub is a few hundred bytes, it carries the two facts the config needs, and it puts the
model in your local list where tooling can see it.

## Your model list is yours to curate

The daemon only reports models you have pulled. Nothing discovers the catalog for you, and nothing
keeps your list current — deciding which models you want, pulling them, and replacing them when the
service moves on are all yours:

```bash
ollama list                        # what you have
ollama pull glm-5.2:cloud          # add one
ollama rm glm-4.6:cloud            # drop one
```

Two things make this a real chore rather than a one-off. Ollama retires cloud models, and a retired
model keeps its local stub — `ollama list` still shows it, and only a review fails, with a 410. And
a model outside your plan answers 402 rather than anything useful. So when a run starts failing on a
model that "is right there in the list", check the catalog before you check your config:
<https://ollama.com/search?c=thinking&c=cloud&c=tools>.

## Where `reasoning` and `contextWindow` come from

Read them from the daemon instead of guessing. `capabilities` decides `reasoning`, and
`details.context_length` is the real window:

```bash
ollama pull glm-5.2:cloud
curl -s http://127.0.0.1:11434/api/tags | python3 -c '
import sys, json
for m in json.load(sys.stdin)["models"]:
    caps = m.get("capabilities") or []
    ctx = (m.get("details") or {}).get("context_length")
    print(m["name"], ctx, "thinking" if "thinking" in caps else "NO-THINKING")'
```

A model without `thinking` must be declared `reasoning: false`, and then its `@level` collapses to
`off` without a word — so it is not a reviewer you want. Reviewers need `tools` too: the whole job is
reading the diff and the files around it.

Rounding `contextWindow` down is safe; it only makes Pi compact earlier. Rounding up invites a
server-side error on a long review.

## Reasoning levels

Rejudge requires an `@level` on every model, and Ollama accepts a different vocabulary than Rejudge
uses. Without a complete `thinkingLevelMap` you get two different failures from one cause:

```
$ curl -s http://127.0.0.1:11434/v1/chat/completions -H 'Content-Type: application/json' \
    -d '{"model":"glm-5.2:cloud","messages":[{"role":"user","content":"hi"}],"reasoning_effort":"minimal"}'
{"error":{"message":"invalid reasoning value: 'minimal' (must be \"high\", \"medium\", \"low\", \"max\", or \"none\")", ...}}
```

`@minimal` is rejected outright, and `@xhigh` never reaches the wire — Pi clamps a level the model
does not declare, so it silently becomes `high`. The map in the example above fixes both: `minimal`
lands on `low`, and `xhigh` reaches Ollama's `max`, which is a real level above `high`.

## Why those three settings

For a base URL it does not recognize, Pi assumes OpenAI's behavior. Two of those assumptions are
wrong for Ollama, and neither announces itself. The third setting is the reasoning map above.

| Setting | Without it | Why |
| --- | --- | --- |
| `supportsDeveloperRole: false` | Reviews come back, written without ever seeing their instructions | Pi sends the system prompt as `role: "developer"` for reasoning models. Ollama passes the role straight into the chat template, which handles `system` and not `developer`, so the prompt is dropped and the model answers from nothing. |
| `maxTokensField: "max_tokens"` | The output cap silently does not apply | Ollama has no `max_completion_tokens` field and ignores unknown ones. It answers `200` and keeps generating. |
| `thinkingLevelMap` (per model) | `@minimal` fails every request, `@xhigh` degrades to `high` | See [Reasoning levels](#reasoning-levels). |

Do not copy `supportsReasoningEffort: false` from generic custom-provider advice. Ollama does support
`reasoning_effort`, and turning it off throws your reviewers' reasoning level away.

One warning about this file: unknown keys inside `compat` are accepted in silence. A typo in a field
name is not reported anywhere — it simply does nothing.

## Purely local models

Local weights work through the same provider, with one difference that matters more than all the
rest: **the context window is a server setting, and overflow is silent.**

`num_ctx` cannot be set through the OpenAI-compatible endpoint (`max_tokens` is a different thing),
so it comes from the daemon:

```bash
OLLAMA_CONTEXT_LENGTH=65536 ollama serve
```

Set each local model's `contextWindow` to exactly that number. Claim more and Ollama truncates the
input instead of compacting it — and Rejudge cannot tell. A truncated run still ends with a clean
stop and non-empty text, so it is reported as a success: a confident review of a diff the model
never saw. Pi says the same about this provider in `utils/overflow.d.ts` of its `pi-ai` package —
that Ollama may truncate input silently, and that the truncation cannot be detected from the
response.

A reviewer needs the room. A single `git_diff` in full mode returns up to 200 000 bytes in one tool
result, before any file reads.

Two more things to expect locally. Reviewers run concurrently, so a three-model panel needs three
models resident at once — `OLLAMA_NUM_PARALLEL` defaults to serving one request at a time, and
models that do not all fit in memory get evicted and reloaded on every step of the tool loop.
And the panel is all-or-nothing: one local reviewer that stalls or truncates fails the whole run,
after the other reviewers have already finished and been paid for.

## When something goes wrong

| What you see | What it is |
| --- | --- |
| `Unknown model "ollama/…"`, and you have not written the provider yet | No `~/.pi/agent/models.json`, or a file under another name. A missing file is not an error — Pi just reads no providers. |
| `Unknown model "ollama/…"`, with the file in place | Either the id is not declared in `models.json` at all, or the provider block is malformed: no `baseUrl`, no `api`, an empty `apiKey`, or a `cost` missing one of its four keys. Any of these drops the provider silently. |
| `model '…' not found` | Wrong id spelling — see [Naming a cloud model](#naming-a-cloud-model). |
| `410 … was retired at …` | The model is gone from the service. `ollama list` keeps stubs for retired cloud models, so trust the catalog, not your local list. |
| `402 … extra usage only` | The model is outside your plan. |
| `invalid reasoning value` | `thinkingLevelMap` is missing or incomplete. |
| Reviews arrive but ignore the task | `supportsDeveloperRole` is not `false`. |
| A message pointing you at `/login` | `apiKey` is absent entirely. Add the placeholder. |

The config format itself is in `docs/specs/config.md`.
