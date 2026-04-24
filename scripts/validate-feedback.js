'use strict';
/**
 * Feedback Data Quality Validator
 *
 * Implements a 4-level validation pipeline:
 * 1. Schema validation (required fields, value ranges)
 * 2. Semantic validation (logical consistency)
 * 3. Anomaly detection (suspicious patterns, sensitive data)
 * 4. Self-correction (auto-correct fixable errors)
 *
 * Adapted for ThumbGate schema validation:
 * - Uses 'signal' (not 'feedback') with values 'positive'/'negative'
 * - Uses 'id' as required field (not 'source')
 * - THUMBGATE_FEEDBACK_DIR env var for path resolution
 *
 * Usage (CLI):
 *   echo '{"signal":"positive",...}' | node validate-feedback.js
 *   node validate-feedback.js --audit   # Audit existing feedback log
 *   node validate-feedback.js --stats   # Show quality statistics
 *
 * Usage (module):
 *   const { validateEntry } = require('./validate-feedback');
 *
 * LOCAL ONLY - Do not commit feedback log data to repository
 */

const fs = require('fs');
const path = require('path');
const { resolveFeedbackDir } = require('./feedback-paths');

// =============================================================================
// PATH RESOLUTION
// =============================================================================

const DEFAULT_FEEDBACK_DIR = resolveFeedbackDir();

function getFeedbackDir() {
  return resolveFeedbackDir();
}

function getFeedbackPaths() {
  const dir = getFeedbackDir();
  return {
    FEEDBACK_LOG: path.join(dir, 'feedback-log.jsonl'),
    VALIDATION_LOG: path.join(dir, 'validation-issues.jsonl'),
    QUALITY_REPORT: path.join(dir, 'quality-report.json'),
  };
}

// =============================================================================
// SCHEMA VALIDATION (Level 1)
// =============================================================================

const REQUIRED_FIELDS = ['timestamp', 'signal', 'id'];
const VALID_SIGNAL_VALUES = ['positive', 'negative'];
const VALID_REWARD_RANGE = [-1, 1];

function validateSchema(entry) {
  const issues = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in entry)) {
      issues.push({
        level: 'error',
        field,
        message: `Missing required field: ${field}`,
        suggestion: `Add "${field}" to the feedback entry`,
      });
    }
  }

  // Validate signal value
  if (entry.signal && !VALID_SIGNAL_VALUES.includes(entry.signal)) {
    issues.push({
      level: 'warning',
      field: 'signal',
      message: `Invalid signal value: "${entry.signal}"`,
      suggestion: `Use one of: ${VALID_SIGNAL_VALUES.join(', ')}`,
    });
  }

  // Validate reward range
  if ('reward' in entry) {
    if (
      typeof entry.reward !== 'number' ||
      entry.reward < VALID_REWARD_RANGE[0] ||
      entry.reward > VALID_REWARD_RANGE[1]
    ) {
      issues.push({
        level: 'error',
        field: 'reward',
        message: `Reward out of range: ${entry.reward}`,
        suggestion: `Reward must be between ${VALID_REWARD_RANGE[0]} and ${VALID_REWARD_RANGE[1]}`,
      });
    }
  }

  // Validate timestamp format
  if (entry.timestamp) {
    const ts = new Date(entry.timestamp);
    if (isNaN(ts.getTime())) {
      issues.push({
        level: 'error',
        field: 'timestamp',
        message: `Invalid timestamp format: "${entry.timestamp}"`,
        suggestion: 'Use ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ',
      });
    } else if (ts > new Date()) {
      issues.push({
        level: 'warning',
        field: 'timestamp',
        message: 'Timestamp is in the future',
        suggestion: 'Check system clock synchronization',
      });
    }
  }

  return issues;
}

// =============================================================================
// SEMANTIC VALIDATION (Level 2)
// =============================================================================

