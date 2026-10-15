// Records Nonna tidying a desktop buried under 21,931,293 icons, offscreen,
// into docs/nonna-21-million.mp4. The files are simulated (no disk holds
// that many), but the folder layout shown at the end comes from the real
// organizer rules applied to the simulated counts.
// Usage: npx electron scripts/record-mess.js   (Linux: xvfb-run -a npx electron --no-sandbox ...)
const { app, BrowserWindow, ipcMain } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const organizer = require('../src/main/organizer');

const ROOT = path.join(__dirname, '..');
const W = 1920;
const H = 1080;
const FPS = 30;
const TOTAL = Number(process.env.NONNA_ICONS || 21_931_293);
const OUT = path.join(ROOT, 'docs', 'nonna-21-million.mp4');

// Share of the mess per category, and the emoji drawn for it.
const MIX = [
  ['Screenshots', 0.22, '📸'], ['Images', 0.21, '🖼️'], ['Documents', 0.13, '📄'], ['Code', 0.07, '📜'],
  ['Videos', 0.06, '🎞️'], ['Archives', 0.05, '🗜️'], ['Other', 0.05, '📄'], ['Audio', 0.04, '🎵'],
  ['Spreadsheets', 0.04, '📊'], ['Installers', 0.03, '💿'], ['Screen Recordings', 0.03, '📹'],
  ['Presentations', 0.04, '📽️'], ['Apps', 0.03, '📦'],
];
const MONTHS = [];
for (let y = 2019; y <= 2026; y++) for (let m = 1; m <= 12 && !(y === 2026 && m > 10); m++) MONTHS.push(`${y}-${String(m).padStart(2, '0')}`);
const DAYS = 28; // simulated days per month, enough to show the day folders

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(weights, r) {
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
  return weights.length - 1;
}

// Spreads every simulated file over category × month × day, then asks
// the organizer where each group would go.
function simulate() {
  const rand = rng(21931293);
  const catW = MIX.map(([, w]) => w);
  const sum = catW.reduce((a, b) => a + b);
  catW.forEach((w, i) => (catW[i] = w / sum));
  const monthW = MONTHS.map((_, i) => Math.pow(1.04, i));
  const ms = monthW.reduce((a, b) => a + b);
  monthW.forEach((w, i) => (monthW[i] = w / ms));
  const cells = new Int32Array(MIX.length * MONTHS.length * DAYS);
  for (let n = 0; n < TOTAL; n++) {
    const c = pick(catW, rand());
    const m = pick(monthW, rand());
    const k = Math.floor(rand() * (m === MONTHS.length - 1 ? 15 : DAYS)); // nothing after 15 Oct 2026
    cells[(c * MONTHS.length + m) * DAYS + k]++;
  }
  const dayName = (m, k) => `${MONTHS[m]}-${String(k + 1).padStart(2, '0')}`;

  const counts = new Map();
  const add = (k, v) => counts.set(k, (counts.get(k) || 0) + v);
  cells.forEach((v, idx) => {
    if (!v) return;
    const m = Math.floor(idx / DAYS) % MONTHS.length;
    const c = Math.floor(idx / DAYS / MONTHS.length);
    add(MIX[c][0], v);
    add(`${MIX[c][0]}/${MONTHS[m]}`, v);
  });

  const rows = MIX.map(([category, , emoji], c) => {
    const leaves = new Map();
    const months = new Set();
    for (let m = 0; m < MONTHS.length; m++) {
      for (let k = 0; k < DAYS; k++) {
        const v = cells[(c * MONTHS.length + m) * DAYS + k];
        if (!v) continue;
        const parts = organizer.folderParts({ category, day: dayName(m, k) }, counts);
        if (parts[1]) months.add(parts[1]);
        const key = parts.join(' › ');
        leaves.set(key, (leaves.get(key) || 0) + v);
      }
    }
    const [biggest, most] = [...leaves].sort((a, b) => b[1] - a[1])[0];
    return { category, emoji, files: counts.get(category), months: months.size, folders: leaves.size, biggest, most };
  });
  rows.sort((a, b) => b.files - a.files);
  return { rows, catW };
}

