#!/usr/bin/env node
'use strict';

/**
 * Slopsquat Guard — intercepts package-install commands and flags hallucinated /
 * typosquatted dependencies BEFORE they install.
 *
 * Why this exists (industry trend, 2026): LLM coding agents hallucinate package
 * names — ~20% of model-suggested npm/PyPI packages do not exist — and attackers
 * register the most-frequently-hallucinated names within hours to ship malware
 * ("slopsquatting"). The Stanford AI Index 2026 lists it among the top new attack
 * surfaces for autonomous agents. The documented defense is to intercept the
 * install command and verify the package before it touches the machine — exactly
 * ThumbGate's PreToolUse mechanism.
 *
 * Gap this closes: ThumbGate's existing supply-chain checks only scan package.json
 * *writes*. Nothing inspected the actual `npm install <pkg>` / `pip install <pkg>`
 * Bash command, and nothing checked a package name for typosquatting at install
 * time. This module does, deterministically and offline (no network in the hot
 * path): single-character typosquats of popular packages are the classic, almost-
 * always-malicious slopsquat vector.
 *
 * Design:
 *   - Offline + deterministic: Levenshtein distance to a bundled popular-package
 *     list per ecosystem. No network call in the gate path (honors local-first +
 *     latency + deny-network-egress). Optional online existence verification is a
 *     separate, explicitly-invoked async utility (verifyPackageExists).
 *   - False-positive safe: a KNOWN_LEGIT allowlist exempts popular packages and
 *     their legitimate near-neighbors (e.g. `preact` is distance-1 from `react`).
 *   - Configurable severity via THUMBGATE_SLOPSQUAT_MODE = block | warn | off.
 */

// ---------------------------------------------------------------------------
// Popular packages (the typosquat targets) — most-downloaded npm + PyPI.
// Compact on purpose: typosquats target the head of the distribution.
// ---------------------------------------------------------------------------

const POPULAR_NPM = [
  'express', 'lodash', 'axios', 'react', 'react-dom', 'vue', 'angular', 'moment',
  'chalk', 'commander', 'inquirer', 'jest', 'mocha', 'chai', 'webpack', 'rollup',
  'typescript', 'eslint', 'prettier', 'nodemon', 'dotenv', 'cors', 'uuid', 'debug',
  'semver', 'glob', 'minimatch', 'yargs', 'request', 'bluebird', 'async', 'redux',
  'classnames', 'styled-components', 'tailwindcss', 'next', 'nuxt', 'svelte', 'vite',
  'babel-core', 'core-js', 'rxjs', 'jquery', 'bootstrap', 'socket.io', 'mongoose',
  'sequelize', 'pg', 'mysql', 'mysql2', 'redis', 'ioredis', 'knex', 'prisma',
  'graphql', 'apollo-server', 'passport', 'jsonwebtoken', 'bcrypt', 'bcryptjs',
  'body-parser', 'cookie-parser', 'multer', 'helmet', 'morgan', 'winston', 'pino',
  'node-fetch', 'got', 'undici', 'ws', 'cheerio', 'puppeteer', 'playwright',
  'nanoid', 'date-fns', 'dayjs', 'zod', 'yup', 'joi', 'ajv', 'fastify', 'koa',
  'nestjs', 'esbuild', 'turbo', 'vitest', 'cypress', 'supertest', 'sinon',
  'husky', 'lint-staged', 'concurrently', 'cross-env', 'rimraf', 'fs-extra',
  'execa', 'ora', 'boxen', 'figlet', 'dotenv-expand', 'pnpm', 'yarn', 'npm',
  'typeorm', 'drizzle-orm', 'tslib', 'immer', 'zustand', 'recoil', 'jotai',
  'react-router', 'react-router-dom', 'react-query', 'swr', 'formik', 'lodash-es',
];

const POPULAR_PYPI = [
  'requests', 'urllib3', 'numpy', 'pandas', 'scipy', 'matplotlib', 'flask',
  'django', 'fastapi', 'pydantic', 'sqlalchemy', 'celery', 'redis', 'boto3',
  'botocore', 'setuptools', 'wheel', 'pip', 'six', 'certifi', 'idna', 'chardet',
  'charset-normalizer', 'pyyaml', 'click', 'jinja2', 'markupsafe', 'werkzeug',
  'pytest', 'tox', 'coverage', 'black', 'flake8', 'mypy', 'isort', 'pylint',
  'ruff', 'poetry', 'pillow', 'opencv-python', 'scikit-learn', 'tensorflow',
  'torch', 'torchvision', 'transformers', 'datasets', 'huggingface-hub',
  'openai', 'anthropic', 'langchain', 'tiktoken', 'tqdm', 'rich', 'typer',
  'httpx', 'aiohttp', 'starlette', 'uvicorn', 'gunicorn', 'cryptography',
  'pyjwt', 'bcrypt', 'passlib', 'python-dotenv', 'python-dateutil', 'pytz',
  'beautifulsoup4', 'lxml', 'selenium', 'scrapy', 'sympy', 'networkx',
  'plotly', 'seaborn', 'statsmodels', 'protobuf', 'grpcio', 'psycopg2',
  'psycopg2-binary', 'pymongo', 'elasticsearch', 'kafka-python', 'pika',
];

