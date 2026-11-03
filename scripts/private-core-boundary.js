'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PRIVATE_CORE_CANDIDATES = [
  process.env.THUMBGATE_CORE_PATH,
  path.resolve(__dirname, '../../ThumbGate-Core'),
  '/Users/iganapolsky/workspace/ThumbGate-Core',
  '/Users/iganapolsky/papercompute-cassettes/ThumbGate-Core',
].filter(Boolean);

function resolvePrivateCoreRoot() {
  for (const candidate of DEFAULT_PRIVATE_CORE_CANDIDATES) {
    try {
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
      }
    } catch (_) {
      // ignore unreadable candidate
    }
  }
  return null;
}

function normalizeRequest(request) {
  return String(request || '').trim();
}

function resolvePrivateCoreModulePath(request) {
  const coreRoot = resolvePrivateCoreRoot();
  if (!coreRoot) return null;
  const normalized = normalizeRequest(request);
  if (!normalized) return null;
  const base = path.basename(normalized).replace(/\.js$/i, '') + '.js';
  const candidates = [
    path.join(coreRoot, 'scripts', base),
    path.join(coreRoot, 'src', base),
    path.join(coreRoot, 'src', 'api', base),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function isOptionalModuleMissing(error, request) {
  if (!error || error.code !== 'MODULE_NOT_FOUND') {
    return false;
  }
  const message = String(error?.message || '');
  const normalizedRequest = normalizeRequest(request);
  const basename = path.basename(normalizedRequest);
  return [normalizedRequest, basename]
    .filter(Boolean)
    .some((candidate) => message.includes(candidate));
}

function loadOptionalModule(request, fallbackFactory) {
  try {
    return require(request);
  } catch (error) {
    if (!isOptionalModuleMissing(error, request)) {
      throw error;
    }
    const privateCorePath = resolvePrivateCoreModulePath(request);
    if (privateCorePath) {
      try {
        return require(privateCorePath);
      } catch (coreError) {
        if (!isOptionalModuleMissing(coreError, privateCorePath)) {
          throw coreError;
        }
      }
    }
    return typeof fallbackFactory === 'function'
      ? fallbackFactory(error)
      : (fallbackFactory || {});
  }
}

function getPrivateCoreStatus() {
  const coreRoot = resolvePrivateCoreRoot();
  const exclusiveModules = [
    'bot-detector.js',
    'hook-rlhf-cache-updater.js',
    'post-to-x.js',
    'prove-subway-upgrades.js',
    'rlhf-search.js',
    'social-pipeline.js',
    'status-dashboard.js',
    'x-autonomous-marketing.js',
  ];
  const availableExclusiveModules = coreRoot
    ? exclusiveModules.filter((name) => fs.existsSync(path.join(coreRoot, 'scripts', name)))
    : [];
  return {
    mounted: Boolean(coreRoot),
    coreRoot,
    availableExclusiveModules,
    exclusiveCount: availableExclusiveModules.length,
  };
}

function createUnavailableError(feature, options = {}) {
  const err = new Error(
    `${feature} moved behind the ThumbGate-Core boundary and is unavailable in the public thumbgate package.`
  );
  err.code = 'THUMBGATE_CORE_REQUIRED';
  err.statusCode = options.statusCode || 503;
  err.feature = feature;
  return err;
}

function createUnavailableOperation(feature, options = {}) {
  return function unavailableOperation() {
    throw createUnavailableError(feature, options);
  };
}

function createUnavailableAsyncOperation(feature, options = {}) {
  return async function unavailableAsyncOperation() {
    throw createUnavailableError(feature, options);
  };
}

function createUnavailableReport(feature, extra = {}) {
  return {
    available: false,
    source: 'ThumbGate-Core',
    message: `${feature} requires ThumbGate-Core.`,
    ...extra,
  };
}

module.exports = {
  createUnavailableAsyncOperation,
  createUnavailableError,
  createUnavailableOperation,
  createUnavailableReport,
  getPrivateCoreStatus,
  isOptionalModuleMissing,
  loadOptionalModule,
  resolvePrivateCoreModulePath,
  resolvePrivateCoreRoot,
};

