#!/usr/bin/env bash
# Runs INSIDE the throwaway container (launched by run.sh). Prints a final
# RESULT: PASS / INCONCLUSIVE line and exits non-zero unless the diff is non-empty.
set -uo pipefail
MODEL="${MODEL:?MODEL not set}"

echo "=== versions ==="
node --version
command -v git >/dev/null || { echo "FAIL: git missing in image"; exit 1; }
git --version

echo "=== set up repo with base commit ==="
git init -q /work
cd /work
git config user.email spike@example.com
git config user.name spike
cat > app.js <<'EOF'
const VERSION = "1.0.0";

function greet() {
  return "hi";
}

module.exports = { VERSION, greet };
EOF
git add -A
git commit -qm base
BASE=$(git rev-parse HEAD)
echo "base=$BASE"

echo "=== install Pi ==="
if ! npm install -g --ignore-scripts @earendil-works/pi-coding-agent >/tmp/npm.log 2>&1; then
  echo "FAIL: npm install -g @earendil-works/pi-coding-agent"
  tail -30 /tmp/npm.log
  exit 1
fi
pi --version

echo "=== run Pi offline (edit from a stdin instruction) ==="
INSTR='In the file app.js, change the version from 1.0.0 to 1.0.1. Use the edit tool. Change nothing else.'
set +e
printf '%s' "$INSTR" | timeout 180 pi -p --offline -ne -ns -np --no-themes -nc \
  --tools read,edit,write,bash --model "$MODEL"
PI_EXIT=$?
set -e
echo "pi exit=$PI_EXIT"

echo "=== commit wrapper (survives a non-zero Pi exit, skips an empty commit) ==="
git add -A
git diff --cached --quiet || git commit -qm agent

echo "=== result: git diff ${BASE}..HEAD ==="
git --no-pager diff "${BASE}"..HEAD

if git diff --quiet "${BASE}"..HEAD; then
  echo "RESULT: INCONCLUSIVE — empty diff (Pi made no edit; pi exit=$PI_EXIT). See output above."
  exit 2
fi
echo "RESULT: PASS — non-empty diff (pi exit=$PI_EXIT, model=$MODEL)"
