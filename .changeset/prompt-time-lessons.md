---
"thumbgate": minor
---

Lessons now show up before the first tool call, not only after a miss. When a prompt is not a thumbs up or down, the UserPromptSubmit hook picks the top three stored lessons that match the prompt's topic (a tag match counts double, and one stray shared word is not enough) and prints them as context. Each injection is logged to lesson-injections.jsonl with the session, the prompt hash and the lesson id, which is the record the repeat-miss measure reads.