function validateSemantics(entry) {
  const issues = [];

  // Signal-reward consistency
  if (entry.signal === 'positive' && typeof entry.reward === 'number' && entry.reward < 0) {
    issues.push({
      level: 'error',
      field: 'reward',
      message: 'Positive signal but negative reward',
      explanation: 'Semantic inconsistency: positive signal should have reward >= 0',
      suggestion: 'Either change signal to "negative" or reward to positive value',
    });
  }

  if (entry.signal === 'negative' && typeof entry.reward === 'number' && entry.reward > 0) {
    issues.push({
      level: 'error',
      field: 'reward',
      message: 'Negative signal but positive reward',
      explanation: 'Semantic inconsistency: negative signal should have reward <= 0',
      suggestion: 'Either change signal to "positive" or reward to negative value',
    });
  }

  // Context validation
  if (entry.context !== undefined) {
    // Empty or too short context
    if (typeof entry.context === 'string' && entry.context.trim().length < 5) {
      issues.push({
        level: 'warning',
        field: 'context',
        message: 'Context too short to be meaningful',
        explanation: 'Short context reduces ML training value',
        suggestion: 'Provide more descriptive context (at least 10 characters)',
      });
    }

    // Check for placeholder text
    const placeholders = ['TODO', 'FIXME', 'placeholder', 'test', 'example'];
    for (const ph of placeholders) {
      if (
        typeof entry.context === 'string' &&
        entry.context.toLowerCase().includes(ph.toLowerCase())
      ) {
        issues.push({
          level: 'warning',
          field: 'context',
          message: `Context contains placeholder text: "${ph}"`,
          explanation: 'Placeholder text may indicate incomplete entry',
          suggestion: 'Replace with actual context or remove entry',
        });
        break;
      }
    }
  }

  // Tool-name validation
  if (entry.tool_name) {
    const validTools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'WebFetch'];
    if (!validTools.includes(entry.tool_name)) {
      issues.push({
        level: 'info',
        field: 'tool_name',
        message: `Uncommon tool: "${entry.tool_name}"`,
        explanation: 'Tool not in standard list - may be valid but unusual',
        suggestion: 'Verify tool name is correct',
      });
    }
  }

  return issues;
}

// =============================================================================
// ANOMALY DETECTION (Level 3)
// =============================================================================

function detectAnomalies(entry, allEntries) {
  const entries = Array.isArray(allEntries) ? allEntries : [];
  const issues = [];

  // Rapid feedback burst (more than 5 in 1 minute)
  if (entry.timestamp && entries.length > 0) {
    const entryTime = new Date(entry.timestamp);
    const recentEntries = entries.filter((e) => {
      const t = new Date(e.timestamp);
      return Math.abs(entryTime - t) < 60000; // 1 minute
    });

    if (recentEntries.length > 5) {
      issues.push({
        level: 'warning',
        type: 'anomaly',
        message: 'Feedback burst detected',
        explanation: `${recentEntries.length} entries within 1 minute - unusual pattern`,
        suggestion: 'Verify this is not automated noise or duplicate entries',
      });
    }
  }

  // Same feedback repeated exactly (duplicate detection)
  if (entry.context && entries.length > 0) {
    const duplicates = entries.filter(
      (e) =>
        e.context === entry.context &&
        e.signal === entry.signal &&
        e.tool_name === entry.tool_name
    );

    if (duplicates.length > 0) {
      issues.push({
        level: 'warning',
        type: 'anomaly',
        message: 'Duplicate feedback entry',
        explanation: `Found ${duplicates.length} identical entries`,
        suggestion: 'Consider deduplication or review capture logic',
      });
    }
  }

  // Feedback balance check (session imbalance)
  if (entries.length >= 10) {
    const positiveCount = entries.filter((e) => e.signal === 'positive').length;
    const ratio = positiveCount / entries.length;

    if (ratio > 0.95) {
      issues.push({
        level: 'info',
        type: 'anomaly',
        message: 'Feedback heavily skewed positive',
        explanation: `${(ratio * 100).toFixed(1)}% positive - may indicate capture bias`,
        suggestion: 'Review if negative cases are being properly captured',
      });
    } else if (ratio < 0.05) {
      issues.push({
        level: 'warning',
        type: 'anomaly',
        message: 'Feedback heavily skewed negative',
        explanation: `${((1 - ratio) * 100).toFixed(1)}% negative - unusual pattern`,
        suggestion: 'Check for systematic issues or misconfigured error detection',
      });
    }
  }

  // Sensitive data leakage detection
  if (entry.context) {
    const sensitivePatterns = [
      /api[_-]?key/i,
      /password/i,
      /secret/i,
      /token/i,
      /bearer/i,
      /\b[A-Za-z0-9]{32,}\b/, // Long alphanumeric strings (possible keys)
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(entry.context)) {
        issues.push({
          level: 'error',
          type: 'security',
          message: 'Potential sensitive data in context',
          explanation: `Pattern matched: ${pattern.toString()}`,
          suggestion: 'Redact sensitive information before logging',
        });
        break;
      }
    }
  }

  return issues;
}

