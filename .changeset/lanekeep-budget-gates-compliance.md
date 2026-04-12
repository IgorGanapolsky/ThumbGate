---
'thumbgate': minor
---

Add budget enforcer, self-protection gates, and compliance tags for competitive parity with LaneKeep.

- Budget Enforcer: action count + time limits with strict/guided/autonomous profiles (Tier 0 pre-check)
- Self-Protection Gates: 4 new gates block agents from modifying ThumbGate config, killing processes, overriding env vars, or disabling hooks
- Compliance Tags: NIST-AC-3, SOC2-CC6.1, OWASP-A01, CWE tags on 13 gates for enterprise security teams
- Budget config profiles: strict (500 actions/2.5h), guided (2000/10h), autonomous (5000/20h)
- Total gates: 33 (was 29). 15 new tests.