// Legitimate packages that sit near a popular name and must NOT be flagged.
const KNOWN_LEGIT_EXTRA = [
  'preact', 'react-is', 'vue-router', 'requests-oauthlib', 'requests-toolbelt',
  'aioredis', 'pytest-cov', 'flask-cors', 'flask-login', 'django-cors-headers',
  'lodash.merge', 'lodash.get', 'next-auth', 'vitest-fetch-mock', 'eslint-config-next',
  'numpy-financial', 'pandas-stubs', 'types-requests', 'asyncpg',
];

const NPM_SET = new Set(POPULAR_NPM);
const PYPI_SET = new Set(POPULAR_PYPI);
const KNOWN_LEGIT = new Set([...POPULAR_NPM, ...POPULAR_PYPI, ...KNOWN_LEGIT_EXTRA]);

// ---------------------------------------------------------------------------
// Levenshtein (bounded) — returns the edit distance, capped at `max + 1`.
// ---------------------------------------------------------------------------

function levenshtein(a, b, max = 2) {
  a = String(a);
  b = String(b);
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1; // early exit — no path within budget
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

// ---------------------------------------------------------------------------
// Install-command parsing
// ---------------------------------------------------------------------------

// Verb sets per ecosystem. The matched verb tells us how to interpret the rest.
const NPM_INSTALL = /^(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|in)\b/;
const NPM_EXEC = /^(?:npx|pnpm\s+dlx|bunx|yarn\s+dlx)\s+/;
const PIP_INSTALL = /^(?:pip3?|uv\s+pip|pipx)\s+install\b|^(?:uv|poetry)\s+add\b|^python3?\s+-m\s+pip\s+install\b/;

function isFlag(tok) {
  return tok.startsWith('-');
}

// Tokens that are not package names (paths, urls, vcs, local installs, options).
function isNonPackageToken(tok) {
  if (!tok) return true;
  if (tok === '.' || tok === '..') return true;
  if (/^(?:https?|git|git\+|file|ssh):/.test(tok)) return true;
  if (tok.includes('://')) return true;
  if (tok.startsWith('git+') || tok.startsWith('github:') || tok.startsWith('file:')) return true;
  if (tok.startsWith('.') || tok.startsWith('/') || tok.startsWith('~')) return true; // local path
  if (tok.startsWith('@') && tok.includes('/') === false) return true; // bare @scope (rare)
  return false;
}

/**
 * Strip a version / extras specifier to the bare package name.
 *   express@4.18.2 -> express ;  requests==2.0 -> requests
 *   requests[socks] -> requests ;  @scope/pkg@1.0 -> @scope/pkg
 */
function bareName(tok) {
  let name = tok.trim();
  // pip extras: name[extra]
  name = name.replace(/\[[^\]]*\]/g, '');
  // pip version operators
  name = name.split(/[<>=!~ ]/)[0];
  // npm version: keep leading @scope, strip trailing @version
  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    if (slash !== -1) {
      const at = name.indexOf('@', slash);
      if (at !== -1) name = name.slice(0, at);
    }
  } else {
    const at = name.indexOf('@');
    if (at > 0) name = name.slice(0, at);
  }
  return name.trim();
}

/**
 * Parse a shell command (possibly chained with && ; |) into install targets.
 * @returns {Array<{ecosystem:'npm'|'pypi', name:string, raw:string}>}
 */
