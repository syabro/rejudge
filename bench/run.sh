#!/usr/bin/env bash
# BENCH-036 — run the Pi adapter against one deep-swe task through pier.
#
# Self-contained in this repo: clones pier + deep-swe into bench/vendor/ (gitignored),
# runs pier on the host (uv), with our pi_agent.py loaded from this repo via PYTHONPATH —
# nothing is written to ~/code or into the pier checkout. Job output → bench/jobs/.
#
# Usage:  OPENCODE_API_KEY=... bench/run.sh <task-name> <provider/model>
#   e.g.  OPENCODE_API_KEY=... bench/run.sh abs-module-cache-flags opencode-go/deepseek-v4-pro
#
# Setup only (clone + uv sync, no run):  bench/run.sh --setup
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$BENCH_DIR/vendor"
PIER="$VENDOR/pier"
TASKS="$VENDOR/deep-swe"
JOBS="$BENCH_DIR/jobs"

ensure_vendor() {
  mkdir -p "$VENDOR" "$JOBS"
  [ -d "$PIER/.git" ]  || git clone --depth 1 https://github.com/datacurve-ai/pier "$PIER"
  [ -d "$TASKS/.git" ] || git clone --depth 1 https://github.com/datacurve-ai/deep-swe "$TASKS"
  uv sync --directory "$PIER" -q
}

if [ "${1:-}" = "--setup" ]; then
  ensure_vendor
  echo "setup done: pier + deep-swe in $VENDOR"
  exit 0
fi

TASK="${1:-}"
MODEL="${2:-}"
[ -z "$TASK" ]  && { echo "usage: bench/run.sh <task-name> <provider/model>   (or --setup)"; exit 2; }
[ -z "$MODEL" ] && { echo "pick a model explicitly, e.g. opencode-go/deepseek-v4-pro"; exit 2; }
[ -z "${OPENCODE_API_KEY:-}" ] && { echo "OPENCODE_API_KEY not set in env"; exit 2; }

ensure_vendor
echo "running task=$TASK model=$MODEL"
PYTHONPATH="$BENCH_DIR" uv run --directory "$PIER" pier run \
  -p "$TASKS/tasks/$TASK" \
  --agent-import-path pi_agent:PiAgent \
  --model "$MODEL" \
  -e docker \
  -o "$JOBS"

# Distill this run into bench/results.jsonl (newest job dir). Compare: bench/compare.py
python3 "$BENCH_DIR/record.py"
