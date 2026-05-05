# Skool — 7-Day Launch Plan (ThumbGate Operator Lab)

Generated: 2026-05-05

Purpose: a minimal, approval-ready 7-day plan to (1) satisfy Skool discovery thresholds, (2) trigger authentic member posts, and (3) route qualified members into the Diagnostic, Sprint, or Pro — without spam or unverified claims.

Guardrails:
- Do not execute any step without explicit operator approval (no autoposts, no uploads, no invites in this automation run).
- Keep all offers/pricing aligned with `docs/COMMERCIAL_TRUTH.md`.
- Only describe the Diagnostic as “available” when `THUMBGATE_SPRINT_DIAGNOSTIC_CHECKOUT_URL` is configured.
- Use `https://thumbgate-production.up.railway.app` as the canonical CTA base unless `thumbgate.ai` redirects are verified.

## Day 0 (setup day) — discovery minimum viable launch

Approval-required checklist:
- Upload cover: `docs/marketing/assets/thumbgate-skool-cover-1084x576.png`
- Upload icon: `docs/marketing/assets/thumbgate-skool-icon-128x128.png`
- Upload About media (optional): follow `skool-media-upload-steps.md`
- Publish + pin “Start Here”: `skool-start-here-post.md` (Version A)
- Publish the first post: `skool-first-post.md` (Version A)
- Invite first 10–20: manual, targeted (no blasts)

## Day 1 — “post your repeated mistake” (member activation)

Post: prompt members to reply with the failure template (reuse `skool-first-post.md` Version A, but ask for 1 specific example).
CTA (optional): `https://thumbgate-production.up.railway.app/guide`
Operator task after replies: pick 1–2 replies and respond with a concrete “Pre-Action Gate” suggestion + one proof step.

## Day 2 — “one gate teardown” (proof-driven authority)

Post: a short teardown of one common failure (context drift, unsafe deploy, broken merge, credentials).
Include:
- the failure
- the gate (what it blocks)
- the proof step (how to verify it prevented the repeat)
CTA (optional): Sprint intake `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`

## Day 3 — “workflow template” (reduce friction)

Post: a copy-pastable workflow submission template (same as Start Here, slightly shorter).
CTA (optional): guide `https://thumbgate-production.up.railway.app/guide`

## Day 4 — “Diagnostic vs Sprint vs Pro” (routing clarity)

Post: a simple decision tree:
- If you want self-serve first → guide + Pro
- If you have one repeated failure blocking rollout → Sprint
- If you are unsure which path is correct → Diagnostic (only if configured)
CTAs:
- Sprint intake: `https://thumbgate-production.up.railway.app/#workflow-sprint-intake`
- Pro checkout: `https://thumbgate-production.up.railway.app/checkout/pro`

## Day 5 — “proof pack” (only after pain is confirmed)

Post: do not lead with proof links unless members have already posted pain. If there are active threads, reply in-thread with:
- `docs/VERIFICATION_EVIDENCE.md` (GitHub link)
- proof reports (GitHub links)

## Day 6 — “wins + next asks” (engagement)

Post: summarize 1–3 anonymized patterns seen (no sensitive details) and ask for the next workflows.

## Day 7 — “Classroom nudge” (course surfacing)

Action: publish the first Classroom lesson (or create a draft) based on `skool-classroom-course-draft.md`.
Post: “Classroom is live: 1 workflow hardening teardown” (keep it short, link within Skool).

