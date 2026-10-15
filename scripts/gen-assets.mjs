#!/usr/bin/env node
// Generates Nonna's animated, background-free clips with FAL:
//   1. one reference image of Nonna (text-to-image)
//   2. one clip per state (image-to-video)
//   3. background removal on each clip (video matting)
//   4. ffmpeg -> VP9 WebM with alpha in assets/nonna/<state>.webm
//
// Usage: node scripts/gen-assets.mjs [--image-only | --slipper | --only angry,sweep] [--image path.png]
// Put refs/volto.jpg (face) and optionally refs/corpo.jpg (body) to base Nonna on real photos.
// FAL_KEY comes from the environment or .env. Every paid call is recorded in
// assets/.work/spend.json and the script refuses to go past NONNA_BUDGET_USD.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const KEY = process.env.FAL_KEY;
if (!KEY) {
  console.error('FAL_KEY is not set.');
  process.exit(1);
}

const IMAGE_MODEL = 'fal-ai/flux-pro/v1.1-ultra';
const EDIT_MODEL = 'fal-ai/nano-banana/edit';
const SLIPPER_MODEL = 'fal-ai/flux/schnell';
const CUTOUT_MODEL = 'fal-ai/birefnet/v2';
const VIDEO_MODEL = 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';
const MATTE_MODEL = 'fal-ai/birefnet/v2/video';
// Worst-case USD per call, from FAL's pricing API (Oct 2026). Matting bills
// per compute second; 0.10 is a generous ceiling for a 5 s clip.
const COST = {
  'fal-ai/flux-pro/v1.1-ultra': 0.06,
  'fal-ai/nano-banana/edit': 0.04,
  'fal-ai/flux/schnell': 0.01,
  'fal-ai/birefnet/v2': 0.02,
  'fal-ai/kling-video/v2.5-turbo/pro/image-to-video': 0.35,
  'fal-ai/elevenlabs/sound-effects/v2': 0.01,
  'fal-ai/birefnet/v2/video': 0.05, // ~$0.03 actual per 5 s clip on FAL's dashboard
};
const BUDGET = Number(process.env.NONNA_BUDGET_USD || 5);

const OUT = path.join(ROOT, 'assets', 'nonna');
const WORK = path.join(ROOT, 'assets', '.work');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

const LOOK =
  'a very old 85 year old Italian grandmother (nonna), deeply wrinkled face, short and plump, round soft belly, ' +
  'with a stooped, hunched back and rounded shoulders, small oval wire-rimmed reading glasses low on her nose, ' +
  'thin white-grey hair in a small bun, black wool cardigan over a dark floral house dress, a faded kitchen apron ' +
  'tied at the waist, thick dark stockings and beige felt house slippers, holding an old worn straw broom';
const FRAMING =
  'Full body photo, she stands small in the centre of the frame with generous empty space above her head, ' +
  'below her feet and on both sides. Plain flat light grey studio background, soft even lighting, sharp focus, photorealistic.';
const NONNA = `A real photograph of ${LOOK}. ${FRAMING}`;
const NONNA_FROM_REFS =
  `Create a real photograph of ${LOOK}. Her face must be the face of the woman in the first image. ` +
  `${FRAMING}`;

const IN_FRAME =
  ' Static wide camera. Her whole body, from her hair to her slippers, stays fully inside the frame the whole time. ' +
  'Plain grey background stays still. Realistic human motion.';
// `tail` clips end on the reference pose, so loops and cuts between clips are seamless.
const CLIPS = {
  angry: {
    tail: true,
    // The slipper flies at the camera after this; the app's own slipper takes
    // over, so it doesn't count towards the crop.
    cropUntil: 2.6,
    prompt:
      'The grandmother glares at the viewer, furious, shakes her fist and scolds, then quickly pulls one house slipper ' +
      'off her foot and hurls it hard straight at the camera, then settles back into her starting pose holding the broom.' +
      IN_FRAME,
  },
  sweep: {
    tail: false,
    pingpong: true, // played forwards then backwards so the loop has no seam
    prompt:
      'The grandmother sweeps the floor energetically with the straw broom, big wide brisk strokes swishing ' +
      'left and right across the floor in front of her, her body and shoulders moving with each stroke, hunched over, ' +
      'determined, staying on the same spot.' + IN_FRAME,
  },
  happy: {
    tail: false,
    prompt:
      'The grandmother looks around, satisfied, breaks into a big warm smile, nods firmly with approval and raises ' +
      'her free hand high next to her face in a clear, big thumbs up, holding it proudly.' + IN_FRAME,
  },
  leave: {
    tail: false,
    prompt:
      'The grandmother gives a small wave goodbye, puts the broom on her shoulder, turns towards the right of the frame ' +
      'and walks slowly to the right; the camera tracks sideways with her so she stays in the centre of the frame.' +
      ' Her whole body, from her hair to her slippers, stays fully inside the frame the whole time. Plain grey background.',
  },
};