// =============================================================================
// SELF-CORRECTION (Level 4)
// =============================================================================

function generateCorrections(entry, issues) {
  const corrections = [];

  for (const issue of issues) {
    if (issue.level === 'error') {
      // Auto-correct reward to match signal
      if (issue.field === 'reward' && entry.signal) {
        const correctedReward =
          entry.signal === 'positive' ? 1 : entry.signal === 'negative' ? -1 : 0;
        corrections.push({
          field: 'reward',
          original: entry.reward,
          corrected: correctedReward,
          reason: 'Auto-corrected to match signal type',
        });
      }

      // Auto-add missing timestamp
      if (issue.field === 'timestamp' && !entry.timestamp) {
        corrections.push({
          field: 'timestamp',
          original: null,
          corrected: new Date().toISOString(),
          reason: 'Added missing timestamp',
        });
      }
    }
  }

  return corrections;
}

function applyCorrections(entry, corrections) {
  const corrected = { ...entry };
  for (const c of corrections) {
    corrected[c.field] = c.corrected;
  }
  corrected._corrected = true;
  corrected._corrections = corrections;
  return corrected;
}

// =============================================================================
// MAIN VALIDATION PIPELINE
// =============================================================================

function validateEntry(entry, allEntries) {
  const entries = Array.isArray(allEntries) ? allEntries : [];
  const result = {
    valid: true,
    entry,
    issues: [],
    corrections: [],
    correctedEntry: null,
  };

  // Level 1: Schema
  result.issues.push(...validateSchema(entry));

  // Level 2: Semantics
  result.issues.push(...validateSemantics(entry));

  // Level 3: Anomalies
  result.issues.push(...detectAnomalies(entry, entries));

  // Level 4: Self-correction
  result.corrections = generateCorrections(entry, result.issues);

  // Determine validity (errors make entry invalid)
  const hasErrors = result.issues.some((i) => i.level === 'error');
  result.valid = !hasErrors;

  // Apply corrections if available
  if (result.corrections.length > 0) {
    result.correctedEntry = applyCorrections(entry, result.corrections);
  }

  return result;
}

// =============================================================================
// FEEDBACK LOG UTILITIES
// =============================================================================

