# Extension — mdtask

The `fusion_agents` Pi extension tool: how it registers and behaves inside a host Pi agent,
including its live progress UI. Engine internals live in `panel.md`; the CLI in `cli.md`.

## Live progress

While `fusion_agents` runs inside Pi it shows a live block, refreshed every second (the clock
advances even during a long step with no events), as a three-level tree — header → judge →
panel models, with a total at the bottom:

    Fusion review the runner change
      glm-5.1 (judge)       0. thinking   12s  …keep it concise but complete
        ⎿ deepseek-v4-pro   2. read       03s  src/runner.ts
        ⎿ mimo-v2.5-pro      ✓ done (46s | 4 tools)
        ⎿ minimax-m3        waiting…
    Total 1m18s

- **Header** `Fusion <title>` — `<title>` is the tool's `title` parameter (the caller passes a
  short phrase for what the run is about); absent, it falls back to the first line of the
  question. Colored by outcome: neutral running, green done, red on failure, dim on cancel.
- **Judge** (the synth model) sits above the panel; the panel models hang under it (`⎿`). The
  tree shape is on the left; the status cell is aligned to one shared column across the judge
  and the panel rows.
- **A running model** reads `nn. tool  time  detail`: a dimmed step number (tools so far),
  the step (`thinking`/`writing`/the tool name), the step's duration (live while it runs,
  frozen between steps so the gap shows the previous step, not a blank), then a dimmed detail —
  the tool's params (a read's path, `git_diff`'s mode, a `web_search` query) or the live tail
  of the streamed thinking/writing text. Before the first step the cell is empty.
- **A finished model** reads `✓ done (time | N tools)` in green; a broken one `✗ <reason>
  (…)` in red; one cancelled by an abort `⊘ cancelled (…)` in dim.
- Durations are `NNs` under a minute, `NmNNs` at or past one. The **Total** line (dimmed) at
  the bottom is the whole run's time. With `debugLog` on, a dimmed line shows the log path.
- Expand the result to see the fused answer below the tree. On a failure the block stays (its
  red/cancelled rows and Total remain) — the tool reports the failure as its result rather than
  throwing, which would wipe the block.
- The engine never writes to the host's output — progress is this block only (the CLI renders
  the same events to stderr instead; see `panel.md`).

# Tasks

- [x] EXT-032 Live progress UI for the fusion_agents tool + stop stderr corrupting Pi output
  Inner-agent activity is written to process stderr; when fusion_agents runs inside a host Pi
  agent, those writes corrupt the host's tool output. The engine must not write to the host's
  output; progress is surfaced per consumer (CLI → stderr; the fusion_agents tool → its own
  live block).

  User decisions:
  - live progress block inside Pi; the clock refreshes every 1 second (even during a long
    step with no events);
  - three levels: fusion_agents → judge model → panel models (judge above the panel);
  - per panel model: current activity, its own elapsed time, a tool count; per-tool timing
    available in the expanded view, not listed inline;
  - the root line shows the live total run time;
  - done = green ✓ + green row; a broken model = red ✗ + red row; a sibling cancelled by
    another's failure = dim, not red;
  - the status/activity column is a fixed width (20) so the table never jumps;
  - the CLI keeps its stderr progress log, now with per-step durations + a total.

  The block uses the SDK's `@earendil-works/pi-tui` as a peer dependency (host-provided, like
  other Pi extensions), not a bundled copy.

  DoD:
  - fusion_agents inside Pi shows the live 3-level block with the 1s timer and zero stderr
    corruption of the host output;
  - on failure: broken model row red, cancelled siblings dim, root red;
  - the CLI prints progress to stderr with per-step durations + a total;
  - docs updated: this spec (tool UX) + the panel.md activity-log section (engine emits events,
    not raw stderr).

  **Implemented:**
  - The engine writes nothing to stdout/stderr on its own — it emits a discriminated
    `ProgressEvent` stream to a caller-supplied `activitySink`; with no sink it is silent, so
    running inside a host Pi no longer corrupts its output. Each consumer renders the events
    its own way.
  - The `fusion_agents` tool draws a live in-place block (`renderShell:"self"`,
    `renderResult` + a 1s ticker): `Fusion <title>` header → judge → panel rows → dimmed
    `Total`. Running rows show `nn. step time detail` with the tool's params or the streamed
    thinking/writing tail dimmed; finished rows `✓/✗/⊘ status (time | N tools)`, tinted. A
    failed run returns the snapshot instead of throwing, so the block survives.
  - The CLI/demo render the same events to stderr (one line per finished step with its
    duration, then per-model, per-stage and total times); durations are `NNs`/`NmNNs`.
  - Side fixes folded in: inner sessions are in-memory (no `/resume` spam), `web_search` is
    offered to inner agents when the host provides it, and debug-log notices ride the sink as
    diagnostics. Skills `fusion`/`fusion-review` call the tool inside Pi, the CLI elsewhere.

- [ ] EXT-033 Consolidate how the fusion_agents tool works into this spec
  How the `fusion_agents` Pi tool works is scattered across other specs (e.g. tools.md
  `## fusion_agents`, plus mentions in panel.md / cli.md / config.md). Review every spec and
  move the "how the extension/tool works" content here, leaving the others to their own scope
  (engine internals, CLI, config, inner-agent tools) with a cross-reference where needed.

  DoD:
  - no other spec describes the fusion_agents tool surface; it lives in extension.md, with the
    others cross-referencing it instead of duplicating.
