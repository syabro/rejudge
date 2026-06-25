#!/usr/bin/env bash
# BENCH-037 — run the codex baseline over the first N deep-swe tasks (alphabetical).
#
# "Plain codex": the host's ChatGPT login (~/.codex/auth.json) is uploaded into each
# sandbox via CODEX_FORCE_AUTH_JSON=1; codex_agent.CodexChatGPT only widens the egress
# allowlist so chatgpt.com is reachable through the locked proxy. No API key needed.
#
# Self-contained like run.sh: clones pier + deep-swe into bench/vendor/ (gitignored),
# runs pier on the host (uv), loads our agent via PYTHONPATH. Output → bench/jobs/.
#
# Usage:  bench/run-codex.sh [N] [model]
#   e.g.  bench/run-codex.sh 10 gpt-5.5     (defaults: N=10, model=gpt-5.5)
#   Concurrency: PIER_CONCURRENCY=2 bench/run-codex.sh   (default 2 — gentle on ChatGPT limits)
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR="$BENCH_DIR/vendor"
PIER="$VENDOR/pier"
TASKS="$VENDOR/deep-swe"
JOBS="$BENCH_DIR/jobs"

N="${1:-10}"
MODEL="${2:-gpt-5.5}"
CONCURRENCY="${PIER_CONCURRENCY:-2}"

[ -f "$HOME/.codex/auth.json" ] || { echo "no ~/.codex/auth.json — run 'codex login' first"; exit 2; }

mkdir -p "$VENDOR" "$JOBS"
[ -d "$PIER/.git" ]  || git clone --depth 1 https://github.com/datacurve-ai/pier "$PIER"
[ -d "$TASKS/.git" ] || git clone --depth 1 https://github.com/datacurve-ai/deep-swe "$TASKS"
uv sync --directory "$PIER" -q

# First N task names, alphabetical — deterministic "first N", independent of pier's order.
NAMES=()
while IFS= read -r t; do NAMES+=("$t"); done < <(
  for d in "$TASKS"/tasks/*/; do basename "$d"; done | sort | head -n "$N"
)
INC=()
for t in "${NAMES[@]}"; do INC+=(-i "$t"); done

echo "running ${#NAMES[@]} task(s) >>> ${NAMES[*]}"
echo "agent=codex (ChatGPT login)  model=$MODEL  concurrency=$CONCURRENCY"

PYTHONPATH="$BENCH_DIR" uv run --directory "$PIER" pier run \
  -p "$TASKS/tasks" \
  "${INC[@]}" \
  --agent-import-path codex_agent:CodexChatGPT \
  --model "$MODEL" \
  --ae CODEX_FORCE_AUTH_JSON=1 \
  -n "$CONCURRENCY" \
  -r 1 \
  -e docker -y \
  -o "$JOBS"

# Distill this run into bench/results.jsonl (newest job dir). Compare: bench/compare.py
python3 "$BENCH_DIR/record.py"
