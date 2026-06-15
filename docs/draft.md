# pi-fusion-agents — decision draft

This document records decisions and the near-term direction. Details that can be looked up later or decided after the first working run stay outside this draft.

## What we are building

Build a separate Pi package/extension:

```text
pi-fusion-agents
```

It adds one external Pi tool:

```text
fusion_agents
```

`fusion_agents` is called explicitly with a question or instruction. The normal tool result contains final answer text only.

The product idea is similar to OpenRouter Fusion: several models look at the same question, then their work is fused into one answer.

## Accepted decisions

- Build this as a separate package/extension.
- Package/folder name: `pi-fusion-agents`.
- External tool name: `fusion_agents`.
- Start with explicit invocation only. Auto-invocation can come later.
- Inner agents receive the exact same task and output instructions.
- Fusion diversity comes from different agents/models/tool-use trajectories while the input stays identical.
- The caller can include output instructions, such as review severity buckets or a requested answer structure.
- Inner agents and synthesis should preserve the requested output format when possible.
- A separate synthesis call combines the inner agent outputs into one answer.
- User-facing output is only the final answer text.
- Build an unsafe spike first to get a working result quickly.
- The unsafe spike uses three inner agents.
- A fusion result requires complete technical success across the three panel agents and synthesis.
- The project config lives at `<project>/.pi/fusion-agents.json`.
- The project config stores full provider/model IDs, for example `anthropic/claude-sonnet-4-5`.
- The first spike config lists exactly three panel model IDs and one synthesis model ID.
- `fusion_agents` starts when a valid spike config is present.
- Model selection for the first spike is the model list in the project config.
- The first spike targets research/answer tasks.
- Write and bash are available in the spike as full local capabilities.
- Bash counts as full write capability and can modify or break the project/environment.
- The first concept check runs in the current trusted project environment.
- Build secure mode after that.
- In secure mode, inner tools use the `fusion_sub_*` prefix.
- In secure mode, agents can read and search the whole current project folder.
- The project root is the access boundary.
- `files` are “start here” hints; permissions come from the project boundary.
- Writes in secure mode go only to scratch under `.pi/fusion-agents/<run-id>/<sub-id>/...`.
- DeepSWE can be tried as a coding/SWE model.

## Unsafe spike

Goal: quickly prove that `fusion_agents` works.

The spike runs three inner agents on the exact same task and output instructions. When the three panel runs complete, a separate synthesis call returns one final answer.

The input can include output instructions, for example `Return code review findings as P0/P1/P2/P3`.

For the spike, inner agents can receive local coding tools: read/list/search, bash, and edit/write.

This is a trusted local experiment. Production safety comes later in secure mode. Bash is treated as full write access, because shell commands, pipes, redirects, and local CLIs can modify or break the project/environment.

Network access, if needed during the spike, goes through bash or local CLIs.

## Secure mode later

After the working spike, move from full local tools to custom tools:

```text
fusion_sub_read
fusion_sub_rg
fusion_sub_list
fusion_sub_write_scratch
```

Read rule: the whole current project folder is available, and the project root is the boundary.

Write rule: writes go to scratch.

## DeepSWE

DeepSWE can be tried as a coding/SWE model.

If we reach a separate DeepSWE check, first look only at the tools it needs:

```text
file_editor
execute_bash
search
finish
```

DeepSWE details stay outside this draft until a dedicated DeepSWE check.

## After the first working spike

After the first working spike, decide these deferred items: config shape beyond model IDs, adapter shape for local tools, evaluation and debug details, network implications, auto-invocation, and DeepSWE adapter details.

## Near-term direction

1. Build a minimal unsafe spike for `fusion_agents`.
2. Run three inner agents on one question about the current project.
3. Give them available local tools.
4. Use a separate synthesis call to return one final answer text.
5. After the demo, decide which tools are needed for secure mode.
