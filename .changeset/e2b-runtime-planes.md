---
'thumbgate': patch
---

The checkout lease now fences release by execution id and refuses secret values. A release that names an older execution leaves the newer lease in place. `planes` reports a shell payload in the checkout record without storing or printing a secret. Compare-not-clone: this does not install e2b, Firecracker, or the embed stack.
