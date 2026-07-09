---
"thumbgate": minor
---

Add rule clustering to surface "leverage points" — groups of DISTINCT prevention rules that likely share one upstream habit — in the feedback rules report. Dedup only merges identical mistakes, so five distinct symptoms of one habit become five narrow gates; clustering groups related-but-distinct rules (by shared tags or a moderate token-overlap band, below the dedup threshold) so a human can make one upstream fix instead of maintaining N gates. Deterministic and auditable: every cluster carries the shared tags/terms that justified it, and every suggestion is a candidate to confirm. Makes NO causal claim by design.
