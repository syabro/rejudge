# Tools — mdtask

## fusion_agents

The extension registers one external tool, `fusion_agents`. Call it explicitly with a `question` (a question or instruction) and, optionally, `outputInstructions` describing the desired output format (e.g. a requested structure or P0/P1/P2/P3 buckets). It runs the question across the configured panel, fuses the answers via synthesis, and returns a single final answer, text only.

The output instructions are carried end-to-end: they are composed into the prompt every panel agent receives and the synthesis is told to honor the task's format, so the returned answer respects the requested format. A missing/invalid config or a technical failure of the panel/synthesis surfaces as a tool error — never a fabricated answer. The package loads as a Pi extension via the `pi.extensions` manifest (entry `src/index.ts`).

Each inner agent (the panel models and the synthesis) runs read-only by default in the working directory: `read` plus the dedicated `grep`/`find`/`ls` search-and-list tools — no `edit`/`write`/`bash` — so the tool cannot change files or run shell commands. The dedicated tools let agents search and list directly instead of shelling out. The full local set (adding `edit`/`write`/`bash`) is an explicit opt-in (`fullTools`), not exposed through the `fusion_agents` tool itself today; the CLI exposes it via `--unsafe`/`--full` (see `cli.md`). Host extensions are not inherited.

For code review, every inner agent also gets a custom read-only `git_diff` tool. It returns the working-tree diff so a reviewing agent sees the actual change instead of depending on the diff being pasted into the prompt. Parameters: `mode` (`stat` default = the change map + untracked list / `full` = the whole diff / `file` = one path), `ref` (default `HEAD`; a branch name or commit hash to review committed work), and `path` (only for `mode=file`). It only reads git state — never modifies the repo. An oversized diff hard-stops with guidance (narrow with `mode=file`, or `read` a huge single file) rather than flooding the context; there is no truncation.

# Tasks

- [x] TLS-001 Scaffold pi-fusion-agents extension and register the fusion_agents tool		#poc @blocked_by:PRJ-012
  Separate Pi extension `pi-fusion-agents` exposing exactly one external tool, `fusion_agents`.
  Constraints: explicit invocation only (no auto-invocation in the POC); tool result content is final answer text only.
  Acceptance: extension loads in Pi; `fusion_agents` is available; invoking it with a question reaches our handler and returns without crashing Pi.

  **Implemented:**
  - `src/index.ts` default export registers one external tool `fusion_agents` via `pi.registerTool` — typebox `question` param, explicit invocation, result is a single text block (final text only).
  - Placeholder handler echoes the question; panel fan-out + synthesis deferred to CFG/PNL/SYN.
  - Smoke test (no mocks): loads the extension through Pi's real loader (`discoverAndLoadExtensions`) and asserts `fusion_agents` registers on load; confirmed it fails when the extension throws on load. typecheck green.

- [x] TLS-002 fusion_agents invocation contract		#poc @blocked_by:PRJ-012
  Callers pass a question/instruction, optionally with output instructions (e.g. P0/P1/P2/P3 buckets or a requested structure — an example, not a fixed scheme).
  Constraint: the requested output format is carried end-to-end — both inner agents and synthesis are told to honor it.
  Acceptance: a call carrying output instructions reaches the panel agents and synthesis intact; the returned answer respects the requested format.

  **Implemented:**
  - `fusion_agents` now takes `question` + optional `outputInstructions`; the handler composes them (`buildInvocationPrompt` in `src/index.ts`) and runs the real `fuse()` (panel fan-out + synthesis), returning only the fused answer text.
  - Output instructions are carried end-to-end by living in the single fanned-out prompt: every panel agent receives them verbatim and synthesis is told to obey the task's format, so the returned answer respects the requested format.
  - A technical failure of the panel or synthesis (or a missing/invalid config) surfaces as a tool error, never a fabricated answer.
  - Smoke test (`test/tool.test.ts`, no mocks): loads the extension through Pi's real loader, invokes the registered tool with output instructions on real stub models, and asserts the returned answer applies the requested format and preserves the fused content; plus a deterministic `buildInvocationPrompt` unit test.

