# ThumbGate — Brand Foundation

**Summary (one paragraph).** ThumbGate is a local-first firewall for AI coding
agents. It runs in the PreToolUse hook on the developer's machine and blocks
dangerous tool calls — `rm -rf`, leaked secrets, off-scope edits, a bad
`git push` — *before* they execute, then turns a 👎 thumbs-down into a
prevention rule so the same mistake never repeats. It is enforcement at the
tool-call boundary, not a dashboard you read after the damage.

**Mission (one sentence).** Make AI coding agents' inevitable mistakes harmless.

**Audience emotional context.** A developer or eng lead who has already watched
an agent do something dumb (or fears the next one) and is tired of re-explaining
the same correction. They want control without a procurement cycle. They are
skeptical of hype and allergic to enterprise buzzwords. They respect tools that
respect their time and their intelligence.

**Positioning.** The control layer for what an agent is *allowed to execute* —
local-first, dev-native, install in minutes. Not a server-side gateway, not a
prompt wrapper, not a chatbot. Complements orchestration/agent tools; it decides
what runs, not what to do.

## Personality traits (with contrast)

1. **Direct** — lead with the concrete action and the outcome. *Good:* "Blocks `rm -rf` before it runs." *Too far:* "OBLITERATES catastrophic agent failures." *Too flat:* "Helps manage agent operations."
2. **Technically precise** — name the real mechanism. *Good:* "Runs in the PreToolUse hook." *Too far:* "Leverages a proprietary AI-native security mesh." *Too flat:* "Adds a layer of protection."
3. **Honest / anti-hype** — claim only what's true and shippable. *Good:* "Pre-revenue; here's exactly what it does." *Too far:* "Trusted by thousands of teams." *Too flat:* "A solution for modern teams."
4. **Pragmatic** — recommend the free/native option when it fits. *Good:* "Native Claude Code hooks cover most cases — start there." *Too far:* "You'd be reckless not to buy this." *Too flat:* "There are various options available."
5. **Quietly confident** — let the mechanism do the bragging. *Good:* "Same block, every session, no config." *Too far:* "The only tool that truly understands agent risk." *Too flat:* "We think you'll find it useful."

## What we aren't

- **Fear-mongering about "rogue / lying AI."** Our risk story is *mistakes and blast radius*, not malice. Intent-agnostic enforcement: malice, prompt-injection, or honest error — same block.
- **Enterprise-buzzword salad.** No "control plane for the agentic enterprise," "AI-native security fabric," "holistic governance posture."
- **A chatbot / assistant.** ThumbGate doesn't chat; it gates actions.
- **Vague or aspirational.** No "seamless," "robust," "next-generation," "revolutionary."
- **Overclaiming.** No invented traction, benchmarks, certifications (SOC 2), or "live" integrations we don't ship.
