# ThumbGate Body of Work & Core Thesis

This document defines the foundational theories and strong opinions that anchor all ThumbGate content and messaging.

## Core Thesis
AI agents are active system operators. Because they can execute commands and write files, they cannot be governed simply by prompting or monitoring. Safety must be enforced deterministically at the execution boundary.

## Foundational Opinions

1. **System Prompts are Advisory, Not Gating**: A system prompt cannot prevent an agent from running a dangerous command when context drift occurs or when it's prompted by an adversarial file. Real safety requires a runtime gate.
2. **Deterministic Gating Beats LLM Judges**: Running an LLM to judge whether another LLM's action is safe is too slow, too expensive, and prone to the same hallucination issues. The enforcement path must use fast, local, regex-based and policy-based checks.
3. **Zero Trust for AI Agents**: Treat AI agents as unvetted third-party processes. Apply the principle of least privilege, enforce strict path directories, and assume breach at all times.
4. **The Feedback-to-Enforcement Flywheel**: Developers correct agents using natural signals (thumbs down, "that failed"). The system must capture these signals, distill them into structured prevention rules, and register them as PreToolUse blocks immediately.
5. **Local-First / Private-by-Default**: Developers work with proprietary, sensitive codebases. Governance data, history, and prevention rules must live locally in the developer's workspace and never leave the laptop without explicit consent.
6. **Defense-in-Depth (Policies + Containment)**: Gate policies (like blocking dangerous commands) are not replacements for sandboxing. A secure deployment pairs ThumbGate's policy layer with microVM/container containment.
7. **Monetary & Loop Safety**: Runaway autonomous agents can burn thousands of tokens in minutes. Budget guards (monthly spend caps, action count triggers, time limits) are essential operational boundaries.
