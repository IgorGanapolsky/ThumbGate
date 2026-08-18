---
"thumbgate": patch
---

Add a "Your Privacy Choices" link to the homepage footer and the matching
anchored section in the privacy notice.

CCPA/CPRA Civil Code 1798.135(a) requires the opt-out affordance be reachable
from the homepage, not only from inside the privacy notice. An external
public-evidence scan flagged this as Not observed on thumbgate.ai and the
finding was correct: the footer carried only Terms / Privacy / Legal, a live
fetch for "do not sell | your privacy choices | global privacy control"
returned nothing, and privacy.html had no id anchors to link to.

The new section states that ThumbGate does not sell or share personal
information as CCPA/CPRA defines those terms, that the Global Privacy Control
signal is honored, and gives a contact route for know / delete / correct /
limit-sensitive-PI requests. This restates the existing Data Sharing position
rather than making a new claim.
