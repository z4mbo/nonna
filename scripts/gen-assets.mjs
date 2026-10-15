#!/usr/bin/env node
// Generates Nonna's animated, background-free clips with FAL:
//   1. one reference image of Nonna (text-to-image)
//   2. one clip per state (image-to-video)
//   3. background removal on each clip (video matting)
//   4. ffmpeg -> VP9 WebM with alpha in assets/nonna/<state>.webm
//
// Usage: FAL_KEY=... node scripts/gen-assets.mjs [--only angry,sweep] [--image path.png]
// Models can be swapped with NONNA_IMAGE_MODEL / NONNA_VIDEO_MODEL / NONNA_MATTE_MODEL.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.FAL_KEY;
if (!KEY) {
  console.error('FAL_KEY is not set.');
  process.exit(1);
}

const IMAGE_MODEL = process.env.NONNA_IMAGE_MODEL || 'fal-ai/flux-pro/v1.1-ultra';
const VIDEO_MODEL = process.env.NONNA_VIDEO_MODEL || 'fal-ai/kling-video/v2.1/master/image-to-video';
const MATTE_MODEL = process.env.NONNA_MATTE_MODEL || 'fal-ai/birefnet/v2/video';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
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

async function fal(model, input) {
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
  if (fs.existsSync(cached)) return { file: cached, url: await uploadDataUri(cached) };
  console.log('Generating Nonna…');
  const r = await fal(IMAGE_MODEL, { prompt: NONNA, aspect_ratio: '9:16', output_format: 'png', num_images: 1 });
  const url = r.images[0].url;
  await download(url, cached);
  return { file: cached, url };
}

const videoUrl = (r) => r.video?.url || r.output?.url || r.url;

async function makeClip(state, imageUrl) {
  console.log(`Clip: ${state}`);
  const raw = path.join(WORK, `${state}.mp4`);
  const matted = path.join(WORK, `${state}-matte.webm`);
  // The matting model needs the hosted URL of the raw clip, so remember it.
  const urlFile = raw + '.url';
  if (!fs.existsSync(raw) || !fs.existsSync(urlFile)) {
    const r = await fal(VIDEO_MODEL, { prompt: CLIPS[state], image_url: imageUrl, duration: '5', aspect_ratio: '9:16' });
    fs.writeFileSync(urlFile, videoUrl(r));
    await download(videoUrl(r), raw);
  }
  const rawUrl = fs.readFileSync(urlFile, 'utf8').trim();
  if (!fs.existsSync(matted)) {
    const m = await fal(MATTE_MODEL, { video_url: rawUrl, output_type: 'webm', output_format: 'webm' });
    await download(videoUrl(m), matted);
  }
  // Re-encode to VP9 with alpha, which Chromium/Electron plays transparently on macOS and Windows.
  const out = path.join(OUT, `${state}.webm`);
  execFileSync('ffmpeg', ['-y', '-c:v', 'libvpx-vp9', '-i', matted, '-vf', 'scale=-2:960', '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '32', '-an', out], { stdio: 'inherit' });
  console.log(`  -> ${path.relative(ROOT, out)}`);
}

const { url } = await referenceImage();
for (const state of only) await makeClip(state, url);
console.log('Done.');
