# Extension — mdtask

The `fusion_agents` Pi extension tool: how it registers and behaves inside a host Pi agent,
including its live progress UI. Engine internals live in `panel.md`; the CLI in `cli.md`.

# Tasks

- [ ] EXT-032 Live progress UI for the fusion_agents tool + stop stderr corrupting Pi output
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

- [ ] EXT-033 Consolidate how the fusion_agents tool works into this spec
  How the `fusion_agents` Pi tool works is scattered across other specs (e.g. tools.md
  `## fusion_agents`, plus mentions in panel.md / cli.md / config.md). Review every spec and
  move the "how the extension/tool works" content here, leaving the others to their own scope
  (engine internals, CLI, config, inner-agent tools) with a cross-reference where needed.

  DoD:
  - no other spec describes the fusion_agents tool surface; it lives in extension.md, with the
    others cross-referencing it instead of duplicating.
