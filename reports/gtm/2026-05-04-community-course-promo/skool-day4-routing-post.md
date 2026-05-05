# Skool — Day 4 Routing Post (Diagnostic vs Sprint vs Pro)

Generated: 2026-05-05

Purpose: a paste-ready Skool post that routes high-intent members into the right next step without unverified claims.

Guardrails:
- Keep all offers/pricing aligned with `docs/COMMERCIAL_TRUTH.md`.
- Only describe the Diagnostic as “available” when `THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL` is configured.
- Use `https://thumbgate-production.up.railway.app` as the canonical CTA base unless `thumbgate.ai` redirects are verified.

## Version A (recommended) — paste as a Skool post

Title: Which path is right: Pro vs Sprint vs Diagnostic?

Body:

If you’re here because your AI agent keeps repeating the same failure, here’s the clean decision tree.

### 1) Choose Pro (self-serve) if:
- You want to install once and start blocking repeats
- You’re okay implementing the gates yourself
- Your workflow is annoying but not “rollback-risk” urgent

Start with the setup guide:
https://thumbgate-production.up.railway.app/guide

If you want the paid self-serve lane:
Pro ($19/mo or $149/yr): https://thumbgate-production.up.railway.app/checkout/pro

### 2) Choose the Sprint (done-with-you) if:
- One workflow failure is blocking a rollout
- The failure has real blast radius (deploys, credentials, data loss, broken merges)
- You want a proof-backed hardening pass end-to-end

Workflow Hardening Sprint ($1500) intake:
https://thumbgate-production.up.railway.app/#workflow-sprint-intake

### 3) Choose the Diagnostic (routing call) if:
- You’re unsure whether this is a “Sprint” problem or a “Pro + checklist” problem
- You want a time-boxed mapping + decision

Workflow Hardening Diagnostic ($499): available on request (I only share the hosted checkout link when it is configured in runtime).

Reply with:
1) Agent/tool
2) The repeated mistake
3) What should happen instead
4) Why it matters (time lost / rollback risk / user impact)
