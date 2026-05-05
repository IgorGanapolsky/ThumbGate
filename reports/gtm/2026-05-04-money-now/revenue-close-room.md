# Revenue Close Room

Updated: 2026-05-05

Use this as the follow-up script bank once a lead replies. Do not send proof links or checkout links until the buyer confirms pain and a concrete workflow.

## Live Close Path

Verified with `npm run revenue:status` on 2026-05-05T12:25:06.708Z:

- Today: 187 visitors, 217 page views, 28 checkout starts, 0 paid orders, $0 booked, 0 sprint leads, 16 signups.
- 30d: 6169 visitors, 5353 page views, 133 checkout starts, 4 paid orders, $149 booked, 0 sprint leads, 475 signups.
- Public runtime: healthy at version 1.16.19 with both paid Workflow Hardening checkout URLs configured.

Use this diagnosis: traffic exists; the immediate bottleneck is qualified follow-up and closing, not top-of-funnel.

Production checkout links:

- Diagnostic ($499): `https://buy.stripe.com/00w14neyUcXA5pL5e33sI0e`
- Sprint ($1500): `https://buy.stripe.com/fZu9AT76saPsg4pbCr3sI0f`

Backup duplicate links created in Stripe; do not use unless the production links fail:

- Diagnostic backup: `https://buy.stripe.com/fZu5kD76s6zccSdfSH3sI0h`
- Sprint backup: `https://buy.stripe.com/eVq6oHfCY4r42dz5e33sI0i`

## Triage (reply comes in)

Pick the lane by signal:

- **Warm / high intent**: they describe a repeating failure + mention urgency/time cost.
- **Medium intent**: they agree the problem exists, but no concrete workflow yet.
- **Low intent**: polite, vague, or "cool project" with no pain.

## 1) Pain confirmation prompt (send first)

Ask one question, then stop:

"What's the one workflow step that keeps breaking: (a) repo config/build, (b) PR review + merge, (c) deploy, (d) data/credentials, or (e) 'agent keeps doing X'?"

## 2) Workflow Hardening Diagnostic ($499)

Use when they have pain but you need scoping before a sprint:

"If you want, we can do a 45-minute Workflow Hardening Diagnostic. We'll map the workflow, identify the repeated failure, and decide whether the right next step is a 1-workflow Sprint, Pro, or nothing. If that's useful, here is the $499 diagnostic checkout: https://buy.stripe.com/00w14neyUcXA5pL5e33sI0e"

## 3) Workflow Hardening Sprint ($1500)

Use when they already have one concrete workflow and you can name the deliverable:

"Sounds like a perfect Sprint fit. In a Workflow Hardening Sprint we take one workflow and make it repeat-safe: capture the failure, turn it into a prevention rule / pre-action gate, and run a proof pass that shows it no longer repeats. If you want to do it this week, here is the $1500 Sprint checkout: https://buy.stripe.com/fZu9AT76saPsg4pbCr3sI0f"

## 4) Pro ($19/mo or $149/yr)

Use when they want self-serve first and they have a single repeated mistake:

"If you want the self-serve path first, start with the proof-backed setup guide: `https://thumbgate-production.up.railway.app/guide`. If one repeated mistake is still slowing you down after that, Pro is the clean next step ($19/mo or $149/yr). Want the Pro checkout link?"

## 5) Proof pack rule (never lead with proof)

Only after explicit pain confirmation:

"Got it - that's exactly the kind of repeat-failure ThumbGate is built for. If you want to see the engineering proof, here's the verification evidence doc: `https://github.com/IgorGanapolsky/ThumbGate/blob/main/docs/VERIFICATION_EVIDENCE.md`."
