#!/usr/bin/env bash
# Golden test: the three Reddit-quoted GitHub URLs must return 404 on main.
set -euo pipefail

URLS=(
  "https://github.com/IgorGanapolsky/ThumbGate/blob/main/.claude/implementation-notes/2026-05-20-high-roi-items.md"
  "https://github.com/IgorGanapolsky/ThumbGate/blob/main/.claude/ralph/ATTEMPTS.md"
  "https://github.com/IgorGanapolsky/ThumbGate/blob/main/.github/workflows/social-engagement-hourly.yml"
)

fail=0
for url in "${URLS[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [ "$code" != "404" ]; then
    echo "FAIL: $url returned $code (want 404)"
    fail=1
  else
    echo "ok: $url"
  fi
done

exit "$fail"
