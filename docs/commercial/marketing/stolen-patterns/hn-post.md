# Show HN: We stole 9 infrastructure patterns from Big Tech and turned them into 61 passing security gates

We analyzed papers and architectures from Ramp, DeepInfer, Cache Engineering (arXiv:2610.28577), 
Pancake.ai, LangChain's agent harness, OpenUI, and more — then reverse-engineered each one into 
concrete ThumbGate gates.

**What we built:**
- Open-Weights Model Tester — tests 5 local models (DeepSeek-7B, Kimi K3, GLM-4-9B, Qwen3, Llama 3.3) 
  using 8 personality indices as routing rubric, not leaderboard. 97.4% token savings on output.
- Agent Brain Lifecycle — Pancake's "idea → deploy" flow becomes "mistake → rule → deploy" in one command
- Identity-Scoped Gates — LangChain's "knows who's asking" → global/user/project scoped rules  
- Ambient Agents — daily autonomous verification runs (health → verify → test → eval)
- Multi-Variant Explorer — build 3-10 implementation variants, auto-discard failures, rank winners

**Results:**
- 61/61 tests pass
- Isolated Verifier: PASS 100/100
- Health: HEALTHY, 0 required failures
- 3 canary tokens deployed in proof/.canary/

**The steal (1 example):**
OpenUI's line-based format — instead of 17,477 bytes of JSON, we emit 450 bytes of compact TL format.
Every verification receipt is pipe-parseable by other agents without JSON parsing overhead.

```
tl|routing
v|1.0
g|12tasks|5models
r|code_gen|deepseek-7b-chat|100
r|security_review|qwen3-4b|100
```

**Code:** https://github.com/IgorGanapolsky/ThumbGate
**Playbook (8 patterns, $19):** https://thumbgate.ai/playbook.html
**Pro ($19/mo direct Stripe):** https://buy.stripe.com/8x2dR91M84r4cSd9uj3sI3f

We're also hiring for the infra compiler — if you've worked on Claude Code hooks or MCP servers, 
DM us.

---
