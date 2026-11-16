---
"thumbgate": patch
---

Status line thumbs now count only feedback a person gave, for the project the line is shown in, and the line says so ("this project"). Before, it summed every project's store and counted automated and history-scraped entries, which showed 45 up and 27 down in a project with one real thumb. `capture_feedback` over MCP now records a human origin (callers can still pass `automated` or `imported`), and status line thumb clicks carry their project. The npm file-count ceiling goes from 688 to 690 for the two new scripts the status line runs (`statusline-human-counts.js`, `human-feedback.js`).
