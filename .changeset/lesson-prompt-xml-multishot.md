---
"thumbgate": patch
---

feat(lesson-inference): XML-tagged Claude prompt + 5 multishot exemplars

Applies Anthropic's prompt-engineering playbook (ref: [Prompt Engineering course](https://anthropic.skilljar.com/claude-with-the-anthropic-api/287745)) to the LLM lesson-extraction prompt in `scripts/lesson-inference.js`. This is PR 2 of the high-ROI eval sequence (PR 1 was gate-eval seed expansion).

**Why this prompt specifically:**

`inferStructuredLessonLLM` calls Claude with a strict-JSON output contract. It hits exactly the three failure modes that XML tags + multishot exemplars are designed to fix:

1. Model occasionally wraps JSON in code fences despite instructions → tightened with explicit `<guidelines>` clause + `no code fences` prohibition.
2. Plain-text `Signal: positive` / `Conversation:` headers compete with the conversation content itself for the model's attention → replaced with scoped `<signal>`, `<user_context>`, `<conversation_window>` tags.
3. Schema description without exemplars means the model has to synthesize shape from an abstract spec → replaced with 5 concrete `<example>` blocks drawn from real ThumbGate incident classes.

**What changed:**

- `LLM_LESSON_SYSTEM_PROMPT` rebuilt with `<task>`, `<output_schema>`, `<guidelines>`, `<examples>` section tags. Schema enum values moved to explicit pipe-delimited unions (`<debugging|implementation|question|error-report|constraint>`).
- New `LLM_LESSON_MULTISHOT_EXAMPLES` constant — 5 exemplars covering: Edit-before-Read, force-push-to-main, deploy-verification, mock-to-live-in-tests, regression-test-pinning. Each exemplar is a `{signal, conversationWindow, output}` triple; `output` is the exact JSON the model should emit.
- New `renderMultishotExamplesForPrompt()` renders the exemplar set as `<example><signal>…</signal><conversation_window>…</conversation_window><output>{…}</output></example>` blocks, then inlines them into the system prompt.
- New `buildLessonUserPrompt({signal, context, windowText})` wraps the user-side content in `<signal>`, `<user_context>` (optional), `<conversation_window>` tags. `inferStructuredLessonLLM` now calls this helper, so the caller's `windowText` never competes with header text for attention.
- Signal normalization preserved: `positive`/`up` → `positive`; `negative`/`down` → `negative`.

**New regression tests (`tests/lesson-prompt-shape.test.js`, 9 cases):**

- Every XML section tag (`<task>`, `<output_schema>`, `<guidelines>`, `<examples>`) is balanced and correctly ordered.
- Every schema enum value (`ALLOWED_TRIGGER_TYPES`, `ALLOWED_ACTION_TYPES`, `ALLOWED_SCOPES`) appears in the prompt — accidental removal surfaces instantly.
- Multishot exemplar count pinned at 5; must cover both `positive` and `negative` signals.
- Every exemplar `output` is schema-valid JSON (trigger.type, action.type, scope enum checks; confidence in [0,1]; non-empty string tags).
- Rendered `<example>` block extracts cleanly via a naive regex parser and round-trips through JSON.parse back to the source exemplar object.
- `buildLessonUserPrompt` emits expected XML structure, normalizes signals, omits `<user_context>` when not provided.
- System prompt contains explicit "no code fences / no prose" prohibitions.

**What this does NOT change:**

- No behavior change in `createLesson`, `extractTrigger`, `extractAction`, `extractToolCalls`, or any of the deterministic lesson-building pipeline. Those stay regex-driven and tested by the existing 30-case `tests/lesson-inference.test.js` suite (still green).
- No measurement of the actual Claude-response quality improvement. That requires a lesson-eval suite analogous to `config/evals/agent-safety-eval.json` plus live API calls — queued as follow-up (`feat/lesson-eval-suite`). Today's PR ships the prompt upgrade and the shape-regression guard; quality measurement is the next loop.

**Follow-up (not in this PR):**

- `feat/lesson-eval-suite` — curate 30+ (signal, conversation_window, expected_lesson) tuples from `.claude/memory/feedback/lessons-index.jsonl` and wire into `scripts/gate-eval.js` as a live A/B suite that compares the old prompt vs the new prompt on the same conversation windows.
