# Extension — mdtask

The `rejudge` Pi extension tool: registration, invocation, results, and live progress inside a host Pi agent. Engine internals live in `panel.md`; inner tools in `tools.md`; config in `config.md`; the CLI in `cli.md`.

## The tool

The `rejudge` package loads `dist/extension.js` through the `pi.extensions` manifest. The bundle inlines third-party dependencies while the Pi SDK and typebox remain host-provided. Build it with `bun run build:ext` or `bun run build`; `bun install` rebuilds it through `prepare`. It registers one explicit tool, `rejudge`, displayed as **Rejudge for Pi**, with:

- `question` (required) — the question or instruction for the reviewers.
- `outputInstructions` (optional) — the desired output format (e.g. a requested structure, or P0/P1/P2/P3 buckets).
- `title` (optional) — a short phrase for what the run is about, shown in the live progress header (see below).
- `resumeRunId` (optional) — the id from an earlier successful run; when set, the tool resumes that run instead of starting a fresh panel.

Without `resumeRunId`, Rejudge starts a fresh panel and the judge returns one answer plus a run ID. With `resumeRunId`, it restores the prior reviewer and judge sessions and sends the follow-up to the judge without repeating the fan-out. Intermediate reviewer outputs remain internal. Output instructions travel in the shared reviewer prompt and are reflected by the judge.

A missing or invalid config is a tool error. Pressing Esc returns the model-visible result `Rejudge cancelled by user.`; it is not reported as a broken review. A panel or judge failure still returns a non-fabricated result naming the stage, model, and reason. Reviewers are read-only by default; the judge has only `ask_panel`. See `tools.md`.

## Trust boundary

`question` and `outputInstructions` are composed verbatim into the prompt every reviewer receives, with no instruction/data delimiter between caller intent and content. A trusted caller or untrusted text inside those inputs can steer reviewers. The judge prompt treats reviewer analyses as data, but that does not protect reviewers from the original inputs. A resumed follow-up goes directly to the restored judge session as raw text and carries the same exposure.

This is accepted for the current trusted use case. Reviewers are read-only by default and the judge only has `ask_panel`; write/run access exists only behind the CLI's `--unsafe`/`--full`, never through the `rejudge` Pi tool. Read-only is not zero-risk: an injected instruction can still surface file or diff contents. Untrusted use requires a real instruction/data delimiter and input sanitization.

## Live progress

While `rejudge` runs inside Pi it shows a live block, refreshed every second, as a three-level tree — Rejudge → judge → reviewers — with a total at the bottom:

    Rejudge review the runner change
      gpt-5.5 (judge)       0. thinking   12s  …checking the disagreement
        ⎿ deepseek-v4-pro   2. read       03s  src/runner.ts
        ⎿ mimo-v2.5-pro      ✓  done (46s | 4 tools)
        ⎿ gpt-5.4           waiting…
    Total 1m18s

- **Header** `Rejudge <title>` uses the `title` parameter or the first question line. It is neutral while running, green when done, red on failure, and dim on cancel.
- **Judge** sits above the panel; reviewers hang under it (`⎿`). Status cells share one aligned column.
- **A running model** reads `nn. tool  time  detail`: a dimmed step number (tools so far), the step (`thinking`/`writing`/the tool name), the step's duration (live while it runs, frozen between steps so the gap shows the previous step, not a blank), then a dimmed detail — the tool's params (a read's path, `git_diff`'s mode, a `web_search` query) or the live tail of the streamed thinking/writing text. The detail trims to the terminal width (keeping its end), so the block fits the window and never wraps, and it reflows on resize. Before the first step the cell is empty.
- **A finished model** reads `✓  done (time | N tools)` in green; a broken one `✗ <reason> (…)` in red; one cancelled by an abort `⊘ cancelled (…)` in dim.
- Durations are `NNs` under a minute, `NmNNs` at or past one. The **Total** line (dimmed) at the bottom is the whole run's time. With `debugLog` on, a dimmed line shows the log path.
- Expand the result (Ctrl+O) to see the full request under `Request:` and the review answer below the tree. Collapsed, the header shows the clipped title and expand hint. On failure or cancellation the block remains with its final rows and total.
- The engine never writes directly to host output; the Pi tool owns this block and the CLI renders the same events to stderr.

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

- [x] EXT-034 Show the request in the fusion_agents expanded view (Ctrl+O)
  Ctrl+O currently shows only the fused answer; the request itself isn't visible (the header has just the truncated title).
  The expanded view should show the full request, first — above the answer.
  Wrap a long or multi-line request to width; never overflow the TUI.

  **Implemented:**
  - `ProgressSnapshot` gained an optional `request`; `createProgressState` takes it as a 4th arg, and `index.ts` passes the composed invocation prompt (`buildInvocationPrompt(question, outputInstructions)`) — what the panel actually receives.
  - Expanded (Ctrl+O), `renderProgress` shows the full request wrapped under a dim `Request:` label at the top, above the tree and the appended answer; it falls back to the title when the request is blank. Collapsed is unchanged (clipped title + the expand hint).
  - Overflow stays safe via the existing `wrapTextWithAnsi` + trailing `clampLines`; the CLI path is untouched (it renders to stderr, not through `progress.ts`).
  - Out of scope (a deeper, separate gap): surfacing the judge's synthesis prompt (task + all panel outputs).
  - Deterministic `progress.test.ts` covers the expanded request (label, ordering above tree/answer, title gone), the collapsed title-only view, blank/undefined fallback, and the unbreakable-token width clamp.

