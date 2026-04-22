'use strict';

const path = require('path');

function normalizeRequest(request) {
  return String(request || '').trim();
}

function isOptionalModuleMissing(error, request) {
  if (!error || error.code !== 'MODULE_NOT_FOUND') {
    return false;
  }
  const message = String(error.message || '');
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
    return typeof fallbackFactory === 'function'
      ? fallbackFactory(error)
      : (fallbackFactory || {});
  }
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
  isOptionalModuleMissing,
  loadOptionalModule,
};
