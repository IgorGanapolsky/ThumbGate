---
'thumbgate': patch
---

Fix mailer sender-DNS regex to match Resend's actual SES MX host (`amazonses.com`, not `amazonaws.com`), and add granular unit tests for `hasResendSenderDns`, `resolveSenderAddress`, `recordsHaveResendDns`, and the 10-minute `senderDnsCache` TTL. The regex bug meant the positive branch of sender-domain verification never matched in production — every send through a custom domain fell back to `onboarding@resend.dev` even after DNS was correctly configured.
