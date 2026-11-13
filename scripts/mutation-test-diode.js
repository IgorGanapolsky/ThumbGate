'use strict';

/**
 * ThumbGate AI Unit Test Mutation Testing Diode
 *
 * Architectural Steal: Maude Lemaire (Scaling Slack, GitHub, Cursor)
 * "Run mutation tests on AI-generated unit tests: LLMs tend to write unit tests
 * that merely confirm the code they just wrote rather than testing true failure modes.
 * Build custom agent skills that run mutation test suites to force the LLM to
 * recognize missed edge cases and rewrite stronger tests."
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const MUTATION_OPERATORS = [
  {
    name: 'equality_inversion',
    pattern: /===/g,
    replacement: '!==',
    description: 'Replace strict equality (===) with strict inequality (!==)',
  },
  {
    name: 'inequality_inversion',
    pattern: /!==/g,
    replacement: '===',
    description: 'Replace strict inequality (!==) with strict equality (===)',
  },
  {
    name: 'greater_to_less_equal',
    pattern: /(\w+)\s*>\s*(\w+)/g,
    replacement: '$1 <= $2',
    description: 'Replace greater-than (>) with less-than-or-equal (<=)',
  },
  {
    name: 'less_to_greater_equal',
    pattern: /(\w+)\s*<\s*(\w+)/g,
    replacement: '$1 >= $2',
    description: 'Replace less-than (<) with greater-than-or-equal (>=)',
  },
  {
    name: 'boolean_flip_true',
    pattern: /\btrue\b/g,
    replacement: 'false',
    description: 'Flip boolean literal true to false',
  },
  {
    name: 'boolean_flip_false',
    pattern: /\bfalse\b/g,
    replacement: 'true',
    description: 'Flip boolean literal false to true',
  },
  {
    name: 'logical_and_to_or',
    pattern: /&&/g,
    replacement: '||',
    description: 'Replace logical AND (&&) with logical OR (||)',
  },
  {
    name: 'logical_or_to_and',
    pattern: /\|\|/g,
    replacement: '&&',
    description: 'Replace logical OR (||) with logical AND (&&)',
  },
  {
    name: 'return_null_stub',
    pattern: /return\s+([^{;]+);/g,
    replacement: 'return null;',
    description: 'Force return statement to return null',
  },
];

/**
 * Generates mutated source code variants from an input source string.
 */
function generateMutations(sourceCode, maxMutations = 10) {
  const mutations = [];
  const lines = sourceCode.split('\n');

  for (const op of MUTATION_OPERATORS) {
    if (mutations.length >= maxMutations) break;

    // Reset regex state
    op.pattern.lastIndex = 0;
    let match;
    while ((match = op.pattern.exec(sourceCode)) !== null) {
      if (mutations.length >= maxMutations) break;

      const startIndex = match.index;
      const originalText = match[0];
      const replacementText = typeof op.replacement === 'function'
        ? op.replacement(match)
        : originalText.replace(op.pattern, op.replacement);

      // Mutate at this exact offset only
      const mutatedCode = sourceCode.slice(0, startIndex) +
        replacementText +
        sourceCode.slice(startIndex + originalText.length);

      // Find line number
      const lineNumber = sourceCode.slice(0, startIndex).split('\n').length;

      mutations.push({
        id: `mutant_${mutations.length + 1}`,
        operator: op.name,
        description: op.description,
        lineNumber,
        originalSnippet: originalText,
        mutatedSnippet: replacementText,
        mutatedCode,
      });

      // Avoid infinite regex loop
      if (!op.pattern.global) break;
    }
  }

  return mutations;
}

/**
 * Runs a test runner against mutated files to verify whether the test suite kills the mutant.
 */
function evaluateMutant({ targetFilePath, mutatedCode, testCmd, cwd = process.cwd(), timeoutMs = 15_000 }) {
  const originalSource = fs.readFileSync(targetFilePath, 'utf8');
  let testPassedOnMutant = false;
  let testError = null;

  try {
    // Write mutation to target file
    fs.writeFileSync(targetFilePath, mutatedCode, 'utf8');

    // Run test command
    execSync(testCmd, {
      cwd,
      stdio: 'pipe',
      timeout: timeoutMs,
    });
    // If the test suite succeeded, the mutant SURVIVED (test is weak / tautological!)
    testPassedOnMutant = true;
  } catch (err) {
    // If the test suite failed with error/assertion failure, the mutant was KILLED (test is strong!)
    testPassedOnMutant = false;
    testError = (err.stderr || err.stdout || err.message).toString().slice(0, 300);
  } finally {
    // Restore original file
    fs.writeFileSync(targetFilePath, originalSource, 'utf8');
  }

  return {
    killed: !testPassedOnMutant,
    survived: testPassedOnMutant,
    error: testError,
  };
}

/**
 * Full Mutation Testing Diode:
 * Evaluates an AI-generated test suite against systematic code mutations.
 */
function runMutationGate(options = {}) {
  const {
    targetFilePath,
    testCmd,
    cwd = process.cwd(),
    minMutationScore = 0.70,
    maxMutations = 6,
    mockEvaluator = null,
  } = options;

  if (!targetFilePath || !fs.existsSync(targetFilePath)) {
    throw new Error(`Target file not found: ${targetFilePath}`);
  }
  if (!testCmd && !mockEvaluator) {
    throw new Error('A testCmd string is required for mutation testing.');
  }

  const originalSource = fs.readFileSync(targetFilePath, 'utf8');
  const mutations = generateMutations(originalSource, maxMutations);

  if (mutations.length === 0) {
    return {
      allowed: true,
      verdict: 'PASS_NO_MUTATIONS',
      mutationScore: 1.0,
      totalMutants: 0,
      killedMutants: 0,
      survivedMutants: 0,
      message: 'No mutation points identified in target file.',
    };
  }

  let killedCount = 0;
  const results = [];

  for (const m of mutations) {
    const evalResult = mockEvaluator
      ? mockEvaluator(m)
      : evaluateMutant({
          targetFilePath,
          mutatedCode: m.mutatedCode,
          testCmd,
          cwd,
        });

    if (evalResult.killed) {
      killedCount++;
    }

    results.push({
      mutantId: m.id,
      operator: m.operator,
      lineNumber: m.lineNumber,
      description: m.description,
      status: evalResult.killed ? 'KILLED' : 'SURVIVED',
      error: evalResult.error || null,
    });
  }

  const mutationScore = Number((killedCount / mutations.length).toFixed(3));
  const passed = mutationScore >= minMutationScore;

  return {
    allowed: passed,
    verdict: passed ? 'PASS_MUTATION_GATE' : 'FAIL_TAUTOLOGICAL_TESTS',
    mutationScore,
    minMutationScore,
    totalMutants: mutations.length,
    killedMutants: killedCount,
    survivedMutants: mutations.length - killedCount,
    mutants: results,
    recommendation: passed
      ? 'Test suite successfully killed code mutations. Verification confident.'
      : 'AI-generated tests are tautological/circular. Mutants survived without failing tests. Rewrite tests to assert true error boundaries.',
  };
}

module.exports = {
  MUTATION_OPERATORS,
  generateMutations,
  evaluateMutant,
  runMutationGate,
};
