---
"thumbgate": minor
---

feat(newsletter): send welcome email via Resend on subscription

New subscribers to the ThumbGate newsletter now receive an immediate welcome email with the "one AI mistake prevented per email" framing and a CTA to thumbgate.ai/pro.

The `/api/newsletter` endpoint fires the send in the background (Promise-then pattern) so the HTTP response stays fast and never fails on mailer errors. Missing RESEND_API_KEY degrades gracefully to a logged warning; the subscriber is still recorded.
