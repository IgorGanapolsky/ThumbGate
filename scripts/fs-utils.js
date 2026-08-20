#!/usr/bin/env node
'use strict';

/**
 * Shared filesystem utilities.
 *
 * Consolidates ensureDir() and readJsonl() which were duplicated
 * across 43 and 19 files respectively.
 */

const fs = require('fs');
const path = require('path');

// Shared dashboard/statusline tail. Production feedback JSONL can exceed
// V8 string limits and starve /v1/dashboard past the authenticated proof budget.
const DEFAULT_JSONL_TAIL_BYTES = 4 * 1024 * 1024;
const DEFAULT_JSONL_TAIL_ENTRIES = 20_000;

/**
 * Read a file, or only its newest `maxBytes` when the file is larger.
 * Incomplete first line after a mid-file seek is dropped.
 * @param {string} filePath
 * @param {number} [maxBytes]
 * @returns {{ text: string, truncated: boolean, size: number }}
 */
const HARD_FULL_READ_BYTES = 64 * 1024 * 1024;

function readTextTail(filePath, maxBytes) {
  const stats = fs.statSync(filePath);
  const size = stats.size || 0;
  if (size <= 0) return { text: '', truncated: false, size: 0 };
  let budget = Number(maxBytes);
  // budget<=0 historically meant "read entire file". On oversized prod logs that
  // throws "Cannot create a string longer than 0x1fffffe8 characters".
  // Also refuse full reads when size exceeds the hard ceiling even if the caller
  // passed an oversized maxBytes (dashboard_data 503 / V8 string limit).
  if (size > HARD_FULL_READ_BYTES && (!budget || budget >= size || budget > HARD_FULL_READ_BYTES)) {
    budget = DEFAULT_JSONL_TAIL_BYTES;
  }
  if (!budget || size <= budget) {
    return { text: fs.readFileSync(filePath, 'utf-8'), truncated: false, size };
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(budget);
    fs.readSync(fd, buffer, 0, budget, size - budget);
    let text = buffer.toString('utf-8');
    const firstNewline = text.indexOf('\n');
    if (firstNewline >= 0) text = text.slice(firstNewline + 1);
    return { text, truncated: true, size };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Recursively create a directory if it does not exist.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Recursively create the parent directory for a file path.
 * @param {string} filePath
 */
function ensureParentDir(filePath) {
  ensureDir(path.dirname(filePath));
}

/**
 * Read a JSONL (JSON Lines) file into an array of parsed objects.
 * Silently skips malformed lines and returns [] if file is missing.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {number} [options.maxLines] - Read at most N lines (from the end if reverse=true)
 * @param {boolean} [options.reverse] - Read lines in reverse order (most recent first)
 * @param {boolean} [options.tail] - Read from the end while preserving chronological order
 * @returns {object[]}
 */
function positiveNumber(value) {
  return Math.max(0, Number(value) || 0);
}

function readJsonl(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const normalizedOptions = typeof options === 'number'
    ? { maxLines: options, tail: true }
    : (options || {});
  const maxLines = positiveNumber(normalizedOptions.maxLines);
  // Opt-in full reads only. Unbounded readFileSync blows past V8 string limits
  // on production feedback/memory JSONL (dashboard_data 503 / 0x1fffffe8).
  const wantFull = normalizedOptions.full === true;
  let maxBytes = positiveNumber(normalizedOptions.maxBytes);
  if (!wantFull && maxBytes <= 0) {
    maxBytes = (maxLines > 0 || normalizedOptions.tail)
      ? DEFAULT_JSONL_TAIL_BYTES
      : DEFAULT_JSONL_TAIL_BYTES;
  }
  if (wantFull) {
    maxBytes = 0; // readTextTail(0) => full file
  }
  let raw = '';
  try {
    raw = readTextTail(filePath, maxBytes).text.trim();
  } catch {
    return [];
  }
  if (!raw) return [];
  let lines = raw.split('\n');

  const effectiveMaxLines = maxLines > 0 ? maxLines : DEFAULT_JSONL_TAIL_ENTRIES;
  if (!wantFull) {
    lines = lines.slice(-effectiveMaxLines);
  } else if (normalizedOptions.tail && maxLines > 0) {
    lines = lines.slice(-maxLines);
  }

  if (normalizedOptions.reverse) {
    lines = lines.reverse();
  }

  if (wantFull && !normalizedOptions.tail && maxLines > 0) {
    lines = lines.slice(0, maxLines);
  }

  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Append a JSON object as a line to a JSONL file.
 * Creates parent directories if they do not exist.
 *
 * @param {string} filePath
 * @param {object} payload
 */
function appendJsonl(filePath, payload) {
  ensureParentDir(filePath);
  fs.appendFileSync(filePath, JSON.stringify(payload) + '\n');
}

/**
 * Write a JSON object to a file with pretty-printing.
 * Creates parent directories if they do not exist.
 *
 * @param {string} filePath
 * @param {object} payload
 */
function writeJson(filePath, payload) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}

function readJsonlTail(filePath, limit) {
  return readJsonl(filePath, { maxLines: limit, tail: true });
}

module.exports = {
  DEFAULT_JSONL_TAIL_BYTES,
  DEFAULT_JSONL_TAIL_ENTRIES,
  ensureDir,
  ensureParentDir,
  readJsonl,
  readJsonlTail,
  readTextTail,
  appendJsonl,
  writeJson,
};
