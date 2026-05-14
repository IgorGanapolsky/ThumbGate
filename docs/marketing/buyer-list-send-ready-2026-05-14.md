# 10 Send-Ready Outbound DMs — 2026-05-14

**Rule:** Send 1-3 today from Igor's LinkedIn. Don't bulk-copy. Personal tone wins.
**Backstop ask if they don't reply:** the second-line ask ("send your top agent failure, I'll reply with a prevention rule") converts higher than "20 min call" because it costs them zero calendar friction.

---

## 1. Birgitta Böckeler — Global Lead, AI-Assisted Software Delivery, Thoughtworks

LinkedIn: https://www.linkedin.com/in/bboeckeler/

> Birgitta — saw your QCon London talk on harness engineering for AI agents. The "thumbs-down becomes a prevention rule" loop you described is exactly what I built into ThumbGate (OSS, ~750 weekly npm installs).
>
> Curious whether the harness work at Thoughtworks is heading toward shared org-level rule libraries, or staying per-team. I'd love your read on the OSS for 15 min next week.
>
> Alt: if a call is too much, send me your single worst agent-induced incident and I'll reply with the rule shape that would have caught it. No deck.
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

---

## 2. Eric Paulsen — Field CTO EMEA, Coder

LinkedIn: https://www.linkedin.com/in/ericpaulsen17/

> Eric — your PlatformCon talk on AI agents in regulated industries is the same problem set ThumbGate is in. We're a pre-action gate that intercepts destructive tool calls + captures thumbs-down as reusable rules. Open source, deploys local.
>
> The question I'm chasing: are Coder customers asking for an enforcement layer that survives across Cursor / Claude Code / Copilot, or solving it per-tool? Wondering if there's a channel angle. 15 min next week?
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

---

## 3. Farhan Thawar — VP & Head of Engineering, Shopify

LinkedIn: https://www.linkedin.com/in/fnthawar/ *(verify)*

> Farhan — read the Pragmatic Engineer piece on Shopify's LLM proxy and multi-tool rollout (Claude Code + Copilot + Cursor). The proxy is the input side; the gap I keep seeing is the agent-side gate that prevents the destructive write before it reaches your repo.
>
> I built ThumbGate for this — pre-action interception, thumbs-down captures the rule, blocks the same class of mistake next session. Across all three IDEs uniformly.
>
> Worth a 15-min compare-notes call? Or send me one recent Shopify agent incident and I'll reply with the gate shape.
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

---

## 4. Addy Osmani — Director of Engineering, Chrome (Google)

LinkedIn: https://www.linkedin.com/in/addyosmani/

> Addy — your `addyosmani/agent-skills` repo nails the "ask before destructive" pattern. ThumbGate is the runtime side of that: PreToolUse hook intercepts the call, captures the human thumbs-down, ships the rule as a reusable block.
>
> Would love your read on whether the rule format we generate is composable with what you're modeling in agent-skills. Quick 15 min, or async if easier.
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

---

## 5. Beyang Liu — Co-founder & CTO, Amp

LinkedIn: https://www.linkedin.com/in/beyang-liu/

> Beyang — watched your Changelog "Flowing with agents." ThumbGate sits one layer above Amp — pre-action gate, thumbs-down to rule, blocks repeats. Right now we wire Claude Code, Cursor, Codex; Amp would be a clean fifth adapter.
>
> Want a reference integration? I'd write the adapter + ship a co-blog post if it lines up.
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

---

## 6. Steve Yegge — Head of Engineering, Amp

LinkedIn: https://www.linkedin.com/in/steveyegge/

> Steve — "Revenge of the junior developer" was correct, and the thing that makes a junior dev safe is a senior reviewing destructive PRs. ThumbGate is that reviewer for agents — pre-execution, captures thumbs-down, blocks the repeat. OSS, ~750 weekly installs.
>
> If the model is interesting, I'd love your tear-down. 15 min, or send me one workflow that bit you and I'll reply with the gate shape.
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

---

## 7. Phillip Carter — Director of PM, Salesforce (ex-Honeycomb) *(verify Salesforce title before sending)*

LinkedIn: https://www.linkedin.com/in/phillip-carter-ml/ *(verify)*

> Phillip — "How I Code With LLMs" landed exactly on the failure mode ThumbGate addresses: the destructive tool call you can't take back. The fix in the post is discipline; the fix at scale is a pre-execution gate that captures the thumbs-down once and prevents the class.
>
> Curious if Agentforce treats this as in-scope or out-of-scope. 15 min, or async note works.
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

---

## 8. Charity Majors — Co-founder & CTO, Honeycomb

LinkedIn: https://www.linkedin.com/in/charity-majors/

