'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { validatePlan, countTableRows, countContracts, countValidationScenarios, getStatus } = require('../scripts/plan-gate');

describe('plan-gate', () => {
  const VALID_PLAN = `
# Plan

## Status
DRAFT

## Clarifying Questions Resolved

| # | Question | Answer |
|---|----------|--------|
| 1 | What is X? | It's Y |
| 2 | Why Z? | Because A |
| 3 | How B? | Via C |

## Contracts

\`\`\`typescript
interface Foo { bar: string }
type Baz = { qux: number }
\`\`\`

## Validation Checklist

- [ ] Scenario 1
- [ ] Scenario 2
- [ ] Scenario 3
`;

  it('validatePlan passes for a well-formed plan', () => {
    const result = validatePlan(VALID_PLAN);
    assert.strictEqual(result.allPass, true);
    assert.ok(result.gates.every(g => g.pass));
  });

  it('countTableRows counts data rows excluding header and separator', () => {
    assert.strictEqual(countTableRows(VALID_PLAN, 'Clarifying Questions Resolved'), 3);
  });

  it('countContracts finds interfaces and types in code blocks', () => {
    assert.strictEqual(countContracts(VALID_PLAN), 2);
  });

  it('countValidationScenarios counts unchecked checkbox items', () => {
    assert.strictEqual(countValidationScenarios(VALID_PLAN), 3);
  });

  it('validatePlan fails when questions are missing', () => {
    const plan = '## Status\nDRAFT\n## Clarifying Questions Resolved\n\n## Contracts\n```\ninterface X {}\n```\n## Validation Checklist\n- [ ] A\n- [ ] B\n';
    const result = validatePlan(plan);
    assert.strictEqual(result.allPass, false);
  });

  it('CLI run executes successfully with mock file', () => {
    const { execSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    
    const mockFile = path.join(__dirname, 'mock-plan-for-cli.md');
    fs.writeFileSync(mockFile, VALID_PLAN);
    
    try {
      const output = execSync(`node ${path.join(__dirname, '..', 'scripts', 'plan-gate.js')} ${mockFile} --json`, { encoding: 'utf8' });
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.allPass, true);
    } finally {
      if (fs.existsSync(mockFile)) fs.unlinkSync(mockFile);
    }
  });

  it('CLI run exits with 1 when plan file is missing', () => {
    const { spawnSync } = require('child_process');
    const path = require('path');
    
    const result = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'plan-gate.js')]);
    assert.strictEqual(result.status, 1);
  });

  it('CLI run exits with 1 when target file does not exist', () => {
    const { spawnSync } = require('child_process');
    const path = require('path');
    
    const result = spawnSync('node', [path.join(__dirname, '..', 'scripts', 'plan-gate.js'), 'non-existent-plan-file-999.md']);
    assert.strictEqual(result.status, 1);
  });
});
