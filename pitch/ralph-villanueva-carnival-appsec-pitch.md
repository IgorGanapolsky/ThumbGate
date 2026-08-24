# Deterministic AppSec Preflight Proposal for Enterprise Security Teams

**To:** Ralph Villanueva, Cybersecurity Compliance Supervisor, Carnival Corporation  
**From:** Igor Ganapolsky, Founder & CEO, ThumbGate  
**Subject:** 10 Common-Sense Solutions to AppSec Challenges (AI Not Required) — Implemented in Code  

---

### Executive Summary

Hi Ralph,

Your BrightTALK session **"10 Common Sense Solutions to App Sec Challenges - AI Not Required"** hits on a vital truth that the industry is overlooking amid the GenAI hype: **prompt engineering is not a security control**.

Persistent application security failures — unauthenticated endpoint exposure, SSRF to cloud metadata (169.254.169.254), multi-tenant IDOR, and hardcoded credential leakage — cannot be solved by asking an LLM to "review this code for security." LLMs hallucinate, miss subtle boundary errors, and provide zero deterministic guarantees.

We took your 10 common-sense AppSec principles and built a fail-closed, sub-millisecond deterministic pre-action firewall in **ThumbGate**.

---

### The 10 Deterministic Invariants (Zero AI / Zero Hallucination)

1. **APPSEC_01 (Unauth Endpoints):** Strict AST detection for internal/admin routes missing auth middleware.
2. **APPSEC_02 (Hardcoded Secrets):** High-entropy regex matching for AWS, OpenAI, JWT, and private keys.
3. **APPSEC_03 (Permissive CORS):** Immediate interdiction of `Origin: *` paired with `Credentials: true`.
4. **APPSEC_04 (SSRF Egress):** Runtime interception of egress calls targeting private RFC 1918 / cloud metadata IPs.
5. **APPSEC_05 (Injection Prevention):** AST-level enforcement of parameterized database and shell executions.
6. **APPSEC_06 (Path Traversal):** File system parameter normalization and root boundary checking.
7. **APPSEC_07 (Telemetry Sanitization):** Log payload stripping for authorization tokens, cookies, and passwords.
8. **APPSEC_08 (Multi-Tenant IDOR):** Mandatory tenant/organization scoping on all multi-tenant queries.
9. **APPSEC_09 (Upload Security):** Restricting executable file types from entering public web roots.
10. **APPSEC_10 (Safe Deserialization):** Blocking dynamic `eval()` and unsafe prototype-polluting parsers.

---

### Fast-Track Evaluation

We would love to share our open reference implementation with your AppSec engineering and compliance teams:
- Instant CLI scan: `npx thumbgate appsec --scan-file=<path>`
- Clear, deterministic root-cause explanations with actionable fixes (`--explain=APPSEC_04_SSRF_EGRESS`)
- Zero cloud egress or LLM latency overhead (runs locally in <1ms)

Would you be open to a 10-minute technical exchange next week?

Best regards,  
**Igor Ganapolsky**  
Founder & CEO, ThumbGate  
https://thumbgate.ai • igor@igorganapolsky.com
