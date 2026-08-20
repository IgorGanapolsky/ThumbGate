'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

/**
 * HashAnchoredEditGuard — Pre-edit concurrency & content collision guard.
 * Inspired by Dirac's Hash-Anchored Edit Engine (Aug 2026).
 *
 * Prevents race condition regressions where concurrent agent sessions or human operators
 * modify code lines while an agent is generating an edit.
 */

function computeChunkHash(content) {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex').slice(0, 16);
}

function evaluateHashAnchoredEdit(request = {}) {
  const { filePath, targetContent, expectedHash, startLine, endLine } = request;

  if (!filePath || !fs.existsSync(filePath)) {
    return {
      allowed: false,
      reason: 'target_file_not_found',
      message: `File does not exist: ${filePath}`,
    };
  }

  let fileContent = '';
  try {
    fileContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      allowed: false,
      reason: 'file_read_error',
      message: `Failed to read ${filePath}: ${err.message}`,
    };
  }

  const lines = fileContent.split('\n');
  let currentSlice = '';

  if (typeof startLine === 'number' && typeof endLine === 'number' && startLine >= 1 && endLine <= lines.length) {
    currentSlice = lines.slice(startLine - 1, endLine).join('\n');
  } else if (targetContent) {
    // Exact target content search
    if (!fileContent.includes(targetContent)) {
      return {
        allowed: false,
        reason: 'target_content_drift',
        message: `Target code block was modified or does not match current file contents.`,
        currentFileHash: computeChunkHash(fileContent),
      };
    }
    currentSlice = targetContent;
  }

  const actualHash = computeChunkHash(currentSlice);

  if (expectedHash && expectedHash !== actualHash) {
    return {
      allowed: false,
      reason: 'hash_anchor_mismatch',
      message: `Hash anchor drift detected: expected ${expectedHash}, found ${actualHash}. Another session or user modified this region.`,
      expectedHash,
      actualHash,
    };
  }

  return {
    allowed: true,
    reason: 'anchor_verified',
    chunkHash: actualHash,
    lineCount: lines.length,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  computeChunkHash,
  evaluateHashAnchoredEdit,
};
