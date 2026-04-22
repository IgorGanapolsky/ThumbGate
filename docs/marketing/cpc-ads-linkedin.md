# LinkedIn Post: ChatGPT CPC Ads as a Price Signal

**Body:**
OpenAI turned on CPC ads inside ChatGPT yesterday. Advertisers bid $3–$5 per click. The CPM rate they launched in February collapsed from $60 to $25 in ten weeks, and a leaked StackAdapt deck shows the real floor is closer to $15.

For the first time, a single LLM turn has an explicit dollar price on the open market.

Your coding agent has had one for months. It just shows up on the Anthropic or OpenAI invoice at the end of the month, not as a line item with a story.

The ones that fund that line item:
- the same failing tool call retried three times in one session
- a file regenerated from scratch because the agent lost the edit it just made
- a mistake from last session repeating today because the context window reset

None of these are exotic. They are the ordinary cost of an agent without persistent correction. The fix is not a longer system prompt. System prompts are suggestions. Agents ignore suggestions under complex reasoning chains.

The fix is enforcement at the tool-call boundary. Pre-action gates fire before the agent executes a tool, check whether the pattern has been flagged as bad, and block it before the API round-trip happens. Fix it once, your bill stops seeing it.

ThumbGate does this for Claude Code, Cursor, and Codex. Local-first lesson DB, PreToolUse hooks, Thompson Sampling on which gates are worth keeping. Open source.

OpenAI priced attention at $3–$5 a click. Price your agent's repeat mistakes before someone else does.

thumbgate.ai