> Charity — your SREcon "AIOps: Prove It" landed. The boring pre-action layer most people are skipping is what ThumbGate does — block destructive tool calls, capture human thumbs-down, emit OTel spans on every interception so the observability story stays tight.
>
> Would you co-publish a "governance + observability for agents" piece if the OTel shape is right? I'll do the writing.
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

---

## 9. Adam Jacob — Co-founder & CEO, System Initiative

LinkedIn: https://www.linkedin.com/in/adamjacob/

> Adam — saw the SI AI editor announcement; the "agent proposes, human approves, system executes" loop is exactly ThumbGate's model for arbitrary tool calls. Different surface, same primitive.
>
> 15-min compare-notes call? I'd rather not duplicate work if SI is going to ship the agent-side primitive natively.
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

---

## 10. Hamel Husain — Independent (Parlance Labs)

LinkedIn: https://www.linkedin.com/in/hamelhusain/

> Hamel — your evals course graduates are exactly the ICP for ThumbGate. We're the runtime side of evals: pre-action gate, captures human thumbs-down at runtime, exports DPO pairs for fine-tuning.
>
> Two asks: (a) interested in including ThumbGate in a course module as the runtime-feedback companion? (b) any clients you'd point at us first? I'll write the integration.
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

---

---

## 11. Rob May — CEO & co-founder, Neurometric AI *(NEW — hot, send TODAY)*

LinkedIn: https://www.linkedin.com/in/robmaycareer/ *(verify)*
Newsletter: InsideAI

> Rob — read your New Stack quote on Claude Code Agent View: *"A better dashboard doesn't make the agents more reliable. The hard part isn't visibility. It's trust."* That's verbatim the thesis behind ThumbGate (OSS, ~750 weekly npm installs). PreToolUse gate intercepts destructive tool calls, captures the human thumbs-down, ships the rule as a reusable block — uniformly across Cursor / Claude Code / Codex.
>
> Two asks, take whichever's interesting:
> (a) 15 min to compare notes on what enterprise teams actually need on top of the visibility layer.
> (b) Cover ThumbGate in InsideAI — happy to write the explainer or do a Q&A.
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

**Why hot:** he literally said our pitch in The New Stack this month. Highest-EV LinkedIn send on this list. He has a paid newsletter (InsideAI) with thousands of AI execs as subscribers — one mention = compounding distribution.

---

## 12. Meredith Shubel — Author, The New Stack

LinkedIn: https://www.linkedin.com/in/meredith-shubel/ *(verify)*

> Meredith — your piece on Claude Code Agent View landed on the right diagnosis: the missing thing is governance + auditability for trust, not a better dashboard. ThumbGate is the OSS implementation of exactly what Rob May described — PreToolUse gate, thumbs-down → durable prevention rule, audit trail. ~750 weekly npm installs, MIT.
>
> Two paths if it's useful:
> (a) Follow-up brief on the "control plane developers have been waiting for" thesis — happy to walk you through the architecture and the actual blocked-incident telemetry from our user base.
> (b) Contributed piece for The New Stack from our angle. Headline candidates: *"The Three Gaps Agent View Doesn't Close"* or *"What Policy-as-Code for AI Agents Actually Looks Like."*
>
> — Igor (github.com/IgorGanapolsky/ThumbGate)

**Why hot:** the piece concluded *"What's still missing in the broader agentic development stack is the governance and auditability to drive trust for production use."* That's our spec verbatim — she's primed for a follow-up. The New Stack is the right outlet to reach the buyer ICP.

---

## Send tracker

| # | Sent? | Date | Reply? | Next step |
|---|---|---|---|---|
| 1 | ☐ | | | |
| 2 | ☐ | | | |
| 3 | ☐ | | | |
| 4 | ☐ | | | |
| 5 | ☐ | | | |
| 6 | ☐ | | | |
| 7 | ☐ | | | |
| 8 | ☐ | | | |
| 9 | ☐ | | | |
| 10 | ☐ | | | |
| 11 | ☐ Rob May | | | |
| 12 | ☐ Meredith Shubel | | | |

## Notes

- **Why no Calendly link:** Don't have one wired. The async "send me your top agent failure" ask compensates — it's lower-friction than booking a slot anyway.
- **Voice rules followed:** Peer-to-peer, no marketing copy, no "transforms your workflow" language, one repo link per message, no asks for warm intros.
- **Pricing not mentioned:** Intentional. First conversation is qualification, not sale. Drop $499 Sprint or Pilot pricing only when they ask "what does it cost."
- **Verification needed before sending:** rows 1, 3, 7 — confirm current title on LinkedIn (research agent could not auth-wall verify).
