---
"thumbgate": patch
---

Rewrite the landing-page hero lede to lead with the concrete mechanism instead of a vague benefit claim. Replaces "AI agents will always hallucinate… we make their mistakes harmless" with what actually happens — ThumbGate blocks the specific dangerous tool call (rm -rf, force-push to main, leaked key, DROP on prod) in the PreToolUse hook before the shell runs it, and a thumbs-down becomes a prevention rule that stops the agent repeating it.
