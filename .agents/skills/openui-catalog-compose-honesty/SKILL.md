---
name: openui-catalog-compose-honesty
description: >
  OpenUI FORMAT steal: catalog-compose-only, root-first streaming, repair-before-claim.
  Audit agent-composed UI against an allowlisted component catalog; never clone OpenUI,
  Thesys Gateway, or a generative-UI SKU. Slash: /openui-catalog-compose-honesty.
---

# OpenUI Catalog-Compose Honesty

## Goal
Keep agent-composed UI honest: only allowlisted components, root-first streams, repair before any ready/done claim. Steal OpenUI FORMAT — do not clone the product.

## Constraints
- Never install `@openuidev/cli`, OpenUI Gateway, or Thesys Observability as ThumbGate
- Never invent components outside the catalog or `eval` / `new Function` generated UI
- Never claim UI/compose ready without `--repair --claim-ready` evidence
- Never dual-edit a sibling OpenUI/generative-UI WIP PR
- ECI: no net-new generative-UI SKU

## Reference
- https://www.openui.com/ (source FORMAT)
- Gates: `require-catalog-compose-only`, `require-repair-before-compose-claim`
- Script: `scripts/openui-catalog-compose-honesty.js`
- Docs: `docs/agents/openui-catalog-compose-honesty.md`

## Examples
```bash
# Clean catalog stream → ready
npx thumbgate openui-catalog-compose-honesty \
  --catalog=catalog.json \
  --stream=compose.txt \
  --repair --claim-ready --json

# Unknown component / missing root → fail
npx thumbgate openui-catalog-compose-honesty \
  --catalog='{"components":["Stack"]}' \
  --stream=$'header = Ghost()\n' \
  --json
```

Catalog:
```json
{ "components": ["Stack", "Card", "Table"] }
```

Stream (root first):
```
root = Stack([header, body])
header = Card()
body = Table([row])
```

## Procedures
1. Check sibling WIP for OpenUI/generative-UI PRs — do not duplicate.
2. Write or load a component catalog JSON.
3. Run doctor with `--catalog` + `--stream` (+ `--repair`).
4. Before any UI/compose done claim, re-run with `--claim-ready --strict`.
5. Wire gates from `config/gate-templates.json` Agent Honesty pair.

## Rubric
- ok=true when doctor status is `ready` with `repairClean=true` on the claimed stream
- ok=false on unknown components, missing root, arbitrary-code markers, or OpenUI SKU clone signals
- evidence: `--json` report in the same turn
