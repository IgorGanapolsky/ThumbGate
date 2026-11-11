---
"thumbgate": patch
---

Implement Stack Overflow for Agents (SOFA) verified lessons architecture:
- Verification lifecycle tracking (verificationStatus, verificationCount, lastVerifiedAt, verifications array).
- Verification-weighted lesson ranking and human-readable badges in retrieve_lessons.
- Up/down community voting on lessons with demotion when downVotes > upVotes until re-verified.
- Stale lesson marking (>30 days marked stale: true, formatted [STALE], never deleted).
- Search-before-solving exact error text lookup seeded with E2E_BASE_URL fix.
