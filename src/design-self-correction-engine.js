'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { computeChunkHash, evaluateHashAnchoredEdit } = require('./hash-anchored-edit');

const WCAG_AA_NORMAL = 4.5;
const WCAG_AA_LARGE = 3.0;
const MIN_TOUCH_TARGET_PX = 44;

// Official Tailwind v3/v4 sRGB hex palette subset for deterministic utility synthesis
const TAILWIND_PALETTE = {
  white: '#ffffff',
  black: '#000000',
  'slate-50': '#f8fafc',
  'slate-100': '#f1f5f9',
  'slate-200': '#e2e8f0',
  'slate-300': '#cbd5e1',
  'slate-400': '#94a3b8',
  'slate-500': '#64748b',
  'slate-600': '#475569',
  'slate-700': '#334155',
  'slate-800': '#1e293b',
  'slate-900': '#0f172a',
  'slate-950': '#020617',
  'gray-50': '#f9fafb',
  'gray-100': '#f3f4f6',
  'gray-200': '#e5e7eb',
  'gray-300': '#d1d5db',
  'gray-400': '#9ca3af',
  'gray-500': '#6b7280',
  'gray-600': '#4b5563',
  'gray-700': '#374151',
  'gray-800': '#1f2937',
  'gray-900': '#111827',
  'gray-950': '#030712',
  'zinc-50': '#fafafa',
  'zinc-100': '#f4f4f5',
  'zinc-200': '#e4e4e7',
  'zinc-300': '#d4d4d8',
  'zinc-400': '#a1a1aa',
  'zinc-500': '#71717a',
  'zinc-600': '#52525b',
  'zinc-700': '#3f3f46',
  'zinc-800': '#27272a',
  'zinc-900': '#18181b',
  'zinc-950': '#09090b',
  'red-200': '#fecaca',
  'red-400': '#f87171',
  'red-600': '#dc2626',
  'red-700': '#b91c1c',
  'red-800': '#991b1b',
  'amber-200': '#fde68a',
  'amber-400': '#fbbf24',
  'amber-700': '#b45309',
  'amber-800': '#92400e',
  'emerald-200': '#a7f3d0',
  'emerald-300': '#6ee7b7',
  'emerald-400': '#34d399',
  'emerald-700': '#047857',
  'emerald-800': '#065f46',
  'blue-200': '#bfdbfe',
  'blue-300': '#93c5fd',
  'blue-400': '#60a5fa',
  'blue-600': '#2563eb',
  'blue-700': '#1d4ed8',
  'blue-800': '#1e40af',
  'indigo-200': '#c7d2fe',
  'indigo-300': '#a5b4fc',
  'indigo-700': '#4338ca',
};

const UNDERSIZED_TW_HEIGHT_CLASSES = new Set([
  'h-3', 'h-3.5', 'h-4', 'h-5', 'h-6', 'h-7', 'h-8', 'h-9',
  'py-0', 'py-0.5', 'py-1', 'p-0', 'p-0.5', 'p-1',
]);

const UNDERSIZED_TW_WIDTH_CLASSES = new Set([
  'w-3', 'w-3.5', 'w-4', 'w-5', 'w-6', 'w-7', 'w-8', 'w-9',
  'px-0', 'px-0.5', 'px-1',
]);