// Nonna's angry voice (generated, so no third-party licence to track).
const SHOUTS = [
  'Elderly Italian grandmother shouting angrily, furious raspy old woman voice scolding loudly, "Mamma mia!", close mic, no music',
  'Very old woman yelling in anger at a mess, shrill cracking elderly female voice, Italian exclamations, scolding, dry room, no music',
  'Angry old Italian nonna screaming "Ma che fai?!" and grumbling, elderly woman voice, close mic, no music',
];

const SLIPPER =
  'Product photo of a single worn beige felt women\'s house slipper, closed toe, seen from above at a slight angle, ' +
  'isolated on a plain white background, soft light, photorealistic';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : Object.keys(CLIPS);
const givenImage = args.includes('--image') ? args[args.indexOf('--image') + 1] : null;

const spendFile = path.join(WORK, 'spend.json');
const spend = fs.existsSync(spendFile) ? JSON.parse(fs.readFileSync(spendFile, 'utf8')) : { total: 0, calls: [] };

async function fal(model, input) {
  const cost = COST[model] ?? 1;
  if (spend.total + cost > BUDGET) {
    throw new Error(`Budget stop: spent $${spend.total.toFixed(2)}, next call ~$${cost} would pass $${BUDGET}.`);
  }
  spend.total = +(spend.total + cost).toFixed(4);
  spend.calls.push({ model, cost, at: new Date().toISOString() });
  fs.writeFileSync(spendFile, JSON.stringify(spend, null, 2));
  const headers = { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' };
  const res = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(input) });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${await res.text()}`);
  const { status_url, response_url } = await res.json();
  process.stdout.write(`  ${model} `);
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const s = await (await fetch(status_url, { headers })).json();
    if (s.status === 'COMPLETED') break;
    if (s.status === 'FAILED' || s.error) throw new Error(`${model} failed: ${JSON.stringify(s)}`);
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  const out = await fetch(response_url, { headers });
  if (!out.ok) throw new Error(`${model} result: ${out.status} ${await out.text()}`);
  return out.json();
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function uploadDataUri(file) {
  const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function findRef(name) {
  const dir = path.join(ROOT, 'refs');
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find((n) => n.toLowerCase().startsWith(name) && /\.(jpe?g|png|webp)$/i.test(n));
  return f ? path.join(dir, f) : null;
}

async function referenceImage() {
  if (givenImage) return { file: givenImage, url: await uploadDataUri(givenImage) };
  const cached = path.join(WORK, 'nonna.png');
  // A hand-padded version (extra margin so motion stays in frame) wins.
  const padded = path.join(WORK, 'nonna-padded.jpg');
  if (fs.existsSync(padded)) return { file: padded, url: await uploadDataUri(padded) };
  if (fs.existsSync(cached) && fs.existsSync(cached + '.url')) {
    return { file: cached, url: fs.readFileSync(cached + '.url', 'utf8').trim() };
  }
  const face = findRef('volto') || findRef('face');
  const body = findRef('corpo') || findRef('body');
  let r;
  if (face) {
    console.log(`Generating Nonna from ${[face, body].filter(Boolean).map((f) => path.basename(f)).join(' + ')}…`);
    const image_urls = [await uploadDataUri(face)];
    let prompt = NONNA_FROM_REFS;
    if (body) {
      image_urls.push(await uploadDataUri(body));
      prompt += ' Her body shape and posture are like the woman in the second image.';
    }
    r = await fal(EDIT_MODEL, { prompt, image_urls, aspect_ratio: '9:16', output_format: 'png', num_images: 1 });
  } else {
    console.log('Generating Nonna…');
    r = await fal(IMAGE_MODEL, { prompt: NONNA, aspect_ratio: '9:16', output_format: 'png', num_images: 1, raw: true });
  }
  const url = r.images[0].url;
  await download(url, cached);
  fs.writeFileSync(cached + '.url', url);
  return { file: cached, url };
}

async function makeVoice() {
  const dir = path.join(ROOT, 'assets', 'sounds');
  fs.mkdirSync(dir, { recursive: true });
  for (const [i, text] of SHOUTS.entries()) {
    const r = await fal('fal-ai/elevenlabs/sound-effects/v2', { text, duration_seconds: 3.5, prompt_influence: 0.6, output_format: 'mp3_44100_128' });
    const url = r.audio?.url || r.audio_file?.url || r.url;
    await download(url, path.join(dir, `shout-raw-${i + 1}.mp3`));
    console.log(`  -> assets/sounds/shout-raw-${i + 1}.mp3`);
  }
}

async function makeSlipper() {
  const out = path.join(ROOT, 'assets', 'slipper.png');
  console.log('Slipper');
  const img = await fal(SLIPPER_MODEL, { prompt: SLIPPER, image_size: 'square_hd', num_images: 1 });
  const cut = await fal(CUTOUT_MODEL, { image_url: img.images[0].url, model: 'General Use (Heavy)', output_format: 'png' });
  await download(cut.image.url, out);
  console.log(`  -> ${path.relative(ROOT, out)}`);
}

// Union of Nonna's bounding box over every frame of every clip, so all clips
// share one crop and she is the same size in each.
function unionCrop(states) {
  let box = null;
  for (const state of states) {
    const until = CLIPS[state].cropUntil ? ['-t', String(CLIPS[state].cropUntil)] : [];
    // cropdetect reports on stderr.
    const log = spawnSync('ffmpeg', [...until, '-i', fullMask(state), '-vf',
      'cropdetect=limit=0.1:round=2:reset=0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const all = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
    const [w, h, x, y] = all.at(-1).slice(1).map(Number);
    const b = { x0: x, y0: y, x1: x + w, y1: y + h };
    box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
  }
  const pad = 12;
  const x = Math.max(0, box.x0 - pad) & ~1;
  const y = Math.max(0, box.y0 - pad) & ~1;
  return { x, y, w: (box.x1 + pad - x) & ~1, h: (box.y1 + pad - y) & ~1 };
}

// The matting model drops the motion-blurred straw broom. The backdrop is
// neutral grey and the broom is tan, so a chroma key (distance from grey in
// YUV) recovers it; the final alpha is the brighter of the two masks.
function fullMask(state) {
  const out = path.join(WORK, `${state}-mask2.mp4`);
  if (fs.existsSync(out)) return out;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(WORK, `${state}.mp4`), '-i', path.join(WORK, `${state}-mask.mp4`),
    '-filter_complex',
    "[0:v]format=yuv444p,geq=lum='if(gt(abs(cb(X,Y)-128)+abs(cr(X,Y)-128),16),255,0)':cb=128:cr=128," +
      'format=gray,erosion,erosion,dilation,dilation,dilation[k];[1:v]format=gray[m];[m][k]blend=all_mode=lighten,gblur=sigma=0.8',
    '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', out], { stdio: 'inherit' });
  return out;
}

// Uses the mask as alpha, crops, and encodes VP9 with alpha, which
// Chromium/Electron plays transparently on macOS and Windows.
function encode(state, crop) {
  const raw = path.join(WORK, `${state}.mp4`);
  const mask = fullMask(state);
  const out = path.join(OUT, `${state}.webm`);
  const c = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`;
  const pingpong = CLIPS[state].pingpong ? ',split[f][r];[r]reverse[b];[f][b]concat=n=2:v=1' : '';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-i', mask, '-filter_complex',
    `[1:v]format=gray[a];[0:v][a]alphamerge,${c},scale=-2:900,format=yuva420p${pingpong}`,
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-auto-alt-ref', '0', '-an', out], { stdio: 'inherit' });
  console.log(`  -> ${path.relative(ROOT, out)}`);
}

