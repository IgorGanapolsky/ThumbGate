# Reddit Reply Comments for r/ClaudeCode Threads

## 1. "Claude forgets everything between sessions"

Yeah, that 10-30 minute "re-onboarding" tax is brutal. I hit this exact wall and ended up building a tool around it. mcp-memory-gateway has a `construct_context_pack` tool that bundles your relevant feedback history, prevention rules, and task context into a bounded retrieval pack at session start. So instead of re-explaining your architecture every time, Claude gets the distilled context it actually needs injected automatically. It's not perfect memory — it's scoped recall of what matters for the current task. Cuts my ramp-up to under a minute now. https://github.com/IgorGanapolsky/thumbgate Disclosure: I built this.

## 2. "WebSocket failed 3x, agent rebuilt it anyway after compaction"

This one hurts. Compaction silently killing your decision log is one of the worst failure modes because Claude doesn't know it forgot. I ran into the same thing — agent confidently rebuilding something I'd explicitly rejected, burning 70K tokens in the process. I built mcp-memory-gateway specifically for this. The `prevention_rules` tool captures mistakes as persistent rules that live outside the context window entirely. They get injected before Claude acts, so even after compaction wipes the conversation, "don't rebuild the WebSocket approach" survives as a hard constraint. https://github.com/IgorGanapolsky/thumbgate Disclosure: I built this.

## 3. "Claude claims fix is done, actually reverted correct code"

The phantom revert is infuriating because it's so confident about it too. "Fixed!" meanwhile `git diff` shows it undid the actual fix. I dealt with this enough that I built a gate mechanism for it. mcp-memory-gateway has `satisfy_gate` — it creates pre-action checkpoints that force Claude to prove preconditions are met before it can claim completion. So instead of trusting Claude's self-assessment, you define what "done" actually means and the gate blocks the completion claim until evidence is provided. Catches the revert-and-declare-victory pattern reliably. https://github.com/IgorGanapolsky/thumbgate Disclosure: I built this.

## 4. "Plans lost after compacting context"

Compaction eating approved plans is the silent productivity killer nobody warns you about. You spend 20 minutes getting Claude to a solid plan, context compacts, and suddenly it's proposing something completely different with zero awareness. I built mcp-memory-gateway to solve exactly this. `construct_context_pack` persists your plans and decisions outside the context window entirely. Prevention rules also survive compaction by design — they're stored in persistent feedback logs, not in-context memory. So your approved architecture decisions are there next time Claude acts, regardless of what the compactor dropped. https://github.com/IgorGanapolsky/thumbgate Disclosure: I built this.

## 5. "CLAUDE.md not followed ~50% of sessions"

50% compliance on CLAUDE.md tracks with my experience. The problem is that CLAUDE.md instructions are suggestions in the system prompt — they compete with everything else in context and lose after compaction. I built mcp-memory-gateway to make constraints enforceable rather than suggestive. `prevention_rules` injects learned constraints (from actual past failures) before Claude acts — these aren't generic instructions, they're specific "you broke this before, don't do it again" rules. And `satisfy_gate` adds hard blocks: Claude literally cannot claim done without proving the conditions you care about. Way more reliable than MUST/ALWAYS/NEVER in a markdown file. https://github.com/IgorGanapolsky/thumbgate Disclosure: I built this.

## 6. "I lost 3 hours of Claude Code work to compaction"

Three hours lost to compaction — I feel that. The worst part is you don't even realize it happened until Claude starts making decisions that contradict everything you already established. I built mcp-memory-gateway after losing similar amounts of work. `capture_feedback` logs your architectural decisions, file relationships, and in-flight work to persistent storage outside the context window. Then `construct_context_pack` retrieves the relevant subset at session start or after compaction. Your decisions survive because they're not living in Claude's ephemeral context — they're in structured feedback logs on disk. https://github.com/IgorGanapolsky/thumbgate Disclosure: I built this.

## 7. "Sessions waste 40-60% tokens on trial-and-error"

That 40-60% token waste on re-learning is real and it's the most expensive part of using Claude Code at scale. Every session pays the "discovery tax" for failures you already solved last week. I built mcp-memory-gateway to eliminate that loop. The `prevention_rules` tool accumulates rules from past mistakes into persistent storage, then injects them pre-action in future sessions. So if Claude already learned "don't use fs.writeFileSync for large files" three sessions ago, that rule is there before it even starts. Tokens go toward new work instead of re-discovering old failures. https://github.com/IgorGanapolsky/thumbgate Disclosure: I built this.

## 8. "SQLite MCP memory server comparison"

Good thread. I'd push back on framing this as just a memory storage comparison though. memory-mcp, claude-mem, memsearch — they're all basically key-value or vector stores for conversation recall. mcp-memory-gateway does something different. It's a reliability enforcement layer: prevention rules that block known mistakes before they happen, `satisfy_gate` for pre-action verification checkpoints, and structured feedback capture with provenance tracking. Memory recall is table stakes — the actual problem is Claude repeating failures and claiming completion without proof. That's what this solves. https://github.com/IgorGanapolsky/thumbgate Disclosure: I built this.
