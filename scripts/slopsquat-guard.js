#!/usr/bin/env node
'use strict';

/**
 * Slopsquat Guard — intercepts package-install commands and flags hallucinated /
 * typosquatted dependencies BEFORE they install.
 */

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

const SHELL_CMDS = new Set(['echo', 'cat', 'ls', 'cd', 'sudo', 'time', 'env', 'xargs', 'mkdir', 'rm', 'cp', 'mv']);
const KNOWN_LEGIT = new Set([...POPULAR_NPM, ...POPULAR_PYPI, 'preact', 'react-is', 'vue-router']);

function levenshtein(a, b, max = 2) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j-1] + 1, prev[j-1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function bareName(tok) {
  let name = tok.trim().replace(/^['"]|['"]$/g, '');
  name = name.replace(/\[[^\]]*\]/g, '');
  name = name.split(/[<>=!~ ]/)[0];
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

function parseInstallCommands(command) {
  const targets = [];
  if (!command) return targets;

  const segments = command.split(/&&|\|\||;|\n|\|/).map(s => s.trim().replace(/^\(|\)$/g, ''));
  for (const seg of segments) {
    const tokens = seg.split(/\s+/).filter(Boolean);
    let ecosystem = null;
    let startIdx = -1;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i].toLowerCase();
      if (['npm', 'pnpm', 'yarn', 'bun'].includes(tok)) {
        if (['install', 'i', 'add', 'in'].includes(tokens[i+1])) {
          ecosystem = 'npm'; startIdx = i + 2; break;
        }
      }
      if (['pip', 'pip3', 'pipx'].includes(tok)) {
        if (tokens[i+1] === 'install') {
          ecosystem = 'pypi'; startIdx = i + 2; break;
        }
      }
      if (tok === 'python' || tok === 'python3') {
        if (tokens[i+1] === '-m' && tokens[i+2] === 'pip' && tokens[i+3] === 'install') {
          ecosystem = 'pypi'; startIdx = i + 4; break;
        }
      }
    }

    if (ecosystem && startIdx !== -1) {
      for (let i = startIdx; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.startsWith('-')) continue;
        const name = bareName(tok);
        if (name) targets.push({ ecosystem, name, raw: tok });
      }
    }
  }
  return targets;
}

function detectSlopsquat(name, ecosystem = 'npm') {
  const lower = name.toLowerCase();
  const list = ecosystem === 'pypi' ? POPULAR_PYPI : POPULAR_NPM;
  if (KNOWN_LEGIT.has(lower)) return null;

  let best = null; let bestDist = 3;
  for (const target of list) {
    const d = levenshtein(lower, target, 2);
    if (d < bestDist) { bestDist = d; best = target; if (d === 1) break; }
  }

  if (best && bestDist === 1) {
    return { severity: 'critical', id: 'slopsquat-typosquat', package: name, ecosystem, suggestion: best, label: `Possible typosquat: "${name}" vs "${best}"` };
  }
  return null;
}

function scanInstallCommand(command) {
  const targets = parseInstallCommands(command);
  const findings = targets.map(t => detectSlopsquat(t.name, t.ecosystem)).filter(Boolean);
  return { detected: findings.length > 0, findings };
}


function resolveMode(env = process.env) {
  const m = String(env.THUMBGATE_SLOPSQUAT_MODE || "block").trim().toLowerCase();
  return m === "warn" || m === "off" ? m : "block";
}

module.exports = { resolveMode,  scanInstallCommand, detectSlopsquat, parseInstallCommands, bareName, levenshtein, POPULAR_NPM, POPULAR_PYPI };
