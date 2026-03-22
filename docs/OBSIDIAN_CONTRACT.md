# Obsidian Memory Contract

This document defines the storage and recall interface for the agent's long-term memory in the Obsidian vault.

## 1. Vault Structure
- `/Decisions`: Contains policy gates, prevention rules, and architectural constraints.
- `/Preferences`: Contains behavioral traits and user-specific working styles.
- `/Growth`: Contains leads, revenue logs, and conversion tracking.
- `/Context`: Contains session primers and raw memory logs.

## 2. Ingestion Rules
- **Rule 1:** Every session handoff must trigger `bin/obsidian-sync.sh`.
- **Rule 2:** All $49 conversions must be recorded in `/Growth/Revenue.md`.
- **Rule 3:** New prevention rules must be tagged with `#prevention-rule` and categorized by layer.

## 3. Recall Protocol
- Before starting a high-risk task (e.g., automated outreach), the agent should:
  1. Search `/Decisions` for relevant policy blocks.
  2. Search `/Preferences` to align the tone/method with the CEO's style.
  3. Update `primer.md` with the last-recall timestamp.

## 4. Integration
This contract is enforced by the **RLHF Execution Layer**. Stale memories should be archived to `/Archive` during "Refactor Weeks."
