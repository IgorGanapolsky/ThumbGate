---
name: apollo-gtm-preview-honesty-not-clone
description: >
  The 2026-10-28 Apollo mail is FORMAT, not a ThumbGate product. Steal a
  plain-English prospecting job as a typed action: free ICP preview with a
  reason on every row, a cost quote that waits, and a maps or directory
  label. Never spend a credit, save a lead, enroll a sequence, grab an
  email, install their MCP, or fetch a directory.
  Slash: /apollo-gtm-preview-honesty-not-clone.
---

# Apollo GTM preview — compare, do not clone

## Goal

Decide one prospecting action before it runs. A preview is free. A credit spend never runs here.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Spend a credit, even after a person approves the quote | `npx thumbgate apollo-gtm-preview --json` |
| Save a lead or enroll a sequence | Every preview row has an ICP reason and no email |
| Grab an email address or install their MCP | `cost.quote` shows a number and waits |
| Fetch a map or a niche directory | `source.name` is maps, directory, or stated |
| Treat their plan price as a ThumbGate price | Credit spend denies with `spend-stays-outside` |

## Procedures

```bash
npx thumbgate apollo-gtm-preview --json --map-only
npx thumbgate apollo-gtm-preview --json --policy=policy.json --action=action.json
npm run test:apollo-gtm-preview
```

`policy.org` and `policy.icp` are required. `previewLimit` defaults to 10 and cannot exceed 10. On `preview.list`, `icp.check`, `cost.quote`, and `source.name`, a saved lead, an enrollment, a fetch, or a non-zero `creditsSpent` denies before the point-specific check. A policy or action that is present as `null`, `false`, or `0` fails closed. The hosted cloud gate is a different surface. This doctor does not add a route.
