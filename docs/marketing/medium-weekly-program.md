# Medium Weekly Program

This program makes Medium a weekly authority channel for ThumbGate without pretending an article was published before a human-visible publish confirmation exists.

## Target

- Primary publication: https://medium.com/conversational-ai-weekly
- Audience: builders evaluating production AI agents, conversational AI operations, policy-aware orchestration, observability, and safe action execution.
- Weekly cadence: generate one operator-ready draft every Monday morning.
- Orchestration: `.github/workflows/medium-weekly-visibility.yml` generates the draft, publication pitch, visibility plan, and engagement queue every Monday.
- Engagement cadence: comment on one relevant article when it discusses tool-using agents, observability, guardrails, customer automation, or agent operations.

## Positioning

ThumbGate is not an AI automation agency. It is the enforcement layer underneath agent workflows.

- Agencies and orchestration platforms decide what should happen next.
- ThumbGate decides what is allowed to execute.
- Observability explains what happened after the fact.
- Pre-action gates block repeated failures before the next tool call runs.

## Weekly Topics

1. Pre-action gates for tool-using AI agents.
2. From passive observability to active enforcement.
3. Deterministic policy instead of LLM-as-policy.
4. Sharing team gates without brittle global rules.
5. AI automation agencies need a reusable execution layer.

## Operating Rules

- Do not publish zero-proof build-in-public claims.
- Do not claim revenue, installs, or customer outcomes without direct evidence.
- Do not auto-submit Medium articles from a background job.
- Do generate drafts, tags, tracked CTAs, publication pitches, visibility plans, and engagement prompts every week.
- Do record published Medium URLs in `docs/marketing/medium/published.csv`.

## Commands

```bash
npm run medium:weekly:draft
npm run medium:weekly:schedule
npm run test:medium-weekly
```

The schedule creates drafts, publication pitches, visibility plans, and engagement queues only. Final Medium publishing remains a visible browser action, and the live URL is the proof of publication.
