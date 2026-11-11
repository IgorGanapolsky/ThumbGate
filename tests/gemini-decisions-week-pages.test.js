const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Gemini Decisions note claims the shipped gate and marks the API check in review once', () => {
  const page = read('public/blog/gemini-decisions-and-the-gate.html');
  const index = read('public/blog.html');
  assert.match(page, /https:\/\/blog\.google\/innovation-and-ai\/technology\/developers-tools\/gemini-decisions-api\//);
  assert.match(page, /local lesson record/);
  assert.match(page, /in review/);
  assert.equal((page.match(/4941/g) || []).length, 1);
  assert.match(page, /https:\/\/github\.com\/IgorGanapolsky\/ThumbGate\/pull\/4941/);
  assert.match(page, /\$19\/mo or \$149\/yr/);
  assert.match(page, /Setup Sprint is \$499 one-time for one workflow/);
  assert.doesNotMatch(page, /\$0\.10|gemini-decision-1|hosted audit|Enterprise gate|Enterprise Workflow|thumbgate\.app/i);
  assert.match(index, /href="\/blog\/gemini-decisions-and-the-gate"/);
  assert.match(index, /Enterprise gate · \$499/);
});

test('OpenCode guide matches the 1.39.1 adapter and stays advisory', () => {
  const page = read('public/blog/opencode-and-thumbgate.html');
  const index = read('public/blog.html');
  assert.match(page, /npx thumbgate init --agent opencode/);
  assert.match(page, /thumbgate@1\.39\.1/);
  assert.match(page, /advisory/i);
  assert.match(page, /does not parse as JSON/);
  assert.match(page, /https:\/\/opencode\.ai\//);
  assert.doesNotMatch(page, /4941|gemini-decision-1|\$0\.10|hosted audit|Enterprise gate/i);
  assert.match(index, /href="\/blog\/opencode-and-thumbgate"/);
});
