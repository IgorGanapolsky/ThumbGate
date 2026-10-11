---
name: windbg-evidence-diagnostics
description: Ground agent failure diagnosis, root cause analysis, and postmortems in raw empirical system evidence (Microsoft WinDbg MCP pattern). Enforces SHA-256 evidence fingerprints, Verifiable Evidence Boxes, and grounded abstention (EVIDENCE_INSUFFICIENT) without installing Windows debuggers or proprietary binaries.
---

# WinDbg MCP Evidence Diagnostics (FORMAT Steal)

Stolen from Microsoft Performance Diagnostics (*Introducing WinDbg MCP: Debug with Natural Language Grounded in Evidence*).

## Core Posture

- **Verdict**: `COMPARE_NOT_CLONE`.
- **Anti-Clone Boundary**: NEVER install WinDbg, Windows Debugging Tools, or DbgEng.dll. Keep all evidence verification deterministic, local, and sub-50ms.
- **Evidence-First Verification**: Every diagnosis must cite exact exit code, stdout/stderr chunk, and cryptographic SHA-256 fingerprint.

## Key Invariants

1. **Empirical Grounding**: Assertions are verified directly against raw process output.
2. **Cryptographic Integrity**: Diagnostic receipts carry SHA-256 digests over output snippets.
3. **Grounded Abstention**: If required evidence cannot be gathered, return `EVIDENCE_INSUFFICIENT` rather than speculating.

## Verification Commands

```bash
node scripts/windbg-evidence-diagnostics.js
node scripts/windbg-evidence-diagnostics.js --json
node scripts/windbg-evidence-diagnostics.js --map-only
node --test tests/windbg-evidence-diagnostics.test.js
```
