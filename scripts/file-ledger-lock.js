#!/usr/bin/env node
'use strict';

/**
 * Cross-process lock for append-only local ledgers.
 *
 * `mkdir` is the atomic acquisition primitive. An owner record prevents a
 * crashed process from permanently wedging the control plane, while a nonce
 * check prevents an old owner from deleting a replacement lock.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STALE_MS = 30 * 1000;

function withFileLedgerLock(lockPath, callback, options = {}) {
  const resolvedLockPath = path.resolve(lockPath);
  fs.mkdirSync(path.dirname(resolvedLockPath), { recursive: true });
  const owner = acquireLock(resolvedLockPath, options);
  try {
    if (typeof options.beforeCallback === 'function') options.beforeCallback();
    return callback();
  } finally {
    releaseOwnedLock(resolvedLockPath, owner);
  }
}

function acquireLock(lockPath, options) {
  const now = options.now || new Date();
  const staleMs = positiveNumber(options.lockStaleMs, DEFAULT_STALE_MS);
  const owner = {
    schemaVersion: 'thumbgate-ledger-lock-v1',
    pid: process.pid,
    nonce: crypto.randomUUID(),
    acquiredAt: now.toISOString(),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.mkdirSync(lockPath);
      writeOwner(lockPath, owner);
      return owner;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!recoverStaleLock(lockPath, now, staleMs)) {
        throw lockError(options, 'ledger is busy; deny and retry only after the active writer finishes');
      }
    }
  }
  throw lockError(options, 'ledger lock could not be acquired after stale-lock recovery');
}

function recoverStaleLock(lockPath, now, staleMs) {
  const observed = readOwner(lockPath);
  const ageMs = lockAgeMs(lockPath, observed, now);
  if (ageMs < staleMs || processIsAlive(observed?.pid)) return false;

  // Rename is atomic. If another process already recovered or replaced the
  // lock, this attempt loses harmlessly and acquisition is retried.
  const quarantine = `${lockPath}.stale-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.renameSync(lockPath, quarantine);
  } catch (error) {
    if (['ENOENT', 'EEXIST'].includes(error.code)) return true;
    throw error;
  }
  fs.rmSync(quarantine, { recursive: true, force: true });
  return true;
}

function writeOwner(lockPath, owner) {
  const target = path.join(lockPath, 'owner.json');
  const temporary = `${target}.tmp-${process.pid}-${owner.nonce}`;
  fs.writeFileSync(temporary, `${JSON.stringify(owner)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
}

function readOwner(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

function lockAgeMs(lockPath, owner, now) {
  const recorded = Date.parse(owner?.acquiredAt || '');
  if (Number.isFinite(recorded)) return Math.max(0, now.getTime() - recorded);
  try {
    return Math.max(0, now.getTime() - fs.statSync(lockPath).mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function releaseOwnedLock(lockPath, owner) {
  const recorded = readOwner(lockPath);
  if (!recorded || recorded.nonce !== owner.nonce) return;
  try { fs.unlinkSync(path.join(lockPath, 'owner.json')); } catch (error) {
    if (error.code !== 'ENOENT') return;
  }
  try { fs.rmdirSync(lockPath); } catch { /* a replacement owner wins */ }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function lockError(options, message) {
  return typeof options.errorFactory === 'function'
    ? options.errorFactory(message)
    : Object.assign(new Error(message), { code: 'THUMBGATE_LEDGER_BUSY' });
}

module.exports = {
  DEFAULT_STALE_MS,
  withFileLedgerLock,
};