function normalizeHex(rawHex) {
  const clean = String(rawHex || '').replace(/^#/, '').trim();
  if (clean.length === 3 && /^[0-9a-fA-F]{3}$/.test(clean)) {
    return `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`.toLowerCase();
  }
  if (clean.length === 6 && /^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean.toLowerCase()}`;
  }
  return null;
}

function hexToRgb(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function computeRelativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

function computeContrastRatio(fgHex, bgHex) {
  const l1 = computeRelativeLuminance(fgHex);
  const l2 = computeRelativeLuminance(bgHex);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/**
 * Computes the minimal lightness adjustment in HSL space so `fgHex` meets
 * `minContrast` against `bgHex`, preserving hue and saturation when possible.
 */
function solveAccessibleForegroundHex(fgHex, bgHex, minContrast = WCAG_AA_NORMAL) {
  const normBg = normalizeHex(bgHex) || '#0f172a';
  const normFg = normalizeHex(fgHex) || '#64748b';
  const initialRatio = computeContrastRatio(normFg, normBg);
  if (initialRatio !== null && initialRatio >= minContrast) {
    return { hex: normFg, ratio: initialRatio, adjusted: false };
  }

  const bgLum = computeRelativeLuminance(normBg) ?? 0;
  const baseHsl = rgbToHsl(hexToRgb(normFg));

  const searchDirection = (lighten) => {
    let low = lighten ? baseHsl.l : 0;
    let high = lighten ? 1 : baseHsl.l;
    let bestHex = null;
    let bestRatio = 0;

    for (let i = 0; i < 32; i += 1) {
      const mid = (low + high) / 2;
      const candidateHex = rgbToHex(hslToRgb({ h: baseHsl.h, s: baseHsl.s, l: mid }));
      const ratio = computeContrastRatio(candidateHex, normBg) || 0;
      if (ratio >= minContrast) {
        bestHex = candidateHex;
        bestRatio = ratio;
        if (lighten) high = mid;
        else low = mid;
      } else if (lighten) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return bestHex ? { hex: bestHex, ratio: bestRatio } : null;
  };

  // Prefer darkening on light backgrounds and lightening on dark backgrounds, with fallback
  const preferLighten = bgLum < 0.179;
  const primary = searchDirection(preferLighten);
  if (primary) return { ...primary, adjusted: true };

  const secondary = searchDirection(!preferLighten);
  if (secondary) return { ...secondary, adjusted: true };

  const fallbackHex = preferLighten ? '#ffffff' : '#000000';
  return {
    hex: fallbackHex,
    ratio: computeContrastRatio(fallbackHex, normBg) || minContrast,
    adjusted: true,
  };
}

/**
 * Selects the closest Tailwind `text-*` token whose color meets `minContrast`
 * against `bgHex`, preferring the same color family when `existingTextClass` is provided.
 */
function selectCompliantTailwindTextClass(targetHex, bgHex, minContrast = WCAG_AA_NORMAL, existingTextClass = '') {
  const normBg = normalizeHex(bgHex) || '#0f172a';
  const targetRgb = hexToRgb(targetHex) || { r: 248, g: 250, b: 252 };
  const familyMatch = /^text-([a-z]+)-\d+$/.exec(String(existingTextClass || '').trim());
  const preferredFamily = familyMatch ? familyMatch[1] : null;

  let bestToken = null;
  let bestScore = Infinity;

  for (const [token, hex] of Object.entries(TAILWIND_PALETTE)) {
    const ratio = computeContrastRatio(hex, normBg);
    if (ratio === null || ratio < minContrast) continue;
    const rgb = hexToRgb(hex);
    const rgbDist = Math.hypot(rgb.r - targetRgb.r, rgb.g - targetRgb.g, rgb.b - targetRgb.b);
    const familyBonus = preferredFamily && token.startsWith(`${preferredFamily}-`) ? -80 : 0;
    const score = rgbDist + familyBonus;
    if (score < bestScore) {
      bestScore = score;
      bestToken = token;
    }
  }

  if (bestToken) return `text-${bestToken}`;
  return `text-[${normalizeHex(targetHex) || '#f8fafc'}]`;
}

function buildLineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return {
    lineAt(offset) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= offset) lo = mid + 1;
        else hi = mid - 1;
      }
      return hi + 1;
    },
  };
}

/**
 * Linear O(N) span-preserving CSS AST parser (handles standalone .css and embedded <style> blocks).
 */
function parseCssRulesAst(source, baseOffset = 0, lineIndex = buildLineIndex(source)) {
  const rules = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    // Skip whitespace & CSS comments /* ... */
    while (i < len && /\s/.test(source[i])) i += 1;
    if (i + 1 < len && source[i] === '/' && source[i + 1] === '*') {
      const endComment = source.indexOf('*/', i + 2);
      i = endComment === -1 ? len : endComment + 2;
      continue;
    }
    if (i >= len) break;

    const openBrace = source.indexOf('{', i);
    if (openBrace === -1) break;

    const rawSelector = source.slice(i, openBrace).trim();
    // Skip nested @media/@keyframes headers by descending into their block
    if (rawSelector.startsWith('@') && !rawSelector.startsWith('@font-face')) {
      let depth = 1;
      let j = openBrace + 1;
      while (j < len && depth > 0) {
        if (source[j] === '{') depth += 1;
        else if (source[j] === '}') depth -= 1;
        j += 1;
      }
      const innerSource = source.slice(openBrace + 1, Math.max(openBrace + 1, j - 1));
      const innerRules = parseCssRulesAst(innerSource, baseOffset + openBrace + 1, lineIndex);
      rules.push(...innerRules);
      i = j;
      continue;
    }

    let depth = 1;
    let j = openBrace + 1;
    while (j < len && depth > 0) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') depth -= 1;
      j += 1;
    }
    const closeBrace = j - 1;
    if (depth !== 0) break;

    const declarations = [];
    let declCursor = openBrace + 1;
    while (declCursor < closeBrace) {
      while (declCursor < closeBrace && /[\s;]/.test(source[declCursor])) declCursor += 1;
      if (declCursor >= closeBrace) break;
      if (declCursor + 1 < closeBrace && source[declCursor] === '/' && source[declCursor + 1] === '*') {
        const cEnd = source.indexOf('*/', declCursor + 2);
        declCursor = cEnd === -1 ? closeBrace : Math.min(closeBrace, cEnd + 2);
        continue;
      }

      let semi = declCursor;
      let quote = null;
      let parenDepth = 0;
      while (semi < closeBrace) {
        const ch = source[semi];
        if (quote) {
          if (ch === '\\') semi += 1;
          else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '(') {
          parenDepth += 1;
        } else if (ch === ')' && parenDepth > 0) {
          parenDepth -= 1;
        } else if (ch === ';' && parenDepth === 0) {
          break;
        }
        semi += 1;
      }

      const declEnd = semi < closeBrace && source[semi] === ';' ? semi + 1 : semi;
      const rawDecl = source.slice(declCursor, semi);
      const colonIdx = rawDecl.indexOf(':');
      if (colonIdx !== -1) {
        const prop = rawDecl.slice(0, colonIdx).trim().toLowerCase();
        const val = rawDecl.slice(colonIdx + 1).trim();
        const valStartInRaw = colonIdx + 1 + (rawDecl.slice(colonIdx + 1).length - rawDecl.slice(colonIdx + 1).trimStart().length);
        const absDeclStart = baseOffset + declCursor;
        const absDeclEnd = baseOffset + declEnd;
        const absValStart = baseOffset + declCursor + valStartInRaw;
        const absValEnd = absValStart + val.length;
        declarations.push({
          type: 'CssDeclaration',
          property: prop,
          value: val,
          range: [absDeclStart, absDeclEnd],
          valueRange: [absValStart, absValEnd],
          startLine: lineIndex.lineAt(absDeclStart),
          endLine: lineIndex.lineAt(absDeclEnd),
        });
      }
      declCursor = declEnd;
    }

    const absRuleStart = baseOffset + i;
    const absRuleEnd = baseOffset + closeBrace + 1;
    rules.push({
      type: 'CssRule',
      selector: rawSelector,
      declarations,
      bodyRange: [baseOffset + openBrace + 1, baseOffset + closeBrace],
      range: [absRuleStart, absRuleEnd],
      startLine: lineIndex.lineAt(absRuleStart),
      endLine: lineIndex.lineAt(absRuleEnd),
    });

    i = closeBrace + 1;
  }

  return rules;
}

/**
 * Linear O(N) span-preserving HTML/JSX opening-element AST parser.
 */
function parseMarkupElementsAst(source, lineIndex = buildLineIndex(source)) {
  const elements = [];
  const styleBlocks = [];
  const len = source.length;
  let i = 0;

  while (i < len) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;

    // HTML comment <!-- ... -->
    if (source.startsWith('<!--', lt)) {
      const endComment = source.indexOf('-->', lt + 4);
      i = endComment === -1 ? len : endComment + 3;
      continue;
    }
    // Closing tag, doctype, fragment
    const nextChar = source[lt + 1];
    if (!nextChar || nextChar === '/' || nextChar === '!' || nextChar === '?' || nextChar === '>') {
      i = lt + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(nextChar)) {
      i = lt + 1;
      continue;
    }

    let cursor = lt + 1;
    while (cursor < len && /[A-Za-z0-9_.:-]/.test(source[cursor])) cursor += 1;
    const tagName = source.slice(lt + 1, cursor);

    const attributes = [];
    let braceDepth = 0;
    let quote = null;
    let selfClosing = false;

    while (cursor < len) {
      while (cursor < len && /\s/.test(source[cursor])) cursor += 1;
      if (cursor >= len) break;
      if (source[cursor] === '>' && braceDepth === 0 && !quote) {
        cursor += 1;
        break;
      }
      if (source[cursor] === '/' && source[cursor + 1] === '>' && braceDepth === 0 && !quote) {
        selfClosing = true;
        cursor += 2;
        break;
      }

      // JSX spread {...props}
      if (source[cursor] === '{') {
        let d = 1;
        let k = cursor + 1;
        while (k < len && d > 0) {
          if (source[k] === '{') d += 1;
          else if (source[k] === '}') d -= 1;
          k += 1;
        }
        cursor = k;
        continue;
      }

      const attrStart = cursor;
      while (cursor < len && /[A-Za-z0-9_.:@-]/.test(source[cursor])) cursor += 1;
      if (cursor === attrStart) {
        cursor += 1;
        continue;
      }
      const attrName = source.slice(attrStart, cursor);
      while (cursor < len && /\s/.test(source[cursor])) cursor += 1;

      if (source[cursor] !== '=') {
        attributes.push({
          type: 'AttributeNode',
          name: attrName,
          value: '',
          quote: null,
          isJsxExpression: false,
          range: [attrStart, cursor],
          valueRange: [cursor, cursor],
        });
        continue;
      }

      cursor += 1; // skip '='
      while (cursor < len && /\s/.test(source[cursor])) cursor += 1;

      if (source[cursor] === '"' || source[cursor] === "'") {
        quote = source[cursor];
        const valStart = cursor + 1;
        cursor += 1;
        while (cursor < len && source[cursor] !== quote) {
          if (source[cursor] === '\\') cursor += 2;
          else cursor += 1;
        }
        const valEnd = cursor;
        if (cursor < len && source[cursor] === quote) cursor += 1;
        quote = null;
        attributes.push({
          type: 'AttributeNode',
          name: attrName,
          value: source.slice(valStart, valEnd),
          quote: source[valStart - 1],
          isJsxExpression: false,
          range: [attrStart, cursor],
          valueRange: [valStart, valEnd],
        });
      } else if (source[cursor] === '{') {
        const exprStart = cursor + 1;
        let d = 1;
        cursor += 1;
        while (cursor < len && d > 0) {
          const ch = source[cursor];
          if (ch === '"' || ch === "'" || ch === '`') {
            const q = ch;
            cursor += 1;
            while (cursor < len && source[cursor] !== q) {
              if (source[cursor] === '\\') cursor += 2;
              else cursor += 1;
            }
          } else if (ch === '{') {
            d += 1;
          } else if (ch === '}') {
            d -= 1;
            if (d === 0) break;
          }
          cursor += 1;
        }
        const exprEnd = cursor;
        if (cursor < len && source[cursor] === '}') cursor += 1;
        attributes.push({
          type: 'AttributeNode',
          name: attrName,
          value: source.slice(exprStart, exprEnd).trim(),
          quote: null,
          isJsxExpression: true,
          range: [attrStart, cursor],
          valueRange: [exprStart, exprEnd],
        });
      } else {
        const valStart = cursor;
        while (cursor < len && !/[\s/>]/.test(source[cursor])) cursor += 1;
        attributes.push({
          type: 'AttributeNode',
          name: attrName,
          value: source.slice(valStart, cursor),
          quote: null,
          isJsxExpression: false,
          range: [attrStart, cursor],
          valueRange: [valStart, cursor],
        });
      }
    }

    const openTagEnd = cursor;
    const classAttr = attributes.find((a) => a.name === 'class' || a.name === 'className');
    const idAttr = attributes.find((a) => a.name === 'id');
    const styleAttr = attributes.find((a) => a.name === 'style');
    const classes = classAttr && !classAttr.isJsxExpression
      ? classAttr.value.split(/\s+/).filter(Boolean)
      : [];

    elements.push({
      type: 'ElementNode',
      tagName,
      id: idAttr ? idAttr.value : null,
      classes,
      classAttr: classAttr || null,
      styleAttr: styleAttr || null,
      attributes,
      selfClosing,
      openTagRange: [lt, openTagEnd],
      insertAttrOffset: selfClosing ? openTagEnd - 2 : openTagEnd - 1,
      startLine: lineIndex.lineAt(lt),
      endLine: lineIndex.lineAt(Math.max(lt, openTagEnd - 1)),
    });

    if (tagName.toLowerCase() === 'style' && !selfClosing) {
      const lowerRest = source.slice(openTagEnd).toLowerCase();
      const closeRel = lowerRest.indexOf('</style>');
      if (closeRel !== -1) {
        const cssStart = openTagEnd;
        const cssEnd = openTagEnd + closeRel;
        styleBlocks.push({
          cssSource: source.slice(cssStart, cssEnd),
          baseOffset: cssStart,
        });
        i = cssEnd + 8;
        continue;
      }
    }
    if (tagName.toLowerCase() === 'script' && !selfClosing) {
      const lowerRest = source.slice(openTagEnd).toLowerCase();
      const closeRel = lowerRest.indexOf('</script>');
      if (closeRel !== -1) {
        i = openTagEnd + closeRel + 9;
        continue;
      }
    }

    i = openTagEnd;
  }

  return { elements, styleBlocks };
}

