#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const { getFeedbackPaths } = require('./feedback-loop');

function buildProductIssueTitle(body, category = 'bug') {
  const prefix = category === 'feature'
    ? '[Feature] '
    : category === 'question'
      ? '[Question] '
      : '[Bug] ';
  const trimmed = String(body || '').trim();
  return prefix + trimmed.slice(0, 80) + (trimmed.length > 80 ? '...' : '');
}

function buildProductIssueBody(body, category = 'bug', source = 'dashboard feedback widget') {
  return [
    '## User Feedback',
    '',
    String(body || '').trim(),
    '',
    '---',
    `*Submitted via ${source}*`,
    `*Category: ${category || 'bug'}*`,
  ].join('\n');
}

function appendProductFeedbackLog(entry) {
  const feedbackLogPath = path.join(getFeedbackPaths().FEEDBACK_DIR, 'user-feedback.jsonl');
  const feedbackDir = path.dirname(feedbackLogPath);
  if (!fs.existsSync(feedbackDir)) fs.mkdirSync(feedbackDir, { recursive: true });
  fs.appendFileSync(feedbackLogPath, `${JSON.stringify(entry)}\n`);
  return feedbackLogPath;
}

function createGithubIssue({ owner, repo, token, title, body, labels }) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({ title, body, labels });
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/issues`,
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        'User-Agent': 'ThumbGate-Product-Feedback',
      },
    }, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

async function submitProductIssue({
  title,
  body,
  category = 'bug',
  source = 'dashboard feedback widget',
  githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  repoFullName = 'IgorGanapolsky/ThumbGate',
} = {}) {
  const trimmedTitle = String(title || '').trim();
  const trimmedBody = String(body || '').trim();
  if (!trimmedTitle) throw new Error('title required');
  if (trimmedBody.length < 5) throw new Error('body too short');

  const feedbackEntry = {
    title: trimmedTitle,
    body: trimmedBody,
    category,
    source,
    timestamp: new Date().toISOString(),
  };
  appendProductFeedbackLog(feedbackEntry);

  if (!githubToken) {
    return {
      success: true,
      issueNumber: null,
      issueUrl: null,
      note: 'logged locally (no GitHub token)',
    };
  }

  const [owner, repo] = String(repoFullName).split('/');
  try {
    const issue = await createGithubIssue({
      owner,
      repo,
      token: githubToken,
      title: trimmedTitle,
      body: buildProductIssueBody(trimmedBody, category, source),
      labels: ['user-feedback', category || 'bug'].filter(Boolean),
    });
    return {
      success: true,
      issueNumber: issue.number || null,
      issueUrl: issue.html_url || null,
      note: issue.number ? 'filed in GitHub' : 'logged locally',
    };
  } catch {
    return {
      success: true,
      issueNumber: null,
      issueUrl: null,
      note: 'logged locally',
    };
  }
}

module.exports = {
  appendProductFeedbackLog,
  buildProductIssueBody,
  buildProductIssueTitle,
  submitProductIssue,
};
