---
"thumbgate": minor
---

Send a branded welcome email with the license key and activation command whenever
`checkout.session.completed` fires. Uses Resend (`RESEND_API_KEY`) with
`onboarding@resend.dev` as the default sender so the webhook keeps working
without a verified domain. If the key is unset, the webhook logs a warning and
continues — the license key is always persisted regardless of email state.
