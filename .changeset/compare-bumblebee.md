---
"thumbgate": patch
---

site: head-to-head comparison page `/compare/bumblebee`

Perplexity open-sourced [Bumblebee](https://github.com/perplexityai/bumblebee) on 2026-05-23 — a read-only scanner that inventories MCP configs, editor extensions, browser extensions, and package lockfiles on developer endpoints. It is the first open-source scanner to treat MCP configuration files as a security surface.

Bumblebee answers a discovery question (what is installed). ThumbGate answers an enforcement question (what should the installed agent be allowed to do). Same supply-chain category, different halves of the answer. The two compose cleanly with zero overlap.

This page positions ThumbGate as the runtime-enforcement complement to Bumblebee's static inventory:

- 9-row side-by-side feature table covering scope, timing, coverage, blocking, output format, distribution, platforms, license, and authorship.
- Three "pick X for" sections that recommend installing both.
- Integration story: how Bumblebee's NDJSON output can seed ThumbGate's agent-manager inventory + auto-generate gates from CVE-flagged components.
- `TechArticle` + `FAQPage` schema.org markup so Perplexity / ChatGPT / Claude / Gemini can cite individual answers.
- Honest framing: credits Perplexity, links to their repo and blog post, recommends `go install` and `bumblebee self-test` alongside `npx thumbgate init`.

Strategic context: Bumblebee will get cited heavily in upcoming "AI agent safety" listicles because of Perplexity's brand authority. Riding alongside it in the same comparison content is the cheapest path to LLM-citation surface for ThumbGate, which the visibility audit confirmed is the binding constraint on inbound traffic.
