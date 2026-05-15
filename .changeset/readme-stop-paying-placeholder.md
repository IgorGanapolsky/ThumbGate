---
"thumbgate": patch
---

Fix broken README hero line. The README has shown `**Stop paying $ for the same AI mistake.**` since 2026-04-26 — a stray `$` placeholder that was never filled in. The canonical product line elsewhere on the site is `Stop paying for the same AI mistake twice` (matches `<title>` tag on the homepage). This PR aligns the README hero to that exact phrasing.

Caught by a self-critique pass during a bug-hunt session. The placeholder had been live on the public GitHub README for almost three weeks.
