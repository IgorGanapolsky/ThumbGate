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
limit-sensitive-PI requests.

Honor is enforced, not just described: marketing pages suppress first-party
emits when GPC or DNT is set, `/v1/telemetry/ping` discards `Sec-GPC: 1` /
`DNT: 1` before writing the JSONL, and the notice calls those events
pseudonymous (visitor + session identifiers) instead of anonymous. Tests are
two-sided: signal set must not persist; no signal must still persist.
