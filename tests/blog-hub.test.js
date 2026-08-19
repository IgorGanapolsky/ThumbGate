'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('blog hub is a Poolside-style series index with CTAs', () => {
  const hub = read('public', 'blog.html');
  assert.match(hub, /Self-Improving Firewall Engineering/i);
  assert.match(hub, /Process over outcome/i);
  assert.match(hub, /Inside your boundary/i);
  assert.match(hub, /href="\/blog\/process-over-outcome-gates"/);
  assert.match(hub, /href="\/blog\/inside-your-boundary"/);
  assert.match(hub, /href="\/blog\/a-10-dollar-vps-is-not-a-computer"/);
  assert.match(hub, /Igor Ganapolsky · 7 min read/);
  assert.match(hub, /Enterprise gate · \$499/);
  assert.match(hub, /"@type": "Blog"/);
});

test('blog posts exist with honest process and boundary claims', () => {
  const processPost = read('public', 'blog', 'process-over-outcome-gates.html');
  const boundaryPost = read('public', 'blog', 'inside-your-boundary.html');

  assert.match(processPost, /Process over outcome/i);
  assert.match(processPost, /not(?:<\/strong>)?\s*retrain your model/i);
  assert.match(processPost, /Autoresearch safety/i);
  assert.match(processPost, /\$499/);

  assert.match(boundaryPost, /inside your boundary/i);
  assert.match(boundaryPost, /Local-first checks/i);
  assert.match(boundaryPost, /Enterprise Workflow Gate/i);
  assert.match(boundaryPost, /do not claim a full air-gapped/i);

  const computerPost = read('public', 'blog', 'a-10-dollar-vps-is-not-a-computer.html');
  assert.match(computerPost, /A \$10 VPS is not a Computer/);
  assert.match(computerPost, /Igor Ganapolsky · 7 min read/);
  assert.match(computerPost, /CHAT_COMPLETIONS_ONLY/);
  assert.match(computerPost, /POLICY_CUE_NOT_DRIVER/);
  assert.match(computerPost, /thumbgate\.app\/\?utm_source=blog/);
  assert.match(computerPost, /cursor\.com\/blog/);
  assert.match(computerPost, /Related posts/);
  assert.doesNotMatch(computerPost, /\$499/);
  assert.doesNotMatch(computerPost, /Continuity/);
  assert.doesNotMatch(computerPost, /1,800/);
});

test('server maps /blog/* posts like learn and guides', () => {
  const server = read('src', 'api', 'server.js');
  assert.match(server, /const BLOG_DIR = /);
  assert.match(server, /BLOG_PAGE_PATHS_BY_SLUG/);
  assert.match(server, /pathname\.startsWith\('\/blog\/'\)/);
  assert.match(server, /dir: 'blog', route: '\/blog'/);
});
