---
"thumbgate": patch
---

Fix hash navigation on Lessons page: scrollIntoView silently failed on elements
inside hidden tabs (display:none). Now switches to the correct tab before querying
for the target element. Statusbar "Latest mistake" links now scroll to the right
rule card.