- [x] TLS-003 Full local tools for inner agents		#poc @blocked_by:PRJ-012
  Inner agents only get read/edit/write/bash, so they search and list through bash — slow and
  noisy. The Pi SDK also ships dedicated grep/find/ls tools that aren't wired in; the task is to
  give inner agents those so they search/list with the dedicated tools instead of bash.
  Constraints: use the SDK's built-in tools (not custom ones); keep bash + edit/write — bash is
  full write capability that can modify or break the project (accepted for the trusted POC, not
  production-safe).
  Acceptance: a panel agent has read/grep/find/ls/edit/write/bash, and a run searches/lists via
  the dedicated grep/find/ls tools, not bash.

  **Implemented:**
  - `PANEL_TOOLS` (src/runner.ts) now lists all seven SDK built-ins — read/grep/find/ls/edit/write/bash; it's the single source consumed by both the panel agents and the synth agent, so all inner agents gain the dedicated grep/find/ls search/list tools.
  - Tool selection at runtime is the model's own choice; capability is what's wired and verified.
  - Test (test/runner.test.ts): a real `createAgentSession` built from `PANEL_TOOLS` (isolated temp dirs, no model call) asserts `getActiveToolNames()` contains all seven, proving the SDK activates grep/find/ls from the allow-list.

- [ ] TLS-004 DeepSWE tool adapter		#deepswe @blocked_by:PNL-009
  Adapt the working POC to run DeepSWE as a panel model; DeepSWE expects its own tool surface, not the standard local tools.
  Constraints: tool surface = file_editor / execute_bash / search / finish; adapter details decided here (deferred until the POC works).
  Acceptance: a panel agent backed by a DeepSWE model ID runs through the adapter and returns an output usable by synthesis.

- [ ] TLS-019 Guard the outputInstructions trust boundary		!low
  outputInstructions is pasted into the panel/synth prompts verbatim, and candidate
  answers are "guarded" by a single English sentence — a caller can inject
  instructions. For the trusted POC, document the trust boundary; harden when wider.

- [x] TLS-026 Add a `git diff HEAD` tool for code review
  Read-only inner agents can inspect files but not the working-tree diff, so a code review
  only reaches them if the diff is pasted into the prompt by hand — otherwise they review the
  current snapshot, not what changed.

  Add a custom read-only tool `git_diff` that shows the working-tree diff against a ref
  (default `HEAD`) for the agent's cwd. Three modes:
  - `stat` (default) — the change map: which files changed with line counts, plus a list of
    untracked files. Never a patch.
  - `full` — the entire unified diff.
  - `file` — the diff of a single file or directory given by `path`.

  The comparison base is the `ref` param (default `HEAD`); it may be a branch name or a commit
  hash, so the agent can review against a base branch, not just uncommitted changes. It is
  always the working tree vs `ref` — the full change, staged or not.

  Output is capped. Over the cap the tool returns a hard stop (e.g. "diff too large — use
  `mode=file`"), never a partial or chopped diff. Untracked files are surfaced in `stat`;
  their content is read with the existing `read` tool, so the tool never injects new-file
  content into a diff. Runs git directly via `spawn` (no shell), no commit-range syntax (always
  working tree vs a single `ref`), with rename detection (`-M`).

  User decisions:
  - tool name `git_diff`; params `mode` (`stat` default | `full` | `file`), `ref`, and `path`
  - comparison base is `ref`, default `HEAD`, may be a branch or commit hash; always the
    working tree vs `ref` (the full diff, staged or not)
  - `path` applies only to `mode=file`
  - default is `stat` (the change map), not a diff
  - no truncation — at the cap, stop hard; never return a chopped diff

  DoD:
  - a read-only inner agent can fetch the `HEAD` diff for its cwd in all three modes
  - a too-large diff yields a hard stop with guidance, not a truncated/partial diff
  - a fusion code review no longer depends on the diff being pasted into the prompt

  **Implemented:**
  - `src/git-diff-tool.ts` defines the custom `git_diff` tool (`defineTool`): `mode`
    (`stat`|`full`|`file`), `ref` (default `HEAD`), `path` (file mode). `stat` is a numstat
    summary + untracked listing; `full`/`file` are the unified diff. Always working-tree-vs-ref
    (commit ranges rejected), git run via `spawn` (no shell), `-M` rename detection.
  - Over a per-mode byte cap the tool returns a hard stop with guidance and no diff content
    (no truncation). Git failures (not a repo, no commits, missing git, bad ref, abort) come
    back as clean text, never a throw.
  - Wired into every inner agent via `customTools` + the tool name in the allow-list
    (`src/runner.ts`); `READONLY_TOOLS`/`PANEL_TOOLS` stay built-in-only.
  - Tests (`test/git-diff-tool.test.ts`, real git, no mocks): pure helpers, the three modes,
    untracked-only, hard-stop caps, and every guard/error path; plus a runner test that
    `git_diff` activates in a read-only session.