function loadFeedbackLog() {
  const { FEEDBACK_LOG } = getFeedbackPaths();
  if (!fs.existsSync(FEEDBACK_LOG)) return [];

  const content = fs.readFileSync(FEEDBACK_LOG, 'utf8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((e) => e !== null);
}

// =============================================================================
// AUDIT MODE
// =============================================================================

function auditFeedbackLog() {
  const { VALIDATION_LOG, QUALITY_REPORT } = getFeedbackPaths();
  console.log('Auditing feedback log...\n');

  const entries = loadFeedbackLog();
  if (entries.length === 0) {
    console.log('No entries to audit.');
    return;
  }

  const results = {
    total: entries.length,
    valid: 0,
    invalid: 0,
    corrected: 0,
    issuesByLevel: { error: 0, warning: 0, info: 0 },
    issuesByField: {},
  };

  const validationIssues = [];

  for (const entry of entries) {
    const validation = validateEntry(entry, entries);

    if (validation.valid) {
      results.valid++;
    } else {
      results.invalid++;
    }

    if (validation.corrections.length > 0) {
      results.corrected++;
    }

    for (const issue of validation.issues) {
      results.issuesByLevel[issue.level] = (results.issuesByLevel[issue.level] || 0) + 1;
      if (issue.field) {
        results.issuesByField[issue.field] = (results.issuesByField[issue.field] || 0) + 1;
      }

      validationIssues.push({
        timestamp: entry.timestamp,
        entryId: entry.id,
        ...issue,
      });
    }
  }

  // Save validation issues log
  if (validationIssues.length > 0) {
    const dir = getFeedbackDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const issueLog = validationIssues.map((i) => JSON.stringify(i)).join('\n');
    fs.writeFileSync(VALIDATION_LOG, issueLog + '\n');
  }

  // Save quality report
  const report = {
    ...results,
    validityRate: ((results.valid / results.total) * 100).toFixed(2) + '%',
    auditedAt: new Date().toISOString(),
  };
  const dir = getFeedbackDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(QUALITY_REPORT, JSON.stringify(report, null, 2) + '\n');

  // Print summary
  console.log(`Total entries: ${results.total}`);
  console.log(`Valid: ${results.valid} (${report.validityRate})`);
  console.log(`Invalid: ${results.invalid}`);
  console.log(`Auto-correctable: ${results.corrected}`);
  console.log('\nIssues by level:');
  console.log(`  Errors: ${results.issuesByLevel.error || 0}`);
  console.log(`  Warnings: ${results.issuesByLevel.warning || 0}`);
  console.log(`  Info: ${results.issuesByLevel.info || 0}`);

  if (Object.keys(results.issuesByField).length > 0) {
    console.log('\nTop issue fields:');
    const sorted = Object.entries(results.issuesByField)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [field, count] of sorted) {
      console.log(`  ${field}: ${count}`);
    }
  }

  console.log(`\nValidation issues saved to: ${VALIDATION_LOG}`);
  console.log(`Quality report saved to: ${QUALITY_REPORT}`);
}

function showStats() {
  const { QUALITY_REPORT } = getFeedbackPaths();
  if (!fs.existsSync(QUALITY_REPORT)) {
    console.log('No quality report found. Run --audit first.');
    return;
  }

  const report = JSON.parse(fs.readFileSync(QUALITY_REPORT, 'utf8'));
  console.log('Feedback Quality Statistics\n');
  console.log(JSON.stringify(report, null, 2));
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--audit')) {
    auditFeedbackLog();
  } else if (args.includes('--stats')) {
    showStats();
  } else {
    // Read from stdin (piped input)
    let input = '';

    if (!process.stdin.isTTY) {
      for await (const chunk of process.stdin) {
        input += chunk;
      }
    }

    if (input.trim()) {
      try {
        const entry = JSON.parse(input);
        const allEntries = loadFeedbackLog();
        const result = validateEntry(entry, allEntries);

        if (result.valid) {
          const output = result.correctedEntry || result.entry;
          console.log(JSON.stringify(output));
        } else {
          console.error('[VALIDATION] Issues found:');
          for (const issue of result.issues) {
            console.error(`  [${issue.level}] ${issue.message}`);
          }
          console.log(JSON.stringify(result.correctedEntry || result.entry));
        }
      } catch (e) {
        console.error(`[VALIDATION] Invalid JSON: ${e.message}`);
        process.exit(1);
      }
    } else {
      console.log('Feedback Data Quality Validator');
      console.log('\nUsage:');
      console.log("  echo '{\"signal\":\"positive\",...}' | node validate-feedback.js");
      console.log('  node validate-feedback.js --audit   # Audit existing log');
      console.log('  node validate-feedback.js --stats   # Show statistics');
    }
  }
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  validateEntry,
  validateSchema,
  validateSemantics,
  detectAnomalies,
  generateCorrections,
  applyCorrections,
  loadFeedbackLog,
  auditFeedbackLog,
  showStats,
};

// Run CLI only when invoked directly
if (require.main === module) {
  main().catch(console.error);
}
