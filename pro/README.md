# ThumbGate — Pro Configuration Pack

Production-ready RLHF configurations for AI agent teams.

## What's Included

### 1. Curated Prevention Rules (`prevention-rules-pro.md`)
Curated rules and presets covering:
- PR workflow failures (declaring done without evidence)
- Git push hygiene (thread verification, CI confirmation)
- Tool misuse patterns (wrong tool for the task)
- Context window management (compaction-safe memory)

### 2. Thompson Sampling Presets (`thompson-presets.json`)
Pre-tuned Thompson Sampling parameters for common agentic workflows:
- **Conservative** — High-reliability production deploys
- **Exploratory** — R&D and prototyping sessions
- **Balanced** — Day-to-day development

### 3. RLAIF Self-Audit Constraints (`constraints-pro.json`)
Extended constraint set beyond the defaults:
- PR thread verification constraint
- Test coverage gate constraint
- Security scan pass constraint
- Documentation freshness constraint

### 4. Hook Templates (`hooks/`)
Ready-to-install Claude Code / Amp hooks:
- Stop hook: blocks completion without evidence
- UserPromptSubmit hook: auto-captures feedback with rich context
- PostToolUse hook: validates tool output quality

### 5. Reminder Engine Templates (`reminders-pro.json`)
Production reminder templates for:
- Post-push thread checks
- Pre-merge CI verification
- Stale branch cleanup
- Memory consolidation scheduling

## Installation

```bash
# Copy pro configs into your ThumbGate installation
cp -r pro/ /path/to/your/mcp-memory-gateway/
npm run self-heal:check
```

## License

Commercial license. Single-team use. See purchase terms on the hosted checkout.

Current pricing and traction policy: [Commercial Truth](../docs/COMMERCIAL_TRUTH.md)
