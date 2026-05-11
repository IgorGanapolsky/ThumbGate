---
"thumbgate": patch
---

Hide visible-text leak on thumbgate.ai: analytics CTA IDs (`hero_workflow_sprint_diagnostic_checkout`, `workflow_sprint_checkout_started`, etc.) and raw HTML attribute names (`id=`, `name=`, `data-team-intake-form`) were rendering as plain `<p>` body paragraphs. Moved into a `hidden` block — strings stay in HTML for regex tests, nothing renders to visitors.
