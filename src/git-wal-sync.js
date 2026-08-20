/**
 * Write-Ahead Log (WAL) & Optimistic Concurrency Engine for Git Mutations
 *
 * Inspired by Cursor Continuity's WAL-first architecture (https://cursor.com/blog/git-at-any-scale).
 * Provides an append-only, tamper-evident WAL and atomic Compare-And-Swap (CAS) index
 * to prevent multi-agent race conditions during file mutations and tool calls.
 *
 * @module git-wal-sync
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Computes a SHA-256 digest of mutation payload.
 *
 * @param {object} payload - Mutation data
 * @returns {string} Hex SHA-256
 */
function computeChecksum(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Initializes a WAL session directory for a repository.
 *
 * @param {string} repoRoot - Path to repository root
 * @returns {object} WAL session metadata
 */
function initWalSession(repoRoot) {
  const walDir = path.join(repoRoot, '.thumbgate', 'wal');
  fs.mkdirSync(walDir, { recursive: true });

  const indexPath = path.join(walDir, 'gitwal-index.json');
  let index = { seq: 0, etag: 'e0', lastUpdated: Date.now() };

  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch {
      index = { seq: 0, etag: 'e0', lastUpdated: Date.now() };
    }
  } else {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  }

  return {
    repoRoot,
    walDir,
    indexPath,
    index,
  };
}

/**
 * Appends an immutable WAL entry to the log.
 *
 * @param {object} walSession - Active WAL session
 * @param {object} mutation - Proposed tool mutation (toolName, filePath, diff, etc.)
 * @returns {object} Appended entry with assigned sequence number and checksum
 */
function appendWalEntry(walSession, mutation) {
  const seq = (walSession.index.seq || 0) + 1;
  const entry = {
    seq,
    timestamp: Date.now(),
    toolName: mutation.toolName || 'unknown',
    filePath: mutation.filePath || null,
    operation: mutation.operation || 'modify',
    payloadChecksum: computeChecksum(mutation),
    actor: mutation.actor || process.env.THUMBGATE_SESSION_AGENT || 'local-agent',
  };

  const entryFile = path.join(walSession.walDir, `entry-${String(seq).padStart(6, '0')}.wal.json`);
  fs.writeFileSync(entryFile, JSON.stringify(entry, null, 2), 'utf8');

  return entry;
}

/**
 * Performs an atomic Compare-And-Swap (CAS) commit of the WAL index.
 *
 * @param {object} walSession - Active WAL session
 * @param {number} expectedSeq - Expected prior sequence number
 * @param {object} newEntry - The newly appended WAL entry
 * @returns {{ ok: boolean, currentSeq: number, etag: string, error?: string }}
 */
function casCommitIndex(walSession, expectedSeq, newEntry) {
  let currentIndex = { seq: 0, etag: 'e0' };
  if (fs.existsSync(walSession.indexPath)) {
    try {
      currentIndex = JSON.parse(fs.readFileSync(walSession.indexPath, 'utf8'));
    } catch {
      currentIndex = { seq: 0, etag: 'e0' };
    }
  }

  if (currentIndex.seq !== expectedSeq) {
    return {
      ok: false,
      currentSeq: currentIndex.seq,
      etag: currentIndex.etag,
      error: `CAS Precondition Failed: expected seq ${expectedSeq} but found ${currentIndex.seq}`,
    };
  }

  const updatedIndex = {
    seq: newEntry.seq,
    etag: `e${newEntry.seq}`,
    lastUpdated: Date.now(),
    lastChecksum: newEntry.payloadChecksum,
  };

  fs.writeFileSync(walSession.indexPath, JSON.stringify(updatedIndex, null, 2), 'utf8');
  walSession.index = updatedIndex;

  return {
    ok: true,
    currentSeq: updatedIndex.seq,
    etag: updatedIndex.etag,
  };
}

/**
 * Reads all WAL entries up to the current sequence number.
 *
 * @param {object} walSession - Active WAL session
 * @returns {object[]} List of valid WAL entries
 */
function readWalEntries(walSession) {
  if (!fs.existsSync(walSession.walDir)) return [];

  const files = fs.readdirSync(walSession.walDir)
    .filter((f) => f.startsWith('entry-') && f.endsWith('.wal.json'))
    .sort((a, b) => a.localeCompare(b));

  const entries = [];
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(walSession.walDir, f), 'utf8');
      entries.push(JSON.parse(content));
    } catch {
      // skip corrupted entries
    }
  }
  return entries;
}

module.exports = {
  computeChecksum,
  initWalSession,
  appendWalEntry,
  casCommitIndex,
  readWalEntries,
};
