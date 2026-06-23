#!/usr/bin/env bash
# BENCH-035 spike — prove Pi runs offline in a throwaway Docker container and makes a real edit.
#
# Chain proved: Pi installs in a clean container, starts with the offline flags
# (--offline = PI_OFFLINE=1), reaches the provider, edits a file from an instruction piped on
# stdin, exits, and the commit wrapper yields a non-empty `git diff base..HEAD`.
#
# Scope: this tests Pi's --offline mode with NORMAL container internet. It does NOT test the
# pier container-level egress firewall / provider allowlist (allow_internet=false) — that is
# BENCH-036's job. See docs/specs/benchmark.md.
#
# Usage:  OPENCODE_API_KEY=... spikes/bench-035/run.sh
#         MODEL=opencode-go/<id> spikes/bench-035/run.sh   # override the model
set -euo pipefail

MODEL="${MODEL:-opencode-go/kimi-k2.6}"
IMAGE="${IMAGE:-node:20-bookworm}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${OPENCODE_API_KEY:-}" ]; then
  echo "FAIL: OPENCODE_API_KEY not set in host env" >&2
  exit 1
fi

echo "spike: image=$IMAGE model=$MODEL"
exec docker run --rm -i \
  -e OPENCODE_API_KEY \
  -e MODEL="$MODEL" \
  -w /work \
  -v "$SCRIPT_DIR/in-container.sh:/in-container.sh:ro" \
  "$IMAGE" \
  bash /in-container.sh
