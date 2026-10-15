// Records a preview of Nonna's visit over a fake desktop, offscreen, into
// docs/nonna-preview.mp4 and docs/nonna-preview.gif.
// Usage: npx electron scripts/record-preview.js
const { app, BrowserWindow, ipcMain } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const W = 1280;
const H = 720;
const FPS = 30;
const FILES = [
  ['IMG_2041.jpg', 'Images', '🖼️'], ['tax-2025-final-FINAL.pdf', 'Documents', '📄'], ['Screenshot 10.42.png', 'Screenshots', '📸'],
  ['budget.xlsx', 'Spreadsheets', '📊'], ['song idea.m4a', 'Audio', '🎵'], ['old project', 'Folders', '📁'],
  ['Setup.dmg', 'Installers', '💿'], ['notes.txt', 'Documents', '📄'], ['holiday.mov', 'Videos', '🎞️'],
  ['archive.zip', 'Archives', '🗜️'], ['Screenshot 11.07.png', 'Screenshots', '📸'], ['pitch.key', 'Presentations', '📽️'],
  ['script.py', 'Code', '📜'], ['untitled folder', 'Folders', '📁'],
];

const DESKTOP_CSS = `
  html, body { background: linear-gradient(160deg, #2b5876 0%, #4e4376 55%, #c06c84 100%) !important; }
  #fake-desktop { position: fixed; inset: 0; pointer-events: none; }
  #fake-desktop .icon { position: absolute; width: 92px; text-align: center; font: 500 11px -apple-system, sans-serif;
    color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.7); transition: opacity .25s, transform .25s; }
  #fake-desktop .icon b { display: block; font-size: 42px; line-height: 52px; font-weight: normal; }
  #fake-desktop .icon.gone { opacity: 0; transform: scale(.4); }
`;

function desktopScript(files) {
  return `
    const d = document.createElement('div');
    d.id = 'fake-desktop';
    ${JSON.stringify(files)}.forEach(([name, , emoji], i) => {
      const el = document.createElement('div');
      el.className = 'icon';
      el.innerHTML = '<b>' + emoji + '</b>';
      el.append(name);
      el.style.right = (16 + Math.floor(i / 6) * 100) + 'px';
      el.style.top = (16 + (i % 6) * 100) + 'px';
      d.append(el);
    });
    document.body.prepend(d);
    window.__sweepIcon = (i) => d.children[i]?.classList.add('gone');
    true;
  `;
}

app.whenReady().then(async () => {
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'nonna-frames-'));
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    webPreferences: { offscreen: true, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
  });
  win.webContents.setFrameRate(FPS);
  let latest = null;
  win.webContents.on('paint', (_e, _dirty, image) => (latest = image));

  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'overlay.html'));
  await win.webContents.insertCSS(DESKTOP_CSS);
  await win.webContents.executeJavaScript(desktopScript(FILES));

  let n = 0;
  const writeFrame = () => latest && fs.writeFileSync(path.join(frames, String(n++).padStart(5, '0') + '.jpg'), latest.toJPEG(92));
  // A beat of messy desktop before Nonna arrives.
  const timer = setInterval(writeFrame, 1000 / FPS);
  await new Promise((r) => setTimeout(r, 1200));

  let i = 0;
  let left = FILES.length;
  ipcMain.on('nonna:sweep', (_e, { indices = [] } = {}) => {
    for (const k of indices) win.webContents.executeJavaScript(`window.__sweepIcon(${k}); true`);
    left -= indices.length;
    win.webContents.send('nonna:swept', { indices, folders: {}, remaining: left, done: left <= 0 });
  });
  ipcMain.on('nonna:hover', () => {});
  const finished = new Promise((r) => ipcMain.once('nonna:finished', r));
  // Same grid as desktopScript: columns of six from the top-right corner.
  const items = FILES.map(([name, category], k) => ({
    name,
    category,
    x: W - (16 + Math.floor(k / 6) * 100) - 46,
    y: 16 + (k % 6) * 100 + 26,
  }));
  win.webContents.send('nonna:start', { count: FILES.length, items, rest: 0 });
  await finished;
  // A beat of clean desktop after she leaves.
  await new Promise((r) => setTimeout(r, 1200));
  clearInterval(timer);

  const docs = path.join(ROOT, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const input = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg')];
  execFileSync('ffmpeg', [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart',
    path.join(docs, 'nonna-preview.mp4')]);
  execFileSync('ffmpeg', [...input, '-vf',
    'fps=15,scale=640:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    path.join(docs, 'nonna-preview.gif')]);
  fs.rmSync(frames, { recursive: true });
  console.log(`Recorded ${n} frames -> docs/nonna-preview.mp4, docs/nonna-preview.gif`);
  app.quit();
});
