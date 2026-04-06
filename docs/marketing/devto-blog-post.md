# I built pre-action gates that physically block Claude Code from repeating mistakes

*Target: Dev.to / Hashnode / Medium*

AI coding assistants and autonomous agents are everywhere. We've all experienced the magic of an agent writing a full feature in seconds. We call this "Vibe Coding"—coding by intuition, where you give the AI a general direction and it figures out the rest.

But there's a dark side to Vibe Coding that platform engineering teams are just starting to wake up to: **Massive Security and Operational Debt.**

## The Problem with Vibes
When an agent hallucinates a database deletion, ignores your team's specific TypeScript conventions, or pushes a force commit without tests, what do you do? You tell it "Stop doing that." 

And it stops... for that session. But the next day, or the next week, or when a junior developer spins up a new agent, the mistake happens again. 

Prompts are subjective. They are suggestions, not constraints. 

## Enter Pre-Action Gates
To move from "cool demos" to "merging 1,000+ PRs per week," you need infrastructure. Specifically, you need **Pre-Action Gates**.

Pre-Action Gates sit between the LLM and your codebase. They enforce hard boundaries that the agent cannot cross, regardless of the prompt.

I built **ThumbGate** to capture human feedback, auto-promote recurring failures into prevention rules, and enforce those rules before risky tool calls execute.

## Feedback-to-Enforcement Pipeline
The core loop in ThumbGate turns subjective human frustration into verifiable constraints:

1. **The Signal:** An agent does something wrong. You hit "thumbs down" or type "this failed."
2. **The Capture:** ThumbGate intercepts this signal, grabbing the exact context, the tool used, and the repository state.
3. **The Gate:** It generates a non-bypassable architectural rule (stored in `CLAUDE.md` or `AGENTS.md`) that blocks the agent from repeating the action.

## Run the Revenue-at-Risk Analyzer
Every time an agent repeats a mistake, it costs you developer time. We built a Revenue-at-Risk analyzer directly into the CLI. 

Run `npx thumbgate stats` in any project, and it will calculate the estimated operational loss caused by repeated agent failures based on your local logs.

**Stop Vibe Coding. Start Context Engineering.**

Try it now:
```bash
npx thumbgate install
```
