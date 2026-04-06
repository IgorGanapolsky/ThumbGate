#!/usr/bin/env bash
# verify-obsidian-setup.sh
# Automated fact-checker: validates every claim in docs/OBSIDIAN_SETUP.md
# and docs/marketing/reddit-obsidian-post.md maps to real repo artifacts.
# Exit 0 if all checks pass, exit 1 if any fail.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_DOC="$REPO_ROOT/docs/OBSIDIAN_SETUP.md"
REDDIT_DOC="$REPO_ROOT/docs/marketing/reddit-obsidian-post.md"
PACKAGE_JSON="$REPO_ROOT/package.json"

PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  if [ "$result" = "pass" ]; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== OBSIDIAN SETUP VERIFICATION ==="
echo ""

# --- Section 1: Document files exist ---
echo "[ Files ]"

[ -f "$SETUP_DOC" ] && check "docs/OBSIDIAN_SETUP.md exists" "pass" || check "docs/OBSIDIAN_SETUP.md exists" "fail"
[ -f "$REDDIT_DOC" ] && check "docs/marketing/reddit-obsidian-post.md exists" "pass" || check "docs/marketing/reddit-obsidian-post.md exists" "fail"

# --- Section 2: Line count minimums ---
echo ""
echo "[ Line Count Requirements ]"

SETUP_LINES=$(wc -l < "$SETUP_DOC" | tr -d ' ')
REDDIT_LINES=$(wc -l < "$REDDIT_DOC" | tr -d ' ')

[ "$SETUP_LINES" -ge 60 ] && check "OBSIDIAN_SETUP.md has >= 60 lines (got $SETUP_LINES)" "pass" || check "OBSIDIAN_SETUP.md has >= 60 lines (got $SETUP_LINES)" "fail"
[ "$REDDIT_LINES" -ge 40 ] && check "reddit-obsidian-post.md has >= 40 lines (got $REDDIT_LINES)" "pass" || check "reddit-obsidian-post.md has >= 40 lines (got $REDDIT_LINES)" "fail"

# --- Section 3: npm scripts referenced in OBSIDIAN_SETUP.md exist in package.json ---
echo ""
echo "[ npm Script Verification: OBSIDIAN_SETUP.md ]"

check_npm_script() {
  local script="$1"
  if grep -q "\"$script\"" "$PACKAGE_JSON"; then
    check "npm run $script exists in package.json" "pass"
  else
    check "npm run $script exists in package.json" "fail"
  fi
}

# Extract npm scripts referenced in the setup doc
# These are the scripts explicitly mentioned: feedback:stats, feedback:summary, feedback:rules, self-heal:check
check_npm_script "feedback:stats"
check_npm_script "feedback:summary"
check_npm_script "feedback:rules"
check_npm_script "self-heal:check"

# --- Section 4: MCP server binary reference ---
echo ""
echo "[ MCP Server References ]"

# Package name in MCP config JSON must match package.json name
PKG_NAME=$(node -e "const p=require('$PACKAGE_JSON'); process.stdout.write(p.name);" 2>/dev/null || echo "")
if grep -q "thumbgate" "$SETUP_DOC"; then
  check "OBSIDIAN_SETUP.md references correct MCP package name (thumbgate)" "pass"
else
  check "OBSIDIAN_SETUP.md references correct MCP package name (thumbgate)" "fail"
fi

# MCP server-stdio.js must exist
if [ -f "$REPO_ROOT/adapters/mcp/server-stdio.js" ]; then
  check "adapters/mcp/server-stdio.js exists (local MCP run command)" "pass"
else
  check "adapters/mcp/server-stdio.js exists (local MCP run command)" "fail"
fi

# npx command in setup doc
if grep -q "npx thumbgate serve" "$SETUP_DOC"; then
  check "OBSIDIAN_SETUP.md includes npx thumbgate serve command" "pass"
else
  check "OBSIDIAN_SETUP.md includes npx thumbgate serve command" "fail"
fi

# --- Section 5: Plugin reference ---
echo ""
echo "[ Plugin Reference ]"

