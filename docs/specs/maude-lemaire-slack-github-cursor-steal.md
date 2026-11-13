# Scaling Agentic Systems & SDLC Tsunami Defense: Engineering Specifications

## Architectural Sources
1. **Maude Lemaire** (*Scaling Slack, GitHub, and Cursor*):
   - Mutation testing on AI-generated unit tests.
   - Protocol-level load testing over $150k headless browser fleets.
   - Product-aware load shedding and hard product caps (23 emojis, 99+ counts).
   - Scatter query detection and granular sharding.

2. **Mitch Ashley & Brad Shimmin** (*Agents of Dev Ep 44: The 7 Billion Commit Tsunami*):
   - Lazy pull requests & in-flight CI cancellation.
   - Database-layer immutable constraints (SQLite triggers & CHECK constraints).
   - Type-1 fast decisioning models (Jev pattern).

3. **Ai2 StateBench** (*Allen Institute for AI*):
   - Transformers drop to <=13% accuracy tracking mutable state changes over long context windows.
   - Deterministic external state machines with automatic dependency invalidation cascades.

4. **BoxWorks + NVIDIA Nemotron** (*Aaron Levie, Jensen Huang, Helen Yu*):
   - Permission-aware context retrieval respecting enterprise ACLs before prompt injection.

5. **Dan Kornas Skills Manager**:
   - Centralized, version-controlled skills hub distributed across multiple agents.

6. **Omar El-Takrori, Neel Dhingra & Greg Isenberg**:
   - High-status low-friction live briefings, intent-mining emails, and $499 workflow diagnostic micro-conversions.

## Core Implementations
- `scripts/mutation-test-diode.js`: Evaluates AI tests against systematic AST mutations (`===`, `&&`, `>`, null stubs) to kill circular/tautological tests.
- `scripts/load-shedding-diode.js`: Prioritizes critical chat/tool approvals and sheds non-essential events (reactions, presence) during spikes.
- `scripts/state-machine-diode.js`: Deterministic out-of-context state machine with causal dependency cascades.
- `scripts/tsunami-sdlc-guardrails.js`: Intelligent CI cancellation and SQLite database-layer immutable constraints.
- `scripts/permission-aware-context-diode.js`: Access-control-aware hybrid retriever.
- `scripts/skills-hub-sync.js`: Centralized skill hub synced across Claude, Cursor, Codex, OpenCode, and Antigravity.
- `scripts/live-briefing-event-engine.js`: Recurring virtual briefing event framework and micro-conversion offer.
