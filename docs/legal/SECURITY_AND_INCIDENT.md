# Security overview and incident language

**Status:** Draft for product counsel and buyer questionnaires.  
**Live summary route:** `/security`  
**Not** a SOC 2 report or penetration-test certificate.

## 1. Product security model

ThumbGate’s primary security value is **pre-action control** for AI agents:

- Gates can allow, warn, require approval, or hard-deny tool calls  
- Feedback can promote local prevention rules  
- Hosted pairing and leases reduce unsafe concurrent mutation on paired systems  

ThumbGate does **not** guarantee detection of every unsafe action. Security
outcomes depend on configuration, strict mode, supported integrations, and
customer testing.

## 2. Local-first vs hosted trust boundary

| Boundary | What is protected / processed |
| --- | --- |
| **Local engine** | Workspace content stays on the customer machine by default |
| **Hosted API / app** | Account, billing references, device pairing metadata, runner operational logs |
| **Professional services** | Only materials the customer chooses to share (prefer redacted, non-secret) |

## 3. Technical and organizational measures (current engineering practice)

These describe engineering intent, not certified controls:

1. **Transport encryption** — HTTPS/TLS for hosted endpoints  
2. **Secrets** — production secrets via host env / secret store; not committed to git  
3. **Auth** — API keys / operator auth for sensitive hosted routes; webhook HMAC verification for Stripe  
4. **Least privilege** — production access limited to operators who need it  
5. **Dependency hygiene** — public MIT repo + third-party notices; dependency updates via normal release process  
6. **Abuse controls** — checkout bot guards, rate limits, and acceptable-use enforcement where implemented  
7. **Lease / single-writer controls** — reduce concurrent destructive git/workspace mutations when agents honor the protocol  

## 4. Customer responsibilities

- Keep paired devices and API keys secure  
- Configure gates for the workflows that matter  
- Test denies and warnings before production reliance  
- Do not send secrets into intake forms or shared logs  
- Review human-approval prompts before authorizing actions  

## 5. Incident notification (draft contractual target)

For **enterprise customers under a signed agreement** that includes this term:

- After ThumbGate **confirms** a security incident involving unauthorized
  access to that customer’s personal data or confidential hosted content,
  ThumbGate will notify the customer’s designated contact **without undue
  delay and within 72 hours** of confirmation.  
- Notification will include known facts: nature of incident, data categories
  if known, likely consequences, and mitigation steps.  

Self-serve free users and customers without a signed incident schedule receive
commercially reasonable notice but not a contractual 72-hour SLA unless added.

## 6. Vulnerability disclosure

Email **igor.ganapolsky@gmail.com** with “Security” in the subject.  
Do not open public GitHub issues for active vulnerabilities.  
We aim to acknowledge within **48 hours**.

## 7. What we do not claim

Until independent evidence exists, do not state that ThumbGate:

- Is SOC 2 Type I/II certified  
- Is ISO 27001 certified  
- Is HIPAA eligible or offers a BAA by default  
- Provides formal pen-test reports on a fixed cadence  
- Guarantees 100% uptime or 100% unsafe-action capture  

## 8. Related documents

- Privacy Policy — `/privacy`, `PRIVACY_POLICY.md`  
- DPA posture — `DPA_POSTURE.md`  
- Terms — `/terms`, `TERMS_OF_SERVICE.md`  
- Claims map — `CLAIMS_SUBSTANTIATION.md`  
