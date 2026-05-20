---
"thumbgate": patch
---

Fix workflow sentinel to checkpoint (warn) background customer-system actions before hard-deny threshold. Previously, risk drivers from background agent + customer system action could push the score past 0.86, triggering a hard deny that blocked legitimate automated workflows.
