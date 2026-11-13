/**
 * Mutation Testing Engine for AI-Generated Unit Tests.
 * 
 * Inspired by Maude Lemaire (Scaling Slack, GitHub, and Cursor):
 * "Run mutation tests on AI-generated unit tests: LLMs tend to write unit tests
 * that merely confirm the code they just wrote rather than testing true failure modes.
 * Force the LLM to recognize missed edge cases and rewrite stronger tests."
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MUTATION_OPERATORS = [
  { name: 'invert_equality', pattern: /===/g, replacement: '!==' },
  { name: 'invert_inequality', pattern: /!==/g, replacement: '===' },
  { name: 'invert_less_than', pattern: / < /g, replacement: ' >= ' },
  { name: 'invert_greater_than', pattern: / > /g, replacement: ' <= ' },
  { name: 'invert_and_or', pattern: / && /g, replacement: ' || ' },
  { name: 'invert_or_and', pattern: / \|\| /g, replacement: ' && ' },
  { name: 'invert_boolean_true', pattern: /\breturn\s+true\b/g, replacement: 'return false' },
  { name: 'invert_boolean_false', pattern: /\breturn\s+false\b/g, replacement: 'return true' },
  { name: 'mutate_addition_subtraction', pattern: /\s\+\s/g, replacement: ' - ' },
];

class MutationTestEngine {
  constructor(options = {}) {
    this.minScoreThreshold = options.minScoreThreshold || 0.75; // 75% killed required
    this.timeoutMs = options.timeoutMs || 5000;
  }

  generateMutants(sourceCode) {
    const mutants = [];
    const lines = sourceCode.split('\n');

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      // Skip comments or import lines
      if (/^\s*(\/\/|\/\*|\*|import|const\s+.*=\s+require)/.test(line)) {
        continue;
      }

      for (const op of MUTATION_OPERATORS) {
        if (op.pattern.test(line)) {
          // Reset regex
          op.pattern.lastIndex = 0;
          const mutatedLine = line.replace(op.pattern, op.replacement);
          if (mutatedLine !== line) {
            const mutatedLines = [...lines];
            mutatedLines[lineIdx] = mutatedLine;
            mutants.push({
              operator: op.name,
              line: lineIdx + 1,
              original: line.trim(),
              mutated: mutatedLine.trim(),
              mutatedCode: mutatedLines.join('\n'),
            });
          }
        }
      }
    }

    return mutants;
  }

  evaluateTestHarness(sourcePath, testCommand, options = {}) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file not found: ${sourcePath}`);
    }

    const originalContent = fs.readFileSync(sourcePath, 'utf8');
    const mutants = this.generateMutants(originalContent);
    const maxMutants = options.maxMutants || 10;
    const selectedMutants = mutants.slice(0, maxMutants);

    if (selectedMutants.length === 0) {
      return {
        ok: true,
        mutantsEvaluated: 0,
        mutationScore: 1.0,
        verdict: 'NO_MUTATIONS_FOUND',
        survivedMutants: [],
      };
    }

    const survived = [];
    const killed = [];

    // Ensure we restore original file in all circumstances
    try {
      for (let i = 0; i < selectedMutants.length; i++) {
        const mutant = selectedMutants[i];
        fs.writeFileSync(sourcePath, mutant.mutatedCode, 'utf8');

        let testFailed = false;
        try {
          execSync(testCommand, {
            cwd: path.dirname(sourcePath),
            timeout: this.timeoutMs,
            stdio: 'pipe',
          });
        } catch (_) {
          // Test failed when code was mutated -> mutant killed (GOOD!)
          testFailed = true;
        }

        if (testFailed) {
          killed.push(mutant);
        } else {
          // Test still passed despite mutant -> mutant survived (TAUTOLOGICAL TEST!)
          survived.push(mutant);
        }
      }
    } finally {
      // Restore original file
      fs.writeFileSync(sourcePath, originalContent, 'utf8');
    }

    const totalEvaluated = selectedMutants.length;
    const score = totalEvaluated > 0 ? (killed.length / totalEvaluated) : 1.0;
    const passed = score >= this.minScoreThreshold;

    return {
      ok: passed,
      mutantsEvaluated: totalEvaluated,
      killedCount: killed.length,
      survivedCount: survived.length,
      mutationScore: Math.round(score * 100) / 100,
      minScoreThreshold: this.minScoreThreshold,
      survivedMutants: survived.map((m) => ({
        line: m.line,
        operator: m.operator,
        original: m.original,
        mutated: m.mutated,
      })),
      repairGuidance: survived.length > 0
        ? `The following mutations survived your test suite (tests passed when logic was inverted). Add assertions covering these lines:\n` +
          survived.map((m) => ` - Line ${m.line} (${m.operator}): '${m.original}' changed to '${m.mutated}'`).join('\n')
        : 'All generated mutations were successfully caught and killed by the test suite.',
    };
  }
}

module.exports = {
  MutationTestEngine,
  MUTATION_OPERATORS,
};
