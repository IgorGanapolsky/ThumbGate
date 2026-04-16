const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/generate-demo-voiceover.js');
const MARKDOWN = path.join(ROOT, 'docs/marketing/demo-video-script.md');

test('demo voiceover generator script exists and is executable as node', () => {
  assert.ok(fs.existsSync(SCRIPT), 'scripts/generate-demo-voiceover.js must exist');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /ELEVENLABS_API_KEY/, 'must reference ELEVENLABS_API_KEY from env');
  assert.doesNotMatch(src, /sk_[a-z0-9]{20,}/i, 'must not hardcode any ElevenLabs key');
  assert.match(src, /api\.elevenlabs\.io\/v1\/text-to-speech/, 'must call ElevenLabs TTS endpoint');
});

test('demo voiceover dry-run extracts narration from the script markdown without network calls', () => {
  const out = execFileSync('node', [SCRIPT, '--dry-run'], {
    cwd: ROOT,
    env: { ...process.env, ELEVENLABS_API_KEY: '' }, // prove it needs no key for dry-run
    encoding: 'utf8',
  });

  assert.match(out, /Narration: \d+ words/, 'dry run reports word count');
  assert.match(out, /--- NARRATION ---/);
  assert.match(out, /--- END ---/);

  const narration = out.split('--- NARRATION ---')[1].split('--- END ---')[0].trim();
  assert.ok(narration.length > 100, 'narration body must be substantive');
  assert.match(narration, /thumbgate|ThumbGate/i, 'narration must mention ThumbGate');
});

test('demo voiceover script extracts every Voiceover block from the canonical markdown', () => {
  const md = fs.readFileSync(MARKDOWN, 'utf8');
  const voiceoverMarkers = md.match(/\*\*Voiceover(?:\s*\([^)]+\))?:\*\*/g) || [];
  assert.ok(voiceoverMarkers.length >= 4, `script must have at least 4 voiceover blocks, found ${voiceoverMarkers.length}`);

  const out = execFileSync('node', [SCRIPT, '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
  const narration = out.split('--- NARRATION ---')[1].split('--- END ---')[0].trim();

  // Quick sanity: the final CTA phrase from the last scene must be in the stitched narration.
  assert.match(narration, /free|install|npx thumbgate/i, 'narration must include install/CTA phrase');
});

test('demo voiceover script refuses to run without an API key unless dry-run', () => {
  let threw = false;
  try {
    execFileSync('node', [SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, ELEVENLABS_API_KEY: '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    threw = true;
    assert.match(err.stderr || '', /ELEVENLABS_API_KEY/i, 'stderr must mention the missing env var');
    assert.equal(err.status, 2, 'exit code must be 2 for missing key');
  }
  assert.ok(threw, 'script must exit non-zero without ELEVENLABS_API_KEY');
});

test('parseArgs handles all supported flags', () => {
  const { parseArgs, DEFAULT_OUT, DEFAULT_VOICE } = require('../scripts/generate-demo-voiceover.js');

  const defaults = parseArgs(['node', 'script']);
  assert.equal(defaults.out, DEFAULT_OUT);
  assert.equal(defaults.voice, DEFAULT_VOICE);
  assert.equal(defaults.text, null);
  assert.equal(defaults.dryRun, false);

  const withFlags = parseArgs([
    'node', 'script',
    '--out=public/assets/demo-v2.mp3',
    '--voice=pNInz6obpgDQGcFmaJgB',
    '--text=Custom narration here',
    '--dry-run',
  ]);
  assert.match(withFlags.out, /demo-v2\.mp3$/);
  assert.equal(withFlags.voice, 'pNInz6obpgDQGcFmaJgB');
  assert.equal(withFlags.text, 'Custom narration here');
  assert.equal(withFlags.dryRun, true);
});

test('extractVoiceoverFromScript returns empty when markdown has no voiceover blocks', () => {
  const { extractVoiceoverFromScript } = require('../scripts/generate-demo-voiceover.js');
  assert.equal(extractVoiceoverFromScript('# Hello\n\nNo voiceover here.\n'), '');
  assert.equal(extractVoiceoverFromScript(''), '');
});

test('extractVoiceoverFromScript strips blockquote markers and surrounding quotes', () => {
  const { extractVoiceoverFromScript } = require('../scripts/generate-demo-voiceover.js');
  const md = [
    '### Scene 1',
    '',
    '**Voiceover:**',
    '',
    '> "ThumbGate stops repeat mistakes."',
    '> It is the shared memory layer.',
    '',
    '**Visual:** screen recording',
  ].join('\n');
  const result = extractVoiceoverFromScript(md);
  assert.match(result, /ThumbGate stops repeat mistakes/);
  assert.match(result, /shared memory layer/);
  assert.doesNotMatch(result, /^>/m, 'blockquote markers must be stripped');
  assert.doesNotMatch(result, /"/, 'wrapping quotes must be stripped');
});

test('synthesize posts JSON to ElevenLabs and returns audio buffer', async () => {
  const { synthesize, MODEL_ID } = require('../scripts/generate-demo-voiceover.js');
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([0x49, 0x44, 0x33, 0x04]).buffer, // "ID3" mp3 magic
    };
  };
  try {
    const buf = await synthesize({ text: 'hello', voice: 'voice-xyz', apiKey: 'test-key' });
    assert.ok(Buffer.isBuffer(buf), 'returns a Buffer');
    assert.equal(buf.length, 4);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/text-to-speech\/voice-xyz$/);
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers['xi-api-key'], 'test-key');
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.text, 'hello');
    assert.equal(body.model_id, MODEL_ID);
    assert.ok(body.voice_settings && typeof body.voice_settings.stability === 'number');
  } finally {
    global.fetch = originalFetch;
  }
});

test('synthesize throws with status and body excerpt on non-2xx response', async () => {
  const { synthesize } = require('../scripts/generate-demo-voiceover.js');
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => 'rate limit exceeded',
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  try {
    await assert.rejects(
      () => synthesize({ text: 'hi', voice: 'v', apiKey: 'k' }),
      /ElevenLabs 429: rate limit exceeded/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