function parseInstallCommands(command) {
  const targets = [];
  if (!command || typeof command !== 'string') return targets;

  const segments = command.split(/&&|\|\||;|\n|\|/);
  for (const rawSeg of segments) {
    const seg = rawSeg.trim().replace(/\s+/g, ' ');
    if (!seg) continue;

    let ecosystem = null;
    let rest = null;

    const npmExec = seg.match(NPM_EXEC);
    if (NPM_INSTALL.test(seg)) {
      ecosystem = 'npm';
      rest = seg.replace(NPM_INSTALL, '');
    } else if (PIP_INSTALL.test(seg)) {
      ecosystem = 'pypi';
      rest = seg.replace(PIP_INSTALL, '');
    } else if (npmExec) {
      ecosystem = 'npm';
      rest = seg.slice(npmExec[0].length);
    } else {
      continue;
    }

    const tokens = rest.split(' ').filter(Boolean);
    for (const tok of tokens) {
      if (isFlag(tok)) continue;
      if (isNonPackageToken(tok)) continue;
      const name = bareName(tok);
      if (!name) continue;
      // npx <pkg> only treats the FIRST package token as the executed package.
      targets.push({ ecosystem, name, raw: tok });
      if (npmExec) break;
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Slopsquat detection
// ---------------------------------------------------------------------------

function nearestPopular(name, ecosystem) {
  const list = ecosystem === 'pypi' ? POPULAR_PYPI : POPULAR_NPM;
  let best = null;
  let bestDist = 3;
  for (const target of list) {
    if (Math.abs(target.length - name.length) > 2) continue;
    const d = levenshtein(name, target, 2);
    if (d < bestDist) {
      bestDist = d;
      best = target;
      if (d === 1) break;
    }
  }
  return best ? { match: best, distance: bestDist } : null;
}

/**
 * Classify a single package install for slopsquat risk.
 * @returns {null | {severity:'critical'|'high', id, label, suggestion, package, ecosystem}}
 */
function detectSlopsquat(name, ecosystem = 'npm') {
  const lower = String(name || '').toLowerCase();
  if (!lower) return null;

  const exactSet = ecosystem === 'pypi' ? PYPI_SET : NPM_SET;
  // pip normalizes _ and . to - for comparison
  const normalized = ecosystem === 'pypi' ? lower.replace(/[_.]/g, '-') : lower;

  if (exactSet.has(normalized) || KNOWN_LEGIT.has(normalized) || KNOWN_LEGIT.has(lower)) {
    return null; // it IS the real, popular package (or a known legit neighbor)
  }

  const near = nearestPopular(normalized, ecosystem);
  if (near && near.distance === 1) {
    return {
      severity: 'critical',
      id: 'slopsquat-typosquat',
      package: name,
      ecosystem,
      suggestion: near.match,
      label: `Possible typosquat/slopsquat: "${name}" is one character from "${near.match}" (${ecosystem}). Hallucinated/typosquatted package names are a known agent malware vector.`,
    };
  }
  if (near && near.distance === 2 && normalized.length >= 5) {
    return {
      severity: 'high',
      id: 'slopsquat-near-miss',
      package: name,
      ecosystem,
      suggestion: near.match,
      label: `Suspicious package name: "${name}" closely resembles "${near.match}" (${ecosystem}). Verify it exists and is the package you intend before installing.`,
    };
  }
  return null;
}

/**
 * Scan a Bash command for slopsquat risk across all install targets.
 * @returns {{ detected: boolean, findings: Array }}
 */
function scanInstallCommand(command) {
  const targets = parseInstallCommands(command);
  const findings = [];
  const seen = new Set();
  for (const t of targets) {
    const key = `${t.ecosystem}:${t.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const finding = detectSlopsquat(t.name, t.ecosystem);
    if (finding) findings.push({ ...finding, category: 'supply-chain' });
  }
  return { detected: findings.length > 0, findings };
}

/**
 * Resolve enforcement mode. THUMBGATE_SLOPSQUAT_MODE = block (default) | warn | off.
 * `block` means a distance-1 (critical) finding denies the action; near-miss warns.
 */
function resolveMode(env = process.env) {
  const m = String(env.THUMBGATE_SLOPSQUAT_MODE || 'block').trim().toLowerCase();
  return m === 'warn' || m === 'off' ? m : 'block';
}

// ---------------------------------------------------------------------------
// Optional online existence verification — NOT used in the gate hot path.
// Exposed for explicit audit/CLI use. Requires global fetch.
// ---------------------------------------------------------------------------

async function verifyPackageExists(name, ecosystem = 'npm', options = {}) {
  if (typeof fetch !== 'function') return { ok: true, checked: false, reason: 'no-fetch' };
  const timeoutMs = options.timeoutMs || 4000;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const url = ecosystem === 'pypi'
      ? `https://pypi.org/pypi/${encodeURIComponent(name)}/json`
      : `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`;
    const res = await fetch(url, { signal: controller ? controller.signal : undefined });
    return { ok: res.status !== 404, checked: true, status: res.status, exists: res.status !== 404 };
  } catch (err) {
    // Network failure must never block — fail open (the offline heuristics already ran).
    return { ok: true, checked: false, reason: err && err.name === 'AbortError' ? 'timeout' : 'error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  scanInstallCommand,
  parseInstallCommands,
  detectSlopsquat,
  nearestPopular,
  levenshtein,
  bareName,
  resolveMode,
  verifyPackageExists,
  POPULAR_NPM,
  POPULAR_PYPI,
};
