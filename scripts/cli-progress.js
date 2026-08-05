'use strict';

/**
 * Lightweight CLI progress for long-running commands (dashboard, cfo, north-star).
 * TTY: spinner on stderr. Non-TTY / THUMBGATE_NO_PROGRESS=1: plain step lines.
 */

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function isProgressEnabled(stream = process.stderr, env = process.env) {
  if (String(env.THUMBGATE_NO_PROGRESS || '').trim() === '1') return false;
  if (String(env.CI || '').trim()) return false; // avoid noisy CI logs
  return Boolean(stream && stream.isTTY);
}

function createCliProgress(options = {}) {
  const stream = options.stream || process.stderr;
  const env = options.env || process.env;
  const enabled = options.enabled !== undefined
    ? Boolean(options.enabled)
    : isProgressEnabled(stream, env);

  let label = '';
  let frame = 0;
  let timer = null;
  let active = false;

  function clearLine() {
    if (!enabled || !stream.clearLine) return;
    try {
      stream.clearLine(0);
      stream.cursorTo(0);
    } catch { /* non-TTY fallback */ }
  }

  function paint() {
    if (!enabled || !active) return;
    const glyph = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    frame += 1;
    clearLine();
    stream.write(`${glyph} ${label}`);
  }

  function start(nextLabel) {
    label = String(nextLabel || 'Working…');
    active = true;
    if (!enabled) {
      stream.write(`[thumbgate] ${label}\n`);
      return;
    }
    paint();
    if (timer) clearInterval(timer);
    timer = setInterval(paint, 80);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function update(nextLabel) {
    label = String(nextLabel || label);
    if (!enabled) {
      stream.write(`[thumbgate] ${label}\n`);
      return;
    }
    if (!active) {
      start(label);
      return;
    }
    paint();
  }

  function stop(finalLabel, { ok = true } = {}) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const text = finalLabel != null ? String(finalLabel) : label;
    if (!enabled) {
      if (text) stream.write(`[thumbgate] ${text}\n`);
      active = false;
      return;
    }
    clearLine();
    if (text) {
      const mark = ok ? '✓' : '✗';
      stream.write(`${mark} ${text}\n`);
    }
    active = false;
  }

  function succeed(finalLabel) {
    stop(finalLabel, { ok: true });
  }

  function fail(finalLabel) {
    stop(finalLabel, { ok: false });
  }

  return {
    enabled,
    start,
    update,
    stop,
    succeed,
    fail,
  };
}

module.exports = {
  createCliProgress,
  isProgressEnabled,
  SPINNER_FRAMES,
};
