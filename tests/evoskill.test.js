// tests/evoskill.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { proposeSkills } = require('../scripts/skill-proposer');
const { materializeSkills } = require('../scripts/skill-materializer');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-evoskill-test-'));
}

function appendJSONL(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function makeNegativeMemory(tags, overrides = {}) {
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: 'MISTAKE: Failed test execution',
    content: 'Reasoning: Agent failed to run tests correctly before pushing.',
    category: 'error',
    tags,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

test('skill-proposer generates proposals from mistakes', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = path.join(tmpDir, 'memory-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  appendJSONL(logFile, makeNegativeMemory(['testing', 'verification'], { title: 'MISTAKE: testing issue 1' }));
  appendJSONL(logFile, makeNegativeMemory(['testing', 'verification'], { title: 'MISTAKE: testing issue 2' }));

  const proposals = proposeSkills({ feedbackDir: tmpDir });
  
  assert.ok(Array.isArray(proposals), 'should return an array of proposals');
  assert.strictEqual(proposals.length, 1, 'should generate exactly one proposal from the cluster');
  assert.strictEqual(proposals[0].status, 'pending', 'proposal should have pending status');
  
  const proposalsDir = path.join(tmpDir, 'skill-proposals');
  assert.ok(fs.existsSync(proposalsDir), 'skill-proposals directory should be created');
  const files = fs.readdirSync(proposalsDir);
  assert.strictEqual(files.length, 1, 'should save exactly one proposal file');
});

test('skill-materializer materializes pending proposals', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  
  // Also we need to mock process.cwd() for the skills output directory, but since skill-materializer writes to process.cwd()/skills, let's override process.cwd or change the materializer to accept an output directory or just check what is produced.
  // Wait, overriding process.cwd() is tricky in Node.js. skill-materializer.js hardcodes `process.cwd(), 'skills'`.
  // Let's create a wrapper or just let it write to a temp 'skills' folder if we can mock it, or let it write to the real one and clean up.
  // Actually, I should probably update skill-materializer.js to allow overriding the skills output dir for testing, or I can just mock the function if possible.
  // Better yet, I'll update the script slightly to use process.env.THUMBGATE_SKILLS_DIR.
  process.env.THUMBGATE_SKILLS_DIR = path.join(tmpDir, 'skills');

  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    delete process.env.THUMBGATE_SKILLS_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const proposalsDir = path.join(tmpDir, 'skill-proposals');
  fs.mkdirSync(proposalsDir, { recursive: true });
  
  const proposal = {
    id: 'prop_123',
    status: 'pending',
    problem: 'testing issue',
    diagnosis: 'failed to run tests',
    suggestedSkill: {
      name: 'solve-testing',
      description: 'handles tests',
      tags: ['testing'],
      toolSpec: {
        name: 'handle_testing',
        description: 'Fixes testing issue',
        parameters: { type: 'object', properties: {} }
      }
    }
  };
  fs.writeFileSync(path.join(proposalsDir, 'solve-testing.json'), JSON.stringify(proposal));

  const results = materializeSkills({ feedbackDir: tmpDir, skillsOutDir: path.join(tmpDir, 'skills') });
  
  assert.ok(Array.isArray(results), 'should return an array of materialized skills');
  assert.strictEqual(results.length, 1, 'should materialize one skill');
  assert.strictEqual(results[0], 'solve-testing', 'returns the skill name');
  
  const skillDir = path.join(process.env.THUMBGATE_SKILLS_DIR, 'solve-testing');
  assert.ok(fs.existsSync(skillDir), 'skill directory should be created');
  assert.ok(fs.existsSync(path.join(skillDir, 'SKILL.md')), 'SKILL.md should be created');
  assert.ok(fs.existsSync(path.join(skillDir, 'tool.js')), 'tool.js should be created');
  
  const updatedProposal = JSON.parse(fs.readFileSync(path.join(proposalsDir, 'solve-testing.json'), 'utf8'));
  assert.strictEqual(updatedProposal.status, 'materialized', 'proposal status should be updated');
});

test('skill-proposer returns empty when no mistakes in memory log', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = path.join(tmpDir, 'memory-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  appendJSONL(logFile, { id: 'mem_1', title: 'SUCCESS: good job', content: 'All tests passed.', category: 'success', tags: ['testing'], timestamp: new Date().toISOString() });

  const proposals = proposeSkills({ feedbackDir: tmpDir });
  assert.ok(Array.isArray(proposals));
  assert.strictEqual(proposals.length, 0, 'should return empty when no mistakes');
});

test('skill-proposer handles entries without Reasoning trace', (t) => {
  const tmpDir = makeTmpDir();
  const logFile = path.join(tmpDir, 'memory-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  appendJSONL(logFile, makeNegativeMemory(['testing', 'verification'], { content: 'Agent failed without trace.' }));
  appendJSONL(logFile, makeNegativeMemory(['testing', 'verification'], { content: 'No reasoning available.' }));

  const proposals = proposeSkills({ feedbackDir: tmpDir });
  assert.ok(Array.isArray(proposals));
  if (proposals.length > 0) {
    assert.ok(proposals[0].diagnosis.length > 0, 'should have a fallback diagnosis');
  }
});

test('skill-materializer returns undefined when no proposals directory exists', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_SKILLS_DIR = path.join(tmpDir, 'skills');
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    delete process.env.THUMBGATE_SKILLS_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const results = materializeSkills({ feedbackDir: tmpDir, skillsOutDir: path.join(tmpDir, 'skills') });
  assert.strictEqual(results, undefined, 'should return undefined when no proposals dir');
});

test('skill-materializer skips non-pending proposals', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_SKILLS_DIR = path.join(tmpDir, 'skills');
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    delete process.env.THUMBGATE_SKILLS_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const proposalsDir = path.join(tmpDir, 'skill-proposals');
  fs.mkdirSync(proposalsDir, { recursive: true });

  const proposal = {
    id: 'prop_456',
    status: 'materialized',
    problem: 'already done',
    diagnosis: 'already materialized',
    suggestedSkill: {
      name: 'already-done',
      description: 'already materialized',
      tags: ['testing'],
      toolSpec: { name: 'handle_done', description: 'N/A', parameters: { type: 'object', properties: {} } }
    }
  };
  fs.writeFileSync(path.join(proposalsDir, 'already-done.json'), JSON.stringify(proposal));

  const results = materializeSkills({ feedbackDir: tmpDir, skillsOutDir: path.join(tmpDir, 'skills') });
  assert.ok(Array.isArray(results));
  assert.strictEqual(results.length, 0, 'should skip non-pending proposals');
});

test('skill-materializer returns empty for empty proposals directory', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_SKILLS_DIR = path.join(tmpDir, 'skills');
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    delete process.env.THUMBGATE_SKILLS_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  });

  const proposalsDir = path.join(tmpDir, 'skill-proposals');
  fs.mkdirSync(proposalsDir, { recursive: true });

  const results = materializeSkills({ feedbackDir: tmpDir, skillsOutDir: path.join(tmpDir, 'skills') });
  assert.strictEqual(results, undefined, 'should return undefined when no pending proposals');
});
