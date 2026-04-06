#!/usr/bin/env node
/**
 * PostToolUse hook: updates ThumbGate statusline cache after feedback_stats calls.
 * Installed by: npx mcp-memory-gateway init --agent claude-code
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.THUMBGATE_FEEDBACK_DIR || process.cwd();
const CACHE_PATH = path.join(CACHE_DIR, '.rlhf', 'statusline_cache.json');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);
    const tool = event.tool_name || '';
    if (tool !== 'mcp__rlhf__feedback_stats' && tool !== 'mcp__rlhf__dashboard') return;

    const raw = event.tool_response;
    if (!raw) return;
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const cache = {};
    if (tool === 'mcp__rlhf__feedback_stats') {
      cache.thumbs_up = String(data.totalPositive || 0);
      cache.thumbs_down = String(data.totalNegative || 0);
      cache.lessons = String((data.rubric || {}).samples || 0);
      cache.approval_rate = String(Math.round((data.approvalRate || 0) * 1000) / 10);
      cache.trend = data.trend || '?';
      cache.total_feedback = String(data.total || 0);
    } else if (tool === 'mcp__rlhf__dashboard') {
      const approval = data.approval || {};
      cache.thumbs_up = String(approval.totalPositive || 0);
      cache.thumbs_down = String(approval.totalNegative || 0);
      cache.lessons = String((data.rubric || {}).samples || 0);
      cache.approval_rate = String(approval.approvalRate || '?');
      cache.trend = approval.trendDirection || '?';
      cache.total_feedback = String(approval.total || 0);
    }
    cache.updated_at = String(Math.floor(Date.now() / 1000));

    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
  } catch (_) { /* silent — statusline cache is best-effort */ }
});
