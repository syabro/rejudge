#!/usr/bin/env bash
# BENCH-037 — Pi baseline over the first N deep-swe tasks (alphabetical, deterministic).
#
# One harness (Pi), model is the explicit argument. Auth by provider:
#   openai-codex/<id>  → the host's ChatGPT login (~/.pi/agent/auth.json); pi_agent uploads it.
#   opencode-go/<id>   → OPENCODE_API_KEY in the env.
# Thinking level rides on the model: openai-codex/gpt-5.5:xhigh
#
# Self-contained like run-codex.sh: clones pier + deep-swe into bench/vendor/ (gitignored),
# runs pier on the host via uv, loads pi_agent via PYTHONPATH. Output → bench/jobs/, and the
# run auto-appends to bench/results.jsonl (compare with bench/compare.py).
#
# Usage:  bench/run-pi.sh [N] <provider/model[:thinking]>
#   e.g.  bench/run-pi.sh 10 openai-codex/gpt-5.5:xhigh
#   Explicit task list (overrides N):  TASKS_FILE=bench/medium-tasks.txt bench/run-pi.sh 0 <model>
#   Concurrency: PIER_CONCURRENCY=2 (default) — gentle on ChatGPT rate limits.
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$BENCH_DIR/vendor"
PIER="$VENDOR/pier"
TASKS="$VENDOR/deep-swe"
JOBS="$BENCH_DIR/jobs"

N="${1:-10}"
MODEL="${2:-}"
CONCURRENCY="${PIER_CONCURRENCY:-2}"
[ -z "$MODEL" ] && { echo "usage: bench/run-pi.sh [N] <provider/model[:thinking]>"; exit 2; }

case "$MODEL" in
  openai-codex/*)
    [ -f "$HOME/.pi/agent/auth.json" ] || { echo "no ~/.pi/agent/auth.json — run 'pi login' first"; exit 2; } ;;
  *)
    [ -z "${OPENCODE_API_KEY:-}" ] && { echo "OPENCODE_API_KEY not set in env"; exit 2; } ;;
esac

mkdir -p "$VENDOR" "$JOBS"
[ -d "$PIER/.git" ]  || git clone --depth 1 https://github.com/datacurve-ai/pier "$PIER"
[ -d "$TASKS/.git" ] || git clone --depth 1 https://github.com/datacurve-ai/deep-swe "$TASKS"
uv sync --directory "$PIER" -q

NAMES=()
if [ -n "${TASKS_FILE:-}" ]; then
  # explicit task list: first whitespace-delimited token per non-comment line
  [ -f "$TASKS_FILE" ] || { echo "TASKS_FILE not found: $TASKS_FILE"; exit 2; }
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    NAMES+=("${line%%[$' \t']*}")
  done < "$TASKS_FILE"
else
  while IFS= read -r t; do NAMES+=("$t"); done < <(
    for d in "$TASKS"/tasks/*/; do basename "$d"; done | sort | head -n "$N"
  )
fi
INC=()
for t in "${NAMES[@]}"; do INC+=(-i "$t"); done

echo "running ${#NAMES[@]} task(s) >>> ${NAMES[*]}"
echo "agent=pi  model=$MODEL  concurrency=$CONCURRENCY"

PYTHONPATH="$BENCH_DIR" uv run --directory "$PIER" pier run \
  -p "$TASKS/tasks" \
  "${INC[@]}" \
  --agent-import-path pi_agent:PiAgent \
  --model "$MODEL" \
  -n "$CONCURRENCY" \
  -r 1 \
  -e docker -y \
  -o "$JOBS"

# Distill this run into bench/results.jsonl (newest job dir). Compare: bench/compare.py
python3 "$BENCH_DIR/record.py"