/**
 * Parses source into a unified Layout AST (CSS rules + HTML/JSX elements).
 */
function parseLayoutAst(source, options = {}) {
  const text = String(source || '');
  const filePath = String(options.filePath || '');
  const lineIndex = buildLineIndex(text);
  const isPureCss =
    options.language === 'css' ||
    filePath.endsWith('.css') ||
    (!text.includes('<') && text.includes('{') && text.includes(':'));

  if (isPureCss) {
    return {
      type: 'LayoutAst',
      language: 'css',
      cssRules: parseCssRulesAst(text, 0, lineIndex),
      elements: [],
      lineIndex,
    };
  }

  const { elements, styleBlocks } = parseMarkupElementsAst(text, lineIndex);
  const cssRules = [];
  for (const block of styleBlocks) {
    cssRules.push(...parseCssRulesAst(block.cssSource, block.baseOffset, lineIndex));
  }

  const usesJsx =
    options.language === 'jsx' ||
    options.language === 'tsx' ||
    /\.(?:jsx|tsx)$/.test(filePath) ||
    elements.some((el) => el.attributes.some((a) => a.name === 'className' || a.isJsxExpression));

  return {
    type: 'LayoutAst',
    language: usesJsx ? 'jsx' : 'html',
    cssRules,
    elements,
    lineIndex,
  };
}

