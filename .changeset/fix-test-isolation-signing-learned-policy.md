---
"thumbgate": patch
---

Fix test fixture isolation: disable commit signing in temp git repos and use empty feedback dir in workflow-sentinel unit tests so CI environments with signing servers and accumulated learned-policy data don't cause false failures.
