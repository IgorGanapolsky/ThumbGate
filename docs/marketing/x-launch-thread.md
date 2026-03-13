# X/Twitter Launch Thread

## Posting Notes
- Best times: Tue-Thu 8-10am PT
- Cross-post highlights to LinkedIn
- Reply to your own thread to boost engagement

---

**Tweet 1 (Hook)**
Claude Code is incredible but it has one fatal flaw: it forgets everything between sessions.

Same bugs. Same wrong approaches. Same apologies.

I spent 6 months building a fix. Here's what I learned:

**Tweet 2 (What it does)**
mcp-memory-gateway is an MCP server that gives your AI agent persistent memory.

It captures your feedback, auto-generates prevention rules, and physically blocks your agent from repeating known mistakes.

**Tweet 3 (How it works)**
The loop:

1. You give thumbs up/down with context
2. Repeated failures become prevention rules
3. Rules become pre-action gates
4. Gates block the agent BEFORE it makes the mistake

Your agent builds an immune system from your corrections.

**Tweet 4 (The tech)**
Under the hood:

- Thompson Sampling decides which gates fire (exploration vs exploitation)
- DPO/KTO export pairs for fine-tuning from your history
- LanceDB vector store for semantic retrieval
- ONNX embeddings, all local, no cloud required

**Tweet 5 (Install)**
Try it in 30 seconds:

npx mcp-memory-gateway serve

Add it to your Claude Code MCP config. Done.

Works with Codex, Gemini CLI, and Amp too.

**Tweet 6 (Differentiation)**
There are other memory MCP servers (Mem0, Zep, official reference).

None of them are MCP-native AND have RLHF feedback loops. None generate prevention rules. None have pre-action gates.

This is the only one that learns from your corrections.

**Tweet 7 (Proof)**
Engineering proof, not marketing claims:

- 314 tests, 0 failures
- 12 machine-readable proof reports
- 82% code coverage
- 5 platform adapters
- Built on $0 budget

Every claim is backed by evidence in the repo.

**Tweet 8 (The ask)**
Free and open source (MIT). Install and use locally forever.

$29/mo Pro for teams: hosted dashboard, auto-gate promotion, unlimited gates, multi-repo sync.

https://github.com/IgorGanapolsky/mcp-memory-gateway

**Tweet 9 (Engagement)**
What's the most annoying mistake your AI coding agent keeps repeating?

Reply and I'll show you how to write a prevention gate for it.
