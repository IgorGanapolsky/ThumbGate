# Paranoid Mode (FORMAT steal, not clone)

> Vitalik Buterin's "paranoid mode" for AI agents: Tor routing, cover traffic,
> zkAPI anonymous payments, local LLM prompt rewriting. FORMAT only — do NOT
> install Tor, zkAPI, or route production traffic through anonymity networks
> unless explicitly configured by the operator.

## The Four Pillars (and how ThumbGate steals them)

### 1. Tor Routing → PreToolUse Egress Diode

**Their idea:** Route all AI agent outbound traffic through Tor to prevent
network-level correlation and destination fingerprinting.

**ThumbGate's FORMAT steal:** ThumbGate's `agent-egress-policy.js` already
implements a deterministic PreToolUse firewall that classifies every outbound
HTTP/HTTPS request at the tool layer — before the request leaves the host.
Instead of Tor's circuit-based anonymity, ThumbGate implements:

- **Static deny-list first** (CrabTrap invariant: deny always wins over allow)
- **Origin-boundary prefix matching** — prevents `evil.com/api.example.com`
  suffix tricks (the Tor equivalent of preventing DNS rebinding)
- **SSRF fail-closed** — private ranges, link-local, cloud metadata endpoints
- **Bridge host classification** — allowlisted registries/proxies are hops, not
  trust boundaries (GitLab 2026-09 FORMAT)

**Improvement opportunity:** Add a `transportIsolation` mode where requests
to non-essential external hosts are deferred or batched into a single
anonymized envelope, preventing per-request fingerprinting without requiring
a Tor daemon.

### 2. Cover Traffic → Structured Judgement Delay

**Their idea:** Mask real agent requests with decoy traffic so an observer
can't distinguish real intent from noise.

**ThumbGate's FORMAT steal:** ThumbGate's `buildJudgeSafeRequestView` already
creates a normalized, capped, redacted JSON representation of any outbound
request. Instead of generating fake traffic, ThumbGate can:

- **Batch non-critical egress** into time-windowed envelopes
- **Inject dummy judgement entries** in the audit log to prevent timing
  analysis of which requests were allowed vs denied
- **Stagger async egress** with random sub-5ms delays (within token-shunt
  budget) to prevent request-rate fingerprinting

**Improvement opportunity:** Add a `coverTraffic` mode that emits phantom
audit-trail entries for denied requests, making it harder to correlate
which tools the agent actually attempted.

### 3. zkAPI / Anonymous Payments → Token Budget Shunt

**Their idea:** Use zero-knowledge proofs for anonymous API payments so
providers can't track which agent is consuming which resources.

**ThumbGate's FORMAT steal:** ThumbGate's `token-shunt-honesty-not-clone`
skill already enforces strict token budgets at the PreToolUse layer:

- Unconditional Read above 350 lines → blocked
- Bare `cat` of large files → blocked
- `npx -y` → blocked
- All under 5ms deterministic CPU decision (no LLM tokens)

**Improvement opportunity:** Add a **token budget pool** abstraction where
agents have a pooled budget across sessions, with SHA-256 receipts for
consumption. This mirrors zkAPI's anonymous consumption without requiring
blockchain infrastructure. The pool is local-first, attributed to the
entity/project/process/session 4-field scope.

### 4. Local LLM Prompt Rewriting → Deterministic Redaction Diode

**Their idea:** Use a local LLM to rewrite prompts before sending to
external APIs, stripping identifying information.

**ThumbGate's FORMAT steal:** ThumbGate's `buildJudgeSafeRequestView`
already performs deterministic, injection-safe redaction:

```javascript
// Headers capped at 4KB; body at 16KB with truncation markers
headers[k] = '[REDACTED]'  // credential-shaped keys
bodySummary = raw.slice(0, bodyCap)  // size-capped
```

Instead of a local LLM (which adds latency and can itself be prompted to
leak), ThumbGate uses:

- **Pattern-based secret detection** (Authorization, Cookie, x-api-key,
  hf_tok, ghp_, sk-, bearer tokens)
- **URL credential stripping** (`/https?:\/\/[^/@]+:[^/@]+@/i`)
- **Body scanning** for credential patterns
- **Structured JSON view** — never raw string interpolation

**Improvement opportunity:** Add a `promptScrub` mode that rewrites outbound
prompt bodies through a deterministic template engine (not an LLM) before
egress, removing project-specific identifiers, session IDs, and file paths.

## Competitive Positioning

| Paranoid Mode Layer | Their Approach | ThumbGate FORMAT Steal |
|---|---|---|
| Transport | Tor circuit routing | PreToolUse egress classification (deny > allow > observe) |
| Traffic masking | Cover traffic / decoy requests | Batched egress + phantom audit entries |
| Payments | zkAPI anonymous billing | Local token budget pool + SHA-256 receipts |
| Prompt safety | Local LLM rewriting | Deterministic secret redaction diode |

## Implementation Roadmap

1. **`paranoid-mode` egress profile** in `agent-egress-policy.js`:
   - When enabled, all non-essential egress is deferred to batched windows
   - Phantom audit entries injected for denied requests
   - Transport isolation via static rules (no Tor dependency)

2. **Token budget pools** (`.thumbgate/token-budgets/`):
   - Entity/project/process/session-scoped budget
   - Consumption receipts via SHA-256
   - Local-first, no blockchain

3. **Prompt scrubbing diode**:
   - Deterministic template-based rewriting (not LLM)
   - Applied to outbound HTTP bodies and MCP tool parameters
   - Configurable scrubbing patterns per agent identity

## Rules

- Never install Tor, zkAPI, or local LLM inference engines from this skill.
- All decisions must be <0.5ms deterministic CPU (no LLM judge on hot path).
- Token budgets are local-first; never depend on blockchain or external
  payment providers.
- Prompt rewriting is template-based, not LLM-based, to prevent the rewriter
  itself from leaking context.

Slash: `/paranoid-mode-honesty-not-clone`
