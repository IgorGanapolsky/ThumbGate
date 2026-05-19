# Bryan Ross — GitLab Field CTO outreach (2026-05-18)

**Trigger:** Bryan published ["The hidden cost of build vs. buy for agentic AI in regulated industries"](https://thenewstack.io/agentic-ai-build-buy/) in The New Stack on 2026-05-15 (GitLab-sponsored). The piece argues buy-don't-build agentic platforms in regulated industries and puts a $1.4M / 18-month price tag on DIY.

**Why this is a warm angle:** ThumbGate is not competing with GitLab Duo. ThumbGate sits underneath any agent platform as the per-tool-call execution boundary. Bryan's article describes the orchestration layer; the boundary layer is the gap. There's a real integration story for GitLab pipelines and a co-marketing story on the regulated-industries thesis.

**Verification check (run before sending):**
- Confirm author bylines are still active at GitLab (LinkedIn + GitLab Field CTO directory).
- Confirm the article URL still resolves and has not been retracted or substantially edited.
- Confirm no prior outbound to Bryan in `docs/marketing/buyer-list-*` or `reports/outreach/*`.

**Channel preference order:**
1. LinkedIn DM (Bryan is active there as Field CTO; ThumbGate has a LinkedIn account via Zernio).
2. Email if a verified address surfaces; otherwise skip — do not guess.
3. Public comment on the New Stack article only as a fallback signal-amplifier; it is not the outreach.

---

## Variant A — LinkedIn DM (≤ 1,500 chars, citation-anchored, ask is small)

> Hi Bryan — read your build-vs-buy piece in The New Stack last week and the $1.4M number is going to do real work for procurement teams in regulated industries. Wanted to flag a layer the article didn't name, in case it's useful for a follow-up.
>
> Even after a bank buys GitLab Duo (or any vendor platform), the agent still issues tool calls against real infra: git pushes, prod DB connections, file deletes. The orchestration layer decides *which* tool. The layer underneath decides whether that tool call actually executes — pre-action gate, learned per-rule, with an immutable decision trail. That second layer is what DORA Article 28 auditors actually ask for.
>
> I run ThumbGate — npm-installable pre-action gate for Claude Code, Cursor, Codex, Gemini, Amp, any MCP agent. MIT core. Wrote a companion piece citing yours: https://thumbgate-production.up.railway.app/learn/regulated-agent-execution-boundary
>
> Two reasons I'm reaching out, not pitching:
> 1. There's a credible integration story with GitLab pipelines — gate calls inside Duo agent runs, surface block reasons in MR comments. I'd want to scope it with your team if it lines up.
> 2. The regulated-industries thesis lands better with named evidence. Happy to share what we're seeing from financial-services intake (under NDA) if it'd inform a follow-up.
>
> Either way — thanks for the piece. Cheers.
>
> — Igor Ganapolsky, ThumbGate

## Variant B — Email (only send if a verified work address surfaces)

> **Subject:** The execution-boundary layer your New Stack piece almost named
>
> Bryan,
>
> Your build-vs-buy piece in The New Stack ran on the 15th and the $1.4M / 18-month anchor is the right number to put in front of regulated-industry procurement. I'd like to extend the frame.
>
> The article positions the buy decision as platform vs. no platform. That's the right first cut. But the residual exposure for a regulated buyer isn't whether they bought GitLab Duo or built one — it's that the bought platform still executes privileged tool calls against their real systems. That's the layer DORA Article 28 audits land on, and the answer there is the pre-action gate: per-call, learned-policy, immutable decision trail.
>
> I wrote a companion piece this week that cites yours, agrees with the thesis, and names the execution-boundary layer underneath: https://thumbgate-production.up.railway.app/learn/regulated-agent-execution-boundary
>
> Two reasons I'm writing:
>
> 1. **Integration.** ThumbGate is npm-installable, MIT-core, and runs on Claude Code, Cursor, Codex, Gemini, Amp, and any MCP agent. The natural integration with GitLab Duo is calling the gate inside Duo agent runs and surfacing block reasons as MR review comments. Happy to scope a thin proof if it lines up.
>
> 2. **Co-evidence.** The regulated-industries thesis benefits from named pain. We're seeing intake from financial-services and insurance buyers asking specifically about DORA Article 28 evidence packaging. I can share patterns under NDA if it would inform a follow-up piece on the topic.
>
> Either way — appreciated the piece.
>
> Igor Ganapolsky
> Founder, ThumbGate
> https://thumbgate-production.up.railway.app

## Variant C — Public reply on the New Stack post (only if 1+2 fail to reach)

> Strong piece, especially the orchestration-as-the-real-complexity point. One layer the build-vs-buy frame didn't fully resolve: even after the orchestration is bought, the agent still executes tool calls against real systems. That residual surface is what DORA Article 28 audits actually open. The pre-action gate — per-call, learned-policy, immutable decision trail — is the buy-side answer there too. Wrote up the extension here: [link]. Would be curious whether GitLab is seeing the same auditor-driven pull on the boundary layer specifically.

---

## Follow-up matrix

| Day | Action | Channel |
|-----|--------|---------|
| T+0 | Send Variant A | LinkedIn DM |
| T+0 | Comment Variant C only if Variant A blocked by connection-required | The New Stack |
| T+3 | If no reply: re-share the companion piece on LinkedIn timeline, tag Bryan + GitLab | LinkedIn post |
| T+7 | If still no reply: stop. Do not third-touch. Move signal to org-level — pitch directly to GitLab partnerships (`partners@gitlab.com`) referencing the article and the companion piece. | Email |

## What "win" looks like

- **Tier 1 win:** Bryan responds and a 30-minute call lands → scope integration + co-marketing.
- **Tier 2 win:** Bryan reposts or quote-shares the companion piece → free distribution to GitLab's regulated-industries audience.
- **Tier 3 win:** GitLab partnerships replies → enters formal partner pipeline.

Anything less than Tier 3 is logged and we move on. No more than two touches per channel.

## Provenance footer

- Article reference: https://thenewstack.io/agentic-ai-build-buy/ (verified 2026-05-18)
- Companion piece: https://thumbgate-production.up.railway.app/learn/regulated-agent-execution-boundary (same-day publish)
- Drafted: 2026-05-18 by ThumbGate CTO agent
- CEO approval required before any send — per `CLAUDE.md` directive that all outbound mentions are manual-send only
