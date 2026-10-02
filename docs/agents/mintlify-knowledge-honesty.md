# Mintlify 2026 State of Knowledge Honesty (FORMAT Steal)

Doctor: `npx thumbgate mintlify-knowledge-honesty --json`

Steals the **Knowledge-as-Operational-Infrastructure protocol** and **Pre-Ingestion Freshness & Poison Diode** from [Mintlify's 2026 State of Knowledge Report](https://www.mintlify.com/state-of-knowledge) and maps it onto **existing** ThumbGate rails.

This is a compare-not-clone doctor. It does **not** vendor Mintlify SaaS, create hosted documentation sites, or quote external traffic statistics as our own. Not affiliated.

## The Core Thesis: Documentation is Where Work Starts, Not Where It Ends

Mintlify's 2026 empirical study of 15,000 developer documentation sites reveals a historic inflection point:
- **66% of traffic is now AI agents** consuming docs programmatically.
- **3x increase in Model Context Protocol (MCP)** tool calls reaching beyond standard docs into unstructured knowledge.
- **61% of agent-drafted pull requests are merged**.
- **Company knowledge lives across multiple surfaces** (support tickets, community forums, Slack, Notion, API specs) with no clear single owner for AI-readiness.

### The Downstream Poison Threat (Anthropic Warning)

As Sarah Deaton (Technical Content Engineer, Anthropic) emphasizes:
> *“The same page that misled one developer now misleads an unknowable number of agents, which then propagate that misunderstanding to downstream users.”*

When an agent reads stale documentation (>90 days old), deprecated endpoint instructions, or unverified community workarounds, it incorporates toxic patterns into its reasoning loop. Storing passive knowledge without a pre-action diode poisons agent tool calls, creates failing commits, and triggers hallucinated migrations.

ThumbGate is **The Infrastructure Firewall**: we validate knowledge surfaces *before* agents ingest or act upon them, gating stale, deprecated, or unverified sources before they cause harm.

## Knowledge-as-Infrastructure FORMAT Map

| Mintlify Finding | Industry Perspective | ThumbGate Rails | Operational Diode |
| :--- | :--- | :--- | :--- |
| **66% Agent Readership** | Chris Riley (HubSpot): *“What's good for humans is good for agents, but you can't treat them the same way.”* | `scripts/hook-pre-tool-use.js`, `scripts/agent-loop.js` | Dual-persona diode: High-intent agent consumers are evaluated through PreToolUse before code generation or tool dispatch. |
| **3x MCP Growth** | Agents reach beyond docs to arbitrary knowledge surfaces via MCP | `scripts/mcp-wiring-doctor.js`, `scripts/retrieval-funnel-doctor.js` | MCP schema diode: Enforces bounded retrieval pools (≤50 candidates) and validates MCP knowledge payloads against schema. |
| **Downstream Poison** | Sarah Deaton (Anthropic): *“Misleading pages propagate misunderstandings downstream.”* | `scripts/mintlify-knowledge-honesty.js`, `config/gate-templates.json` | Knowledge Poison Diode (`gate-mintlify-knowledge-poison-prevention`): Scans ingested text for deprecated methods, unsafe exec snippets, and bare credentials. |
| **Non-Docs Knowledge Gap** | David Hou (Decagon): *“Building the knowledge layer takes people and operating infrastructure too.”* | `scripts/feedback-to-memory.js`, `scripts/rubric-engine.js` | Surface Federation: Classifies community forum / ticket snippets into untrusted tiers requiring human review before mutating ops. |
| **Operational Infrastructure** | Documentation cannot be static text; must be living operational infrastructure | `scripts/action-receipts.js`, `VERIFICATION_EVIDENCE.md` | Attested receipts: Cryptographically links agent action outcomes to verified knowledge versions. |

## Fail-Closed Boundaries

| Finding Code | Trigger Condition | Enforcement Action |
| :--- | :--- | :--- |
| `critical_knowledge_poison` | Ingested text contains `curl ... \| sh`, `rm -rf /`, or realistic plaintext tokens | Immediate `block`. Prevents agent code execution from untrusted knowledge snippets. |
| `stale_canonical_docs` | Canonical documentation age > 90 days (via front-matter or file metadata) without release alignment | `review` gate. Requires operator verification before agent relies on obsolete API specs. |
| `unverified_community_advice` | Content from community forums / tickets recommending `--force` or bypassing branch protections | Immediate `block` / `review`. Prohibits unverified community hacks from mutating repo state. |
| `mintlify_clone_refused` | Attempt to install Mintlify SaaS, build a hosted doc generator, or quote 15k stats as ours | Hard architectural refusal. ThumbGate steals the operational firewall format, not the docsite product. |

## CLI Commands

```bash
# Display FORMAT mapping table
npx thumbgate mintlify-knowledge-honesty --map-only

# Emit machine-readable audit of docs directory
npx thumbgate mintlify-knowledge-honesty --check-dir docs --json

# Strict mode: fail if any review or blocked surfaces are detected
npx thumbgate mintlify-knowledge-honesty --check-dir docs --strict

# Run automated verification suite
npm run test:mintlify-knowledge
```

## Skill

- `.agents/skills/mintlify-knowledge-honesty-not-clone/SKILL.md` (`/mintlify-knowledge-honesty-not-clone`)
- `skills/mintlify-knowledge-honesty-not-clone/SKILL.md`
