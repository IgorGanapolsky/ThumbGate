'use strict';

const fs = require('node:fs');

/**
 * Read recent JSONL rows since `sinceMs`, scanning at most maxBytes from EOF.
 * Avoids loading multi-MB ledgers entirely into memory (export timeout fix).
 */
function readJsonlSinceTail(filePath, {
  sinceMs = 0,
  limit = 1000,
  maxBytes = 8 * 1024 * 1024,
  timestampKeys = ['timestamp', 'receivedAt', 'ts', 'createdAt'],
} = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { rows: [], totalAfterSince: 0, truncated: false, scannedBytes: 0 };
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { rows: [], totalAfterSince: 0, truncated: false, scannedBytes: 0 };
  }

  const size = stat.size || 0;
  if (size === 0) {
    return { rows: [], totalAfterSince: 0, truncated: false, scannedBytes: 0 };
  }

  const scanBytes = Math.min(size, Math.max(64 * 1024, maxBytes));
  const start = Math.max(0, size - scanBytes);
  let buf;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      buf = Buffer.alloc(scanBytes);
      fs.readSync(fd, buf, 0, scanBytes, start);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { rows: [], totalAfterSince: 0, truncated: false, scannedBytes: 0 };
  }

  let text = buf.toString('utf8');
  // If we started mid-file, drop the partial first line.
  if (start > 0) {
    const nl = text.indexOf('\n');
    text = nl >= 0 ? text.slice(nl + 1) : '';
  }

  const matched = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    let parsed = NaN;
    for (const key of timestampKeys) {
      const raw = obj && obj[key];
      if (raw == null) continue;
      parsed = typeof raw === 'number' ? raw : Date.parse(raw);
      if (Number.isFinite(parsed)) break;
    }
    // Preserve since filter: only include rows with a parseable timestamp
    // inside the window. Legacy/malformed lines without timestamps must not
    // inflate totalAfterSince or journey summaries.
    if (Number.isFinite(parsed) && parsed >= sinceMs) {
      matched.push(obj);
    }
  }

  const totalAfterSince = matched.length;
  const rows = matched.slice(-Math.max(1, limit));
  return {
    rows,
    totalAfterSince,
    truncated: totalAfterSince > rows.length || start > 0,
    scannedBytes: scanBytes,
  };
}

module.exports = {
  readJsonlSinceTail,
};
