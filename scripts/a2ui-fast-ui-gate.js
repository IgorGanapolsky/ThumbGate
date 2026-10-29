'use strict';

/**
 * Google A2UI, 2026-10-27 — format only.
 * https://developers.googleblog.com/fast-reliable-a2ui/
 *
 * An agent UI is a catalog contract. The model writes short lines.
 * Deterministic code compiles those lines into surface messages.
 * A known screen is a choice among layouts declared ahead of time.
 * A value the system already holds comes from a macro, not from the model.
 *
 * Does not install an A2UI SDK, call a decision-model vendor, or record
 * that vendor's speed or token figures as ThumbGate measurements.
 */

const KNOWN_LAYOUTS = new Set(['settings', 'checkout', 'confirmation']);
const SYSTEM_KEYS = new Set(['price', 'orderStatus', 'email', 'customerEmail']);

const LINE_RE = /^\s*([A-Za-z_][\w.-]*)\s*=\s*([A-Za-z_][\w.-]*)\s*(?:\((.*)\))?\s*$/;
const SURFACE_RE = /^\s*surface\(\s*["']([^"']+)["']\s*\)\s*$/;
const BIND_RE = /^\s*\$\/([A-Za-z_][\w.-]*)\s*=\s*(.+?)\s*$/;
const MACRO_RE = /^([A-Za-z_][\w.-]*)\(\s*["']([^"']+)["']\s*\)$/;
const CODE_RE = /\b(?:eval\s*\(|new\s+Function\s*\(|<script\b|dangerouslySetInnerHTML\b)/i;
const INSTALL_VERB_RE = /\b(?:npm\s+install|pnpm\s+add|yarn\s+add|pip\s+install|git\s+clone)\b/i;
const ARCHETYPE_RE = /\b(settings|checkout|confirmation)\s+(?:screen|page)\b/i;
const ROOT_RE = /\broot\s*=\s*[A-Za-z_]/;
const LAYOUT_RE = /\blayoutId\s*[:=]\s*['"]?([A-Za-z0-9_-]+)/i;

function catalogIds(catalog) {
  if (!catalog) return null;
  if (catalog instanceof Set) return catalog.size > 0 ? catalog : null;
  if (typeof catalog === 'string') {
    const trimmed = catalog.trim();
    if (!trimmed) return null;
    try {
      return catalogIds(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  let list = [];
  if (Array.isArray(catalog)) list = catalog;
  else if (catalog && Array.isArray(catalog.components)) list = catalog.components;
  else return null;
  const ids = new Set();
  for (const item of list) {
    const id = typeof item === 'string' ? item.trim() : String(item && item.id || '').trim();
    if (id) ids.add(id);
  }
  return ids.size > 0 ? ids : null;
}

function compileCatalogLines({ catalog, source, macros = {} } = {}) {
  const ids = catalogIds(catalog);
  if (!ids) {
    return { ok: false, error: 'empty_catalog', messages: [], errors: [{ line: 0, reason: 'empty_catalog' }] };
  }
  const lines = String(source || '').split(/\r?\n/);
  const components = [];
  const dataModel = {};
  const errors = [];
  let surfaceId = 'main';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    if (CODE_RE.test(line)) {
      errors.push({ line: i + 1, reason: 'arbitrary_code' });
      continue;
    }
    const surface = SURFACE_RE.exec(line);
    if (surface) {
      surfaceId = surface[1];
      continue;
    }
    const binding = BIND_RE.exec(line);
    if (binding) {
      const key = binding[1];
      const raw = binding[2].trim();
      const macro = MACRO_RE.exec(raw);
      if (SYSTEM_KEYS.has(key) && !macro) {
        errors.push({ line: i + 1, reason: 'system_value_needs_macro', key });
        continue;
      }
      dataModel[key] = macro
        ? { macro: macro[1], id: macro[2] }
        : raw.replace(/^["']|["']$/g, '');
      continue;
    }
    const match = LINE_RE.exec(line);
    if (!match) {
      errors.push({ line: i + 1, reason: 'invalid_line' });
      continue;
    }
    const id = match[1];
    const type = match[2];
    const args = match[3] || '';
    if (typeof macros[type] === 'function') {
      const arg = args.trim().replace(/^["']|["']$/g, '');
      components.push({ id, type, data: macros[type](arg) });
      continue;
    }
    if (!ids.has(type)) {
      errors.push({ line: i + 1, reason: 'unknown_component', component: type });
      components.push({ id, type, args: [] });
      continue;
    }
    components.push({
      id,
      type,
      args: args.split(',').map((part) => part.trim()).filter((part) => part && part !== '_'),
    });
  }

  if (!components.some((row) => row.id === 'root')) {
    errors.push({ line: 0, reason: 'missing_root' });
  }
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    surfaceId,
    dataModel,
    messages: ok ? [
      { kind: 'surface', surfaceId },
      { kind: 'data', surfaceId, dataModel },
      { kind: 'components', surfaceId, components },
    ] : [],
  };
}

function commandText(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (!toolInput || typeof toolInput !== 'object') return '';
  return [toolInput.command, toolInput.cmd, toolInput.express, toolInput.ui]
    .filter((part) => typeof part === 'string')
    .join('\n');
}

function catalogSource(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (!toolInput || typeof toolInput !== 'object') return '';
  const ui = [toolInput.express, toolInput.ui].filter((part) => typeof part === 'string');
  if (ui.length > 0) return ui.join('\n');
  return [toolInput.command, toolInput.cmd].filter((part) => typeof part === 'string').join('\n');
}

function fullText(toolName, toolInput) {
  let encoded = '';
  try {
    encoded = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput || {});
  } catch {
    encoded = '';
  }
  return `${toolName || ''}\n${encoded}`;
}

function mentionsSdkInstall(text) {
  const verb = INSTALL_VERB_RE.exec(text);
  if (!verb) return false;
  return SDK_NAME_RE.test(text.slice(verb.index, verb.index + 120));
}

function transportMarkers() {
  return [['create', 'Surface'].join(''), ['update', 'Components'].join('')];
}

function mentionsRawTransport(text) {
  return transportMarkers().some((key) => text.includes(key));
}

function screenName(input, text) {
  const named = String(input.screenArchetype || '').trim().toLowerCase();
  if (KNOWN_LAYOUTS.has(named)) return named;
  const match = text.match(ARCHETYPE_RE);
  return match ? match[1].toLowerCase() : '';
}

function layoutName(input, text) {
  if (typeof input.layoutId === 'string' && input.layoutId.trim()) {
    return input.layoutId.trim().toLowerCase();
  }
  const match = text.match(LAYOUT_RE);
  return match ? match[1].toLowerCase() : '';
}

function evaluateA2uiFastUiPretool({ toolName = '', toolInput = {} } = {}) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const prose = commandText(toolInput);
  const blob = fullText(toolName, toolInput);
  const blockers = [];

  if (mentionsSdkInstall(blob)) {
    blockers.push('a2ui_sdk_install_denied');
  }

  const catalog = catalogIds(input.catalog);
  const uiText = catalogSource(toolInput);
  if (catalog && mentionsRawTransport(uiText)) {
    blockers.push('a2ui_raw_transport_json');
  }

  if (catalog && uiText.trim()) {
    const compiled = compileCatalogLines({
      catalog,
      source: uiText,
      macros: input.macros && typeof input.macros === 'object' ? input.macros : {},
    });
    for (const error of compiled.errors) {
      if (error.reason === 'unknown_component') blockers.push('a2ui_component_outside_catalog');
      else if (error.reason === 'system_value_needs_macro') blockers.push('a2ui_system_value_needs_macro');
      else if (error.reason === 'arbitrary_code') blockers.push('a2ui_arbitrary_code');
      else if (error.reason === 'missing_root') blockers.push('a2ui_missing_root');
      else if (error.reason === 'invalid_line') blockers.push('a2ui_invalid_line');
    }
  }

  const screen = screenName(input, prose);
  const layout = layoutName(input, prose);
  const freeForm = ROOT_RE.test(uiText);
  if (screen && freeForm && !KNOWN_LAYOUTS.has(layout)) {
    blockers.push('a2ui_known_screen_needs_layout');
  }

  return {
    ok: blockers.length === 0,
    blockers: [...new Set(blockers)],
    source: 'google-a2ui-2026-10-27',
  };
}

const SDK_NAME_RE = /@a2ui\/agent|a2ui-agent-sdk|a2ui_agent|jev2ui/i;

module.exports = {
  KNOWN_LAYOUTS,
  compileCatalogLines,
  evaluateA2uiFastUiPretool,
};
