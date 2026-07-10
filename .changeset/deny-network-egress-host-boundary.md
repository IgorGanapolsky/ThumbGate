---
"thumbgate": patch
---

Fix `deny-network-egress` matching every `curl` and `wget` regardless of destination. The pattern led with bare `curl\s|wget\s` alternatives, so the allowlist was never consulted for them and loopback probes such as `curl http://localhost:9222` warned on every invocation, recording false-positive negative-feedback events. Detection now keys on the destination, with loopback (`localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`) added to the allowlist. Each allowlist entry is also anchored to a hostname boundary, closing a bypass where `open https://github.com.evil.com/x` was silently exempt because an allowlisted host matched as a bare prefix.
