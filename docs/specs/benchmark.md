# Benchmark — mdtask

How we measure Pi against a baseline agent on an external SWE benchmark. First target: the DataCurve DeepSWE benchmark. Our own measurement, not a leaderboard submission.

## DeepSWE (DataCurve): measuring Pi vs a baseline

DeepSWE is a contamination-free SWE benchmark — 113 tasks across 91 repos and 5 languages (TS/Go/Rust/JS/Python), scored by Pass@1. We compare Pi against a baseline agent (codex) on the same sampled tasks; we are not submitting to the official leaderboard.

The runner is `pier` (`datacurve-ai/pier`, tasks in `datacurve-ai/deep-swe`): it drives CLI agents in sandboxes — Docker locally by default, Modal via `--env modal`. Each task is a Harbor bundle — `environment/Dockerfile` (the repo at a base commit), `instruction.md`, and a hidden test suite the agent never sees. Sample deterministically with `pier run -p deep-swe/tasks --agent <name> --model <id> --n-tasks N --sample-seed 0`; codex is a built-in agent. (OpenCode's published cost is $2.82–$21.63/task — a reference, not Pi's; bound Pi's real cost with a 5-task probe before a 10- or 30-task run.)

### How a task is graded (the "judge" is tests, not an LLM)

Grading is deterministic, SWE-bench style. The submission is `git diff base_commit..HEAD`, so the agent MUST commit its edits. In a separate clean container the harness applies the agent's patch, then the hidden `test.patch`, runs the suites, and grades against two whitelists: fail-to-pass (failed at base, must now pass) and pass-to-pass (passed before, must stay). Pass@1 = 1 iff ≥1 fail-to-pass test, all fail-to-pass pass, and no pass-to-pass fails; outputs `reward.json`/`ctrf.json`/`test-stdout.txt`. Whitelists come from an oracle-vs-nop differential; the reference solution is never diffed against the change.

### Running Pi as a pier agent

Pi is a thin pier agent, no fork: pier loads a custom agent by import path (`create_agent_from_import_path`); `SUPPORTS_ATIF` defaults false, so the agent ships in our tree and skips the trajectory format at first. `run(instruction, environment, context)` runs with CWD = repo root. Concrete shape:

- Install (`install_spec`): Node ≥18, then `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` (or `curl -fsSL https://pi.dev/install.sh | sh`); the task image may lack Node, so the step must provide it.
- Offline start: sandboxes are `allow_internet=false`, so pass `--no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files` and `PI_OFFLINE=1` — this also turns `fusion_agents` OFF, giving a clean Pi-vs-codex baseline (the panel is read-only and useless for edit tasks). `network_allowlist()` must permit the provider's base URL so the model call still works.
- Invoke: pipe `instruction.md` into `pi -p --model <id>` via stdin (not argv — length limits), with Pi's edit/write/bash tools enabled.
- Commit wrapper: `pi -p … ; git add -A ; git diff --cached --quiet || git commit -m agent` — survives a non-zero Pi exit and skips an empty commit, so `base..HEAD` is non-empty exactly when Pi changed something.
- Provider key: set `OPENCODE_API_KEY` in the process env in `run()` (not on argv), or pre-bake `~/.pi/agent/auth.json` in `install_spec`.
- Timeout: a per-task wall-clock cap so one stuck task can't eat the sample or the budget.

### Open decisions (resolve before the comparison run)

- Model: pin the SAME model for both sides, or accept a harness+model comparison (Pi+its model vs codex+its model). Baseline default: plain Pi (fusion off).
- Sample size: n=10 validates the pipeline; a defensible Pi-vs-codex number needs n≥30 per agent. Set a total budget cap for both runs.

# Tasks

- [ ] BENCH-035 Spike: Pi runs in a pier-style Docker sandbox, offline
  De-risk before any pier code. Prove, in a throwaway Docker container like a task environment (no internet), that Pi installs, starts with the offline flags + `PI_OFFLINE=1`, reaches the provider through an allowlist, edits a file from a piped instruction, exits, and a commit yields a non-empty `git diff base..HEAD`. Acceptance: a documented one-container run where `pi -p` makes a real edit offline and the resulting diff is non-empty.

- [ ] BENCH-036 Thin Pi agent adapter for pier		@blocked_by:BENCH-035
  A `BaseInstalledAgent` subclass registered via pier's import-path (no fork). Constraints: `install_spec` provides Node + installs Pi; `run` pipes `instruction.md` into `pi -p --model <id>` (CWD = repo root) with edit/write/bash and the offline flags (fusion off), sets the provider key in env, then runs the commit wrapper; `network_allowlist()` permits the provider base URL; a per-task timeout; `SUPPORTS_ATIF=false`. Acceptance: `pier run` on one task with our Pi agent produces a `model.patch` and a graded `reward.json`.

- [ ] BENCH-037 Sample run + Pi-vs-codex comparison		@blocked_by:BENCH-036
  Run the Pi agent and built-in codex over the same deterministic sample. Constraints: pinned-model decision applied; same tasks, sandbox, and `--sample-seed`; fusion off; a 5-task cost probe, then n=10 to validate the pipeline and n≥30 for a defensible number; a total budget cap; collect Pass@1 (and cost when available). Acceptance: a documented table of Pass@1 (+ cost) for Pi and codex on the same sample, with the model and n stated.

- [ ] BENCH-038 ATIF v1.7 trajectory for the Pi agent  !low @blocked_by:BENCH-036
  Convert Pi's `--mode json` output to ATIF v1.7 (like the opencode agent) so cost/step/token metrics populate — this fills the cost half of the comparison and would also enable a leaderboard submission. Constraints: map Pi's events to ATIF Steps/ToolCalls/Metrics; `SUPPORTS_ATIF=true`. Acceptance: a run writes a valid `trajectory.json` with per-step metrics; Pass@1 unchanged.
