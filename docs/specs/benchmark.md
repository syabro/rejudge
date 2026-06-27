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

### Spike: offline Pi edits in a Docker container (BENCH-035, proven)

`spikes/bench-035/run.sh` runs one throwaway `node:20-bookworm` container and proves the run mechanics end-to-end: Pi installs (`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`), starts with the offline flags (`--offline` plus `-ne -ns -np --no-themes -nc`), reads an instruction piped on stdin, edits a file with the default edit tool, and the commit wrapper yields a non-empty `git diff base..HEAD`. Confirmed for BENCH-036: `OPENCODE_API_KEY` in the env authenticates the opencode-go provider (no `auth.json` needed), `pi -p` takes the prompt from stdin, and edit/write/bash are on by default in `-p` mode.

Not proven here: the container-level egress firewall (`allow_internet=false`) and provider allowlist. The spike runs with normal container internet and relies on `--offline` to suppress every non-provider startup call; enforcing a real allowlist is BENCH-036's job.

### Running the Pi agent (bench/)

The Pi pier agent lives in this repo at `bench/pi_agent.py` (a `BaseInstalledAgent` loaded by import path — no pier fork). `bench/run.sh` is self-contained: it clones pier + deep-swe into `bench/vendor/` (gitignored), runs pier on the host via `uv`, and loads our agent with `PYTHONPATH=bench` so nothing is written into the pier checkout. Output lands in `bench/jobs/` (gitignored).

    OPENCODE_API_KEY=… bench/run.sh <task-name> <provider/model>
    # e.g. bench/run.sh abs-module-cache-flags opencode-go/deepseek-v4-flash

The model is an explicit argument — pick it per run, no default.

### Running the codex baseline (bench/)

`bench/run-codex.sh [N] [model]` runs the built-in codex agent over the first N deep-swe
tasks (alphabetical, deterministic), default `N=10 model=gpt-5.5`. "Plain codex" means the
host's ChatGPT login: the agent (`bench/codex_agent.py`, a thin `Codex` subclass) uploads
`~/.codex/auth.json` into each sandbox (`CODEX_FORCE_AUTH_JSON=1`) and only widens the egress
allowlist so `chatgpt.com` is reachable through the locked proxy — no OpenAI API key needed.
Concurrency is gentle by default (`PIER_CONCURRENCY=2`) to stay under ChatGPT rate limits.

    bench/run-codex.sh            # first 10, gpt-5.5
    bench/run-codex.sh 10 gpt-5.5

### Running Pi on a ChatGPT-login model (bench/)

`bench/run-pi.sh [N] <provider/model[:thinking]>` runs the Pi agent over the first N tasks
(default N=10) — the multi-task Pi runner (`run.sh` stays the single-task form). One harness
(Pi), swappable model:

- `openai-codex/*` → Pi uses the host's ChatGPT login. `pi_agent.py` uploads
  `~/.pi/agent/auth.json` into each sandbox (pointed at by `PI_CODING_AGENT_DIR`) and adds
  `chatgpt.com` + `auth.openai.com` to the egress allowlist — the same gpt-5.5 the codex
  baseline uses. The thinking level rides on the model id (`:xhigh` → `--thinking xhigh`).
- `opencode-go/*` → still authenticates with `OPENCODE_API_KEY`.

      bench/run-pi.sh 10 openai-codex/gpt-5.5:xhigh     # Pi harness, codex's model
      bench/run-pi.sh 10 opencode-go/deepseek-v4-flash  # Pi harness, an API model

Fairness caveat: a Pi-vs-codex head-to-head isolates the harness only if both sides use the
SAME reasoning effort. The first codex baseline ran `@high`; running Pi `@xhigh` also changes
the reasoning budget, so match them (Pi `@high`, or re-run codex `@xhigh`) before calling it a
pure harness comparison. The model labels in `results.jsonl` keep the effort, so the asymmetry
is visible in `compare.py`.

### Comparing models (bench/)

Each run auto-appends its per-task results to `bench/results.jsonl` (the runners call
`bench/record.py` at the end; run it by hand on any old job dir to backfill). The file is
the durable, committed data store — one immutable line per (run, task) with: model
(`agent:model@effort`), task, `status` (`graded`/`errored` — an infra crash is never counted
as a model failure), `reward`, new tests passed (`new_pass/new_need`), old tests broken
(`old_broke/old_total`), tokens, `secs`, `steps`, notional cost, and the task's `base_commit`.

