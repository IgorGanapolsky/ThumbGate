---
"thumbgate": patch
---

Fail confirmed revenue email dispatches when Resend rejects the send. This prevents revenue workflows from recording a successful run when the provider returns an API error such as an unverified sender domain.
