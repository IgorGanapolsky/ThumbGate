#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  getClaudePluginLatestDownloadUrl,
} = require('./distribution-surfaces');

const ROOT = path.join(__dirname, '..');
const CONFIG_RELATIVE_PATH = path.join('config', 'github-about.json');
const LEGACY_REPOSITORY_URL = 'https://github.com/IgorGanapolsky/mcp-memory-gateway';
const GITHUB_API_BASE_URL = 'https://api.github.com';

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTopics(topics) {
  return [...new Set((topics || []).map((topic) => normalizeText(topic).toLowerCase()).filter(Boolean))].sort();
}

function normalizeUrl(value) {
  const text = normalizeText(value);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return text.replace(/\/+$/, '');
  }
}

function extractUrls(text) {
  return (String(text || '').match(/https?:\/\/[^\s"'`<>]+/g) || []).map((url) => normalizeUrl(url));
}

function hasExactUrl(text, targetUrl) {
  const normalizedTarget = normalizeUrl(targetUrl);
  return extractUrls(text).includes(normalizedTarget);
}

function hasRepositoryUrl(text, targetUrl) {
  const normalizedTarget = normalizeUrl(targetUrl);
  return extractUrls(text).some((candidate) => (
    candidate === normalizedTarget ||
    candidate.startsWith(`${normalizedTarget}/`) ||
    candidate.startsWith(`${normalizedTarget}?`) ||
    candidate.startsWith(`${normalizedTarget}#`)
  ));
}

function loadGitHubAboutConfig(root = ROOT) {
  const about = readJson(root, CONFIG_RELATIVE_PATH);
  return {
    repo: normalizeText(about.repo),
    repositoryUrl: normalizeText(about.repositoryUrl),
    homepageUrl: normalizeText(about.homepageUrl),
    description: normalizeText(about.description),
    topics: normalizeTopics(about.topics),
  };
}

function buildCanonicalRepoUrls(about) {
  return {
    repositoryUrl: about.repositoryUrl,
    repositoryGitUrl: `${about.repositoryUrl}.git`,
    issuesUrl: `${about.repositoryUrl}/issues`,
    actionsUrl: `${about.repositoryUrl}/actions`,
    licenseUrl: `${about.repositoryUrl}/blob/main/LICENSE`,
    quickStartUrl: `${about.repositoryUrl}#quick-start`,
    pluginsUrl: `${about.repositoryUrl}/tree/main/plugins`,
    readmeImageUrl: `https://raw.githubusercontent.com/${about.repo}/main/docs/diagrams/rlhf-architecture-pb.png`,
    verificationEvidenceUrl: `${about.repositoryUrl}/blob/main/docs/VERIFICATION_EVIDENCE.md`,
    compatibilityReportUrl: `${about.repositoryUrl}/blob/main/proof/compatibility/report.json`,
    automationReportUrl: `${about.repositoryUrl}/blob/main/proof/automation/report.json`,
    gtmPlanUrl: `${about.repositoryUrl}/blob/main/docs/GO_TO_MARKET_REVENUE_WEDGE_2026-03.md`,
    sprintBriefUrl: `${about.repositoryUrl}/blob/main/docs/WORKFLOW_HARDENING_SPRINT.md`,
  };
}

function extractMetaDescription(html) {
  const match = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  return match ? normalizeText(match[1]) : '';
}

function compareGitHubAbout(expected, actual, label = 'Live GitHub About') {
  const errors = [];
  const actualDescription = normalizeText(actual.description);
  const actualHomepage = normalizeText(actual.homepageUrl || actual.homepage);
  const actualTopics = normalizeTopics(actual.topics);

  if (actualDescription !== expected.description) {
    errors.push(`${label} description mismatch`);
  }
  if (actualHomepage !== expected.homepageUrl) {
    errors.push(`${label} homepage mismatch`);
  }
  if (JSON.stringify(actualTopics) !== JSON.stringify(expected.topics)) {
    errors.push(`${label} topics mismatch`);
  }

  return errors;
}

function collectLocalGitHubAboutErrors(root = ROOT) {
  const about = loadGitHubAboutConfig(root);
  const canonical = buildCanonicalRepoUrls(about);
  const landingHtml = readText(root, 'public/index.html');
  const readme = readText(root, 'README.md');
  const packageJson = readJson(root, 'package.json');
  const serverManifest = readJson(root, 'server.json');
  const appManifest = readJson(root, path.join('.github', 'github-app-manifest.json'));
  const marketingCopy = readText(root, path.join('docs', 'MARKETING_COPY_CONGRUENCE.md'));
  const claude = readText(root, 'CLAUDE.md');
  const serverSource = readText(root, path.join('src', 'api', 'server.js'));
  const claudePluginManifest = readJson(root, path.join('.claude-plugin', 'plugin.json'));
  const claudePluginMarketplace = readJson(root, path.join('.claude-plugin', 'marketplace.json'));
  const claudePluginReadme = readText(root, path.join('.claude-plugin', 'README.md'));
  const errors = [];

  function check(condition, message) {
    if (!condition) errors.push(message);
  }

  check(
    extractMetaDescription(landingHtml) === about.description,
    'config/github-about.json description must match public/index.html meta description'
  );
  check(
    packageJson.homepage === about.homepageUrl,
    `package.json homepage must match ${about.homepageUrl}`
  );
  check(
    packageJson.repository.url === canonical.repositoryGitUrl,
    `package.json repository.url must match ${canonical.repositoryGitUrl}`
  );
  check(
    packageJson.bugs.url === canonical.issuesUrl,
    `package.json bugs.url must match ${canonical.issuesUrl}`
  );
  check(
    serverManifest.websiteUrl === about.homepageUrl,
    `server.json websiteUrl must match ${about.homepageUrl}`
  );
  check(
    serverManifest.repository.url === about.repositoryUrl,
    `server.json repository.url must match ${about.repositoryUrl}`
  );
  check(
    hasRepositoryUrl(landingHtml, canonical.repositoryUrl),
    `public/index.html must link to ${canonical.repositoryUrl}`
  );
  check(
    !hasRepositoryUrl(landingHtml, LEGACY_REPOSITORY_URL),
    'public/index.html still links to the legacy GitHub repo URL'
  );
  check(
    hasRepositoryUrl(readme, canonical.repositoryUrl),
    `README.md must link to ${canonical.repositoryUrl}`
  );
  check(
    !hasRepositoryUrl(readme, LEGACY_REPOSITORY_URL),
    'README.md still links to the legacy GitHub repo URL'
  );
  check(
    marketingCopy.includes('config/github-about.json'),
    'docs/MARKETING_COPY_CONGRUENCE.md must reference config/github-about.json as the source of truth'
  );
  check(
    marketingCopy.includes(about.description),
    'docs/MARKETING_COPY_CONGRUENCE.md must include the canonical GitHub About description'
  );
  check(
    claude.includes(`REPO        = ${about.repo}`),
    `CLAUDE.md must declare REPO        = ${about.repo}`
  );
  check(
    appManifest.url === about.homepageUrl,
    `.github/github-app-manifest.json url must match ${about.homepageUrl}`
  );
  check(
    /pre-action gates/i.test(appManifest.description),
    '.github/github-app-manifest.json description must mention pre-action gates'
  );
  check(
    !/persistent memory/i.test(appManifest.description),
    '.github/github-app-manifest.json description must not use stale persistent-memory positioning'
  );
  check(
    hasRepositoryUrl(serverSource, canonical.repositoryUrl),
    `src/api/server.js must link to ${canonical.repositoryUrl}`
  );
  check(
    !hasRepositoryUrl(serverSource, LEGACY_REPOSITORY_URL),
    'src/api/server.js still links to the legacy GitHub repo URL'
  );
  check(
    normalizeUrl(claudePluginManifest.homepage) === about.homepageUrl,
    `.claude-plugin/plugin.json homepage must match ${about.homepageUrl}`
  );
  check(
    normalizeUrl(claudePluginManifest.repository) === about.repositoryUrl,
    `.claude-plugin/plugin.json repository must match ${about.repositoryUrl}`
  );
  check(
    normalizeUrl(claudePluginMarketplace.plugins[0].metadata.homepage) === about.homepageUrl,
    `.claude-plugin/marketplace.json metadata.homepage must match ${about.homepageUrl}`
  );
  check(
    hasRepositoryUrl(claudePluginReadme, canonical.repositoryUrl),
    `.claude-plugin/README.md must link to ${canonical.repositoryUrl}`
  );
  check(
    !hasRepositoryUrl(claudePluginReadme, LEGACY_REPOSITORY_URL),
    '.claude-plugin/README.md still links to the legacy GitHub repo URL'
  );
  check(
    hasExactUrl(claudePluginReadme, getClaudePluginLatestDownloadUrl(root)),
    '.claude-plugin/README.md must link to the latest Claude plugin bundle download'
  );

  return errors;
}

function resolveGitHubToken(explicitToken) {
  return normalizeText(explicitToken || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GH_PAT) || null;
}

function buildGitHubApiHeaders(token) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'thumbgate-github-about-sync',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseGitHubError(response) {
  try {
    const payload = await response.json();
    return payload.message || JSON.stringify(payload);
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

async function fetchLiveGitHubAbout(options = {}) {
  const about = loadGitHubAboutConfig(options.root || ROOT);
  const repo = normalizeText(options.repo) || about.repo;
  const token = resolveGitHubToken(options.token);

  if (!token) {
    try {
      const ghPayload = execFileSync('gh', ['api', `repos/${repo}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const payload = JSON.parse(ghPayload);
      return {
        repo,
        description: normalizeText(payload.description),
        homepageUrl: normalizeText(payload.homepage),
        topics: normalizeTopics(payload.topics),
      };
    } catch {
      // Fall back to the public REST API when GitHub CLI auth is unavailable.
    }
  }

  const response = await fetch(`${GITHUB_API_BASE_URL}/repos/${repo}`, {
    headers: buildGitHubApiHeaders(token),
  });

  if (!response.ok) {
    throw new Error(`GitHub repo metadata fetch failed for ${repo}: ${response.status} ${await parseGitHubError(response)}`);
  }

  const payload = await response.json();
  return {
    repo,
    description: normalizeText(payload.description),
    homepageUrl: normalizeText(payload.homepage),
    topics: normalizeTopics(payload.topics),
  };
}

async function updateLiveGitHubAbout(options = {}) {
  const about = loadGitHubAboutConfig(options.root || ROOT);
  const repo = normalizeText(options.repo) || about.repo;
  const token = resolveGitHubToken(options.token);

  if (!token) {
    throw new Error('GITHUB_TOKEN, GH_TOKEN, or GH_PAT is required to update live GitHub About metadata');
  }

  const repoResponse = await fetch(`${GITHUB_API_BASE_URL}/repos/${repo}`, {
    method: 'PATCH',
    headers: buildGitHubApiHeaders(token),
    body: JSON.stringify({
      description: about.description,
      homepage: about.homepageUrl,
    }),
  });

  if (!repoResponse.ok) {
    throw new Error(`GitHub repo metadata update failed for ${repo}: ${repoResponse.status} ${await parseGitHubError(repoResponse)}`);
  }

  const topicsResponse = await fetch(`${GITHUB_API_BASE_URL}/repos/${repo}/topics`, {
    method: 'PUT',
    headers: buildGitHubApiHeaders(token),
    body: JSON.stringify({
      names: about.topics,
    }),
  });

  if (!topicsResponse.ok) {
    throw new Error(`GitHub repo topics update failed for ${repo}: ${topicsResponse.status} ${await parseGitHubError(topicsResponse)}`);
  }

  return about;
}

module.exports = {
  LEGACY_REPOSITORY_URL,
  buildCanonicalRepoUrls,
  collectLocalGitHubAboutErrors,
  compareGitHubAbout,
  extractMetaDescription,
  fetchLiveGitHubAbout,
  hasExactUrl,
  hasRepositoryUrl,
  loadGitHubAboutConfig,
  normalizeText,
  normalizeTopics,
  normalizeUrl,
  updateLiveGitHubAbout,
};
