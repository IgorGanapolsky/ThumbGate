---
"thumbgate": patch
---

Steal OpenUI's catalog-compose-only / root-first / repair-before-claim FORMAT onto ThumbGate honesty rails.

Adds `openui-catalog-compose-honesty` doctor + CLI, Agent Honesty gate templates (`require-catalog-compose-only`, `require-repair-before-compose-claim`), and skill. Does not install `@openuidev/cli`, OpenUI Gateway, or Thesys Observability, and does not ship a generative-UI SKU.
