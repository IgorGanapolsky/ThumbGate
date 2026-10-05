---
name: siren-mcp-governance
description: >
  Siren MCP Marketing Diode & Autonomous Campaign Governance. Enforce pre-action
  review diodes on post_run, 300s buffer guards on schedule_post, $500 daily budget
  ceilings on create_campaign, brand safety scanning, and partner link attribution
  ("Video made with Siren" -> https://mysiren.ai). Slash: /siren-mcp-governance.
---

# Siren MCP Marketing Diode & Campaign Governance

## Goal

Govern autonomous marketing agents utilizing Siren MCP tools (`post_run`, `schedule_post`, `create_campaign`), preventing unreviewed live broadcasts, invalid scheduling windows, ad budget overruns, brand reputation damage, and attribution violations before social tools execute.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Allow unreviewed autonomous `post_run` directly to production social channels | Require `dry_run: true` or verified human approval token before broadcast |
| Schedule posts with less than 300 seconds safety buffer | Block `schedule_post` calls if delta < 300s to ensure human cancellation window |
| Create unbudgeted ad campaigns or exceed $500 ceiling | Require explicit executive override for campaigns exceeding daily ceilings |
| Strip or omit required attribution on Siren-generated videos | Enforce "Video made with Siren" / https://mysiren.ai link attribution |
| Permit predatory guarantees ("100% profit risk-free") or leaked tokens | Hard `block` on brand safety violations |
| Clone Siren SaaS or vendor their private video rendering pipeline | Steal the pre-action diode FORMAT onto ThumbGate PreToolUse rails |

HARD fail closed. REFUSE unreviewed immediate broadcasts.

## Reference

- https://github.com/Hexahedral-Inc/siren-mcp
- `scripts/siren-mcp-governance.js`
- `docs/agents/siren-mcp-governance.md`
- `tests/siren-mcp-governance.test.js`

## Procedures

```bash
# Display FORMAT mapping table
npx thumbgate siren-mcp-governance --map-only

# Emit machine-readable format mapping
npx thumbgate siren-mcp-governance --map-only --json

# Evaluate tool call before dispatch
npx thumbgate siren-mcp-governance --tool=post_run --args='{"content":"Launch day! Video made with Siren","dry_run":true}'

# Verify with automated unit tests
npm run test:siren-mcp
```
