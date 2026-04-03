#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SETTINGS_SCOPE_ORDER = ['defaults', 'user', 'project', 'local', 'managed'];
const DEFAULT_SETTINGS = Object.freeze({
  mcp: {
    defaultProfile: 'essential',
    readonlySessionProfile: 'readonly',
  },
  harnesses: {
    enabled: true,
    allowRuntimeExecution: true,
  },
  dashboard: {
    showSettingsStatus: true,
    showPolicyOrigins: true,
  },
  team: {
    orgVisibilityMode: 'team_rollout',
  },
  policies: {
    surfaceOriginsInStatus: true,
  },
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
  }
  return value;
}

function mergeSettings(base, override) {
  if (!isPlainObject(override)) {
    return cloneValue(override);
  }

  const merged = isPlainObject(base) ? cloneValue(base) : {};
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergeSettings(merged[key], value);
      continue;
    }
    merged[key] = cloneValue(value);
  }
  return merged;
}

function flattenLeafValues(value, prefix = '', entries = []) {
  if (!isPlainObject(value)) {
    if (prefix) {
      entries.push([prefix, cloneValue(value)]);
    }
    return entries;
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(entry)) {
      flattenLeafValues(entry, nextPrefix, entries);
      continue;
    }
    entries.push([nextPrefix, cloneValue(entry)]);
  }

  return entries;
}

function getNestedValue(target, dottedPath) {
  if (!dottedPath) return target;
  return String(dottedPath)
    .split('.')
    .reduce((current, key) => (current && Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined), target);
}

function resolveSettingsPaths(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const homeDir = options.homeDir || process.env.HOME || os.homedir();

  return {
    managed: path.join(projectRoot, 'config', 'thumbgate-settings.managed.json'),
    user: path.join(homeDir, '.thumbgate', 'settings.json'),
    project: path.join(projectRoot, '.thumbgate', 'settings.json'),
    local: path.join(projectRoot, '.thumbgate', 'settings.local.json'),
  };
}

function readJsonObject(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function summarizeOrigins(originsByPath) {
  return Object.values(originsByPath).reduce((summary, origin) => {
    summary[origin.scope] = (summary[origin.scope] || 0) + 1;
    return summary;
  }, {});
}

function resolveSettingsHierarchy(options = {}) {
  const paths = resolveSettingsPaths(options);
  let settings = cloneValue(DEFAULT_SETTINGS);
  const originsByPath = Object.fromEntries(
    flattenLeafValues(DEFAULT_SETTINGS).map(([settingPath, value]) => [
      settingPath,
      {
        scope: 'defaults',
        sourcePath: null,
        value,
      },
    ]),
  );

  const activeLayers = [
    {
      scope: 'defaults',
      sourcePath: null,
      exists: true,
      leafCount: flattenLeafValues(DEFAULT_SETTINGS).length,
    },
  ];

  for (const scope of SETTINGS_SCOPE_ORDER.slice(1)) {
    const sourcePath = paths[scope];
    const data = readJsonObject(sourcePath);
    const exists = Boolean(data);
    activeLayers.push({
      scope,
      sourcePath,
      exists,
      leafCount: exists ? flattenLeafValues(data).length : 0,
    });

    if (!exists) {
      continue;
    }

    settings = mergeSettings(settings, data);
    for (const [settingPath, value] of flattenLeafValues(data)) {
      originsByPath[settingPath] = {
        scope,
        sourcePath,
        value,
      };
    }
  }

  const warnings = activeLayers
    .filter((layer) => !layer.exists && layer.scope !== 'defaults')
    .map((layer) => `No ${layer.scope} settings file at ${layer.sourcePath}`);

  return {
    resolvedSettings: settings,
    settings,
    originsByPath,
    origins: Object.entries(originsByPath)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([settingPath, origin]) => ({ path: settingPath, ...origin })),
    activeLayers,
    originSummary: summarizeOrigins(originsByPath),
    warnings,
    paths,
  };
}

function getSetting(settingPath, options = {}) {
  return getNestedValue(resolveSettingsHierarchy(options).resolvedSettings, settingPath);
}

function getSettingOrigin(settingPath, options = {}) {
  return resolveSettingsHierarchy(options).originsByPath[String(settingPath || '')] || null;
}

function getSettingsStatus(options = {}) {
  const hierarchy = resolveSettingsHierarchy(options);
  return {
    activeLayers: hierarchy.activeLayers,
    originSummary: hierarchy.originSummary,
    origins: hierarchy.origins,
    paths: hierarchy.paths,
    resolvedSettings: hierarchy.resolvedSettings,
    warnings: hierarchy.warnings,
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  SETTINGS_SCOPE_ORDER,
  getSetting,
  getSettingOrigin,
  getSettingsStatus,
  resolveSettingsHierarchy,
  resolveSettingsPaths,
};
