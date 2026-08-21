# Future AGI Integration Guide

> Bridging Open-Source Agent Evaluation, Simulation, and Tracing with Deterministic PreToolUse Guardrails.

## Overview
Future AGI (`future-agi/future-agi`) provides an open-source platform collapsing simulation, evals, guardrails, tracing, gateway, and optimization into a single feedback loop.

**ThumbGate** acts as the **deterministic pre-action execution firewall** at the tool-call interface. When paired together:
1. **Simulation to Gate Synthesis**: Adversarial test failures in Future AGI are compiled into fail-closed PreToolUse gates in ThumbGate.
2. **Runtime Action Receipts**: Blocked mutations, tool calls, and human approvals in ThumbGate emit OTel spans back to Future AGI for continuous model optimization.

## Model Candidates
- `future-agi/agentic-eval-v1`: Specialized evaluator model for multi-turn tool calling and groundedness verification.
- `future-agi/guardrail-scanner`: Sub-10ms scanner for prompt injection and PII detection.

## Quickstart
```bash
# Evaluate a tool call payload with Future AGI simulation rubric:
npx thumbgate eval --payload '{"tool": "Bash", "command": "publish_release"}'

# Run Doctor check on Future AGI bridge:
node scripts/future-agi-evaluator.js --doctor
```