- [x] EXT-045 Bundle the extension to a self-contained JS file
  Pi 0.80's extension loader (jiti, node mode) resolves only aliased deps — the pi SDK and typebox — from the global Pi install; it does NOT resolve a project's other `node_modules`. Loading `src/index.ts` directly then fails on our `neverthrow` import with "Cannot find module 'neverthrow'". It also makes the extension fragile to the `node_modules` layout / a clean `bun install`.
  Outcome: the extension ships as one built JS file with its third-party deps (neverthrow) bundled in, and `package.json` `pi.extensions` points at the built file instead of `src/index.ts` — so nothing outside the pi SDK is left for Pi's loader to resolve, and it loads regardless of repo/node_modules state.
  Constraints: keep `@earendil-works/*` and `typebox` external (Pi provides/aliases them — never bundle the SDK); bundle `neverthrow` and any other third-party dep; add a build step alongside `build:cli` and rebuild after `src/` changes; the built file is a gitignored artifact like `bin/fusion.js`; update the tech.md / CLAUDE.md note that said the extension loads `src/index.ts` directly with no build.
  Acceptance: after a clean `bun install`, running `pi` in the project loads the fusion extension with no "Cannot find module" error and the `fusion_agents` tool works; the CLI still works; unit tests pass.

  **Implemented:**
  - `build:ext` bundles `src/index.ts` → `dist/extension.js` (bun build), inlining `neverthrow` and keeping `@earendil-works/pi-coding-agent`/`pi-ai`/`pi-tui` + `typebox` external (host-provided). `build` runs cli+ext; `prepare` runs `build` so `bun install` always materializes the artifacts. `pi.extensions` now points at `./dist/extension.js` (gitignored, like `bin/`).
  - Verified on Pi 0.80.2: `pi -p` loads the extension with no "Cannot find module 'neverthrow'" error (exit 0); the bundle has zero external `neverthrow` imports; typecheck + unit pass; CLI unchanged.
  - Root cause was the 0.80 loader, not our code — pinning the SDK to match the host (0.80.2) plus bundling makes the extension independent of how Pi resolves third-party deps.

- [x] EXT-051 Add resume support to the `fusion_agents` tool
  Pi reviews should be able to keep the same panel context without using the wrong launcher.

  Fusion already has resumable runs, and the CLI exposes them through `--resume <runId>`. Inside Pi, the correct launch path is the `fusion_agents` tool, but the tool has no resume parameter yet. Add an optional `resumeRunId` parameter that sends the question to the existing resume path instead of starting a fresh panel.

  User decision: split Pi tool resume support from the review workflow rules.

  DoD:
  - `fusion_agents` accepts an optional `resumeRunId` parameter.
  - A call with `resumeRunId` resumes the selected run and does not re-run the panel fan-out.
  - A call without `resumeRunId` still starts a fresh run.
  - Missing, expired, or wrong-cwd run ids fail clearly, matching the existing CLI resume behavior.
  - The tool result includes enough run id/context for another follow-up.

  **Implemented:**
  - `fusion_agents` accepts optional `resumeRunId` and passes it to the existing `fuse` resume path.
  - Successful tool output includes a `Run ID` follow-up hint, with resumed calls keeping the same run id.
  - Deterministic tool tests cover the public parameter and resume forwarding without a model call; the live tool smoke asserts that a run id is returned.

- [x] EXT-052 Surface user cancellation separately from Fusion failures		#release
  Pi agents can tell when a `fusion_agents` run was cancelled by the user instead of treating it as a broken review.

  Pressing Esc during a `fusion_agents` run cancels the tool, but the host agent currently sees that like a failed Fusion run. User cancellation should be surfaced as its own clear outcome in the tool result, distinct from panel, synth, config, or resume failures.

  DoD:
  - cancelling a `fusion_agents` run from Pi returns a model-visible user-cancelled result
  - technical Fusion failures still return failure text with stage/model details
  - the live progress block still shows cancelled rows and keeps the final snapshot visible

  **Implemented:**
  - Pi reports an Esc cancellation as `Rejudge cancelled by user.` instead of a failed review.
  - Cancellation is attributed to the outcome that actually aborted, so a later Esc cannot hide a technical model or tool failure.
  - The final progress snapshot remains visible with cancelled reviewer rows and the total duration.
  - Deterministic tests cover the Pi tool result, late-abort attribution, and cancelled-row rendering.

- [ ] EXT-061 Show whether Rejudge started fresh or resumed
  The Pi live block and CLI progress make it immediately clear whether a review started a new panel or restored an earlier run.

  Fresh and resumed invocations currently look the same while running. A follow-up can therefore appear to reuse the previous judge context even when the calling agent omitted `resumeRunId` or `--resume` and started a new panel instead.

  Show the actual mode from the beginning of the run. A resumed invocation must identify the prior run whose judge and panel sessions were restored; a fresh invocation must clearly say that it started without previous context.

  User decisions:
  - cover both the Pi tool UI and CLI progress
  - identify the previous run, not only show a generic `resumed` label

  DoD:
  - the Pi live block shows `fresh` or `resumed` from its first render
  - a resumed Pi run shows the restored run ID, and the indicator remains visible in the final success, failure, or cancellation snapshot
  - CLI progress reports the same actual mode before model work starts
  - the indicator is derived from the invocation’s real resume parameter, not its title or request text
  - deterministic tests cover fresh and resumed output in both interfaces
