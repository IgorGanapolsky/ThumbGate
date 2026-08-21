---
"thumbgate": patch
---

Fix the two SonarCloud findings that surfaced once the Future AGI scripts were removed from `sonar.exclusions`: give `extractTraceSignatures` an explicit code-unit comparator (S2871) and optional-chain the `post.live` guard in the pre/post gate (S6582). Both are behaviour-preserving.
