'use strict';

/**
 * Recursive Language Model (RLM) Policy Evaluator
 *
 * Implements the RLM "Plan -> Inspect -> Decide" pattern for governance.
 * Instead of feeding a massive diff or log into a single prompt, this engine
 * recursively chunks the artifact, scores each chunk independently, and aggregates
 * the risk to prevent context-window amnesia and latency blowouts.
 */

function evaluatePolicyRecursively(artifact, chunkSize = 1000) {
  if (!artifact || typeof artifact !== 'string') {
    return { mode: 'allow', risk: 'low', summary: 'Empty artifact' };
  }

  // 1. Partition
  const chunks = [];
  for (let i = 0; i < artifact.length; i += chunkSize) {
    chunks.push(artifact.slice(i, i + chunkSize));
  }

  // 2. Map (Simulated Sub-LM evaluations)
  const chunkResults = chunks.map((chunk, index) => {
    let risk = 'low';
    let violations = [];
    const normalized = chunk.toLowerCase();

    // High-ROI code safety checks
    if (normalized.includes('aws_access_key') || normalized.includes('private_key')) {
      risk = 'block';
      violations.push('secret_exposure');
    }
    if (normalized.includes('rm -rf /') || normalized.includes('drop table')) {
      risk = 'block';
      violations.push('destructive_action');
    }
    if (normalized.includes('eval(') || normalized.includes('exec(')) {
      risk = 'warn';
      violations.push('arbitrary_execution');
    }

    return { chunkId: index, risk, violations };
  });

  // 3. Aggregate / Decide (Root LM reasoning)
  let highestRisk = 'low';
  const allViolations = new Set();

  for (const res of chunkResults) {
    res.violations.forEach(v => allViolations.add(v));
    if (res.risk === 'block') highestRisk = 'block';
    if (res.risk === 'warn' && highestRisk === 'low') highestRisk = 'warn';
  }

  return {
    mode: highestRisk === 'block' ? 'block' : highestRisk === 'warn' ? 'warn' : 'allow',
    risk: highestRisk,
    summary: `Analyzed ${chunks.length} chunks. Violations found: ${Array.from(allViolations).join(', ') || 'none'}`,
    violations: Array.from(allViolations)
  };
}

module.exports = {
  evaluatePolicyRecursively
};
