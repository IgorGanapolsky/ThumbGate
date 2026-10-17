# Paranoid Mode (FORMAT steal, not clone)

> **CoinMarketCap / Vitalik Buterin, Oct 2026:** "paranoid mode" for AI agents
> routes them through Tor, masks requests with cover traffic, uses zkAPI for
> anonymous payments, and rewrites prompts with a local LLM.
>
> **ThumbGate FORMAT steal:** We steal the *threat model* and *architectural
> principles* — not the Tor daemon, zkAPI stack, or local LLM inference. ThumbGate
> already implements a PreToolUse egress firewall that achieves the same
> *security guarantees* via deterministic, <5ms CPU-local evaluation.

## The Threat Model Paranoia Solves

1. **Destination fingerprinting** — an external API observes request patterns
   (timing, payload shape, IP) and infers agent workflow identity.
2. **Prompt leakage** — sending raw agent context to external LLMs exposes
   project structure, credentials, and proprietary logic.
3. **Payment correlation** — linking an API usage pattern to a specific billing
   account reveals agent behavior at scale.
4. **Correlation across requests** — an observer ties multiple requests together
   to reconstruct the agent's plan.

## How ThumbGate Steals Each Pillar

### 1. Tor Routing → PreToolUse Egress Classification

**Their approach:** All agent HTTP traffic goes through a Tor circuit. The
destination server sees only a Tor exit node IP — it cannot correlate the
source or fingerprint the agent's network location.

**ThumbGate's approach:** `scripts/agent-egress-policy.js` classifies every
outbound request *before tool execution* and applies:

- **Static deny-list first** (deny always wins — the CrabTrap invariant)
- **Origin-boundary prefix matching** — prevents `evil.com/api.example.com`
  suffix tricks (the DNS-rebinding equivalent of Tor hidden-service validation)
- **SSRF fail-closed** — RFC1918, link-local, CGNAT, cloud metadata endpoints
  are blocked unconditionally
- **Bridge host classification** — allowlisted package registries/proxies are
  classified as *hops, not trust boundaries* (GitLab 2026-09 FORMAT). Credentials
  riding a bridge hop trigger `ALLOWLIST_BRIDGE_CREDENTIAL` denial unless
  independent auth is already granted.

**Key difference:** Tor obscures the *source*. ThumbGate prevents the *decision*
from being made at all for risky destinations. The PreToolUse hook fires
**before** the HTTP request is constructed, so no network metadata leaks.

**Improvement:** Add a `batchEgress` mode that queues non-critical egress
(e.g., documentation fetches) and releases them in randomized windows, making
the egress pattern indistinguishable from noise — the "cover traffic" idea,
implemented as timing obfuscation rather than decoy requests.

### 2. Cover Traffic → Batched Egress + Phantom Audit Entries

**Their approach:** Generate decoy HTTP requests alongside real ones so an
observer can't tell which traffic is the agent's actual intent.

**ThumbGate's approach:** ThumbGate's `buildJudgeSafeRequestView` already
structures every egress decision into a normalized JSON audit entry. Instead
of decoy requests, ThumbGate can:

- **Batch non-critical egress** into time-windowed envelopes (release queued
  fetches every 5–30s window)
- **Inject phantom audit entries** for denied requests — the audit log shows
  a decision was made, but the actual request never left the host, so an
  observer of the log can't correlate which tools actually executed
- **Randomize judgement timing** within the 5ms budget to prevent
  request-rate fingerprinting

**Implementation:** Add a `coverTraffic` flag to the egress policy that:
1. Logs `OBSERVE` entries for every deny decision (already done)
2. Emits empty `JUDGE` entries at randomized intervals (new)
3. Batches non-critical `STATIC_ALLOW` requests into windowed release (new)

### 3. zkAPI → Local Token Budget Pool

**Their approach:** Zero-knowledge proofs allow anonymous payment — the API
provider can't link usage to a specific billing identity.

**ThumbGate's approach:** ThumbGate's `token-shunt-honesty` skill already
enforces strict token budgets:

- Unconditional Read above 350 lines → **blocked**
- Bare `cat` of large files → **blocked**
- `npx -y` → **blocked**
- All decisions are <5ms deterministic CPU, zero LLM tokens

**Improvement:** Extend the token budget into a **pool** abstraction:
- Agents get a pooled budget across sessions (entity/project/process/session
  4-field scope)
- Consumption receipts are SHA-256 hashed and attributed to the pool
- No blockchain/zk infrastructure required — purely local accounting
- The pool enforces a hard cap per window, preventing spend-correlation
  attacks where an observer links high-spend events to a specific agent

### 4. Local LLM Prompt Rewriting → Deterministic Redaction Diode

**Their approach:** A local LLM rewrites outbound prompts to strip
identifying information before sending to external APIs.

**ThumbGate's approach:** `buildJudgeSafeRequestView` performs
**deterministic, pattern-based redaction** — which is faster and more
reliable than an LLM rewrite:

```javascript
// Credential-shaped headers → [REDACTED]
if (lower === 'authorization' || lower.includes('api-key') || ...) {
  headers[k] = '[REDACTED]';
}
// URL credentials stripped
if (/https?:\/\/[^/@\s]+:[^/@\s]+@/i.test(url)) return true;
// Body scanned for credential patterns
if (/\b(authorization|x-api-key|hf_tok)\b/i.test(body) && /bearer|hf_|sk-|ghp_/i.test(body)) {
  return true; // deny
}
// Size caps prevent payload fingerprinting
headers: capped at 4KB, body: capped at 16KB
```

**Improvement:** Add a `promptScrub` mode that applies template-based
rewriting to outbound HTTP bodies — not an LLM, but deterministic rules that:
1. Replace project names and file paths with placeholders
2. Truncate large payloads to the budget cap
3. Strip session IDs and principal identifiers before egress

## Why This Is Better Than Tor + LLM Rewriting

| Property | Paranoid Mode (Tor + LLM) | ThumbGate FORMAT Steal |
|---|---|---|
| Decision latency | Network RTT + LLM inference (~100ms+) | <5ms deterministic CPU |
| Reliability | Depends on Tor circuit availability | Host-local, 100% deterministic |
| Cost | Tor relay bandwidth + LLM tokens | $0.00 (local CPU only) |
| Secret safety | LLM rewrite can leak context | Pattern-based, never sees full content |
| Auditability | Tor exit nodes obscure audit trail | Full SHA-256 receipt trail |

## Implementation: Egress Policy Extension

Add a `paranoidMode` profile to `agent-egress-policy.js`:

```javascript
// New policy mode: batch + phantom + scrub
{ mode: 'paranoid', batchEgress: true, phantomAudit: true, promptScrub: true }
```

- `batchEgress`: Queue non-critical egress into randomized time windows
- `phantomAudit`: Log deny decisions as `OBSERVE` entries with timing jitter
- `promptScrub`: Apply deterministic template rewriting to request bodies

Slash: `/paranoid-mode-honesty-not-clone`
