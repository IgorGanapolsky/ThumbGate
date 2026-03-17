# Research Spec: Project Bayes (Bayesian Agentic Memory)

This document maps Google's **Bayesian Teaching** approach to our local MCP Memory Gateway. It transitions our memory layer from a static database of "facts" to a dynamic system of **probabilistic beliefs**.

## 1. The Core Problem: Memory Over-Confidence
Standard RAG treats all retrieved memories as equally "true." If a user changes their mind or a tool returns a different result, the agent is stuck with conflicting context. Standard LLMs lack a formal mechanism for **belief revision**.

## 2. Technical Solution: Bayesian Belief Graph

Every memory record in our system will now include:
*   **Prior Probability ($P(H)$):** The initial confidence that this memory is "correct" for the current task.
*   **Uncertainty ($\sigma$):** The entropy or "noise level" associated with the memory.
*   **Confidence Interval:** The range within which we trust the memory to be valid.

### The Update Mechanism (Belief Revision)
When new feedback arrives that relates to an existing memory category (e.g., "coding style"):
1.  **Likelihood Calculation:** We calculate the likelihood of the new feedback given the existing memory.
2.  **Posterior Update:** We use a simplified Bayesian update rule:
    $$P(H|E) = \frac{P(E|H) \cdot P(H)}{P(E)}$$
3.  **Conflict Resolution:** If the new signal strongly contradicts the old one, the old memory's `priorProbability` is decayed (pruned) and the new signal becomes the primary belief.

## 3. Implementation Details

### Refactored Schema
```json
{
  "id": "mem_123",
  "category": "preference",
  "content": "User prefers two-space indentation",
  "bayesian": {
    "priorProbability": 0.95,
    "uncertainty": 0.05,
    "observations": 12,
    "lastUpdated": "2026-03-17T14:00:00Z"
  }
}
```

### Entropy-Based Pruning
Instead of deleting based on age, we prune memories where:
*   **High Entropy:** Uncertainty exceeds a threshold (e.g., $> 0.7$).
*   **Low Resonance:** The memory has been consistently contradicted by recent signals.

## 4. ROI: The "Active Sensing" Advantage
Agents will now know when they are "guessing." 
*   **Tool:** `estimate_uncertainty`
*   **Action:** If $Uncertainty > Threshold$, the agent is forced to ask: *"I see conflicting history regarding [X]. Would you like me to use [A] or [B]?"* 

This eliminates the "Hallucination Plateau" and makes agentic behavior 100% calibrated to the user's current intent.
