---
'thumbgate': patch
---

Harden the GitHub CI release process by using the tested changeset checker in PR workflows, trimming duplicate npm publish validation, and adding slower npm registry propagation retries to package smoke tests.
