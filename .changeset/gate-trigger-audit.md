---
'thumbgate': minor
---

New `thumbgate gate-audit` command replays every learned rule against past allowed actions and reports false fires, the sample size, a 95% upper bound on the false-fire rate and an evidence label (none, weak, strong, fires-on-safe-actions). Newly promoted block rules now keep that audit on the rule. Idea from arXiv 2611.26450, which reports its compiled circuits' false triggers as a count over a large held-out sample.