`bench/compare.py` reads it and prints a tasks×models table + Pass@1 per model. It takes the
latest graded result per (model, task), compares two models only on their COMMON graded tasks,
and reports infra errors separately. Run a model once (results persist); compare any time.

    bench/compare.py

Scope kept deliberately simple: one attempt per task (k=1), no confidence intervals, no
rerun-aggregation machinery — a presentable head-to-head, not a leaderboard submission.

Token/cost coverage is asymmetric for now: codex emits an ATIF `trajectory.json`, so its
rows carry tokens + notional cost; the Pi agent is `SUPPORTS_ATIF=False`, so Pi rows have only
`secs` (no tokens/cost) until BENCH-038 wires Pi's `--mode json` into ATIF. Pass@1 and time are
comparable today; per-token cost is codex-only.

### Open decisions (resolve before the comparison run)

- Model: pin the SAME model for both sides, or accept a harness+model comparison (Pi+its model vs codex+its model). Baseline default: plain Pi (fusion off).
- Sample size: n=10 validates the pipeline; a defensible Pi-vs-codex number needs n≥30 per agent. Set a total budget cap for both runs.

### Picking "medium" tasks (DeepSWE difficulty signal) — bench/

To choose tasks where a fusion panel can plausibly beat a single model (not trivial, not impossible) we mine DeepSWE's OWN published trials instead of running our own multi-attempt sweeps.

**Data source (read-only, public):**
- Trials index: `https://deepswe.datacurve.ai/artifacts/v1/trials.json` — MUST send `Accept: application/json` (the same path returns the SPA's HTML to a browser request). 14728 rows; fields incl. `trial_name, task_name, model, reasoning_effort, source, eval_scope, included_in_score, passed`. Per-test fraction fields (`f2p_total` etc.) are **null** here.
- Raw per-trial test output: `https://d3ujjcmjq6o8v6.cloudfront.net/trial-artifacts/<trial_name>/verifier/test-stdout.txt`. Present for BOTH models even though the index's `verifier_files` is `None` for gpt-5-5 (don't trust that field). `reward.json`/`ctrf.json` → 403; `reward.txt` → 200 only for glm. So the binary verdict comes from the index `passed`, and per-test detail from `test-stdout.txt`.
- We used 4 runs/task for `gpt-5-5@xhigh` (67% overall) and `glm-5-2@max` (44%), filter `source=deep-swe, eval_scope=full, included_in_score`. 892 trials, full coverage.