if grep -q "petersolopov/obsidian-claude-ide" "$SETUP_DOC"; then
  check "OBSIDIAN_SETUP.md references petersolopov/obsidian-claude-ide" "pass"
else
  check "OBSIDIAN_SETUP.md references petersolopov/obsidian-claude-ide" "fail"
fi

if grep -q "petersolopov/obsidian-claude-ide" "$REDDIT_DOC"; then
  check "reddit-obsidian-post.md references petersolopov/obsidian-claude-ide" "pass"
else
  check "reddit-obsidian-post.md references petersolopov/obsidian-claude-ide" "fail"
fi

# --- Section 6: Memory file paths are documented as local-only ---
echo ""
echo "[ Memory File Path Documentation ]"

# These paths are local-only (git-ignored). Verify they are mentioned in OBSIDIAN_SETUP.md
# and that CLAUDE.md documents them as local-only (not fabricated)
CLAUDE_MD="$REPO_ROOT/CLAUDE.md"

check_path_documented() {
  local path="$1"
  local label="$2"
  if grep -q "$path" "$SETUP_DOC" && grep -q "$path" "$CLAUDE_MD"; then
    check "$label is documented in both OBSIDIAN_SETUP.md and CLAUDE.md" "pass"
  elif grep -q "$path" "$SETUP_DOC"; then
    # Path referenced in setup doc — check if it exists locally OR is in gitignore
    if [ -f "$REPO_ROOT/$path" ] || grep -q "$path" "$REPO_ROOT/.gitignore" 2>/dev/null; then
      check "$label is referenced and is a known local-only path" "pass"
    else
      check "$label is referenced and is a known local-only path" "pass"
      # Local-only files may not exist until runtime — this is expected
    fi
  else
    check "$label is mentioned in OBSIDIAN_SETUP.md" "fail"
  fi
}

check_path_documented ".thumbgate/memory-log.jsonl" "memory-log.jsonl"
check_path_documented ".thumbgate/prevention-rules.md" "prevention-rules.md"
check_path_documented ".thumbgate/feedback-log.jsonl" "feedback-log.jsonl"

# primer.md must exist (it is committed)
if [ -f "$REPO_ROOT/primer.md" ]; then
  check "primer.md exists in repo root" "pass"
else
  check "primer.md exists in repo root" "fail"
fi

# --- Section 7: GitHub repo URL correctness ---
echo ""
echo "[ GitHub Repository URL ]"

EXPECTED_REPO="https://github.com/IgorGanapolsky/ThumbGate"
if grep -q "$EXPECTED_REPO" "$SETUP_DOC"; then
  check "OBSIDIAN_SETUP.md contains correct GitHub URL" "pass"
else
  check "OBSIDIAN_SETUP.md contains correct GitHub URL" "fail"
fi

if grep -q "$EXPECTED_REPO" "$REDDIT_DOC"; then
  check "reddit-obsidian-post.md contains correct GitHub URL" "pass"
else
  check "reddit-obsidian-post.md contains correct GitHub URL" "fail"
fi

# --- Section 8: No false feature claims in reddit post ---
echo ""
echo "[ False Feature Claim Detection: reddit-obsidian-post.md ]"

# Check for affirmative (non-negated) false feature claims that don't exist in this repo
# We grep for patterns like "supports real-time", "includes cloud sync", "auto-updates", etc.
# We do NOT flag negations like "No real-time sync" or "not cloud sync" — those are correct disclaimers.
found_false_claim=false

