# Strands Decider 2B Intervention Honesty (FORMAT Steal)

Source: Marc Brooker, Mike Chambers, Fabio Nonato de Paula — [*Introducing Strands Decider 2B: a small, open source, decision model*](https://strandsagents.com/blog/introducing-strands-decider/).

## Architectural Ideas Stolen into `adapters/strands/strands-decider-adapter.js`

1. **Pointer-Head Option Scoring (`scoreChoiceQuestion`)**
   - Models the v19 pointer-head architecture (`StrandsAgents/strands-decider-2B-hobson-v19`, which removes the generative LM head from Qwen3.5-2B + rank-16 LoRA and scores option hidden states against `<answer>`).
   - Produces a normalized probability distribution over options plus a calibrated `confidence` reliability score, with `canGenerateFreeformText: false`.

2. **Parallel `Decider.noul` Pre-Tool Groundedness & Prematurity (`evaluateToolGroundednessAndPrematurity`)**
   - Evaluates two binary `noul` questions over the conversation state and proposed tool call in one pass:
     - `args_grounded`: Does every tool argument value trace back to facts the user actually provided, or did an eager agent guess/invent an argument (e.g., guessing a city for `get_weather`)?
     - `premature`: Should the assistant ask a clarifying question before calling the tool?

3. **`InterventionHandler.before_tool_call` (`Proceed | Deny | Confirm | Guide`)**
   - `beforeToolCallIntervention()` returns Strands' four typed intervention actions:
     - `Deny`: blocks critical destructive actions (`git push --force origin main`, `--admin`).
     - `Confirm`: pauses for human confirmation on high-risk mutations or protected governance files.
     - `Guide`: **hands the turn back to the model with targeted feedback** when `args_grounded === false` or `premature === true` so the agent asks the user to clarify instead of executing a hallucinated tool call.
     - `Proceed`: allows grounded, policy-clear tool calls.

4. **Brier Score Calibration & Sub-0.5ms Local CPU Advantage (`computeBrierScore`, `estimateDeciderLatencyMs`)**
   - Computes $\text{BS} = \frac{1}{N}\sum (p_i - y_i)^2$ for confidence calibration and keeps hot-path `PreToolUse` decisions at `<0.5ms` on local CPU (vs. `115ms` RTX 3090 / `153ms` M3 MacBook for 2B weights) without `pip install strands-decider`.

## CLI Usage

```bash
npx thumbgate strands-decider-honesty --json
node --test tests/strands-decider-adapter.test.js
```