const PAGE_CSS = `
  html, body { background: linear-gradient(160deg, #2b5876 0%, #4e4376 55%, #c06c84 100%) !important; }
  #mess { position: fixed; inset: 0; pointer-events: none; }
  #hud { position: fixed; top: 22px; left: 50%; transform: translateX(-50%); padding: 12px 26px; border-radius: 999px;
    background: rgba(18, 16, 30, .62); backdrop-filter: blur(14px); color: #fff; font: 600 30px -apple-system, 'Inter', sans-serif;
    letter-spacing: .3px; font-variant-numeric: tabular-nums; box-shadow: 0 10px 40px rgba(0,0,0,.35); white-space: nowrap; z-index: 5; }
  #hud small { font-weight: 500; opacity: .75; font-size: 22px; margin-left: 10px; }
  #folders { position: fixed; top: 110px; right: 24px; display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 112px);
    gap: 4px 6px; direction: rtl; pointer-events: none; }
  #folders .f { width: 104px; text-align: center; direction: ltr; color: #fff; font: 600 13px -apple-system, sans-serif;
    text-shadow: 0 1px 3px rgba(0,0,0,.8); opacity: 0; transform: scale(.4); transition: opacity .35s, transform .35s cubic-bezier(.3,1.6,.6,1); }
  #folders .f b { display: block; font-size: 58px; line-height: 70px; font-weight: normal; }
  #folders .f.on { opacity: 1; transform: none; }
  #tree { position: fixed; left: 60px; top: 100px; width: 1260px; border-radius: 16px; overflow: hidden; z-index: 6;
    background: rgba(250, 249, 252, .97); color: #1d1b26; box-shadow: 0 30px 90px rgba(0,0,0,.45);
    font: 18px -apple-system, 'Inter', sans-serif; opacity: 0; transform: translateY(30px) scale(.97); transition: all .6s cubic-bezier(.2,.9,.3,1); }
  #tree.on { opacity: 1; transform: none; }
  #tree header { padding: 14px 20px; background: #ebe8f0; font-weight: 700; display: flex; gap: 10px; align-items: center; }
  #tree header i { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  #tree header span { margin-left: 14px; }
  #tree table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  #tree th { text-align: left; font-weight: 600; color: #6b6678; font-size: 15px; padding: 9px 20px; border-bottom: 1px solid #e3e0ea; }
  #tree td { padding: 8px 20px; border-bottom: 1px solid #f0eef4; white-space: nowrap; }
  #tree td.n { text-align: right; }
  #tree td.p { color: #6b6678; font-size: 16px; }
  #tree tfoot td { font-weight: 700; border: 0; padding: 12px 20px; background: #f4f2f7; }
`;

function pageScript(mix, total) {
  return `
    (() => {
      const MIX = ${JSON.stringify(mix)};
      const W = innerWidth, H = innerHeight;
      const fmt = (n) => n.toLocaleString('it-IT');
      const canvas = document.createElement('canvas');
      canvas.id = 'mess';
      canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      document.body.prepend(canvas);
      const ctx = canvas.getContext('2d');
      ctx.scale(devicePixelRatio, devicePixelRatio);

      // A seeded pile: a full grid of icons, then layers of icons on top.
      let s = 7;
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const weights = MIX.map((m) => m[1]);
      const pickCat = () => { let x = r(); for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) < 0) return i; return 0; };
      const icons = [];
      for (let layer = 0; layer < 4; layer++) {
        const step = 46 - layer * 4;
        for (let y = 70; y < H + 20; y += step) for (let x = -10; x < W + 20; x += step) {
          icons.push({ x: x + (layer ? (r() - .5) * step : 0), y: y + (layer ? (r() - .5) * step : 0), size: 34 - layer * 3 + r() * 6,
            rot: layer ? (r() - .5) * 0.6 : 0, cat: pickCat(), order: r() });
        }
      }
      // Top layers go first, like a real pile.
      icons.forEach((ic, i) => (ic.order = ic.order * 0.5 + (1 - Math.floor(i / (icons.length / 4)) / 4) * 0.5));
      const byOrder = [...icons].sort((a, b) => b.order - a.order);
      icons.forEach((ic) => (ic.rank = byOrder.indexOf(ic) / icons.length));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      function draw(p) {
        ctx.clearRect(0, 0, W, H);
        for (const ic of icons) {
          if (ic.rank < p) continue;
          ctx.save(); ctx.translate(ic.x, ic.y); ctx.rotate(ic.rot);
          ctx.font = ic.size + 'px "Noto Color Emoji", "Apple Color Emoji", sans-serif';
          ctx.fillText(MIX[ic.cat][2], 0, 0); ctx.restore();
        }
      }

      const hud = document.createElement('div');
      hud.id = 'hud';
      document.body.append(hud);
      const setHud = (n) => (hud.innerHTML = fmt(n) + ' icone sul desktop' + (n ? '' : '<small>✓ tutto in ordine</small>'));
      setHud(${total});

      const folders = document.createElement('div');
      folders.id = 'folders';
      MIX.forEach(([name]) => {
        const f = document.createElement('div');
        f.className = 'f';
        f.innerHTML = '<b>📁</b>' + name;
        folders.append(f);
      });
      document.body.append(folders);

      draw(0);
      window.__progress = (p, remaining) => {
        draw(p);
        setHud(remaining);
        [...folders.children].forEach((f, i) => f.classList.toggle('on', p > 0.002 + i * 0.03));
      };
      window.__tree = (rows, total) => {
        const t = document.createElement('div');
        t.id = 'tree';
        t.innerHTML = '<header><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i>'
          + '<span>Scrivania — come le ha messe la Nonna</span></header><table><thead><tr><th>Cartella</th><th class="n">File</th>'
          + '<th class="n">Mesi</th><th class="n">Sottocartelle</th><th>La più piena</th></tr></thead><tbody>'
          + rows.map((x) => '<tr><td>📁 ' + x.category + '</td><td class="n">' + fmt(x.files) + '</td><td class="n">' + x.months
            + '</td><td class="n">' + fmt(x.folders) + '</td><td class="p">' + x.biggest + ' · ' + fmt(x.most) + '</td></tr>').join('')
          + '</tbody><tfoot><tr><td>Totale</td><td class="n">' + fmt(total) + '</td><td></td><td class="n">'
          + fmt(rows.reduce((a, x) => a + x.folders, 0)) + '</td><td>Categoria › mese › giorno, sempre uguale</td></tr></tfoot></table>';
        document.body.append(t);
        requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('on')));
      };
      return icons.length;
    })();
  `;
}

