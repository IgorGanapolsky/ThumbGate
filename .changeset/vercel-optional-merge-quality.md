---
"thumbgate": patch
---

Treat the Vercel deployment status as an optional merge-quality check. It is not in required branch-protection contexts, and free-tier deploy rate-limits were stalling Trunk while every required check was green.
