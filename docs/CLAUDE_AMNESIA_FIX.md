# Fix: Claude Code Memory Loss & Context Compaction

If you are using **Claude Code** and hitting "Context Compaction" where the agent forgets your mission, North Star, or architectural constraints between sessions, this is the definitive fix.

## The Problem
Claude Code auto-compacts the context window to save tokens. During this process, critical system instructions and session history are often "nuked," leading to agent amnesia.

## The Solution: 5-Layer Memory Stack
The **MCP Memory Gateway** implements a persistent, compaction-resistant bridge for your agent.

### 1. Compaction-Resistant Primer
We maintain a `primer.md` that is surgically re-injected in the first 200 lines of every session. It contains:
- Your Active Mission (North Star)
- Last Completed Task
- Exact Next Step
- Live Git Context (Branch, Commits, Dirty Files)

### 2. NVIDIA-Aligned Governance
Move beyond regex. We verify executables by **Content Hash**. Even if an agent renames a binary to bypass your sandbox, the gate stays closed.

### 3. Azure Fabric OneLake Sync
Enterprise-ready audit logs streamed directly to Microsoft Fabric for long-term behavioral tracking.

## Get Started (10 Seconds)
```bash
npx mcp-memory-gateway init --agent claude-code
```

## Pricing
- **Local Version:** $0 (Free/OSS)
- **Mistake-Free Starter Pack:** $49 (One-time) - Includes 500 verified consolidations and the full 5-layer stack.

**Stop starting over. Get the Gateway.**
[Claim your $49 Starter Pack](https://rlhf-feedback-loop-production.up.railway.app/checkout/pro?packId=mistake-free-starter)