**Metric decisions (the non-obvious ones — these bit us):**
- `f2p_total` (new-test count) comes from the BENCHMARK whitelist: `bench/vendor/deep-swe/tasks/<task>/tests/config.json` → `len(f2p_node_ids)`. NOT from the runner's stdout count (on a failed run the runner collects fewer tests, so its total lies).
- The verifier's line `[verifier] New tests exit code: N` is the clean per-run f2p gate (`N==0` ⇒ all f2p passed), uniform across languages — more reliable than parsing.
- **reward ≠ f2p:** `reward = (f2p pass) AND (p2p not broken)`. A run can have all f2p passing yet `passed=False` (broke an old test) → `p2p_regression` flag. Do NOT cross-check progress against reward.
- **"Number of failed tests" is NOT recoverable** — pytest runs **failfast** (`-x`, stops at the first failure; confirmed by `!!! stopping after N failures !!!`). So the signal is `progress = f2p_passed / f2p_total` ("how far it got"), not a failure count.
- `progress_quality`: `clean` (exit 0 → all passed), `exact` (go/rust/mocha run all tests, real counts), `lowerbound` (pytest failfast — passed-before-stop), `build_failed` (patch didn't compile/collect → progress 0).
- Per-language numerator on a miss: pytest `N passed`; mocha `passing/(passing+failing)` (mocha runs the whole file, so its count ≠ the whitelist — use its own denominator); go `f2p_total − count(^--- FAIL:)` (runs all, top-level FAIL per failed func); rust sum of `test result: … N passed; M failed`.
- Diagnostic: `regression_gap = f2p-rate − solve-rate` — small ⇒ clean medium; large ⇒ regression-heavy trap. Do NOT select FOR a large gap (that picks traps).
- solve-rate is the PRIMARY signal; progress is a weak secondary; 4 runs is coarse — don't read a 0.25 difference as real.

**Pipeline (two stages, separate scripts):**
- `bench/deepswe_fetch.py` (Stage 1, network): download `test-stdout.txt`, idempotent → `bench/deepswe-artifacts/` (gitignored) + `fetch-manifest.jsonl`.
- `bench/deepswe_f2p.py` (Stage 2, offline): parse → `bench/deepswe-f2p.jsonl` (per run: reward, exit_code, f2p_total/passed/failed, progress, progress_quality, p2p_regression, build_failed).
- `bench/deepswe_f2p_report.py`: aggregate per (task, model) → `bench/deepswe-difficulty.csv` (all 113 tasks, sortable) + the medium band.

**Selection decision (fusion-panel-vetted):**
- **Headline = Set A: all 20 tasks where BOTH models solve 1..n-1 of n** (both coin-flip). Frozen in `bench/medium-tasks.txt`. Don't filter down — 4-run data makes any extra filter noisy / cherry-picking; if forced, shrink by language/repo diversity, not by progress/gap. Set A is clean (`regression_gap ≈ 0` → failures are genuine feature misses, not regressions).
- **Set B (near-miss: low solve, progress ≈ 0.9–1.0)** = SEPARATE secondary slice, NOT in the headline. Many are p2p-regression traps (feature implemented but breaks an old test every time) — a different claim, not "fusion can finish the job".
- **Validity risk (moderate, not fatal):** difficulty was measured on the `mini-swe-agent` harness; we run Pi+gpt-5.5 (different harness). Treat DeepSWE as a SHORTLIST signal, not proof. Hedge: run a small non-scored Pi calibration on 3–5 of the 20 first; if they're trivial/impossible in Pi, recalibrate; report both the DeepSWE selection rule and the observed Pi solo baseline.

# Tasks

- [x] BENCH-035 Spike: Pi runs in a pier-style Docker sandbox, offline
  De-risk before any pier code. Prove, in a throwaway Docker container like a task environment (no internet), that Pi installs, starts with the offline flags + `PI_OFFLINE=1`, reaches the provider through an allowlist, edits a file from a piped instruction, exits, and a commit yields a non-empty `git diff base..HEAD`. Acceptance: a documented one-container run where `pi -p` makes a real edit offline and the resulting diff is non-empty.

  **Implemented:**
  - `spikes/bench-035/run.sh` + `in-container.sh`: one throwaway `node:20-bookworm` container installs Pi, runs it offline (`--offline` + `-ne -ns -np --no-themes -nc`) on an instruction piped via stdin, and the commit wrapper produces a non-empty `git diff base..HEAD`. Ran twice, PASS both times (edit `"1.0.0"` → `"1.0.1"`, `pi exit=0`, model `opencode-go/kimi-k2.6`).
  - De-risked for BENCH-036: env auth via `OPENCODE_API_KEY` works for opencode-go without `auth.json`; `pi -p` reads the prompt from stdin; edit/write/bash are default-on in `-p` mode; the commit wrapper survives a non-zero Pi exit and skips an empty commit.
  - Left to BENCH-036 (documented, not proven here): the container egress firewall (`allow_internet=false`) + provider allowlist — the spike uses normal container internet and `--offline` to suppress non-provider startup calls; also provisioning Node on a task image that lacks it.

- [x] BENCH-036 Thin Pi agent adapter for pier		@blocked_by:BENCH-035
  A `BaseInstalledAgent` subclass registered via pier's import-path (no fork). Constraints: `install_spec` provides Node + installs Pi; `run` pipes `instruction.md` into `pi -p --model <id>` (CWD = repo root) with edit/write/bash and the offline flags (fusion off), sets the provider key in env, then runs the commit wrapper; `network_allowlist()` permits the provider base URL; a per-task timeout; `SUPPORTS_ATIF=false`. Acceptance: `pier run` on one task with our Pi agent produces a `model.patch` and a graded `reward.json`.

  **Implemented:**
  - `bench/pi_agent.py` — a `BaseInstalledAgent` subclass loaded by pier's import path (`pi_agent:PiAgent`, no fork). `install_spec` installs Node 24 (NVM) + Pi; `run` pipes the instruction into `pi -p` with the offline flags (fusion off), edit/write/bash tools, the provider key in env, then the commit wrapper so `pre_artifacts.sh` captures `base..HEAD`; `network_allowlist()` permits `opencode.ai`; `SUPPORTS_ATIF=false`.
  - Sandbox network solved: the pier egress proxy is authenticated; Node 24 + `NODE_USE_ENV_PROXY=1` routes Pi's model call through it (confirmed via squid `TCP_TUNNEL/200`).
  - `bench/run.sh` runs it end-to-end and self-contained (pier/deep-swe cloned into gitignored `bench/vendor/`, host `uv`, output in `bench/jobs/`).
  - Acceptance met: `pier run` on `abs-module-cache-flags` produced a `model.patch` and a graded `reward.json` — `reward 1` (20/20 fail-to-pass, 3/3 pass-to-pass) with `opencode-go/deepseek-v4-flash`.

- [x] BENCH-043 codex baseline on deep-swe (ChatGPT login, first N)		@blocked_by:BENCH-036
  Run plain codex over the first N deep-swe tasks (alphabetical, deterministic) through the locked sandbox, fusion-equivalent baseline. Constraints: the host's ChatGPT login, no OpenAI API key; chatgpt.com reachable through the egress allowlist; gentle concurrency for ChatGPT rate limits. Acceptance: a graded run over the first 10, Pass@1 recorded.

  **Implemented:**
  - `bench/codex_agent.py` — thin `Codex` subclass; only widens the egress allowlist to `chatgpt.com` so a ChatGPT-login codex (`CODEX_FORCE_AUTH_JSON=1`, host `~/.codex/auth.json`) reaches the model through the locked proxy. No API key.
  - `bench/run-codex.sh [N] [model]` — codex over the first N tasks (default 10, gpt-5.5), `PIER_CONCURRENCY` default 2.
  - Ran first 10 with `gpt-5.5`: **Pass@1 5/10**, 0 regressions (old tests never broken), the 5 misses all 1–2 fail-to-pass tests short; ~47.6M tokens, ~$38.6 notional, ~1h19m wall-clock at `-n 2`. Proven first on one task before the batch.

- [x] BENCH-044 Benchmark reporter: results.jsonl data store + compare tool		@blocked_by:BENCH-036
  A model-agnostic way to store and compare benchmark runs without hand-editing files. Constraints: durable committed data, one immutable record per run×task; infra crashes must never count as a model failure; compare two models only on their common graded tasks; deliberately simple (k=1, no confidence intervals, no rerun-aggregation). Acceptance: a run auto-writes its results and `compare.py` prints a tasks×models table + Pass@1.

  **Implemented:**
  - `bench/record.py` — distills a pier job dir into `bench/results.jsonl` (append-only, idempotent per model+task+job); `status` separates `graded` from `errored`; row carries reward, new/old test counts, tokens, secs, steps, notional cost, base_commit. Auto-called at the end of both runners.
  - `bench/compare.py` — latest graded result per (model, task) → tasks×models table + Pass@1; infra errors shown as ERR and excluded from the denominator; head-to-head on common graded tasks.
  - `bench/results.jsonl` committed (data); `bench/jobs/` stays gitignored (raw output).

- [x] BENCH-037 Pi baseline run + Pi-vs-codex head-to-head		@blocked_by:BENCH-036
  Run the Pi agent (fusion off) on the same first-10 deep-swe sample the codex baseline used, then produce the head-to-head. Constraints: same tasks, sandbox, and grading; pinned-model decision applied; collect Pass@1 (+ tokens/time). Acceptance: `bench/compare.py` shows a Pi-vs-codex table over the common graded tasks, with each side's model and n stated; decide whether to extend to n≥30.

  **Implemented:**
  - Ran Pi on the first 10 tasks with `openai-codex/gpt-5.5:xhigh` (ChatGPT login), 0 errors: **Pass@1 8/10** vs the codex baseline's 5/10 over the same 10. Pi cleared four codex near-misses (44/44, 53/53, 2/2, 9/9); codex won one Pi missed (arktype 25/25 vs Pi 23/25). Recorded in `bench/results.jsonl`; `bench/compare.py` prints the table.
  - **Fairness caveat (not yet a pure harness comparison):** Pi ran `@xhigh`, codex `@high` — a bigger reasoning budget, so the 8-vs-5 gap conflates harness with reasoning effort. Match the effort (Pi `@high`, or re-run codex `@xhigh`) before claiming a harness win. The model labels carry the effort so the asymmetry is explicit.
  - Per-token cost is codex-only for now (Pi is `SUPPORTS_ATIF=False` → only `secs`); BENCH-038 fills the Pi cost half. n≥30 not run yet — the n=10 pipeline is proven and is the decision point for scaling.

- [ ] BENCH-038 ATIF v1.7 trajectory for the Pi agent  !low @blocked_by:BENCH-036
  Convert Pi's `--mode json` output to ATIF v1.7 (like the opencode agent) so cost/step/token metrics populate — this fills the cost half of the comparison and would also enable a leaderboard submission. Constraints: map Pi's events to ATIF Steps/ToolCalls/Metrics; `SUPPORTS_ATIF=true`. Acceptance: a run writes a valid `trajectory.json` with per-step metrics; Pass@1 unchanged.
