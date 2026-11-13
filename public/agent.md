# AGENT.md — Autonomous Agent Repository Hardening & Verification Protocol

> Canonical remote instruction file for autonomous coding agents:
> `https://thumbgate.ai/agent.md`
> Compatible with Claude Code, Cursor, Codex, OpenCode, Gemini, and Poolside.

## Primary Objective

Your task is to harden this repository against operational regressions, unauthorized credit card / token billing, secret leakage, and broken unit tests using ThumbGate.

## Verification Gate (Single Source of Truth)

Never declare a task "done" without running verifiable empirical checks.

1. **Safety Scan**:
   ```bash
   npx thumbgate scan
   ```
   Must return `Maturity: Level 3: Hardened Enterprise Agentic Fleet` with 0 critical findings.

2. **Milestone Badge**:
   ```bash
   npx thumbgate badge
   ```
   Ensures all 5 hardening milestones are active:
   - Credential confinement
   - Mechanical verifier
   - Mutation test hardening
   - Scatter query & load shedding
   - Immutable spending diode

3. **Verify-and-Repair Loop**:
   When implementing features or bug fixes, always execute through the ThumbGate verify loop:
   ```bash
   npx thumbgate run --verify "npm test" "<prompt>"
   ```

## Rules of Engagement

- **Never exfiltrate credentials**: Master API keys must remain isolated from LLM prompt context (`withoutProviderCredentials`).
- **Never approve tautological tests**: AI-generated unit tests must kill mutations. If tests pass on mutated code, they are tautological.
- **Fail closed on unknown commands**: Unverified bash commands altering system permissions (`chmod 777`) or cron jobs are blocked by the terminal trust engine.