function parseInlineStyleMap(styleAttr) {
  const map = new Map();
  if (!styleAttr) return map;
  if (!styleAttr.isJsxExpression) {
    for (const part of styleAttr.value.split(';')) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      const prop = part.slice(0, idx).trim().toLowerCase();
      const val = part.slice(idx + 1).trim();
      if (prop) map.set(prop, val);
    }
    return map;
  }
  // JSX style={{ color: '#777', backgroundColor: '#888' }}
  let inner = styleAttr.value.trim();
  if (inner.startsWith('{') && inner.endsWith('}')) {
    inner = inner.slice(1, -1).trim();
  }
  for (const entry of inner.split(',')) {
    const idx = entry.indexOf(':');
    if (idx === -1) continue;
    const rawKey = entry.slice(0, idx).trim().replace(/^['"]|['"]$/g, '');
    const cssProp = rawKey.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    const val = entry.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (cssProp) map.set(cssProp, val);
  }
  return map;
}

function cssPropToCamelCase(prop) {
  return String(prop || '').replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function serializeJsxStyleObject(styleMap) {
  const pairs = [];
  for (const [prop, val] of styleMap.entries()) {
    pairs.push(`${cssPropToCamelCase(prop)}: '${val}'`);
  }
  return `{{ ${pairs.join(', ')} }}`;
}

function serializeHtmlStyleString(styleMap) {
  const pairs = [];
  for (const [prop, val] of styleMap.entries()) {
    pairs.push(`${prop}: ${val}`);
  }
  return `${pairs.join('; ')};`;
}

function extractTailwindColors(classes) {
  let fgHex = null;
  let bgHex = null;
  let textClass = null;
  let bgClass = null;

  for (const cls of classes) {
    if (cls.startsWith('text-[') && cls.endsWith(']')) {
      const hex = normalizeHex(cls.slice(6, -1));
      if (hex) {
        fgHex = hex;
        textClass = cls;
      }
    } else if (cls.startsWith('text-')) {
      const key = cls.slice(5);
      if (TAILWIND_PALETTE[key]) {
        fgHex = TAILWIND_PALETTE[key];
        textClass = cls;
      }
    } else if (cls.startsWith('bg-[') && cls.endsWith(']')) {
      const hex = normalizeHex(cls.slice(4, -1));
      if (hex) {
        bgHex = hex;
        bgClass = cls;
      }
    } else if (cls.startsWith('bg-')) {
      const key = cls.slice(3);
      if (TAILWIND_PALETTE[key]) {
        bgHex = TAILWIND_PALETTE[key];
        bgClass = cls;
      }
    }
  }

  return { fgHex, bgHex, textClass, bgClass };
}

function parsePxValue(raw) {
  const m = /^(-?\d+(?:\.\d+)?)px$/i.exec(String(raw || '').trim());
  return m ? Number(m[1]) : null;
}

function elementSelectorLabel(el) {
  if (el.id) return `${el.tagName}#${el.id}`;
  if (el.classes.length > 0) return `${el.tagName}.${el.classes[0]}`;
  return el.tagName;
}

function matchesSelector(el, selector) {
  const sel = String(selector || '').trim();
  if (!sel) return false;
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return el.classes.includes(sel.slice(1));
  const tagDot = /^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/.exec(sel);
  if (tagDot) return el.tagName.toLowerCase() === tagDot[1].toLowerCase() && el.classes.includes(tagDot[2]);
  const tagHash = /^([a-zA-Z0-9_-]+)#([a-zA-Z0-9_-]+)$/.exec(sel);
  if (tagHash) return el.tagName.toLowerCase() === tagHash[1].toLowerCase() && el.id === tagHash[2];
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

/**
 * Automatically detects layout & accessibility optimization issues directly from the Layout AST
 * when visual-model findings are not pre-supplied (or augments them).
 */
function detectAstOptimizationIssues(ast, defaultBgHex = '#0f172a') {
  const detected = [];

  for (const rule of ast.cssRules) {
    const propMap = new Map(rule.declarations.map((d) => [d.property, d]));
    const colorDecl = propMap.get('color');
    const bgDecl = propMap.get('background-color') || propMap.get('background');
    const fgHex = colorDecl ? normalizeHex(colorDecl.value) : null;
    const bgHex = bgDecl ? normalizeHex(bgDecl.value) : null;
    if (fgHex && bgHex) {
      const ratio = computeContrastRatio(fgHex, bgHex);
      if (ratio !== null && ratio < WCAG_AA_NORMAL) {
        detected.push({
          type: 'contrast_too_low',
          selector: rule.selector,
          foregroundHex: fgHex,
          backgroundHex: bgHex,
          contrastRatio: ratio,
          minContrast: WCAG_AA_NORMAL,
          targetRule: rule,
        });
      }
    }

    const widthDecl = propMap.get('width');
    const maxWidthDecl = propMap.get('max-width');
    const widthPx = widthDecl ? parsePxValue(widthDecl.value) : null;
    if (widthPx !== null && widthPx > 600 && !maxWidthDecl) {
      detected.push({
        type: 'horizontal_overflow',
        selector: rule.selector,
        fixedWidthPx: widthPx,
        targetRule: rule,
      });
    }

    const isInteractiveSelector = /(?:^|[\s>.#:])(button|a|btn|cta)\b/i.test(rule.selector);
    const heightDecl = propMap.get('min-height') || propMap.get('height');
    const heightPx = heightDecl ? parsePxValue(heightDecl.value) : null;
    if (isInteractiveSelector && heightPx !== null && heightPx < MIN_TOUCH_TARGET_PX) {
      detected.push({
        type: 'touch_target_too_small',
        selector: rule.selector,
        measuredHeightPx: heightPx,
        targetRule: rule,
      });
    }
  }

  for (const el of ast.elements) {
    const inlineMap = parseInlineStyleMap(el.styleAttr);
    const twColors = extractTailwindColors(el.classes);
    const fgHex = normalizeHex(inlineMap.get('color')) || twColors.fgHex;
    const bgHex = normalizeHex(inlineMap.get('background-color') || inlineMap.get('background')) || twColors.bgHex || (twColors.textClass ? defaultBgHex : null);

    if (fgHex && bgHex) {
      const ratio = computeContrastRatio(fgHex, bgHex);
      if (ratio !== null && ratio < WCAG_AA_NORMAL) {
        detected.push({
          type: 'contrast_too_low',
          selector: elementSelectorLabel(el),
          foregroundHex: fgHex,
          backgroundHex: bgHex,
          contrastRatio: ratio,
          minContrast: WCAG_AA_NORMAL,
          targetElement: el,
        });
      }
    }

    const lowerTag = el.tagName.toLowerCase();
    const isInteractive = lowerTag === 'button' || lowerTag === 'a' || el.attributes.some((a) => a.name === 'role' && a.value === 'button');
    if (isInteractive) {
      const inlineHeightPx = parsePxValue(inlineMap.get('min-height') || inlineMap.get('height'));
      const hasUndersizedTw = el.classes.some((c) => UNDERSIZED_TW_HEIGHT_CLASSES.has(c) || UNDERSIZED_TW_WIDTH_CLASSES.has(c));
      if ((inlineHeightPx !== null && inlineHeightPx < MIN_TOUCH_TARGET_PX) || hasUndersizedTw) {
        detected.push({
          type: 'touch_target_too_small',
          selector: elementSelectorLabel(el),
          measuredHeightPx: inlineHeightPx || 24,
          targetElement: el,
        });
      }
    }

    const inlineWidthPx = parsePxValue(inlineMap.get('width'));
    const fixedArbitraryWidthClass = el.classes.find((c) => /^w-\[\d{3,4}px\]$/.test(c));
    if (
      (inlineWidthPx !== null && inlineWidthPx > 600 && !inlineMap.has('max-width')) ||
      (fixedArbitraryWidthClass && !el.classes.some((c) => c.startsWith('max-w-')))
    ) {
      detected.push({
        type: 'horizontal_overflow',
        selector: elementSelectorLabel(el),
        fixedWidthPx: inlineWidthPx || Number(fixedArbitraryWidthClass.slice(3, -3)),
        targetElement: el,
      });
    }
  }

  return detected;
}

function buildCssRulePatch(source, rule, declarationsToUpsert) {
  const existingByProp = new Map(rule.declarations.map((d) => [d.property, d]));
  const subEdits = [];
  const toAppend = [];

  for (const { property, value } of declarationsToUpsert) {
    const existing = existingByProp.get(property.toLowerCase());
    if (existing) {
      subEdits.push({
        range: existing.valueRange,
        replacement: value,
        from: existing.value,
        to: value,
        property,
      });
    } else {
      toAppend.push({ property, value });
    }
  }

  const ruleText = source.slice(rule.range[0], rule.range[1]);
  const isMultiline = ruleText.includes('\n');
  let patchedRule = ruleText;

  // Apply value replacements inside rule-relative offsets in reverse order
  subEdits.sort((a, b) => b.range[0] - a.range[0]);
  for (const edit of subEdits) {
    const relStart = edit.range[0] - rule.range[0];
    const relEnd = edit.range[1] - rule.range[0];
    patchedRule = patchedRule.slice(0, relStart) + edit.replacement + patchedRule.slice(relEnd);
  }

  if (toAppend.length > 0) {
    const closeIdx = patchedRule.lastIndexOf('}');
    const prefix = patchedRule.slice(0, closeIdx);
    const trimmedPrefix = prefix.trimEnd();
    const needsSemicolon = trimmedPrefix.length > 0 && !trimmedPrefix.endsWith('{') && !trimmedPrefix.endsWith(';');
    const sep = isMultiline ? '\n  ' : ' ';
    const tail = isMultiline ? '\n}' : ' }';
    const rendered = toAppend.map((d) => `${d.property}: ${d.value};`).join(sep);
    patchedRule = `${trimmedPrefix}${needsSemicolon ? ';' : ''}${sep}${rendered}${tail}`;
  }

  return {
    range: rule.range,
    before: ruleText,
    after: patchedRule,
    startLine: rule.startLine,
    endLine: rule.endLine,
    nodeType: 'CssRule',
  };
}

function buildElementPatch(source, el, { tailwindRemove = [], tailwindAdd = [], inlineStyleUpdates = [], preferTailwind = false, isJsx = false }) {
  const openTagText = source.slice(el.openTagRange[0], el.openTagRange[1]);
  const useTailwind =
    preferTailwind &&
    (Boolean(el.classAttr) || (!el.styleAttr && (tailwindRemove.length > 0 || tailwindAdd.length > 0)));

  if (useTailwind && (tailwindRemove.length > 0 || tailwindAdd.length > 0)) {
    const removeSet = new Set(tailwindRemove);
    const nextClasses = el.classes.filter((c) => !removeSet.has(c));
    for (const addCls of tailwindAdd) {
      if (addCls && !nextClasses.includes(addCls)) nextClasses.push(addCls);
    }
    const nextClassStr = nextClasses.join(' ');
    if (el.classAttr && !el.classAttr.isJsxExpression) {
      const relStart = el.classAttr.valueRange[0] - el.openTagRange[0];
      const relEnd = el.classAttr.valueRange[1] - el.openTagRange[0];
      const after = openTagText.slice(0, relStart) + nextClassStr + openTagText.slice(relEnd);
      return {
        range: el.openTagRange,
        before: openTagText,
        after,
        startLine: el.startLine,
        endLine: el.endLine,
        nodeType: isJsx ? 'JSXOpeningElement' : 'HtmlOpeningElement',
      };
    }
    const attrName = isJsx ? 'className' : 'class';
    const relInsert = el.insertAttrOffset - el.openTagRange[0];
    const after = `${openTagText.slice(0, relInsert)} ${attrName}="${nextClassStr}"${openTagText.slice(relInsert)}`;
    return {
      range: el.openTagRange,
      before: openTagText,
      after,
      startLine: el.startLine,
      endLine: el.endLine,
      nodeType: isJsx ? 'JSXOpeningElement' : 'HtmlOpeningElement',
    };
  }

  if (inlineStyleUpdates.length > 0) {
    const styleMap = parseInlineStyleMap(el.styleAttr);
    for (const { property, value } of inlineStyleUpdates) {
      styleMap.set(property.toLowerCase(), value);
    }
    if (el.styleAttr) {
      const relStart = el.styleAttr.range[0] - el.openTagRange[0];
      const relEnd = el.styleAttr.range[1] - el.openTagRange[0];
      const renderedAttr = isJsx || el.styleAttr.isJsxExpression
        ? `style=${serializeJsxStyleObject(styleMap)}`
        : `style="${serializeHtmlStyleString(styleMap)}"`;
      const after = openTagText.slice(0, relStart) + renderedAttr + openTagText.slice(relEnd);
      return {
        range: el.openTagRange,
        before: openTagText,
        after,
        startLine: el.startLine,
        endLine: el.endLine,
        nodeType: isJsx ? 'JSXOpeningElement' : 'HtmlOpeningElement',
      };
    }

    const relInsert = el.insertAttrOffset - el.openTagRange[0];
    const renderedAttr = isJsx
      ? `style=${serializeJsxStyleObject(styleMap)}`
      : `style="${serializeHtmlStyleString(styleMap)}"`;
    const after = `${openTagText.slice(0, relInsert)} ${renderedAttr}${openTagText.slice(relInsert)}`;
    return {
      range: el.openTagRange,
      before: openTagText,
      after,
      startLine: el.startLine,
      endLine: el.endLine,
      nodeType: isJsx ? 'JSXOpeningElement' : 'HtmlOpeningElement',
    };
  }

  return null;
}

function normalizeIssueType(rawCode) {
  const code = String(rawCode || '').trim().toLowerCase();
  if (code === 'accessibility_contrast_violation' || code === 'low_contrast' || code === 'contrast') {
    return 'contrast_too_low';
  }
  if (code === 'colorblind_accessibility_violation' || code === 'colorblind') {
    return 'colorblind_unsafe_status';
  }
  if (code === 'tap_target' || code === 'small_touch_target') {
    return 'touch_target_too_small';
  }
  if (code === 'overflow' || code === 'viewport_overflow') {
    return 'horizontal_overflow';
  }
  if (code === 'cls' || code === 'missing_aspect_ratio') {
    return 'layout_shift_unbounded_media';
  }
  return code || 'contrast_too_low';
}

/**
 * Synthesizes exact CSS override declarations, Tailwind utility adjustments,
 * and an AST-anchored inline code edit for a single visual/layout optimization issue.
 */
function synthesizeIssueRemediation(issue, context = {}) {
  const {
    source = '',
    ast = null,
    filePath = null,
    allowTailwind = true,
    defaultBgHex = '#0f172a',
  } = context;

  const type = normalizeIssueType(issue.type || issue.code);
  const selector = String(issue.selector || '.tg-surface').trim();
  const matchedRule =
    issue.targetRule ||
    (ast ? ast.cssRules.find((r) => r.selector === selector || r.selector.split(',').map((s) => s.trim()).includes(selector)) : null);
  const matchedElement =
    issue.targetElement ||
    (ast ? ast.elements.find((el) => matchesSelector(el, selector)) : null);

  const detectedTailwindInAst = Boolean(
    matchedElement &&
      matchedElement.classes.some(
        (c) =>
          c.startsWith('text-') ||
          c.startsWith('bg-') ||
          c.startsWith('px-') ||
          c.startsWith('py-') ||
          c.startsWith('flex') ||
          UNDERSIZED_TW_HEIGHT_CLASSES.has(c),
      ),
  );
  const tailwindEnabled = allowTailwind !== false;

  let declarations = [];
  let tailwindRemove = [];
  let tailwindAdd = [];
  let summary = '';
  let resolvedMetrics = {};

  if (type === 'contrast_too_low') {
    const twColors = matchedElement ? extractTailwindColors(matchedElement.classes) : {};
    const fgHex = normalizeHex(issue.foregroundHex || twColors.fgHex) || '#777777';
    const bgHex = normalizeHex(issue.backgroundHex || twColors.bgHex) || defaultBgHex;
    const minContrast = Number(issue.minContrast) || (issue.isLargeText ? WCAG_AA_LARGE : WCAG_AA_NORMAL);
    const solved = solveAccessibleForegroundHex(fgHex, bgHex, minContrast);
    const existingTextCls = twColors.textClass || '';
    const nextTwTextCls = selectCompliantTailwindTextClass(solved.hex, bgHex, minContrast, existingTextCls);

    declarations = [
      {
        property: 'color',
        from: fgHex,
        to: solved.hex,
        value: solved.hex,
        cssText: `color: ${solved.hex};`,
      },
    ];
    if (tailwindEnabled) {
      if (existingTextCls) tailwindRemove.push(existingTextCls);
      tailwindAdd.push(nextTwTextCls);
    }
    const beforeRatio = computeContrastRatio(fgHex, bgHex);
    summary = `Adjusted foreground color from ${fgHex} (${beforeRatio}:1) to ${solved.hex} (${solved.ratio}:1 >= ${minContrast}:1) on ${bgHex}.`;
    resolvedMetrics = {
      previousContrastRatio: beforeRatio,
      resolvedContrastRatio: solved.ratio,
      resolvedForegroundHex: solved.hex,
      backgroundHex: bgHex,
    };
  } else if (type === 'touch_target_too_small') {
    declarations = [
      { property: 'min-height', from: issue.measuredHeightPx ? `${issue.measuredHeightPx}px` : null, to: '44px', value: '44px', cssText: 'min-height: 44px;' },
      { property: 'min-width', from: issue.measuredWidthPx ? `${issue.measuredWidthPx}px` : null, to: '44px', value: '44px', cssText: 'min-width: 44px;' },
      { property: 'padding', from: null, to: '0.625rem 1rem', value: '0.625rem 1rem', cssText: 'padding: 0.625rem 1rem;' },
    ];
    if (tailwindEnabled) {
      if (matchedElement) {
        tailwindRemove = matchedElement.classes.filter((c) => UNDERSIZED_TW_HEIGHT_CLASSES.has(c) || UNDERSIZED_TW_WIDTH_CLASSES.has(c));
      }
      tailwindAdd = ['min-h-11', 'min-w-11', 'px-4', 'py-2.5', 'inline-flex', 'items-center', 'justify-center'];
    }
    summary = `Expanded interactive tap target ${selector} to >= 44x44px WCAG 2.5.8 minimum.`;
    resolvedMetrics = { minHeightPx: 44, minWidthPx: 44 };
  } else if (type === 'horizontal_overflow') {
    const capPx = Number(issue.fixedWidthPx) || 1200;
    declarations = [
      { property: 'width', from: `${capPx}px`, to: '100%', value: '100%', cssText: 'width: 100%;' },
      { property: 'max-width', from: null, to: `${capPx}px`, value: `${capPx}px`, cssText: `max-width: ${capPx}px;` },
      { property: 'flex-wrap', from: 'nowrap', to: 'wrap', value: 'wrap', cssText: 'flex-wrap: wrap;' },
      { property: 'box-sizing', from: null, to: 'border-box', value: 'border-box', cssText: 'box-sizing: border-box;' },
    ];
    if (tailwindEnabled) {
      if (matchedElement) {
        tailwindRemove = matchedElement.classes.filter((c) => /^w-\[\d+px\]$/.test(c) || c === 'whitespace-nowrap' || c === 'flex-nowrap');
      }
      tailwindAdd = ['w-full', `max-w-[${capPx}px]`, 'flex-wrap'];
    }
    summary = `Replaced rigid ${capPx}px width on ${selector} with responsive fluid width + max-width clamp.`;
    resolvedMetrics = { responsiveFluidWidth: true, maxWidthPx: capPx };
  } else if (type === 'line_length_unreadable') {
    declarations = [
      { property: 'max-width', from: null, to: '65ch', value: '65ch', cssText: 'max-width: 65ch;' },
      { property: 'line-height', from: null, to: '1.625', value: '1.625', cssText: 'line-height: 1.625;' },
    ];
    if (tailwindEnabled) {
      if (matchedElement) {
        tailwindRemove = matchedElement.classes.filter((c) => c === 'max-w-none' || c.startsWith('leading-'));
      }
      tailwindAdd = ['max-w-prose', 'leading-relaxed'];
    }
    summary = `Constrained ${selector} measure to 65ch with 1.625 line-height for optimal reading cadence.`;
    resolvedMetrics = { maxMeasureCh: 65, lineHeight: 1.625 };
  } else if (type === 'layout_shift_unbounded_media') {
    const ratio = String(issue.aspectRatio || '16 / 9');
    declarations = [
      { property: 'aspect-ratio', from: null, to: ratio, value: ratio, cssText: `aspect-ratio: ${ratio};` },
      { property: 'width', from: null, to: '100%', value: '100%', cssText: 'width: 100%;' },
      { property: 'height', from: null, to: 'auto', value: 'auto', cssText: 'height: auto;' },
    ];
    if (tailwindEnabled) {
      tailwindAdd = ['aspect-video', 'w-full', 'h-auto'];
    }
    summary = `Reserved explicit ${ratio} aspect-ratio box on ${selector} to eliminate Cumulative Layout Shift (CLS).`;
    resolvedMetrics = { aspectRatio: ratio, clsProtected: true };
  } else if (type === 'colorblind_unsafe_status') {
    declarations = [
      { property: 'text-decoration', from: 'none', to: 'underline', value: 'underline', cssText: 'text-decoration: underline;' },
      { property: 'text-underline-offset', from: null, to: '3px', value: '3px', cssText: 'text-underline-offset: 3px;' },
      { property: 'font-weight', from: null, to: '600', value: '600', cssText: 'font-weight: 600;' },
    ];
    if (tailwindEnabled) {
      tailwindAdd = ['underline', 'underline-offset-4', 'font-semibold'];
    }
    summary = `Added non-color visual affordances (underline + semibold weight) to ${selector} for deuteranopia/protanopia clarity.`;
    resolvedMetrics = { nonColorAffordance: true };
  }

  const cssRuleBlock = `${selector} {\n  ${declarations.map((d) => d.cssText).join('\n  ')}\n}`;
  const cssOverrides = {
    selector,
    declarations: declarations.map(({ property, from, to, cssText }) => ({ property, from, to, cssText })),
    ruleBlock: cssRuleBlock,
  };

  const classBefore = matchedElement ? matchedElement.classes.join(' ') : '';
  const classAfter = tailwindEnabled
    ? [
        ...((matchedElement ? matchedElement.classes : []).filter((c) => !tailwindRemove.includes(c))),
        ...tailwindAdd.filter((c) => !(matchedElement ? matchedElement.classes : []).includes(c)),
      ].join(' ')
    : classBefore;

  const tailwindAdjustments = {
    enabled: tailwindEnabled,
    remove: tailwindRemove,
    add: tailwindAdd,
    classBefore,
    classAfter,
  };

  let rawPatch = null;
  if (source && matchedRule) {
    rawPatch = buildCssRulePatch(source, matchedRule, declarations);
  } else if (source && matchedElement) {
    rawPatch = buildElementPatch(source, matchedElement, {
      tailwindRemove,
      tailwindAdd,
      inlineStyleUpdates: declarations,
      preferTailwind: tailwindEnabled && (detectedTailwindInAst || context.preferTailwind === true),
      isJsx: Boolean(ast && ast.language === 'jsx'),
    });
  }

  const inlineCodeEdit = rawPatch
    ? {
        filePath: filePath || null,
        nodeType: rawPatch.nodeType,
        selector,
        startLine: rawPatch.startLine,
        endLine: rawPatch.endLine,
        startOffset: rawPatch.range[0],
        endOffset: rawPatch.range[1],
        expectedChunkHash: computeChunkHash(rawPatch.before),
        before: rawPatch.before,
        after: rawPatch.after,
      }
    : {
        filePath: filePath || null,
        nodeType: 'CssStyleSheetOverride',
        selector,
        startLine: null,
        endLine: null,
        startOffset: null,
        endOffset: null,
        expectedChunkHash: null,
        before: '',
        after: cssRuleBlock,
      };

  return {
    issueType: type,
    selector,
    summary,
    cssOverrides,
    tailwindAdjustments,
    inlineCodeEdit,
    resolvedMetrics,
  };
}

/**
 * Deduplicates overlapping AST node patches by merging edits that target the exact same byte span,
 * then applies all non-overlapping AST edits in reverse byte-offset order so line/offset anchors stay exact.
 */
function applyInlineAstEditsToSource(source, remediations, options = {}) {
  let workingSource = String(source || '');
  const ast = options.ast || parseLayoutAst(workingSource, options);

  // Group remediations by target span so multiple issues on the same element/rule compose cleanly
  const groupedBySpan = new Map();
  const unanchoredCssBlocks = [];

  for (const rem of remediations) {
    const edit = rem.inlineCodeEdit;
    if (!edit || typeof edit.startOffset !== 'number' || typeof edit.endOffset !== 'number') {
      if (rem.cssOverrides && rem.cssOverrides.ruleBlock) {
        unanchoredCssBlocks.push(rem.cssOverrides.ruleBlock);
      }
      continue;
    }
    const key = `${edit.startOffset}:${edit.endOffset}`;
    if (!groupedBySpan.has(key)) {
      groupedBySpan.set(key, []);
    }
    groupedBySpan.get(key).push(rem);
  }

  const concretePatches = [];
  for (const group of groupedBySpan.values()) {
    const firstEdit = group[0].inlineCodeEdit;
    if (group.length === 1) {
      concretePatches.push({
        startOffset: firstEdit.startOffset,
        endOffset: firstEdit.endOffset,
        before: firstEdit.before,
        after: firstEdit.after,
      });
      continue;
    }

    // Compose multiple remediations targeting the same CssRule or ElementNode
    const targetRule = ast.cssRules.find((r) => r.range[0] === firstEdit.startOffset && r.range[1] === firstEdit.endOffset);
    const targetEl = ast.elements.find((e) => e.openTagRange[0] === firstEdit.startOffset && e.openTagRange[1] === firstEdit.endOffset);

    if (targetRule) {
      const mergedDecls = [];
      for (const rem of group) {
        for (const d of rem.cssOverrides.declarations) {
          mergedDecls.push({ property: d.property, value: d.to });
        }
      }
      const composed = buildCssRulePatch(workingSource, targetRule, mergedDecls);
      concretePatches.push({
        startOffset: composed.range[0],
        endOffset: composed.range[1],
        before: composed.before,
        after: composed.after,
      });
    } else if (targetEl) {
      const mergedRemove = [];
      const mergedAdd = [];
      const mergedStyles = [];
      let anyTailwind = false;
      for (const rem of group) {
        if (rem.tailwindAdjustments.enabled) {
          anyTailwind = true;
          mergedRemove.push(...rem.tailwindAdjustments.remove);
          mergedAdd.push(...rem.tailwindAdjustments.add);
        }
        for (const d of rem.cssOverrides.declarations) {
          mergedStyles.push({ property: d.property, value: d.to });
        }
      }
      const detectedTailwindInAst = targetEl.classes.some(
        (c) => c.startsWith('text-') || c.startsWith('bg-') || UNDERSIZED_TW_HEIGHT_CLASSES.has(c) || /^w-\[\d+px\]$/.test(c),
      );
      const composed = buildElementPatch(workingSource, targetEl, {
        tailwindRemove: mergedRemove,
        tailwindAdd: mergedAdd,
        inlineStyleUpdates: mergedStyles,
        preferTailwind: anyTailwind && (detectedTailwindInAst || options.preferTailwind === true),
        isJsx: ast.language === 'jsx',
      });
      if (composed) {
        concretePatches.push({
          startOffset: composed.range[0],
          endOffset: composed.range[1],
          before: composed.before,
          after: composed.after,
        });
      }
    }
  }

  concretePatches.sort((a, b) => b.startOffset - a.startOffset);
  for (const patch of concretePatches) {
    const actualSlice = workingSource.slice(patch.startOffset, patch.endOffset);
    if (actualSlice !== patch.before) continue;
    workingSource = workingSource.slice(0, patch.startOffset) + patch.after + workingSource.slice(patch.endOffset);
  }

  if (unanchoredCssBlocks.length > 0 && workingSource.length > 0) {
    const closeStyleIdx = workingSource.toLowerCase().lastIndexOf('</style>');
    if (closeStyleIdx !== -1) {
      workingSource =
        `${workingSource.slice(0, closeStyleIdx)}\n${unanchoredCssBlocks.join('\n\n')}\n${workingSource.slice(closeStyleIdx)}`;
    } else if (ast.language === 'css') {
      workingSource = `${workingSource.trimEnd()}\n\n${unanchoredCssBlocks.join('\n\n')}\n`;
    }
  }

  return workingSource;
}

/**
 * Active, AST-backed self-correcting design engine (Lovable-inspired upgrade for ThumbGate).
 *
 * Accepts visual-model optimization findings and/or raw CSS/HTML/JSX source (or a file path),
 * builds the Layout AST, synthesizes exact CSS override properties + Tailwind utility adjustments
 * + hash-anchored inline AST edits, renders the self-corrected source in real time, and optionally
 * writes verified changes in-place behind `HashAnchoredEditGuard`.
 */
function runDesignSelfCorrectionPipeline(input = {}) {
  const filePath = input.filePath ? path.resolve(String(input.filePath)) : null;
  let sourceCode = typeof input.sourceCode === 'string' ? input.sourceCode : '';
  if (!sourceCode && filePath && fs.existsSync(filePath)) {
    sourceCode = fs.readFileSync(filePath, 'utf8');
  }

  const allowTailwind = input.allowTailwind !== false;
  const defaultBgHex = normalizeHex(input.defaultBgHex) || '#0f172a';
  const ast = sourceCode ? parseLayoutAst(sourceCode, { filePath, language: input.language }) : null;

  const suppliedIssues = Array.isArray(input.visualFindings) ? input.visualFindings : [];
  const autoIssues = input.autoDetect !== false && ast ? detectAstOptimizationIssues(ast, defaultBgHex) : [];

  // Deduplicate supplied + auto-detected issues by (normalizedType, selector)
  const seenKeys = new Set();
  const combinedIssues = [];
  for (const issue of [...suppliedIssues, ...autoIssues]) {
    const key = `${normalizeIssueType(issue.type || issue.code)}::${String(issue.selector || '')}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    combinedIssues.push(issue);
  }

  const remediations = combinedIssues.map((issue) =>
    synthesizeIssueRemediation(issue, {
      source: sourceCode,
      ast,
      filePath,
      allowTailwind,
      preferTailwind: input.preferTailwind === true,
      defaultBgHex,
    }),
  );

  const patchedSource = sourceCode
    ? applyInlineAstEditsToSource(sourceCode, remediations, {
        ast,
        filePath,
        preferTailwind: input.preferTailwind === true,
      })
    : '';

  // Re-parse patched source to verify self-correction eliminated AST-detectable issues
  const postAst = patchedSource ? parseLayoutAst(patchedSource, { filePath, language: input.language }) : null;
  const remainingAstIssues = postAst ? detectAstOptimizationIssues(postAst, defaultBgHex) : [];

  let appliedInPlace = false;
  let guardReceipt = null;
  if (input.applyInPlace === true && filePath && sourceCode && patchedSource !== sourceCode) {
    const anchorCheck = evaluateHashAnchoredEdit({
      filePath,
      targetContent: sourceCode,
      expectedHash: computeChunkHash(sourceCode),
    });
    guardReceipt = anchorCheck;
    if (anchorCheck.allowed) {
      fs.writeFileSync(filePath, patchedSource, 'utf8');
      appliedInPlace = true;
    }
  }

  return {
    ok: remainingAstIssues.length === 0,
    mode: 'active_self_correcting_design_engine',
    language: ast ? ast.language : 'css',
    issueCount: remediations.length,
    remediations,
    cssOverrides: remediations.map((r) => r.cssOverrides),
    tailwindAdjustments: remediations.map((r) => ({ selector: r.selector, ...r.tailwindAdjustments })),
    inlineEdits: remediations.map((r) => r.inlineCodeEdit),
    patchedSource,
    appliedInPlace,
    guardReceipt,
    verification: {
      changed: Boolean(sourceCode && patchedSource !== sourceCode),
      remainingIssueCount: remainingAstIssues.length,
      remainingIssues: remainingAstIssues.map((iss) => ({
        type: iss.type,
        selector: iss.selector,
      })),
    },
  };
}

module.exports = {
  TAILWIND_PALETTE,
  normalizeHex,
  computeRelativeLuminance,
  computeContrastRatio,
  solveAccessibleForegroundHex,
  selectCompliantTailwindTextClass,
  parseLayoutAst,
  detectAstOptimizationIssues,
  synthesizeIssueRemediation,
  applyInlineAstEditsToSource,
  runDesignSelfCorrectionPipeline,
};
