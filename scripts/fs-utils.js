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
 * Read a JSONL (JSON Lines) file into an array of parsed objects.
 * Silently skips malformed lines and returns [] if file is missing.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {number} [options.maxLines] - Read at most N lines (from the end if reverse=true)
 * @param {boolean} [options.reverse] - Read lines in reverse order (most recent first)
 * @returns {object[]}
 */
function readJsonl(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];

  let lines = raw.split('\n');

  if (options.reverse) {
    lines = lines.reverse();
  }

  if (options.maxLines && options.maxLines > 0) {
    lines = lines.slice(0, options.maxLines);
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
  ensureDir(path.dirname(filePath));
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
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}

module.exports = { ensureDir, readJsonl, appendJsonl, writeJson };
