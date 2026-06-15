# pi-fusion-agents — decision draft

This is not an implementation plan. This document records decisions and the near-term direction. If a detail can be looked up later or decided after the first working run, it does not belong here.

## What we are building

Build a separate Pi package/extension:

```text
pi-fusion-agents
```

It adds one external Pi tool:

```text
fusion_agents
```

`fusion_agents` is called explicitly with a question or instruction. It returns one normal final answer to the user.

The product idea is similar to OpenRouter Fusion: several models look at the same question, then their work is fused into one answer.

## Accepted decisions

- Do not patch the current `pi-fusion`.
- Package/folder name: `pi-fusion-agents`.
- External tool name: `fusion_agents`.
- Start with explicit invocation only. Auto-invocation can come later.
- Inner agents receive the same question/instruction.
- User-facing output is a final answer, not an internal report.
- Build an unsafe spike first to get a working result quickly.
- Build secure mode after that.
- In secure mode, inner tools use the `fusion_sub_*` prefix, not `panel_*`.
- In secure mode, agents can read and search the whole current project folder.
- `allowed_paths` from outer Pi is not needed.
- `files` are only “start here” hints, not permissions.
- Policy exists to prevent escaping the project root.
- Writes in secure mode go only to scratch under `.pi/fusion-agents/<run-id>/<sub-id>/...`.
- DeepSWE can be tried as a coding/SWE model.

## Unsafe spike

Goal: quickly prove that `fusion_agents` works.

For the spike, inner agents can receive the available local tools. This is a trusted local experiment, not the production default and not the final security model.

## Secure mode later

After the working spike, restrict access to custom tools:

```text
fusion_sub_read
fusion_sub_rg
fusion_sub_list
fusion_sub_write_scratch
```

Read rule: the whole current project folder is available; escaping outside it is forbidden.

Write rule: scratch only, no direct project writes.

## DeepSWE

DeepSWE can be tried as a coding/SWE model.

If we reach a separate DeepSWE check, first look only at the tools it needs:

```text
file_editor
execute_bash
search
finish
```

Do not record other DeepSWE details in this document.

## Result check

Run the first check on a local coding/project task.

Decide the benchmark method, scoring, and report format after the first working run.

## What we are not fixing now

- config and tool parameters;
- exact toolset for the unsafe spike;
- benchmark method;
- internal judge/report format;
- web tools;
- auto-invocation;
- DeepSWE adapter details.

## Near-term direction

1. Build a minimal unsafe spike for `fusion_agents`.
2. Run several inner agents on one question about the current project.
3. Give them available local tools.
4. Return one final answer.
5. After the demo, decide which tools are needed for secure mode.
