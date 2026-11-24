---
"thumbgate": patch
---

secret-exfiltration: reading a credentials file such as `.env` now gets read-specific advice (load values at runtime, or ask the user) instead of inline-literal advice, and deny messages advertise only `~/.thumbgate/secrets` and `~/.config/thumbgate` (`~/.resume_secrets` stays allowed for existing installs).
