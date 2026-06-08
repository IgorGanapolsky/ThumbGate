#!/usr/bin/env bash
# Golden test: the CI-level no-internal-orchestration-leaks test must
# exist on origin/main and must pass when run locally.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
cd "$REPO_ROOT"

git fetch origin main --quiet

if git cat-file -e "origin/main:tests/no-internal-orchestration-leaks.test.js" 2>/dev/null; then
  echo "ok: tests/no-internal-orchestration-leaks.test.js present on origin/main"
else
  echo "FAIL: tests/no-internal-orchestration-leaks.test.js missing from origin/main"
  exit 1
fi

if git cat-file -e "origin/main:tests/public-repo-hygiene.test.js" 2>/dev/null; then
  echo "ok: tests/public-repo-hygiene.test.js present on origin/main"
fi

if node --test tests/no-internal-orchestration-leaks.test.js >/dev/null 2>&1; then
  echo "ok: test passes locally"
else
  echo "FAIL: test does not pass locally"
  exit 1
fi

echo "PASS"
