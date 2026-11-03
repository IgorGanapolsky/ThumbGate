# Boardy A2A Agent Interface (boardy.ai/agents)

> **Steal**: Use Boardy's headless Agent-to-Agent Skill endpoint (`boardy.ai/agents`)
> to negotiate deals, intros, and reference checks without voice calls.

## The Problem

Most agents treat Boardy as a novelty voice-chat matchmaker, burning daily
3-intro caps on lukewarm prospects. Boardy Pro (`$100/mo`) is actually an
autonomous negotiation and deal-closing agent that joins live calls, manages
follow-up loops, and interfaces directly with personal AI assistants via his
A2A endpoint.

The key insight: structure your state-machine payload to map directly to
Boardy's internal memory slots, or he stretches logic to force a match.

## The Steal Pattern

1. **Headless A2A**: Instead of voice calls, send structured JSON payloads to
   `boardy@boardy.ai` via his `/agents` endpoint. Boardy parses incoming agent
   emails into internal memory slots.
2. **Red Team Interrogation**: Force Boardy to explain his reasoning before
   authorizing the double opt-in. Ask the 3-Question Challenge.
3. **Draft Interception**: Never say "yes, connect us." Demand the exact draft
   email first; edit out AI phrasing, inject hyper-specific hooks.
4. **Pro Call Hijacking**: Brief Boardy on the exact concession/budget question
   you want surfaced during the live call he joins.
5. **Inbound Reciprocity**: Seed your "unfair advantage" tags so Boardy
   surfaces *you* to high-value inbound queries.
6. **Guardrail: Email Loop Prevention**: Never let an autonomous email
   auto-responder reply directly to `boardy@boardy.ai`.

## Usage

```bash
# Generate a structured Boardy A2A payload from current repo state
node scripts/boardy-a2a-payload.js \
  --role "AI Infrastructure Operator" \
  --company "ThumbGate" \
  --stage "Production" \
  --metrics "53/53 verifier tests passing, 0.4ms latency" \
  --problem "Cold outbound conversion dropped 40% since August; need warm partner channels" \
  --offer "Infrastructure firewall expertise, DPO exports, MCP hook design" \
  --stack "Claude Code, Cursor, MCP, Stripe, Railway, GitHub"
```

## The 3-Question Challenge Template

When Boardy proposes a match, always reply:

> 1. Why this person specifically based on what they told you recently?
> 2. What concerns or red flags should I have about this match?
> 3. Who else in your graph is a 10% better fit for this exact problem?

## Pro Call Brief Template

> Before the call, brief Boardy: "The exact question I want surfaced during the
> meeting is [X]. I do not want to ask it awkwardly myself."

## Guardrail: Friday 30-Minute Batch

Instead of reacting to Boardy daily, batch interactions into a single 30-minute
Friday debrief. Grade the week's introductions explicitly—high-signal vs.
wasted time—so his reinforcement loop tightens.

## Guardrail: Email Loop Prevention

**NEVER** let an autonomous email auto-responder reply directly to
`boardy@boardy.ai` without human-in-the-loop approval. Two persistent agents
trying to schedule with each other will spiral into dozens of aggressive emails,
potentially CC'ing live clients or investors.
