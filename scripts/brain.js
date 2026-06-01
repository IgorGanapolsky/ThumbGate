'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BRAIN_ROOT = path.join('.thumbgate', 'brain');
const SOUL_FILES = Object.freeze({
  'company-profile.md': `# company-profile.md

Operating truth for this repo, customer, or team. Keep it short, specific, and current.

- Who are we serving?
- What does this system actually do?
- Where do we win?
- Where do we not play?
- What claims require evidence before they are repeated?
`,
  'style-guide.md': `# style-guide.md

Concrete output rules. Avoid vague adjectives; use pass/fail examples.

- Tone directive: concise, evidence-grounded, and explicit about uncertainty.
- Passing example: "CI passed on commit abc123 after rerunning the failing test."
- Failing example: "Everything is definitely fixed" without command evidence.
`,
  'audience.md': `# audience.md

Capture worries, objections, trust signals, and language used by the people this work serves.

- Primary users:
- Common objections:
- What earns trust:
- Words or framing to avoid:
`,
  'keyword-map.md': `# keyword-map.md

For marketing or SEO work, capture how this repo or customer thinks about its category.

- Terms we own:
- Terms we want:
- Competitor-owned terms to handle carefully:
- Terms we do not want to chase:
`,
  'never-do.md': `# never-do.md

Hard constraints for agents. Each bullet should be specific enough to check before action.

- Never claim a release, deploy, publish, metric, or CI result without command or URL evidence.
- Never store secrets, raw transcripts, credentials, or private customer exports in brain memory.
- Never repeat a rejected plan without citing the newer source that changed the decision.
`,
});

const ROUTER_TEMPLATE = `# router.md

At the start of every important task, load only the relevant brain context.

Always read:
- .thumbgate/brain/soul/company-profile.md
- .thumbgate/brain/soul/never-do.md

If the task involves writing, marketing, SEO, outreach, or public copy, also read:
- .thumbgate/brain/soul/style-guide.md
- .thumbgate/brain/soul/audience.md
- .thumbgate/brain/soul/keyword-map.md
- .thumbgate/brain/memory/patterns/content.md

If the task involves coding, tests, CI, deploys, or tool failures, also read:
- .thumbgate/brain/memory/patterns/engineering.md
- .thumbgate/brain/memory/patterns/tool-failures.md
- the latest 5 files in .thumbgate/brain/memory/decisions/

If the user gives thumbs feedback, a correction, or a rejected idea, write one sourced memory entry.

Every factual memory entry must include:
- Source:
- Date:
- Tags:
`;

const MEMORY_DIRS = Object.freeze(['decisions', 'patterns', 'feedback', 'log']);

function brainRoot(root = process.cwd()) {
  return path.join(root, BRAIN_ROOT);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    return true;
  }
  return false;
}

function writeIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`);
  return true;
}

function ensureBrain(root = process.cwd()) {
  const base = brainRoot(root);
  const created = [];
  if (ensureDir(base)) created.push(path.relative(root, base));

  const soulDir = path.join(base, 'soul');
  if (ensureDir(soulDir)) created.push(path.relative(root, soulDir));
  for (const [fileName, template] of Object.entries(SOUL_FILES)) {
    const target = path.join(soulDir, fileName);
    if (writeIfMissing(target, template)) created.push(path.relative(root, target));
  }

  const memoryDir = path.join(base, 'memory');
  if (ensureDir(memoryDir)) created.push(path.relative(root, memoryDir));
  for (const dirName of MEMORY_DIRS) {
    const target = path.join(memoryDir, dirName);
    if (ensureDir(target)) created.push(path.relative(root, target));
  }

  const defaultPatterns = {
    'content.md': '# content.md\n\n- Capture repeated copy, SEO, and positioning lessons here with sources.\n',
    'engineering.md': '# engineering.md\n\n- Capture repeated coding, testing, CI, and release lessons here with sources.\n',
    'tool-failures.md': '# tool-failures.md\n\n- Capture tool failure patterns, commands, outputs, and workarounds here with sources.\n',
  };
  for (const [fileName, content] of Object.entries(defaultPatterns)) {
    const target = path.join(memoryDir, 'patterns', fileName);
    if (writeIfMissing(target, content)) created.push(path.relative(root, target));
  }

  const routerPath = path.join(base, 'router.md');
  if (writeIfMissing(routerPath, ROUTER_TEMPLATE)) created.push(path.relative(root, routerPath));

  const gatesPath = path.join(base, 'never-do-gates.json');
  if (writeIfMissing(gatesPath, JSON.stringify(buildNeverDoGates(root), null, 2))) {
    created.push(path.relative(root, gatesPath));
  }

  return {
    ok: true,
    brainDir: base,
    created,
    soulFiles: Object.keys(SOUL_FILES).map((name) => path.join(BRAIN_ROOT, 'soul', name)),
    memoryDirs: MEMORY_DIRS.map((name) => path.join(BRAIN_ROOT, 'memory', name)),
    router: path.join(BRAIN_ROOT, 'router.md'),
    gates: path.join(BRAIN_ROOT, 'never-do-gates.json'),
  };
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

function taskMatches(task, words) {
  const text = String(task || '').toLowerCase();
  return words.some((word) => text.includes(word));
}

function latestMarkdownFiles(dirPath, limit = 5) {
  try {
    return fs.readdirSync(dirPath)
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.join(dirPath, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, limit);
  } catch (_) {
    return [];
  }
}

function routedBrainFiles(root = process.cwd(), task = '') {
  const base = brainRoot(root);
  const files = [
    path.join(base, 'soul', 'company-profile.md'),
    path.join(base, 'soul', 'never-do.md'),
  ];

  if (taskMatches(task, ['write', 'copy', 'marketing', 'seo', 'outreach', 'content', 'brief'])) {
    files.push(
      path.join(base, 'soul', 'style-guide.md'),
      path.join(base, 'soul', 'audience.md'),
      path.join(base, 'soul', 'keyword-map.md'),
      path.join(base, 'memory', 'patterns', 'content.md')
    );
  }

  if (taskMatches(task, ['code', 'test', 'ci', 'deploy', 'tool', 'debug', 'release', 'pr'])) {
    files.push(
      path.join(base, 'memory', 'patterns', 'engineering.md'),
      path.join(base, 'memory', 'patterns', 'tool-failures.md'),
      ...latestMarkdownFiles(path.join(base, 'memory', 'decisions'), 5)
    );
  }

  return Array.from(new Set(files));
}

function buildContextPack(root = process.cwd(), options = {}) {
  ensureBrain(root);
  const files = routedBrainFiles(root, options.task || '');
  const sections = [];
  const missing = [];

  for (const filePath of files) {
    const relative = path.relative(root, filePath);
    const content = readTextIfExists(filePath).trim();
    if (!content) {
      missing.push(relative);
      continue;
    }
    sections.push(`## ${relative}\n\n${content}`);
  }

  return {
    ok: true,
    task: options.task || '',
    files: files.map((filePath) => path.relative(root, filePath)),
    missing,
    neverDoRules: readNeverDoRules(root),
    text: sections.join('\n\n'),
  };
}

function slugify(value) {
  return String(value || 'memory')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'memory';
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(String).map((tag) => tag.trim()).filter(Boolean);
  return String(tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
}

function memoryTypeDir(type) {
  const normalized = String(type || 'log').toLowerCase();
  if (['decision', 'decisions'].includes(normalized)) return 'decisions';
  if (['pattern', 'patterns'].includes(normalized)) return 'patterns';
  if (['feedback', 'correction', 'thumbs'].includes(normalized)) return 'feedback';
  return 'log';
}

function recordMemory(root = process.cwd(), entry = {}) {
  ensureBrain(root);
  const source = String(entry.source || '').trim();
  if (!source) {
    return {
      ok: false,
      error: 'brain memory requires --source so future agents can trust the lesson',
    };
  }

  const now = entry.date ? new Date(entry.date) : new Date();
  const isoDate = Number.isNaN(now.getTime()) ? new Date().toISOString().slice(0, 10) : now.toISOString().slice(0, 10);
  const title = String(entry.title || entry.content || 'Brain memory').trim();
  const dirName = memoryTypeDir(entry.type);
  const targetDir = path.join(brainRoot(root), 'memory', dirName);
  ensureDir(targetDir);
  const target = path.join(targetDir, `${isoDate}-${slugify(title)}.md`);
  const tags = normalizeTags(entry.tags);
  const body = [
    `# ${isoDate} - ${title}`,
    '',
    entry.content ? String(entry.content).trim() : title,
    '',
    entry.reason ? `Reason: ${String(entry.reason).trim()}` : null,
    `Source: ${source}`,
    `Date: ${isoDate}`,
    `Tags: ${tags.join(', ') || 'brain-memory'}`,
    '',
  ].filter((line) => line !== null).join('\n');

  fs.writeFileSync(target, body);
  return {
    ok: true,
    path: path.relative(root, target),
    type: dirName,
    source,
    tags,
  };
}

function parseNeverDoLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('-')) return null;
  const text = trimmed.replace(/^-\s*/, '').trim();
  if (!text) return null;
  const quoted = text.match(/"([^"]+)"/);
  const match = quoted ? quoted[1] : text.replace(/^Never\s+/i, '').replace(/\.$/, '');
  return {
    id: `never-do-${slugify(quoted ? quoted[1] : text)}`,
    text,
    match,
    tokens: match.toLowerCase().match(/[a-z0-9]+/g) || [],
  };
}

