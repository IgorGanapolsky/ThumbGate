---
"thumbgate": patch
---

Add a paid-user `Log in` navbar drawer on `public/index.html` that exchanges a Pro or operator API key once via `/v1/auth/session` for an opaque `HttpOnly; Secure; SameSite=Lax` session cookie and restores `/dashboard` sessions from that cookie without browser storage.