const videoUrl = (r) => r.video?.url || r.output?.url || r.url;

async function makeClip(state, imageUrl) {
  console.log(`Clip: ${state}`);
  const raw = path.join(WORK, `${state}.mp4`);
  const mask = path.join(WORK, `${state}-mask.mp4`);
  // The matting model needs the hosted URL of the raw clip, so remember it.
  const urlFile = raw + '.url';
  if (!fs.existsSync(raw) || !fs.existsSync(urlFile)) {
    const { prompt, tail } = CLIPS[state];
    const r = await fal(VIDEO_MODEL, { prompt, image_url: imageUrl, ...(tail && { tail_image_url: imageUrl }), duration: '5' });
    fs.writeFileSync(urlFile, videoUrl(r));
    await download(videoUrl(r), raw);
  }
  const rawUrl = fs.readFileSync(urlFile, 'utf8').trim();
  if (!fs.existsSync(mask)) {
    const m = await fal(MATTE_MODEL, {
      video_url: rawUrl,
      model: 'Matting',
      output_mask: true,
      operating_resolution: '1024x1024',
      video_output_type: 'X264 (.mp4)',
      video_quality: 'high',
    });
    await download(m.mask_video.url, mask);
  }
}

try {
  if (args.includes('--image-only')) {
    await referenceImage();
  } else if (args.includes('--voice')) {
    await makeVoice();
  } else if (args.includes('--slipper')) {
    await makeSlipper();
  } else {
    if (!args.includes('--encode-only')) {
      const { url } = await referenceImage();
      for (const state of only) await makeClip(state, url);
    }
    if (args.includes('--no-encode')) process.exit(0);
    const crop = unionCrop(Object.keys(CLIPS));
    console.log('Crop', crop);
    for (const state of Object.keys(CLIPS)) encode(state, crop);
  }
} finally {
  console.log(`FAL spend so far: $${spend.total.toFixed(2)} of $${BUDGET}`);
}
