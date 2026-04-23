# The Agentic Asset Factory: MCP Implementation

This document maps the node-based visual workflow (like Freepik Spaces) to our headless ThumbGate architecture. Instead of outputting static images, this factory outputs **"MCP Experience Packs"**—pre-configured agent brains with built-in assets, rules, and contextual memory.

## 1. Architectural Mapping

| Visual Node (Spaces) | MCP Gateway Implementation |
| :--- | :--- |
| **Packs List** | `contextfs` (Brand DNA, core constraints) |
| **Jobs List** | `async-job-runner.js` (Batched task execution) |
| **Text Assistant** | `scripts/code-reasoning.js` (Prompt expansion and constraint checking) |
| **Image Generator** | *External API / CLI* (Triggered via `run_shell_command`) |
| **Upscaler/Collage** | `scripts/a2ui-engine.js` (Agent-to-UI rendering and layout) |
| **Human Monitoring** | **Pre-Action Checks + Thompson Sampling** (Automated QA layer) |

## 2. The "Experience Pack" Format

When we generate a product (e.g., `TW-NEON-01`), we don't just create images. We generate a portable MCP configuration.

**Directory Structure:**
```text
packs/TW-NEON-01/
├── assets/                  # The generated visual assets (PNG/WEBP)
├── .thumbgate/
│   ├── prevention-rules.md  # Brand-specific QA rules (e.g., "NEVER use pastels")
│   └── feedback-log.jsonl   # Pre-trained reliability scores
├── brand-dna.md             # The core system prompt / constraints
├── moderation-policy.md     # Chatbot rules for the specific niche
└── server.json              # The MCP Server configuration to mount this pack
```

## 3. The Execution Loop

1.  **Define constraints:** Write the `brand-dna.md`.
2.  **Seed the vector store:** Mount the pack folder so `contextfs` indexes the DNA.
3.  **Run the Jobs:** Use `async-job-runner.js` to iterate through the asset list (Overlays, Emotes, Alerts).
4.  **Auto-QA:** If an output violates the `brand-dna.md`, the `rubric-engine.js` throws a veto, and a new `prevention_rule` is written to the pack's local `.thumbgate/` directory.
5.  **Package:** Zip the directory. The buyer mounts `server.json` and instantly gets an agent perfectly tuned to their new visual brand.
