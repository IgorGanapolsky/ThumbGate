# OpenUI catalog-compose honesty (FORMAT steal)

Source: https://www.openui.com/

## How this helps ThumbGate

OpenUI is a generative-UI framework (OpenUI Lang + optional Thesys Gateway). We do **not** clone that product. Three process tactics transfer onto existing PreToolUse / claim-honesty rails:

| OpenUI FORMAT | ThumbGate mapping |
|---------------|-------------------|
| Model only composes allowlisted components | `require-catalog-compose-only` + doctor catalog check |
| Line-oriented root-first streaming | Doctor requires `root = ...` before children |
| Gateway repairs invalid output before users see it | `--repair` + `require-repair-before-compose-claim` |

## Commands

```bash
npm run openui-catalog-compose-honesty -- --catalog=catalog.json --stream=compose.txt --repair --json
npm run test:openui-catalog-compose-honesty
```

## Out of scope

- Installing `@openuidev/cli` or OpenUI Lang
- Thesys Gateway / Observability as a ThumbGate SKU
- Net-new generative-UI R&D (ECI wall)
