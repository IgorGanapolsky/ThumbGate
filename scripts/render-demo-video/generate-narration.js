#!/usr/bin/env node
/**
 * generate-narration.js — produce scripts/render-demo-video/narration.mp3 aligned
 * to the scene boundaries in index.html (0, 15, 30, 55, 75, 90 s).
 *
 * Uses ElevenLabs when ELEVENLABS_API_KEY is set, else macOS `say` (Samantha, 175 wpm).
 * Per-scene clips are padded with silence to the next scene boundary, then concatenated.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT_MD = path.join(ROOT, 'docs/marketing/demo-video-script.md');
const OUT_MP3 = path.join(__dirname, 'narration.mp3');

/* Scene boundaries in seconds — must mirror index.html's timeline. */
const SCENE_BOUNDARIES_S = [0, 15, 30, 55, 75, 90];
const HEAD_PAD_MS = 600;                // small lead-in before Scene 1 voice
const SCENE_TAIL_MS = 500;              // breathing room after each scene's last word

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
  return r;
}

function extractScenesFromMarkdown(md) {
  /* Splits the script at `## Scene N` headings and pulls the first blockquote
   * under each "**Voiceover:**" marker. Returns an array of plain-text lines,
   * one per scene, in order. */
  const sceneBlocks = md.split(/^## Scene \d+/m).slice(1);
  return sceneBlocks.map((block) => {
    const voMarker = /\*\*Voiceover:\*\*/;
    const idx = block.search(voMarker);
    if (idx === -1) return '';
    const rest = block.slice(idx).split(/\n/).slice(1); // skip "**Voiceover:**" line
    const lines = [];
    for (const raw of rest) {
      const l = raw.trim();
      if (!l) { if (lines.length) break; else continue; }   // blank after content → stop
      if (l.startsWith('**')) break;                         // next marker → stop
      if (l.startsWith('---')) break;
      lines.push(l.replace(/^>\s?/, '').replace(/^["']|["']$/g, '').trim());
    }
    return lines.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  });
}

async function synthWithElevenLabs(text, outPath, apiKey) {
  const voice = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 400)}`);
  }
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

function synthWithSay(text, outPathMp3) {
  const aiff = outPathMp3.replace(/\.mp3$/, '.aiff');
  sh('say', ['-v', 'Samantha', '-r', '170', '-o', aiff, text]);
  sh('ffmpeg', ['-y', '-i', aiff, '-codec:a', 'libmp3lame', '-b:a', '160k', outPathMp3]);
  fs.unlinkSync(aiff);
}

function clipDurationSeconds(mp3Path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp3Path]);
  return parseFloat(r.stdout.toString().trim());
}

async function main() {
  const md = fs.readFileSync(SCRIPT_MD, 'utf8');
  const scenes = extractScenesFromMarkdown(md);
  if (scenes.length !== 5) throw new Error(`expected 5 scenes, got ${scenes.length}`);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const mode = apiKey ? 'ElevenLabs' : 'macOS say (Samantha)';
  console.log(`[narration] engine: ${mode}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-narr-'));
  const sceneClips = [];

  for (let i = 0; i < scenes.length; i++) {
    const text = scenes[i];
    const clip = path.join(tmp, `scene-${i + 1}.mp3`);
    console.log(`[narration] scene ${i + 1}: "${text.slice(0, 60)}…"`);
    if (apiKey) await synthWithElevenLabs(text, clip, apiKey);
    else synthWithSay(text, clip);
    sceneClips.push(clip);
  }

  /* Build concat list with silence padding to hit each scene boundary.
   * Budget: boundary N ends at SCENE_BOUNDARIES_S[N+1]. Scene duration is that minus prev boundary. */
  const concatList = [];
  const headSilence = path.join(tmp, 'silence-head.mp3');
  sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono`, '-t', (HEAD_PAD_MS / 1000).toFixed(3), '-q:a', '9', '-acodec', 'libmp3lame', headSilence]);
  concatList.push(headSilence);

  for (let i = 0; i < scenes.length; i++) {
    concatList.push(sceneClips[i]);
    const sceneDur = SCENE_BOUNDARIES_S[i + 1] - SCENE_BOUNDARIES_S[i];
    const clipDur = clipDurationSeconds(sceneClips[i]);
    const padSec = sceneDur - clipDur - (SCENE_TAIL_MS / 1000);
    if (padSec > 0.05) {
      const silence = path.join(tmp, `silence-${i}.mp3`);
      sh('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', padSec.toFixed(3), '-q:a', '9', '-acodec', 'libmp3lame', silence]);
      concatList.push(silence);
      console.log(`[narration]   scene ${i + 1}: ${clipDur.toFixed(2)}s clip + ${padSec.toFixed(2)}s pad → ${sceneDur}s slot`);
    } else {
      console.log(`[narration]   scene ${i + 1}: ${clipDur.toFixed(2)}s clip (budget ${sceneDur}s — trimming may occur)`);
    }
  }

  const concatTxt = path.join(tmp, 'concat.txt');
  fs.writeFileSync(concatTxt, concatList.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatTxt, '-c', 'copy', OUT_MP3]);
  const totalDur = clipDurationSeconds(OUT_MP3);
  console.log(`\n✅ narration.mp3 written (${totalDur.toFixed(2)}s) → ${path.relative(ROOT, OUT_MP3)}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
