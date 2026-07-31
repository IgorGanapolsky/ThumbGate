---
'thumbgate': patch
---

Keep ordinary init and quick-start runs deterministic by configuring only the explicitly selected integration, avoiding package-registry probes in source checkouts, replacing shell-based executable discovery, and requiring explicit opt-in before invoking optional external agent plugin managers with argument-safe, bounded execution.
