#!/bin/bash
# ThumbGate — install local git hooks into this checkout.
# Run once after cloning. Idempotent. No new npm dependencies.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d .githooks ]; then
  echo "No .githooks directory found at $REPO_ROOT/.githooks"
  exit 1
fi

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "✓ Git hooks activated at .githooks/ (core.hooksPath set)"
echo "  pre-commit: package parity, version sync, congruence, claims, gates"
echo "  pre-push:   npm pack dry-run, internal link validation, regression guards"
