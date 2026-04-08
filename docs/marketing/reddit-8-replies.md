# Reddit Reply Comments for r/ClaudeCode Threads

Guidelines:
- Reply only when the comment is adding real signal or asking a real question.
- Start by engaging the exact point they made.
- Do not paste links, install commands, pricing, or stack details unless they explicitly ask.
- If the best move is silence, stay silent.
- If disclosure matters, keep it to one sentence after the useful reply.

## 1. "Claude forgets everything between sessions"

Yeah, that 10-30 minute re-onboarding tax every session is brutal. What helped most for me was moving the accepted and rejected patterns outside the session window entirely. Once the "don't do this again" decisions survive compaction, the next session stops feeling like a reset.

## 2. "WebSocket failed 3x, agent rebuilt it anyway after compaction"

This one hurts. Compaction silently kills the decision log and Claude has no idea it forgot. The only thing that really stuck for me was persisting the rejected approach itself, not the whole conversation, so "do not rebuild the WebSocket path" survives the next session.

## 3. "Claude claims fix is done, actually reverted correct code"

The phantom revert is infuriating because Claude is so confident about it. What helped for me was separating "did the work" from "proved the work" and treating those as different steps. Once the agent has to pass the same proof step every time, that revert-and-declare-victory loop shows up much faster.

## 4. "Plans lost after compacting context"

Compaction eating approved plans is the silent productivity killer. What helped me was treating approved plans as durable constraints instead of hoping the model keeps them in context. Once the plan survives outside the session, deviations stop looking like "fresh ideas" and start looking like obvious regressions.

## 5. "CLAUDE.md not followed ~50% of sessions"

50% compliance on CLAUDE.md tracks with my experience too. Once instructions compete with everything else in context, they stop behaving like rules and start behaving like suggestions. The only durable fix I have seen is moving the important constraints somewhere the next session cannot casually forget them.

## 6. "I lost 3 hours of Claude Code work to compaction"

Three hours lost to compaction is brutal. The worst part is not even the loss itself, it is the false confidence afterward. Once I started persisting the important good and bad decisions outside the chat, compaction stopped wiping out the parts that actually mattered.

## 7. "Sessions waste 40-60% tokens on trial-and-error"

That 40-60% token waste on re-learning is real. The discovery tax is what makes the tool feel smart in-session and dumb across sessions. Persisting the already-rejected moves is the only thing I have found that materially cuts that waste.

## 8. "SQLite MCP memory server comparison"

Good thread. I think the missing distinction is memory versus enforcement. Remembering that force-push is bad is useful, but it still leaves the model free to do it again. The workflows that felt durable for me were the ones where rejected actions became actual constraints instead of just recall.
