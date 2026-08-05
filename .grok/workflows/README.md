# Grok high-ROI workflows (Igor)

Docs: [Workflows in Grok Build](https://x.ai/news/workflows) — plan → fan out parallel agents → adversarial verify → one report. Progress under `/workflows`. Budget default 128 agents.

Installed under `~/.grok/workflows/` (global). Mirror into project `.grok/workflows/` when a workflow is product-specific.

## Pattern (from xAI)

| Phase | Job |
|-------|-----|
| **Context / Inventory** | One scout, clean focused schema |
| **Review / Lanes** | `parallel()` specialists, independent contexts |
| **Verify** | Adversarial recheck — drop unverified claims |
| **Synthesize** | Ranked board + markdown scratch report |

Hard rules shared across workflows: **read-only by default**, evidence-backed findings, no silent “done”, no send/email/spend.

## Workflows

| Name | Purpose | Invoke |
|------|---------|--------|
| `linear-top10-triage` | Vault + Linear + Resume queue → top-10 actions | `/linear-top10-triage` |
| `resume-ready-to-submit-package` | RTS package audit + apply order | `/resume-ready-to-submit-package` |
| `pr-adversarial-review` | Multi-specialist PR review + merge readiness | `/pr-adversarial-review` |
| `thumbgate-enforcement-audit` | Live wall + match surfaces + prose-gate census | `/thumbgate-enforcement-audit` |

## Args

| Workflow | Args |
|----------|------|
| linear-top10-triage | `{ "smoke": true }`, `{ "focus": "..." }` |
| resume-ready-to-submit-package | `{ "smoke": true }`, `{ "company": "UKG" }` |
| pr-adversarial-review | `{ "pr": "3219" }`, `{ "url": "https://github.com/…/pull/3219" }`, `{ "smoke": true }` |
| thumbgate-enforcement-audit | `{ "project": "/path/to/Resume" }`, `{ "smoke": true }` |

Smoke = one lane (cheap). Full = specialists + verifiers.

## Coding system improvements these enable

1. **Never merge on one-brain review** — use `/pr-adversarial-review` before `/trunk merge`.
2. **Never claim enforcement works without audit** — `/thumbgate-enforcement-audit` after hook/gate changes.
3. **Session start** — `/linear-top10-triage` instead of re-deriving multi-agent state by hand.
4. **Resume apply** — rank packages with `/resume-ready-to-submit-package` then execute via main agent.

## Safety

| NEVER | ALWAYS |
|-------|--------|
| Claim/done Linear from inside workflow | Recommend only |
| Merge / approve / send mail / spend | Synthetic probes only |
| Treat absence of log lines as pass | Live deny/allow matrix |
| Overwrite other agents' vault state | One-writer-per-file |

## ROI thesis

| Old | New (workflows) |
|-----|-----------------|
| Serial single-agent PR skim | Parallel correctness/security/tests/claims + verify |
| “Gates look active” from dashboard | Probe matrix + lastFiredAt census + inert prose detect |
| Re-explain coord every session | `/linear-top10-triage` slash command |

Complements (does not replace): Obsidian vault, Linear bridge, Herdr, PreToolUse guards, ThumbGate `gate-check`.