app.whenReady().then(async () => {
  const t0 = Date.now();
  const { rows, catW } = simulate();
  console.log(`Simulated ${TOTAL.toLocaleString()} files in ${Date.now() - t0} ms`);

  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'nonna-mess-'));
  const win = new BrowserWindow({
    width: W,
    height: H,
    useContentSize: true,
    show: false,
    webPreferences: { offscreen: true, preload: path.join(ROOT, 'src', 'main', 'preload.js') },
  });
  win.webContents.setFrameRate(FPS);
  let latest = null;
  win.webContents.on('paint', (_e, _dirty, image) => (latest = image));

  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'overlay.html'));
  await win.webContents.insertCSS(PAGE_CSS);
  const mix = MIX.map(([name], i) => [name, catW[i], MIX[i][2]]);
  const drawn = await win.webContents.executeJavaScript(pageScript(mix, TOTAL));
  console.log(`Drew ${drawn} icons in the pile`);

  // Let the pile paint before the first frame, so the video never opens on white.
  await new Promise((r) => setTimeout(r, 500));
  let n = 0;
  const writeFrame = () => latest && fs.writeFileSync(path.join(frames, String(n++).padStart(5, '0') + '.jpg'), latest.toJPEG(90));
  const timer = setInterval(writeFrame, 1000 / FPS);
  // A beat of the buried desktop before Nonna arrives.
  await new Promise((r) => setTimeout(r, 2000));

  const rand = rng(5);
  let remaining = TOTAL;
  ipcMain.on('nonna:sweep', (_e, max = 1) => {
    const swept = Math.min(max, remaining);
    remaining -= swept;
    const categories = Array.from({ length: Math.min(3, swept) }, () => MIX[pick(catW, rand())][0]);
    win.webContents.executeJavaScript(`window.__progress(${(TOTAL - remaining) / TOTAL}, ${remaining}); true`);
    win.webContents.send('nonna:swept', { swept, categories, remaining, done: remaining === 0 });
  });
  ipcMain.on('nonna:hover', () => {});
  const finished = new Promise((r) => ipcMain.once('nonna:finished', r));
  win.webContents.send('nonna:start', { count: TOTAL });
  await finished;
  await new Promise((r) => setTimeout(r, 800));
  await win.webContents.executeJavaScript(`window.__tree(${JSON.stringify(rows)}, ${TOTAL}); true`);
  await new Promise((r) => setTimeout(r, 6000));
  clearInterval(timer);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'),
    '-vf', `scale=${W}:${H}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', OUT]);
  fs.rmSync(frames, { recursive: true });
  console.log(`Recorded ${n} frames -> ${path.relative(ROOT, OUT)}`);
  console.table(rows.map(({ category, files, months, folders, biggest, most }) => ({ category, files, months, folders, biggest, most })));
  app.quit();
});
