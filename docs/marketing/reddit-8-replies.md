# Reddit Reply Comments for r/ClaudeCode Threads

Guidelines: Each reply should feel human, empathetic, and lead with the 👍/👎 concept. Keep it conversational. Don't link the repo unless someone explicitly asks.

## 1. "Claude forgets everything between sessions"

Yeah, that 10-30 minute "re-onboarding" tax every session is brutal. I dealt with this by setting up a feedback loop — literally just 👎 when Claude screws up and 👍 when it gets something right. The 👎 captures what went wrong and auto-generates a prevention rule. Next session, those rules get loaded before Claude acts, so it doesn't repeat the same mistakes. It's not perfect memory — it's more like an immune system that accumulates over time. Cuts ramp-up to under a minute now.

## 2. "WebSocket failed 3x, agent rebuilt it anyway after compaction"

This one hurts. Compaction silently kills your decision log and Claude doesn't know it forgot. I hit the same thing — agent confidently rebuilding something I'd explicitly rejected. What finally fixed it: giving a 👎 with "what went wrong" and "what to change" captured. That thumbs-down becomes a persistent rule that lives outside the context window. Even after compaction wipes the conversation, "don't rebuild the WebSocket approach" survives as a hard block. The agent can't even attempt it.

## 3. "Claude claims fix is done, actually reverted correct code"

The phantom revert is infuriating because Claude is so confident about it. "Fixed!" meanwhile it undid the actual fix. I started using a gate system for this — basically, before Claude can claim completion, it has to prove preconditions are met. Combined with 👎 on every revert-and-declare-victory, the system accumulates rules that block the pattern. It catches it reliably now because the gate fires before the claim, not after.

## 4. "Plans lost after compacting context"

Compaction eating approved plans is the silent productivity killer. You spend 20 minutes getting a solid plan, context compacts, and Claude proposes something completely different. The fix that worked for me: 👎 every time it deviates from an approved plan, with the plan context captured in the feedback. Those decisions get persisted outside the context window, so they survive compaction. It's not about memory recall — it's about enforcement.

## 5. "CLAUDE.md not followed ~50% of sessions"

50% compliance on CLAUDE.md tracks with my experience. The problem is CLAUDE.md instructions are suggestions — they compete with everything in context and lose after compaction. What made the difference: turning actual past failures into prevention rules via 👎 feedback. These aren't generic instructions, they're specific "you broke this before, here's exactly what went wrong" rules. Way more reliable than MUST/ALWAYS/NEVER in a markdown file because they fire as gates before execution, not as context that can be deprioritized.

## 6. "I lost 3 hours of Claude Code work to compaction"

Three hours lost to compaction — I feel that. The worst part is you don't realize it happened until Claude starts contradicting everything you established. I started treating every significant decision as a 👍 (reinforce this) and every mistake as a 👎 (block this). Those signals persist on disk, not in the ephemeral context window. When compaction hits, the accumulated 👍/👎 history is still there. It's not memory — it's enforcement that outlives the session.

## 7. "Sessions waste 40-60% tokens on trial-and-error"

That 40-60% token waste on re-learning is real. Every session pays the "discovery tax" for failures you already solved last week. The pattern that eliminated it for me: consistent 👎 on repeated failures. Each thumbs-down generates a prevention rule that gets injected before the agent acts in future sessions. So if Claude already learned "don't use fs.writeFileSync for large files" three sessions ago, that rule is there before it even starts. Tokens go toward new work instead of re-discovering old failures.

## 8. "SQLite MCP memory server comparison"

Good thread, but I'd push back on framing this as just a memory comparison. Most MCP memory servers are key-value or vector stores for conversation recall. The piece they're missing is enforcement. Remembering that force-push is bad doesn't prevent the agent from doing it — you need a gate that physically blocks the action before execution. The 👎 → prevention rule → gate pipeline is what makes the difference. Memory is table stakes. Enforcement is the actual problem.
