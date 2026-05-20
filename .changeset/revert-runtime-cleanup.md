---
"thumbgate": patch
---

Revert the graceful shutdown listener cleanup after production verification showed the cleanup path could leave Railway without a healthy running container.
