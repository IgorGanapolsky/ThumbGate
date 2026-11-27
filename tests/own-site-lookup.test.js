'use strict';

// friction-1.9: the owner's outbound-post rule must not refuse a page read or a form lookup on the owner's own site,
// and must keep refusing everything that can be a post.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gatesEngine = require('../scripts/gates-engine');

const RULE = 'outbound-off-brand-vertical-block';
const ROOT = path.join(__dirname, '..');
const OWN = 'https://deals.igorganapolsky.com';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-own-site-'));
const config = path.join(dir, 'gates.json');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const base = read('config/gates/default.json');
fs.writeFileSync(config, JSON.stringify({ ...base, gates: [...base.gates, ...read('config/gates/profiles/private-owner.json').gates] }));
const previousActions = gatesEngine.SESSION_ACTIONS_PATH;
gatesEngine.SESSION_ACTIONS_PATH = path.join(dir, 'session-actions.json');
test.after(() => {
  gatesEngine.SESSION_ACTIONS_PATH = previousActions;
  fs.rmSync(dir, { recursive: true, force: true });
});

const refused = (tool, input) => {
  const decision = gatesEngine.evaluateGates(`mcp__browseros-neo__${tool}`, input, config);
  return Boolean(decision && decision.gate === RULE);
};

test('a read or a form lookup on the own site is not outbound posting', () => {
  for (const [tool, input] of [
    ['navigate', { page: 3, url: `${OWN}/lookup?folio=123` }],
    ['grep', { page: 3, pattern: 'folio' }],
    ['read', { page: 3, selector: '#folio' }],
    ['tabs', { action: 'new', url: `${OWN}/folio` }],
    ['run', { code: `const page = await browser.open('${OWN}/search'); await page.snapshot({ mode: 'interactive' }); await page.fill('e12', 'folio 123'); await page.click('e13'); return await page.read();` }],
  ]) assert.equal(refused(tool, input), false, `${tool} ${JSON.stringify(input)}`);
});

test('anything that can be a post stays refused', () => {
  for (const [tool, input] of [
    ['act', { page: 3, kind: 'fill', value: `New tax-deed offer ${OWN}/x` }],
    ['run', { code: `await page.fill('#editor', 'tax-deed offer ${OWN}')` }],
    ['run', { code: `const p = await browser.open('${OWN}'); await p.goto('https://www.linkedin.com/feed'); await p.fill('e1', 'folio')` }],
    ['run', { code: `const p = await browser.open('${OWN}'); const q = await browser.page(2); await q.fill('e1', 'folio')` }],
    ['run', { code: `const p = await browser.open('${OWN}'); await q.fill('e1', 'folio')` }],
    ['run', { code: `const p = await browser.open('${OWN}'); await p.goto(next); await p.fill('e1', 'folio')` }],
    ['run', { code: `const p = await browser.open('${OWN}'); await p.evaluate("document.title = 'folio'")` }],
    ['run', { code: "const p = await browser.open('https://example.com/form'); await p.fill('e1', 'folio')" }],
    ['run', { code: `const p = await browser.open('${OWN}.evil.example/x'); await p.fill('e1', 'folio')` }],
    ['navigate', { page: 3, url: 'https://x.com/intent/post?text=tax-deed' }],
    ['evaluate', { page: 3, code: "document.querySelector('#e').value = 'tax-deed'" }],
  ]) assert.equal(refused(tool, input), true, `${tool} ${JSON.stringify(input)}`);
});
