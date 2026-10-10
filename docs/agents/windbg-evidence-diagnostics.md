# WinDbg MCP Evidence Diagnostics — Compare, Do Not Clone

> **Paradigm Reference**: Microsoft Performance Diagnostics (*"Introducing WinDbg MCP: Debug with Natural Language Grounded in Evidence"*)  
> **ThumbGate Implementation**: `scripts/windbg-evidence-diagnostics.js` | `tests/windbg-evidence-diagnostics.test.js`  
> **Skill**: `.agents/skills/windbg-evidence-diagnostics/SKILL.md` (`/windbg-evidence-diagnostics`)  
> **Status**: In-tree, verified, 0 external dependencies, sub-50ms execution.

---

## 1. Executive Summary

Autonomous coding agents frequently hallucinate root causes during debugging, build failures, or post-incident audits when presented with unconstrained conversational prompts. Microsoft's WinDbg MCP architecture addresses this by ensuring that every diagnostic assertion is **grounded in raw, empirical evidence** retrieved directly from the operating environment.

ThumbGate implements this paradigm on its native PreToolUse and audit verification rails:
1. **Empirical Grounding**: Assertions must evaluate against raw command stdout/stderr and exit codes.
2. **Cryptographic Integrity**: Diagnostic receipts carry an immutable SHA-256 fingerprint of the observed output.
3. **Grounded Abstention**: If diagnostic evidence cannot be gathered, the system returns `EVIDENCE_INSUFFICIENT` rather than speculating.
4. **Verifiable Evidence Box**: Outputs standard GitHub Markdown boxes with exact paths, exit codes, and timestamps for seamless pair-programming reviews.

---

## 2. Four Stolen Practices (FORMAT Steal)

| Practice | WinDbg MCP | ThumbGate Evidence Diagnostics Steal |
| :--- | :--- | :--- |
| **Empirical Evidence Grounding** | LLM queries backed by live memory dumps, stack traces, and engine registers | Diagnostic claims backed by exact command stdout/stderr, exit code, and timestamps |
| **Cryptographic Evidence Receipts** | Session-bound dump verification tokens | SHA-256 checksums over raw command outputs verifying tamper-free diagnosis |
| **Grounded Abstention** | Refuses to diagnose symbol corruption without loaded PDBs | Returns `EVIDENCE_INSUFFICIENT` instead of speculative LLM guessing |
| **Verifiable Evidence Box Protocol** | Structured debug output windows for human inspection | Markdown `Verifiable Evidence Box` with absolute paths and verifiable receipts |

---

## 3. Strict Anti-Clone Boundaries

```text
1. NEVER install WinDbg, Windows Debugging Tools, or DbgEng.dll.
2. NEVER spin up Windows containers or proprietary Microsoft diagnostic services.
3. ALWAYS keep evidence verification local, deterministic, and fast (<50ms).
4. ALWAYS abstain (EVIDENCE_INSUFFICIENT) when diagnostic output is missing or truncated.
```

---

## 4. Verification Evidence

Run the diagnostic suite:
```bash
node scripts/windbg-evidence-diagnostics.js --json
node scripts/windbg-evidence-diagnostics.js --map-only
node --test tests/windbg-evidence-diagnostics.test.js
```
