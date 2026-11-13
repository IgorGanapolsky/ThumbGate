'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const path = require('node:path');

const storage = new AsyncLocalStorage();

function existingRealPath(candidate) {
  let current = path.resolve(candidate);
  const missing = [];
  while (!fs.existsSync(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw scopeError('Tenant scope cannot follow a dangling symbolic link');
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...missing);
}

function scopeError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function withDataScope(scope, callback) {
  if (!scope || !['tenant', 'legacy'].includes(scope.kind) || !path.isAbsolute(scope.feedbackDir || '')) {
    throw scopeError('Invalid trusted data scope');
  }
  if (scope.kind === 'tenant' && !scope.tenantId) throw scopeError('Tenant scope requires an authenticated identity');
  if (scope.kind === 'tenant' && fs.existsSync(scope.feedbackDir) && fs.lstatSync(scope.feedbackDir).isSymbolicLink()) {
    throw scopeError('Tenant data root cannot be a symbolic link');
  }
  const frozen = Object.freeze({
    kind: scope.kind,
    tenantId: scope.tenantId || null,
    principalId: scope.principalId || null,
    feedbackDir: existingRealPath(scope.feedbackDir),
    lexicalRoot: path.resolve(scope.feedbackDir),
  });
  return storage.run(frozen, callback);
}

function withoutDataScope(callback) {
  return storage.exit(callback);
}

function currentDataScope() {
  return storage.getStore() || null;
}

function tenantDataScope() {
  const scope = currentDataScope();
  return scope?.kind === 'tenant' ? scope : null;
}

function assertScopedDataPath(candidate) {
  const resolved = path.resolve(String(candidate || ''));
  const scope = tenantDataScope();
  if (!scope) return resolved;
  const inside = (value, root = scope.feedbackDir) => value === root || value.startsWith(root + path.sep);
  if ((!inside(resolved) && !inside(resolved, scope.lexicalRoot)) || !inside(existingRealPath(resolved))) {
    throw scopeError('Path must stay within the authenticated tenant scope');
  }
  return resolved;
}

function scopedStatePath(legacyPath) {
  const scope = tenantDataScope();
  return scope ? assertScopedDataPath(path.join(scope.feedbackDir, path.basename(legacyPath))) : legacyPath;
}

function dataScopeKey() {
  const scope = currentDataScope();
  return scope ? `${scope.kind}:${scope.feedbackDir}` : 'legacy';
}

function restrictedWorkerEnv(scope = tenantDataScope()) {
  if (!scope) return process.env;
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    HOME: scope.feedbackDir,
    THUMBGATE_FEEDBACK_DIR: scope.feedbackDir,
    THUMBGATE_DISABLE_TELEMETRY: '1',
    THUMBGATE_WORKER_SCOPE: JSON.stringify(scope),
  };
}

module.exports = {
  withDataScope,
  withoutDataScope,
  currentDataScope,
  tenantDataScope,
  assertScopedDataPath,
  scopedStatePath,
  dataScopeKey,
  restrictedWorkerEnv,
};
