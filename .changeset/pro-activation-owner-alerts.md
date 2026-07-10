---
"thumbgate": patch
---

Email the operator when a customer activates ThumbGate Pro locally. The CLI now pings the hosted activation endpoint with the Pro key only as Bearer auth, while the hosted server validates the billing key and sends a secret-safe owner alert containing only a key fingerprint and activation metadata.
