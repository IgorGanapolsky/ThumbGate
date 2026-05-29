---
"thumbgate": patch
---

site: /ai-malpractice-prevention — copy-email fallback for the pilot CTAs

Both "Book a 25-minute pilot walkthrough" mailto: buttons now ship a paired fallback line: a copy-to-clipboard button (writes the full prefilled email — To/Subject/Body — to the system clipboard) plus the bare email address surfaced as a click-to-select span. Removes the silent conversion failure path for visitors on Gmail Web, iPhone, or any environment where mailto: doesn't open a configured mail client. Pure vanilla JS, no external dependencies.