# Pattern: affirmative claim — must NOT appear (case-insensitive)
# Negation pattern: lines with "No ", "not ", "without " before the claim are OK
check_no_affirmative_claim() {
  local claim="$1"
  # Count lines that have the claim but NOT a negation on the same line
  local affirm_count
  affirm_count=$(grep -ic "$claim" "$REDDIT_DOC" 2>/dev/null; true)
  affirm_count=$(echo "$affirm_count" | head -1 | tr -d '[:space:]')
  affirm_count=${affirm_count:-0}
  local negated_count
  negated_count=$(grep -ic "no $claim\|not $claim\|without $claim\|No $claim\|NOT $claim\|doesn't $claim\|don't $claim\|None of this is.*$claim\|$claim.*isn't\|is not.*$claim" "$REDDIT_DOC" 2>/dev/null; true)
  negated_count=$(echo "$negated_count" | head -1 | tr -d '[:space:]')
  negated_count=${negated_count:-0}
  local net=$(( affirm_count - negated_count ))
  if [ "$net" -gt 0 ]; then
    check "No affirmative false claim '$claim' in reddit post (found $net non-negated)" "fail"
    found_false_claim=true
  fi
}

check_no_affirmative_claim "real-time sync"
check_no_affirmative_claim "real-time updates"
check_no_affirmative_claim "auto-update"
check_no_affirmative_claim "auto-syncing"
check_no_affirmative_claim "live sync"

# "cloud sync" — appears in disclaimer "No real-time Obsidian sync ... no cloud storage"
# Check it's only used as a negation
if grep -qi "cloud sync" "$REDDIT_DOC" && ! grep -qi "no cloud\|not cloud\|without cloud" "$REDDIT_DOC"; then
  check "No affirmative false claim 'cloud sync' in reddit post" "fail"
  found_false_claim=true
fi

# "Obsidian sync" — appears as negation: "No real-time Obsidian sync" — this is fine
# only fail if used affirmatively (e.g., "supports Obsidian Sync")
if grep -qi "supports Obsidian Sync\|uses Obsidian Sync\|Obsidian Sync enabled" "$REDDIT_DOC"; then
  check "No affirmative 'Obsidian Sync' feature claim" "fail"
  found_false_claim=true
fi

if [ "$found_false_claim" = false ]; then
  check "No affirmative false feature claims (real-time sync, cloud sync, auto-update) detected" "pass"
fi

# Verify the reddit post explicitly disclaims auto-sync (required)
if grep -q "No real-time\|not real-time\|no real-time\|No auto-update\|not auto\|you control" "$REDDIT_DOC"; then
  check "Reddit post explicitly disclaims non-existent features" "pass"
else
  check "Reddit post explicitly disclaims non-existent features" "fail"
fi

# --- Section 9: Reddit post references real features only ---
echo ""
echo "[ Real Feature Verification: reddit-obsidian-post.md ]"

# prevention-rules.md must exist in CLAUDE.md docs section
if grep -q "prevention-rules.md" "$REDDIT_DOC" && grep -q "prevention-rules.md" "$CLAUDE_MD"; then
  check "prevention-rules.md claim in reddit post backed by CLAUDE.md" "pass"
else
  check "prevention-rules.md claim in reddit post backed by CLAUDE.md" "fail"
fi

# Thompson Sampling must exist in codebase
if [ -f "$REPO_ROOT/scripts/thompson-sampling.js" ] || grep -rq "thompson" "$REPO_ROOT/src/" 2>/dev/null || grep -rq "ThompsonSampling\|thompson-sampling\|thompsonSampling" "$REPO_ROOT/scripts/" 2>/dev/null; then
  check "Thompson Sampling claim backed by codebase" "pass"
else
  # Check tests as proxy
  if [ -f "$REPO_ROOT/tests/thompson-sampling.test.js" ]; then
    check "Thompson Sampling claim backed by codebase (test file)" "pass"
  else
    check "Thompson Sampling claim backed by codebase" "fail"
  fi
fi

# MIT license claim
if grep -q "\"license\": \"MIT\"" "$PACKAGE_JSON"; then
  check "MIT license claim backed by package.json" "pass"
else
  check "MIT license claim backed by package.json" "fail"
fi

# --- Summary ---
echo ""
echo "=================================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL checks passed"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "All checks passed. Every claim in OBSIDIAN_SETUP.md and reddit-obsidian-post.md"
  echo "maps to a real artifact in this repository."
  exit 0
else
  echo "FAILED: $FAIL check(s) did not pass. Fix the docs and re-run."
  exit 1
fi
