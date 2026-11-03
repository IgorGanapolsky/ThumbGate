# Bernhardsson: Ephemeral Sandboxes + Snapshot Cloning

## Steal Source
"Why AI Compute Comes in Rectangles" — Erik Bernhardsson (Modal)

## Problem
CI/CD wastes compute on sequential setup. Test shards install dependencies independently. Sandboxes persist long after they're useful.

## Pattern Stolen
1. **Ephemeral sandboxes**: Run long-lived workflows outside the sandbox; spin up sandboxes only for specific commands (seconds/milliseconds lifetime)
2. **Snapshot cloning**: Run setup once, snapshot the container, clone it to run every test in its own parallel sandbox
3. **Container snapshotting**: Pause, resume, fork environments using memory/filesystem snapshots

## How ThumbGate Applies It
- `createIsolatedTempDir()` — Creates a fresh tempDir per verification run. No state leakage between sessions
- The Isolated Verifier runs in a separate process with isolated proof directory (`THUMBGATE_PROOF_DIR`)
- `isolated-proof-dir` prefix ensures each run gets its own sandbox namespace

## Implementation
```js
// scripts/isolated-verifier.js
const tempDir = createIsolatedTempDir();
// Each verifier run gets: /tmp/thumbgate-verifier-<random>/
// Proof artifacts are isolated to: /tmp/thumbgate-verifier-<random>/proof-isolated/
```

## Pro Value
Pro adds:
- Snapshot/restore of verification state across sessions
- Parallel sandbox cloning for test shards (setup once, fork N times)
- Cross-environment snapshot diffing (staging vs prod blast radius)

**Steal command**: `npx thumbgate init` → select "ephemeral-sandbox-pack"
