'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SPECS_DIR = path.join(REPO_ROOT, 'docs', 'specs');

const REQUIRED_HEADINGS = [
  'Problem',
  'Technical Plan',
  'Alternatives Rejected',
  'Enumerated Files',
  'Acceptance Checks',
];

// Legacy specifications present prior to standard template enforcement
const LEGACY_SPECS = new Set([
  'provider-execution-attestation-v1.md',
]);

function extractHeadings(markdownContent) {
  const headingRegex = /^##\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(markdownContent)) !== null) {
    headings.push(match[1].trim());
  }
  return headings;
}

function validateSpecHeadings(markdownContent) {
  const headings = extractHeadings(markdownContent);
  const normalizedHeadings = headings.map((h) =>
    h
      .replace(/^[\d\.\s§#\-\:]+/, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim()
  );

  const missing = [];
  for (const required of REQUIRED_HEADINGS) {
    const normRequired = required.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const found = normalizedHeadings.some((h) => h === normRequired || h.startsWith(normRequired));
    if (!found) {
      missing.push(required);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    foundHeadings: headings,
  };
}

test('docs/specs/TEMPLATE.md exists and contains all four Elephant sections plus Acceptance Checks', () => {
  const templatePath = path.join(SPECS_DIR, 'TEMPLATE.md');
  assert.ok(fs.existsSync(templatePath), 'docs/specs/TEMPLATE.md must exist');

  const content = fs.readFileSync(templatePath, 'utf8');
  const result = validateSpecHeadings(content);

  assert.equal(
    result.valid,
    true,
    `TEMPLATE.md missing required sections: ${result.missing.join(', ')}`
  );
});

test('all docs/specs/*.md added after this PR contain the required standard sections', () => {
  assert.ok(fs.existsSync(SPECS_DIR), 'docs/specs directory must exist');

  const files = fs.readdirSync(SPECS_DIR).filter((f) => f.endsWith('.md'));
  const violations = [];

  for (const file of files) {
    if (file === 'TEMPLATE.md' || LEGACY_SPECS.has(file)) {
      continue;
    }

    const filePath = path.join(SPECS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const result = validateSpecHeadings(content);

    if (!result.valid) {
      violations.push({
        file,
        missing: result.missing,
      });
    }
  }

  assert.deepEqual(
    violations,
    [],
    `The following specs violate the standard template: ${JSON.stringify(violations, null, 2)}`
  );
});

test('validateSpecHeadings accurately catches missing sections and reports them', () => {
  const incompleteSpec = `
# Incomplete Feature Spec

## Problem
Something is broken.

## Technical Plan
We will fix it.

## Enumerated Files
- foo.js
`;

  const result = validateSpecHeadings(incompleteSpec);
  assert.equal(result.valid, false);
  assert.ok(result.missing.includes('Alternatives Rejected'));
  assert.ok(result.missing.includes('Acceptance Checks'));
});

test('validateSpecHeadings accepts valid specs with case-insensitive whitespace resilience', () => {
  const validSpec = `
# Feature Spec

## 1. Problem
Description here.

## 2. Technical Plan
Plan details.

## 3. Alternatives Rejected
Rejected choices.

## 4. Enumerated Files
Files here.

## 5. Acceptance Checks
Checklist here.
`;

  const result = validateSpecHeadings(validSpec);
  assert.equal(result.valid, true);
  assert.deepEqual(result.missing, []);
});

module.exports = {
  REQUIRED_HEADINGS,
  LEGACY_SPECS,
  extractHeadings,
  validateSpecHeadings,
};
