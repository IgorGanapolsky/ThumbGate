#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CORP_AIRGAP_RE = /\b(eci|psn|ecinexus|eciplatform|stockservice|khameleon|ddms)\b/i;

function slugifyProjectName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'default';
}

function readJsonlLines(filePath, maxLines = 1500) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !CORP_AIRGAP_RE.test(l))
      .slice(-maxLines);
  } catch {
    return [];
  }
}

function readTextSafe(filePath, maxChars = 32000) {
  if (!fs.existsSync(filePath)) return '';
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (CORP_AIRGAP_RE.test(raw)) return '';
    return raw.slice(0, maxChars);
  } catch {
    return '';
  }
}

function discoverMachineThumbGateProjects({ homeDir = os.homedir() } = {}) {
  const bySlug = new Map();
  const seenDirs = new Set();

  const tryAddCandidate = (projectRootDir, displayLabel, explicitSlug) => {
    let absRoot = path.resolve(projectRootDir);
    try {
      absRoot = fs.realpathSync(absRoot);
    } catch { /* keep resolved path */ }
    if (seenDirs.has(absRoot)) return;
    if (CORP_AIRGAP_RE.test(absRoot) || CORP_AIRGAP_RE.test(displayLabel)) return;
    if (absRoot.includes('.worktrees') || absRoot.includes('-wt-') || absRoot.includes('RealEstate-lanes')) return;

    const tgDir = path.basename(absRoot) === '.thumbgate'
      ? absRoot
      : path.join(absRoot, '.thumbgate');
    if (!fs.existsSync(tgDir) || !fs.statSync(tgDir).isDirectory()) return;

    const fbPath = path.join(tgDir, 'feedback-log.jsonl');
    const memPath = path.join(tgDir, 'memory-log.jsonl');
    const rulesPath = path.join(tgDir, 'prevention-rules.md');

    const feedbackLines = readJsonlLines(fbPath);
    const memoryLines = readJsonlLines(memPath);
    const preventionRules = readTextSafe(rulesPath);

    if (feedbackLines.length === 0 && memoryLines.length === 0 && !preventionRules.trim()) {
      return;
    }

    seenDirs.add(absRoot);
    const shortDir = absRoot.startsWith(homeDir)
      ? `~${absRoot.slice(homeDir.length)}`
      : absRoot;
    const slug = explicitSlug || slugifyProjectName(displayLabel);
    const existing = bySlug.get(slug);
    if (!existing || feedbackLines.length > existing.feedbackLines.length) {
      bySlug.set(slug, {
        slug,
        name: displayLabel,
        projectDir: shortDir,
        feedbackLines,
        memoryLines,
        preventionRules,
      });
    }
  };

  // 1. Scan ~/workspace/* and ~/workspace/projects/*
  const workspaceRoots = [
    path.join(homeDir, 'workspace'),
    path.join(homeDir, 'workspace', 'projects'),
  ];

  for (const wsRoot of workspaceRoots) {
    if (!fs.existsSync(wsRoot)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(wsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(wsRoot, entry.name);
      tryAddCandidate(fullPath, entry.name, slugifyProjectName(entry.name));
    }
  }

  // 2. Also include ~/.thumbgate (global CLI runtime)
  tryAddCandidate(path.join(homeDir, '.thumbgate'), 'global-cli (~/.thumbgate)', 'global-thumbgate');

  // Sort by signal count descending
  const candidates = Array.from(bySlug.values());
  candidates.sort((a, b) => b.feedbackLines.length - a.feedbackLines.length);

  // Also include aggregate workspace entry for iganapolsky-workspace so Google SSO default slug is populated
  const allFb = [];
  const allMem = [];
  for (const c of candidates) {
    allFb.push(...c.feedbackLines);
    allMem.push(...c.memoryLines);
  }
  candidates.unshift({
    slug: 'iganapolsky-workspace',
    name: '🌐 All Machine Projects (iganapolsky-workspace)',
    projectDir: '~/workspace/*',
    feedbackLines: allFb,
    memoryLines: allMem,
    preventionRules: candidates.map((c) => c.preventionRules).filter(Boolean).join('\n\n'),
  });

  return candidates;
}

async function syncProjectsToCloud({
  apiBaseUrl = process.env.THUMBGATE_CLOUD_URL || 'https://thumbgate.ai',
  authToken = process.env.THUMBGATE_SSO_TOKEN || process.env.THUMBGATE_API_KEY || '',
  email = process.env.THUMBGATE_USER_EMAIL || 'igor@igorganapolsky.com',
} = {}) {
  const projects = discoverMachineThumbGateProjects();
  if (!authToken) {
    return {
      ok: false,
      error: 'missing_auth_token',
      discoveredCount: projects.length,
      projects: projects.map((p) => ({
        slug: p.slug,
        name: p.name,
        projectDir: p.projectDir,
        signals: p.feedbackLines.length,
        memories: p.memoryLines.length,
      })),
    };
  }

  const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v1/projects/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      email,
      projects,
    }),
  });

  const data = await res.json();
  return {
    status: res.status,
    ...data,
  };
}

if (require.main === module) {
  syncProjectsToCloud()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result && result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  discoverMachineThumbGateProjects,
  syncProjectsToCloud,
};
