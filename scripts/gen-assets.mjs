#!/usr/bin/env node
// Generates Nonna's animated, background-free clips with FAL:
//   1. one reference image of Nonna (text-to-image)
//   2. one clip per state (image-to-video)
//   3. background removal on each clip (video matting)
//   4. ffmpeg -> VP9 WebM with alpha in assets/nonna/<state>.webm
//
// Usage: node scripts/gen-assets.mjs [--only angry,sweep] [--image path.png] [--images 2]
// FAL_KEY comes from the environment or .env. Every paid call is recorded in
// assets/.work/spend.json and the script refuses to go past NONNA_BUDGET_USD.
import { execFileSync } from 'node:child_process';
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
const VIDEO_MODEL = 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video';
const MATTE_MODEL = 'fal-ai/birefnet/v2/video';
// Worst-case USD per call, from FAL's pricing API (Oct 2026). Matting bills
// per compute second; 0.10 is a generous ceiling for a 5 s clip.
const COST = { [IMAGE_MODEL]: 0.06, [VIDEO_MODEL]: 0.35, [MATTE_MODEL]: 0.1 };
const BUDGET = Number(process.env.NONNA_BUDGET_USD || 5);

const OUT = path.join(ROOT, 'assets', 'nonna');
const WORK = path.join(ROOT, 'assets', '.work');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

const NONNA =
  'a real photograph of a short, plump 80 year old Italian grandmother, full body head to toe, ' +
  'grey hair in a bun, black cardigan over a floral house dress, apron, thick stockings, house slippers, ' +
  'holding an old worn straw broom, standing on a plain flat light grey studio background, ' +
  'soft even lighting, sharp focus, photorealistic, 9:16';

const CLIPS = {
  angry:
    'The grandmother is furious, shouts and shakes her fist, then grabs a ciabatta bread loaf from her apron ' +
    'and throws it hard straight at the camera. Static camera, plain background stays still.',
  sweep:
    'The grandmother sweeps the floor energetically with her old broom, muttering, side to side, in place. ' +
    'Seamless loop. Static camera, plain background stays still.',
  happy:
    'The grandmother looks around, smiles warmly, nods with approval and gives a thumbs up, very pleased. ' +
    'Static camera, plain background stays still.',
  leave:
    'The grandmother turns to her side and walks away to the side carrying her broom on her shoulder, waving goodbye. ' +
    'Static camera, plain background stays still.',
};

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

async function referenceImage() {
  if (givenImage) return { file: givenImage, url: await uploadDataUri(givenImage) };
  const cached = path.join(WORK, 'nonna.png');
  if (fs.existsSync(cached) && fs.existsSync(cached + '.url')) {
    return { file: cached, url: fs.readFileSync(cached + '.url', 'utf8').trim() };
  }
  console.log('Generating Nonna…');
  const r = await fal(IMAGE_MODEL, { prompt: NONNA, aspect_ratio: '9:16', output_format: 'png', num_images: 1, raw: true });
  const url = r.images[0].url;
  await download(url, cached);
  fs.writeFileSync(cached + '.url', url);
  return { file: cached, url };
}

const videoUrl = (r) => r.video?.url || r.output?.url || r.url;

async function makeClip(state, imageUrl) {
  console.log(`Clip: ${state}`);
  const raw = path.join(WORK, `${state}.mp4`);
  const mask = path.join(WORK, `${state}-mask.mp4`);
  // The matting model needs the hosted URL of the raw clip, so remember it.
  const urlFile = raw + '.url';
  if (!fs.existsSync(raw) || !fs.existsSync(urlFile)) {
    const r = await fal(VIDEO_MODEL, { prompt: CLIPS[state], image_url: imageUrl, duration: '5' });
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
  // Use the mask as alpha and encode VP9 with alpha, which Chromium/Electron
  // plays transparently on macOS and Windows.
  const out = path.join(OUT, `${state}.webm`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-i', mask, '-filter_complex',
    '[1:v]format=gray,scale=iw:ih[a];[0:v][a]alphamerge,scale=-2:960,format=yuva420p',
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-auto-alt-ref', '0', '-an', out], { stdio: 'inherit' });
  console.log(`  -> ${path.relative(ROOT, out)}`);
}

try {
  if (args.includes('--image-only')) {
    await referenceImage();
  } else {
    const { url } = await referenceImage();
    for (const state of only) await makeClip(state, url);
  }
} finally {
  console.log(`FAL spend so far: $${spend.total.toFixed(2)} of $${BUDGET}`);
}
