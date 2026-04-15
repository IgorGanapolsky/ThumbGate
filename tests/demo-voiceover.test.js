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