function readNeverDoRules(root = process.cwd()) {
  const neverDoPath = path.join(brainRoot(root), 'soul', 'never-do.md');
  return readTextIfExists(neverDoPath)
    .split(/\r?\n/)
    .map(parseNeverDoLine)
    .filter(Boolean);
}

function buildNeverDoGates(root = process.cwd()) {
  const rules = readNeverDoRules(root);
  return {
    version: 1,
    source: path.join(BRAIN_ROOT, 'soul', 'never-do.md'),
    generatedAt: new Date().toISOString(),
    gates: rules.map((rule) => ({
      id: rule.id,
      type: 'never-do',
      severity: 'block',
      match: rule.match,
      rule: rule.text,
      requiresOverrideEvidence: true,
    })),
  };
}

function refreshNeverDoGates(root = process.cwd()) {
  ensureBrain(root);
  const gates = buildNeverDoGates(root);
  const target = path.join(brainRoot(root), 'never-do-gates.json');
  fs.writeFileSync(target, `${JSON.stringify(gates, null, 2)}\n`);
  return {
    ok: true,
    path: path.relative(root, target),
    gateCount: gates.gates.length,
    gates,
  };
}

function checkNeverDo(root = process.cwd(), input = {}) {
  ensureBrain(root);
  const text = String(input.text || input.action || '').toLowerCase();
  const blocked = readNeverDoRules(root).filter((rule) => {
    const match = String(rule.match || '').toLowerCase();
    if (match && text.includes(match)) return true;
    const meaningfulTokens = (rule.tokens || [])
      .filter((token) => token.length >= 4)
      .filter((token) => !['never', 'without', 'before', 'after', 'with'].includes(token));
    if (meaningfulTokens.length === 0) return false;
    const matched = meaningfulTokens.filter((token) => text.includes(token));
    return matched.length >= Math.min(4, meaningfulTokens.length);
  });

  return {
    ok: blocked.length === 0,
    decision: blocked.length ? 'block' : 'allow',
    blocked,
  };
}

function fileAgeDays(filePath, now = Date.now()) {
  try {
    return Math.floor((now - fs.statSync(filePath).mtimeMs) / 86400000);
  } catch (_) {
    return 0;
  }
}

function scanMemoryFiles(root = process.cwd()) {
  const memoryRoot = path.join(brainRoot(root), 'memory');
  const files = [];
  for (const dirName of MEMORY_DIRS) {
    const dirPath = path.join(memoryRoot, dirName);
    for (const fileName of latestMarkdownFiles(dirPath, Number.MAX_SAFE_INTEGER)) {
      files.push({
        type: dirName,
        path: fileName,
        relative: path.relative(root, fileName),
        content: readTextIfExists(fileName),
      });
    }
  }
  return files;
}

function cleanupReport(root = process.cwd(), options = {}) {
  ensureBrain(root);
  const staleDays = Number(options.staleDays || options['stale-days'] || 60);
  const files = scanMemoryFiles(root);
  const unsourced = files.filter((file) => !/^Source:\s*\S+/mi.test(file.content));
  const stale = files.filter((file) => fileAgeDays(file.path) >= staleDays);
  const seen = new Map();
  const duplicates = [];
  for (const file of files) {
    const title = (file.content.match(/^#\s+(.+)$/m) || [null, path.basename(file.path)])[1];
    const key = slugify(title);
    if (seen.has(key)) duplicates.push([seen.get(key).relative, file.relative]);
    else seen.set(key, file);
  }

  return {
    ok: unsourced.length === 0,
    total: files.length,
    staleDays,
    unsourced: unsourced.map((file) => file.relative),
    stale: stale.map((file) => ({ path: file.relative, ageDays: fileAgeDays(file.path) })),
    duplicates,
  };
}

function formatContextPack(pack) {
  const header = [
    'ThumbGate brain context pack',
    '=============================',
    `Task: ${pack.task || '(unspecified)'}`,
    `Files: ${pack.files.length}`,
    '',
  ].join('\n');
  return `${header}${pack.text}\n`;
}

module.exports = {
  BRAIN_ROOT,
  SOUL_FILES,
  MEMORY_DIRS,
  buildContextPack,
  buildNeverDoGates,
  checkNeverDo,
  cleanupReport,
  ensureBrain,
  formatContextPack,
  readNeverDoRules,
  recordMemory,
  refreshNeverDoGates,
  routedBrainFiles,
};
