---
name: fusion-review
description: Review the current code changes. Use when the user wants a code review — a diff or branch — or says /fusion-review.
user_invocable: true
---

# Fusion Review

A code review through the fusion panel — this is `/fusion` pointed at a diff. Same rules and the same launch decision: read the `fusion` skill first — **inside Pi call the `fusion_agents` tool, do NOT run the CLI**; only use the bin (`-f`, foreground/blocking, rebuild-after-pull) where the tool isn't available. This skill owns only *what prompt to feed* and *how to present the result*. Either way the panel runs read-only and fetches the diff itself via `git_diff`.

For a generic multi-model question that isn't a code review, use `fusion`; for an implementation-plan review, use `plan-review`.

## Pick the ref

The panel always diffs the working tree against one ref. Choose `<REF>`:

- default `HEAD` — review uncommitted work;
- a base branch the user named (e.g. `main`) — review committed work on a branch;
- genuinely ambiguous → ask one short question, don't guess.

State the ref you used in the output header.

## Run — read-only (review is an ask; never `--unsafe`/`--full`)

The review prompt below is the same whichever way you launch. Pick the path:

- **Inside Pi** — call the `fusion_agents` tool with the prompt as its `question`. The inner panel fetches the diff via `git_diff` against the cwd, so run it from the repo being reviewed. No file, no bin. Its result is the fused review.
- **Anywhere else** — write the prompt to a file and run the bin **from the repo being reviewed** (cwd drives `git_diff` and config lookup), as below.

    cat > /tmp/fusion-review-<id>.txt <<'EOF'
    Review my change against <REF> — only the change, not the rest of the codebase.
    Use git_diff to get the change. You may read files for context, but review ONLY the
    diff (the changed lines), not the current file snapshot.

    The task I solved: <PROBLEM>. How I solved it: <APPROACH>.
    Decisions taken — each marked AGENT or USER. Context for why the code looks this way,
    NOT settled truth: challenge any that look wrong — the AGENT ones especially; a USER
    decision that looks wrong, flag it for discussion.
    <DECISIONS>
    Hard constraints / out of scope — respect these, don't relitigate: <CONSTRAINTS>.

    Report findings grouped P0 / P1 / P2 / P3 (P0 = must-fix blocker, P1 = should fix,
    P2 = minor, P3 = nitpick). For each: the location (`file:line`, or
    `file:Lstart-Lend`); the relevant code/diff SHOWN; and a plain-language explanation of
    what's wrong and what breaks if ignored. Show the actual code AND explain it — the reader
    must decide seeing both, without opening the file. End with a one-line verdict
    (ship / fix-first / discuss). Stay in scope. If there are no changes, say so.
    EOF

    node /Users/syabro/code/pi-fusion-agents/bin/fusion.js -f /tmp/fusion-review-<id>.txt > /tmp/fusion-review-<id>.md
    echo "exit=$?"

- Fill `<PROBLEM>` / `<APPROACH>` / `<DECISIONS>` / `<CONSTRAINTS>` from the actual work — you did it, so you know the task, how you solved it, and every decision taken. Mark each decision **AGENT** or **USER**: the AGENT ones are the most suspect — the panel should pressure them; USER ones can still be flagged for discussion. Don't shield decisions as "given" — catching a bad one is the whole point. Constraints are the real boundaries the panel respects. Replace `<REF>` (default `HEAD`) and `<id>` (any short unique tag, e.g. `$$`, so parallel runs don't collide).
- A real run is minutes (the panel runs at xhigh). Set a generous timeout; never background.

## Output — review, then fixes

The panel runs read-only — it only produces the review; applying fixes is this skill's job, and the outcome for the user is fixed code, not a wall of text. Read the fused review (the `fusion_agents` tool result inside Pi, or `/tmp/fusion-review-<id>.md` from the CLI), then present **each** finding in this exact shape:

    path/to/file.ts

    ```
      80 │ <a couple of code lines for context>
      81 │ <the problem line(s)>
    ```
    ──────────────────────────────────────────────
    **<n>. <short title> — P<0–3>**
    <plain-language explanation: what's wrong and what breaks if ignored>
    **fix:** <the concrete fix>
    ──────────────────────────────────────────────
    ```
      82 │ <2–3 code lines after the problem, for context>
    ```

Shape rules:
- File path on top; then the code in a fenced block with line numbers — the change plus a couple of context lines BEFORE and AFTER, so it reads in place (the terminal is already monospace; only the *code* goes in a fence, never the prose).
- The `**n. title — P0..P3**` line is bold and carries the severity; the explanation and `**fix:**` sit between the two horizontal rules, as normal text so the bold renders.
- Decide seeing the code AND the words — never a bare `file:line`, never a description with no code shown.
- Order findings P0 first.

After the findings:
1. Ask the user which to fix.
2. Apply the ones they chose — the panel changed nothing (read-only), you make the edits — then report what you changed.

If the panel reports no changes, say so in one line and stop.

## Failure modes

For bin-level failures (didn't complete, bad config, missing bin → rebuild), see the `fusion` skill. Review-specific: "No changes against the requested ref" usually means the wrong cwd, or the wrong `<REF>` — committed work needs a base branch, not `HEAD`. Confirm before re-running.
