# Universal Agent Driver & Verify-and-Repair Architecture

## Overview
Adopted from Dan Kornas' GenAIcode (`gtanczyk/genaicode`) and modernized with ThumbGate Pre-Action Firewall Diodes.

## Key Capabilities
1. **Multi-Agent CLI Driver Engine**:
   - Seamless abstraction over 8 agent CLIs on host: `claude`, `codex`, `copilot`, `cursor`, `gemini`, `opencode`, `poolside`, `antigravity`.
   - Host binary discovery (`findExecutable`), version detection (`detectAgents`), and standardized argument construction (`buildAgentCommand`).

2. **Automated Verify-and-Repair Loop (`thumbgate run --verify "<cmd>"`):**
   - Automatically executes the agent task.
   - Runs verification command (`npm test`, `node scripts/check.js`).
   - If tests fail, feeds stderr directly back into the agent prompt for autonomous iterative repair (up to `maxRepairs`).
   - If primary agent fails repeatedly, falls back to `fallbackAgent` (Swarm Escalation).

3. **ThumbGate Pre-Action Firewall Diode**:
   - Rejects destructive commands (`rm -rf`, `mkfs`, `git push --force`, `git reset --hard`).
   - Blocks data leaks to unauthorized corporate domains.
   - Enforces credential isolation (`withoutProviderCredentials`) to prevent token leakage.

## CLI Commands
- `npx thumbgate agents`: Displays all installed coding agents on host with version and binary paths.
- `npx thumbgate run -a claude --verify "npm test" "fix math bug"`: Runs verify-and-repair loop.
