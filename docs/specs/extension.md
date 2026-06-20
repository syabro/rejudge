# Extension — mdtask

The `fusion_agents` Pi extension tool: how it registers and behaves inside a host Pi agent, including its live progress UI. Engine internals live in `panel.md`; the inner-agent tools in `tools.md`; config in `config.md`; the CLI in `cli.md`.

## The tool

The package loads as a Pi extension via the `pi.extensions` manifest (entry `src/index.ts`) and registers one external tool, `fusion_agents`. It is invoked explicitly — never auto-invoked — with:

- `question` (required) — the question or instruction to run across the panel.
- `outputInstructions` (optional) — the desired output format (e.g. a requested structure, or P0/P1/P2/P3 buckets).
- `title` (optional) — a short phrase for what the run is about, shown in the live progress header (see below).

It runs the question across the configured panel, fuses the answers via synthesis, and returns a single final answer, text only — intermediate panel outputs are never surfaced. The output instructions are carried end-to-end: they are composed into the prompt every panel agent receives, and synthesis is told to honor the task's format, so the returned answer respects the requested format.

A missing or invalid config makes the tool fail — it throws, which the host reports as a tool error. A technical failure of the panel or synthesis instead returns a non-fabricated failure result naming the stage, model, and error; either way the tool never invents an answer.

Each inner agent (the panel models and synthesis) runs read-only by default in the working directory. The inner-agent tool surface — the read-only set, the `fullTools` opt-in, and the custom `git_diff` tool — is described in `tools.md`.

## Live progress

While `fusion_agents` runs inside Pi it shows a live block, refreshed every second (the clock advances even during a long step with no events), as a three-level tree — header → judge → panel models, with a total at the bottom:

    Fusion review the runner change
      glm-5.1 (judge)       0. thinking   12s  …keep it concise but complete
        ⎿ deepseek-v4-pro   2. read       03s  src/runner.ts
        ⎿ mimo-v2.5-pro      ✓ done (46s | 4 tools)
        ⎿ minimax-m3        waiting…
    Total 1m18s

- **Header** `Fusion <title>` — `<title>` is the tool's `title` parameter (the caller passes a short phrase for what the run is about); absent, it falls back to the first line of the question. Colored by outcome: neutral running, green done, red on failure, dim on cancel.
- **Judge** (the synth model) sits above the panel; the panel models hang under it (`⎿`). The tree shape is on the left; the status cell is aligned to one shared column across the judge and the panel rows.
- **A running model** reads `nn. tool  time  detail`: a dimmed step number (tools so far), the step (`thinking`/`writing`/the tool name), the step's duration (live while it runs, frozen between steps so the gap shows the previous step, not a blank), then a dimmed detail — the tool's params (a read's path, `git_diff`'s mode, a `web_search` query) or the live tail of the streamed thinking/writing text. The detail trims to the terminal width (keeping its end), so the block fits the window and never wraps, and it reflows on resize. Before the first step the cell is empty.
- **A finished model** reads `✓ done (time | N tools)` in green; a broken one `✗ <reason> (…)` in red; one cancelled by an abort `⊘ cancelled (…)` in dim.
- Durations are `NNs` under a minute, `NmNNs` at or past one. The **Total** line (dimmed) at the bottom is the whole run's time. With `debugLog` on, a dimmed line shows the log path.
- Expand the result to see the fused answer below the tree. On a failure the block stays (its red/cancelled rows and Total remain) — the tool reports the failure as its result rather than throwing, which would wipe the block.
- The engine never writes to the host's output — progress is this block only (the CLI renders the same events to stderr instead; see `panel.md`).

# Tasks

- [x] EXT-032 Live progress UI for the fusion_agents tool + stop stderr corrupting Pi output
  Inner-agent activity is written to process stderr; when fusion_agents runs inside a host Pi agent, those writes corrupt the host's tool output. The engine must not write to the host's output; progress is surfaced per consumer (CLI → stderr; the fusion_agents tool → its own live block).

  User decisions:
  - live progress block inside Pi; the clock refreshes every 1 second (even during a long step with no events);
  - three levels: fusion_agents → judge model → panel models (judge above the panel);
  - per panel model: current activity, its own elapsed time, a tool count; per-tool timing available in the expanded view, not listed inline;
  - the root line shows the live total run time;
  - done = green ✓ + green row; a broken model = red ✗ + red row; a sibling cancelled by another's failure = dim, not red;
  - the status/activity column is a fixed width (20) so the table never jumps;
  - the CLI keeps its stderr progress log, now with per-step durations + a total.

  The block uses the SDK's `@earendil-works/pi-tui` as a peer dependency (host-provided, like other Pi extensions), not a bundled copy.

  DoD:
  - fusion_agents inside Pi shows the live 3-level block with the 1s timer and zero stderr corruption of the host output;
  - on failure: broken model row red, cancelled siblings dim, root red;
  - the CLI prints progress to stderr with per-step durations + a total;
  - docs updated: this spec (tool UX) + the panel.md activity-log section (engine emits events, not raw stderr).

  **Implemented:**
  - The engine writes nothing to stdout/stderr on its own — it emits a discriminated `ProgressEvent` stream to a caller-supplied `activitySink`; with no sink it is silent, so running inside a host Pi no longer corrupts its output. Each consumer renders the events its own way.
  - The `fusion_agents` tool draws a live in-place block (`renderShell:"self"`, `renderResult` + a 1s ticker): `Fusion <title>` header → judge → panel rows → dimmed `Total`. Running rows show `nn. step time detail` with the tool's params or the streamed thinking/writing tail dimmed; finished rows `✓/✗/⊘ status (time | N tools)`, tinted. A failed run returns the snapshot instead of throwing, so the block survives.
  - The CLI/demo render the same events to stderr (one line per finished step with its duration, then per-model, per-stage and total times); durations are `NNs`/`NmNNs`.
  - Side fixes folded in: inner sessions are in-memory (no `/resume` spam), `web_search` is offered to inner agents when the host provides it, and debug-log notices ride the sink as diagnostics. Skills `fusion`/`fusion-review` call the tool inside Pi, the CLI elsewhere.

- [x] EXT-033 Consolidate how the fusion_agents tool works into this spec
  How the `fusion_agents` Pi tool works is scattered across other specs (e.g. tools.md `## fusion_agents`, plus mentions in panel.md / cli.md / config.md). Review every spec and move the "how the extension/tool works" content here, leaving the others to their own scope (engine internals, CLI, config, inner-agent tools) with a cross-reference where needed.

  DoD:
  - no other spec describes the fusion_agents tool surface; it lives in extension.md, with the others cross-referencing it instead of duplicating.

  **Implemented:**
  - The external tool surface now lives in a single `## The tool` section here: how it registers (the `pi.extensions` manifest), that it's invoked explicitly, its params (`question`/`outputInstructions`/`title`), that it returns one final answer text only, end-to-end output instructions, and the precise failure modes (bad config throws → tool error; a panel/synth failure returns a non-fabricated result naming stage/model/error).
  - `tools.md` lost its external-contract paragraphs; its `## fusion_agents` heading became `## Inner-agent tools` and now opens with a cross-reference here, keeping only its own scope (the read-only/`fullTools` tool set and `git_diff`).
  - `config.md` and `cli.md` keep only their own scope and gained short cross-references back here; `panel.md`/`synth.md` already cross-referenced this spec. Verified no other spec restates the tool surface.
