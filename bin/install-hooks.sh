#!/bin/bash
# ThumbGate — install local git hooks into this checkout.
# Run once after cloning. Idempotent. No new npm dependencies.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

node scripts/git-hook-installer.js
