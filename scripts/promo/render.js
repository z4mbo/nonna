// Renders a promo scene (intro/outro) offscreen to an MP4 with its sound.
// Usage: npx electron scripts/promo/render.js <intro|outro> <out.mp4>
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const [scene, out] = process.argv.slice(2);
const FPS = 30;

app.whenReady().then(async () => {
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), `nonna-${scene}-`));
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.webContents.setFrameRate(FPS);
  let latest = null;
  win.webContents.on('paint', (_e, _d, image) => (latest = image));
  await win.loadFile(path.join(__dirname, 'scene.html'));
  await new Promise((r) => setTimeout(r, 1500)); // fonts + videos ready

  let n = 0;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    // Write as many frames as wall-clock time says we should have, so the
    // video stays in sync with the real-time audio.
    const due = Math.floor(((Date.now() - startedAt) / 1000) * FPS);
    while (latest && n <= due) fs.writeFileSync(path.join(frames, String(n++).padStart(5, '0') + '.jpg'), latest.toJPEG(94));
  }, 1000 / FPS / 2);
  const { t0, audio } = await win.webContents.executeJavaScript(`runScene(${JSON.stringify(scene)})`);
  clearInterval(timer);

  const wav = path.join(frames, 'audio.webm');
  fs.writeFileSync(wav, Buffer.from(audio));
  const offset = Math.max(0, (t0 - startedAt) / 1000);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'),
    '-itsoffset', String(offset), '-i', wav,
    '-filter_complex', '[1:a]aresample=48000,apad[a]', '-map', '0:v', '-map', '[a]', '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', out]);
  fs.rmSync(frames, { recursive: true });
  console.log(`${scene}: ${n} frames -> ${out}`);
  app.quit();
});
