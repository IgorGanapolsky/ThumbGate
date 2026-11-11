---
"thumbgate": patch
---

fix(doctor): a host (non-container) runtime is now an advisory instead of a readiness warning, so `npx thumbgate doctor` exits 0 on a fully wired developer machine
