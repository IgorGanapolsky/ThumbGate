# X/Twitter Launch Thread — mcp-memory-gateway

> Draft thread. Do not post without review.

---

## Tweet 1 (Hook)

I got tired of my AI agent making the same mistakes across sessions. So I built an MCP server that captures feedback and blocks repeated failures.

mcp-memory-gateway — open source, works with Claude/Codex/Gemini/Amp/Cursor.

#MCP #AIAgents #DevTools

---

## Tweet 2 (Solution)

One command. Zero config.

```
npx mcp-memory-gateway
```

It's an MCP server that plugs into Claude, Codex, Gemini, Amp, or Cursor.

Captures feedback. Blocks repeated mistakes. Exports DPO training pairs.

Listed on the official MCP Registry. MIT licensed.

#MCP #RLHF

---

## Tweet 3 (How it works)

The loop:

1. Capture — thumbs up/down with context
2. Validate — schema-checked, timestamped
3. Learn — promotes patterns to memory
4. Prevent — generates guardrails from failures
5. Export — DPO pairs ready for fine-tuning

All local. All auditable. All yours.

#RLHF #DPO

---

## Tweet 4 (Engineering proof)

4 AI agents — Claude, Codex, Amp, Gemini — independently evaluated this in the same repo.

All four validated it works.

No orchestration. No prompting to agree. They each ran the tests and passed.

That's engineering validation, not customer proof.

#AIAgents

---

## Tweet 5 (DPO angle)

Most RLHF tools stop at "collect feedback."

This one exports real DPO training pairs: chosen vs rejected completions with full context.

Feed them into your fine-tuning pipeline. Make your agent actually improve, not just apologize better.

#DPO #RLHF

---

## Tweet 6 (Install + links)

Get started:

```
npm install mcp-memory-gateway
```

GitHub: github.com/IgorGanapolsky/mcp-memory-gateway
npm: npmjs.com/package/mcp-memory-gateway
Pro ($49/mo): https://iganapolsky.gumroad.com/l/tjovof
Hosted demo: rlhf-feedback-loop-production.up.railway.app

#DevTools #MCP

---

## Tweet 7 (CTA)

MIT licensed. One npm package. No infra to manage.

If you're building with AI coding agents and want them to stop repeating mistakes, try it. Feedback welcome on GitHub.

@AnthropicAI @OpenAI @GoogleDeepMind @llama_index

#MCP #RLHF #AIAgents #DPO #DevTools
