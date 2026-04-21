---
"thumbgate": minor
---

Add one-shot integration bridge for [agent-architect-kit](https://github.com/ultrathink-art/agent-architect-kit) per-role memory directories.

`scripts/integrations/architect-kit-memory-bridge.js` parses `agents/state/memory/<role>.md` files (Mistakes / Learnings / Stakeholder Feedback / Session Log sections) and emits ThumbGate feedback entries: Mistakes → thumbs-down with `whatWentWrong`, Learnings → thumbs-up with `whatWorked`, Stakeholder Feedback polarity-flipped on negative keywords, Session Log skipped. Every entry tagged `architect-kit` + `role:<name>` + source section for auditable rollback. Ingested entries flow through the standard lesson-DB / Thompson Sampling / prevention-rule pipeline, so architect-kit users can promote their markdown memory into PreToolUse-enforced hooks.

CLI: `npm run integrations:architect-kit:import -- --dir=<path> [--role=<name>] [--dry-run] [--json]`.

Also harvests six high-ROI patterns from architect-kit's annotated CLAUDE.md into a new *Hard-Won Lessons* section (fix-on-fix signal, rapid-push batching, ZERO/ALWAYS behavioral thresholds, memory-instructions coupling, post-deploy-gate nuance, `require.main === module` path-resolve fix) each with an explicit `# WHY` tying to a specific incident class.

Test coverage: 16 dependency-injected unit tests pinned into `npm test` via the test-suite parity guard.
