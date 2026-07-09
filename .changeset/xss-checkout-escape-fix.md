---
thumbgate: patch
---

Security: complete HTML-attribute escaping to close reflected XSS (CodeQL js/reflected-xss #252). `escapeHtmlAttribute()` now escapes single quotes and backticks in addition to `& " < >`, so a `?email` search param reflected into the checkout page's `value="..."` attribute can no longer break out of the attribute context (and CodeQL recognizes it as a full sanitizer). Adds `tests/xss-checkout-escape.test.js`.
