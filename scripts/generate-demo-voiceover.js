#!/usr/bin/env node
/**
 * generate-demo-voiceover.js — turn the demo video script into an ElevenLabs mp3.
 *
 * Reads the voiceover lines from docs/marketing/demo-video-script.md, stitches
 * them, and POSTs to ElevenLabs text-to-speech API. Writes public/assets/demo-voiceover.mp3
 * ready to be muxed with the screen recording.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=sk_... node scripts/generate-demo-voiceover.js
 *   node scripts/generate-demo-voiceover.js --voice=pNInz6obpgDQGcFmaJgB      # Adam
 *   node scripts/generate-demo-voiceover.js --text="Your custom narration here"
 *   node scripts/generate-demo-voiceover.js --out=public/assets/demo-v2.mp3
 *
 * Defaults: voice = Rachel (21m00Tcm4TlvDq8ikWAM), model = eleven_turbo_v2_5.
 * Pulls key from process.env.ELEVENLABS_API_KEY — never hardcode a key in this file.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'docs/marketing/demo-video-script.md');
const DEFAULT_OUT = path.join(ROOT, 'public/assets/demo-voiceover.mp3');
const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel
const MODEL_ID = 'eleven_turbo_v2_5';

function parseArgs(argv) {
  const out = { out: DEFAULT_OUT, voice: DEFAULT_VOICE, text: null, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--out=')) out.out = path.resolve(ROOT, arg.slice(6));
    else if (arg.startsWith('--voice=')) out.voice = arg.slice(8);
    else if (arg.startsWith('--text=')) out.text = arg.slice(7);
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 17).join('\n'));
      process.exit(0);
    }
  }
  return out;
}

function extractVoiceoverFromScript(markdown) {
  // Pulls every line following a "**Voiceover:**" or "**Voiceover (mm:ss):**" marker,
  // stopping at the next blank line. Returns a single stitched narration string.
  const lines = markdown.split('\n');
  const chunks = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\*\*Voiceover(?:\s*\([^)]+\))?:\*\*/.test(lines[i].trim())) {
      // next non-empty line is the quote block
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      while (j < lines.length && lines[j].trim() && !lines[j].startsWith('**')) {
        const cleaned = lines[j]
          .replace(/^>\s?/, '')
          .replace(/^["']|["']$/g, '')
          .trim();
        if (cleaned) chunks.push(cleaned);
        j++;
      }
    }
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

async function synthesize({ text, voice, apiKey }) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 400)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const args = parseArgs(process.argv);
  const text = args.text || extractVoiceoverFromScript(fs.readFileSync(SCRIPT_PATH, 'utf8'));
  if (!text) {
    console.error('No narration text found. Check docs/marketing/demo-video-script.md for **Voiceover:** blocks.');
    process.exit(1);
  }

  const approxSeconds = Math.round(text.split(/\s+/).length / 2.5); // ~150 wpm
  console.log(`Narration: ${text.split(/\s+/).length} words · ~${approxSeconds}s @ 150wpm`);
  console.log(`Voice:     ${args.voice}`);
  console.log(`Model:     ${MODEL_ID}`);
  console.log(`Out:       ${path.relative(ROOT, args.out)}`);

  if (args.dryRun) {
    console.log('\n--- NARRATION ---\n' + text + '\n--- END ---');
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('\nMissing ELEVENLABS_API_KEY. Add to .env or export it, then re-run.');
    console.error('See .env.example for the canonical line.');
    process.exit(2);
  }

  const audio = await synthesize({ text, voice: args.voice, apiKey });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, audio);
  console.log(`\n✅ Wrote ${audio.length.toLocaleString()} bytes → ${path.relative(ROOT, args.out)}`);
  console.log('\nNext: mux with your screen recording in iMovie/Final Cut/ffmpeg:');
  console.log(`  ffmpeg -i screen-recording.mov -i ${path.relative(ROOT, args.out)} -c:v copy -c:a aac -shortest public/assets/demo-v2.mp4`);
}

if (require.main && require.main.filename === __filename) {
  main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = { parseArgs, extractVoiceoverFromScript, synthesize, DEFAULT_OUT, DEFAULT_VOICE, MODEL_ID };
