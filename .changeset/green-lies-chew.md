---
'thumbgate': patch
---

Harden operational integrity git revision validation so unsafe refs and commit
arguments are rejected before invoking git, and add regression coverage for the
SonarCloud command-argument findings.
