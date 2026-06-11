# ThumbGate Voice Profile

This document outlines the vocabulary, pacing, and brand persona parameters for ThumbGate.

## 1. Persona & Tone
- **Technical & Direct**: Talk to developers like a fellow systems engineer. Use precise technical terms (CDP, PreToolUse hooks, Bayes-optimal, Thompson sampling, microVMs) rather than buzzwords.
- **Honest & Anti-Hype**: Avoid marketing fluff, "revolutionary" or "game-changing" claims. If a feature has limitations or can be bypassed (e.g., shell containment escapes), state it clearly.
- **Action-Oriented**: Focus on what happens, not just abstract benefits. Leads with the concrete mechanism: "ThumbGate blocks the specific dangerous tool call before the shell runs it."

## 2. Ideal Client Profile (ICP)
- **Primary Audience**: Senior developers, Devops engineers, and Engineering managers who:
  - Deploy AI coding agents (Claude Code, Cursor, Cline) in team settings.
  - Are concerned about agents force-pushing to `main`, running destructive SQL drop tables, exfiltrating keys, or causing infinite token-burn loops.
  - Require local-first, zero-trust enforcement boundaries.

## 3. Vocabulary Constraints
- **Preferred Words**: Gating, Pre-action check, boundary, local-first, deterministic, prevention rule, tool call, execution boundary, zero-trust.
- **Banned Words**: Revolutionize, empower, seamlessly, cutting-edge, next-gen, paradigm-shift, synergy, game-changing.

## 4. Writing Samples (Before/After)
- *Beige / Generic*: "Our cutting-edge AI governance platform seamlessly empowers developer teams to write code safely with advanced agent guardrails."
- *ThumbGate Voice*: "ThumbGate is a local-first firewall that blocks AI agents at the tool-call boundary. It intercepts commands in the PreToolUse hook, auto-promoting your thumbs-down feedback into hard rules."
