# Rejudge — product direction

## Product boundary

Rejudge is an independent multi-model review layer for AI agents. Pi is the first native adapter, not the product identity. The same review engine is available through the Pi tool and a local CLI.

> **Independent review before your agent acts.**

Rejudge runs separate tool-enabled reviews, lets a judge investigate material disagreements through `ask_panel`, and returns one answer with a resumable run ID.

## Terminology

```text
Rejudge
├── Panel
│   ├── Reviewer 1
│   ├── Reviewer 2
│   └── Reviewer N
├── Judge
└── Review result
```

- **reviewer** — one model in its own session, independently investigating the request.
- **panel** — the reviewers collectively; it is not a machine-facing config key.
- **judge** — the model that examines reviewer findings, investigates material disagreements, preserves relevant dissent, and produces the answer.
- **review run** — one persisted execution that can be resumed by run ID.
- **review result** — the answer consumed by the calling agent.
- **ask_panel** — the judge's tool for re-querying reviewers in their existing sessions.

`fusion` is only an internal description of combining reviewer analyses. It is not the product, CLI, Pi tool, workflow, config, or public category.

## Current interfaces

- Product and repository: **Rejudge** / `rejudge`
- Public npm package: `rejudge` — one package for the CLI, Pi adapter, and both workflows
- Pi display name: **Rejudge for Pi**
- Pi tool: `rejudge`
- CLI: `bin/rejudge.js`
- General workflow: `/rejudge`
- Current-change review: `/rejudge-diff`
- Project config: `.rejudge/config.json`
- Global config: `~/.config/rejudge/config.json`

Configuration uses participant roles, not the collective panel name:

```json
{
  "reviewers": [
    "provider-a/model-x@xhigh",
    "provider-b/model-y@xhigh"
  ],
  "judge": "provider-c/model-z@medium",
  "debugLog": false
}
```

## Current review flow

```text
Caller
  → Rejudge
    → reviewers run separately
    → judge examines their findings
      ↔ ask_panel re-queries reviewer sessions when needed
    → one answer + run ID
  → caller continues
```

A fresh run starts a new panel. A follow-up with a run ID restores the reviewer and judge sessions instead of repeating the panel fan-out. Reviewers are read-only by default; the judge has only `ask_panel`.

## Positioning boundary

Rejudge promises an independent review process, not guaranteed correctness or truth from consensus. Initial reviews are generated in separate sessions, but model errors can still be correlated. The judge may combine compatible findings, reject the majority, retain dissent, return a conditional answer, or state that the available evidence is insufficient.

This naming pass does not add structured result contracts, instrumentation, evaluation infrastructure, new adapters, dynamic routing, policies, `inspect`, or a dedicated diff mode. Those remain separate product work.
