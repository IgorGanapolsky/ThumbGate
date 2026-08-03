---
"thumbgate": patch
---

Cover opaque screen-mutation detection in the financial control plane.

`detectOpaqueScreenMutation` and the screen path through `detectEconomicAction`
had no test coverage: all 30 existing cases exercised ledger mechanics only.
Neutering the detector left the suite fully green, so a regression that let a
blind browser click through would have shipped silently.

Adds seven cases pinning the intended behaviour — coordinate, `ref`, `selector`
and `elementId` locators are opaque; observation-only calls are not mutations;
a non-screen tool carrying coordinates is not a screen mutation; routine shell
commands stay allowed; and the control plane blocks a blind click while
allowing a screenshot. The same mutation now fails five of them.

Tests only; no behaviour change.
