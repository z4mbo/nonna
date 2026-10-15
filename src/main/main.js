const { app, BrowserWindow, Tray, Menu, screen, ipcMain, dialog, nativeImage } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const organizer = require('./organizer');

// NONNA_DESKTOP points at a fake desktop for demos/tests; NONNA_DRY_RUN plays
// the whole show without moving anything.
const DESKTOP = process.env.NONNA_DESKTOP || app.getPath('desktop');
const DRY_RUN = process.env.NONNA_DRY_RUN === '1';
const WATCH_INTERVAL_MS = 60_000;
const AUTO_VISIT_COOLDOWN_MS = 60 * 60_000;

const settingsFile = path.join(app.getPath('userData'), 'settings.json');
const moveLog = new organizer.MoveLog(path.join(app.getPath('userData'), 'moves'));

// Logs from 0.1 lived in one moves.json; turn each session into its own
// NDJSON file so "Undo last tidy-up" still finds them.
function migrateMoveLog() {
  const old = path.join(app.getPath('userData'), 'moves.json');
  if (!fs.existsSync(old)) return;
  try {
    const dir = path.join(app.getPath('userData'), 'moves');
    fs.mkdirSync(dir, { recursive: true });
    for (const s of JSON.parse(fs.readFileSync(old, 'utf8')).sessions || []) {
      if (s.entries?.length) fs.writeFileSync(path.join(dir, `${s.at}.ndjson`), s.entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    }
    fs.renameSync(old, old + '.migrated');
  } catch (err) {
    console.error('move log migration failed', err);
  }
}

let settings = { autoVisit: true, clutterThreshold: 15, confirmedFirstTidy: false, muted: false };
let overlay = null;
let tray = null;
let busy = false;
let lastAutoVisit = 0;
const launchedAt = Date.now();

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {}
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

function createOverlay() {
  // The work area excludes the Dock/taskbar, so Nonna's feet are never hidden.
  const bounds = screen.getPrimaryDisplay().workArea;
  overlay = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    // Her sound effects play without a click on the overlay.
    webPreferences: { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required' },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  // skipTransformProcessType keeps Nonna in the Dock; without it macOS turns
  // the app into a menu-bar-only accessory.
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  // Clicks fall through to the desktop except where the renderer says Nonna is.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
}

async function confirmFirstTidy(count) {
  if (settings.confirmedFirstTidy || DRY_RUN) return true;
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Sì, Nonna, pulisci!', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    message: `Nonna wants to tidy ${count} item${count === 1 ? '' : 's'} on your desktop.`,
    detail: 'Files go into folders on your desktop (Images, Documents, Screenshots…). Your own folders stay where they are. You can undo any tidy-up from the Nonna menu.',
  });
  if (response !== 0) return false;
  settings.confirmedFirstTidy = true;
  saveSettings();
  return true;
}

async function callNonna({ auto = false } = {}) {
  if (busy) return;
  busy = true;
  try {
    const steps = organizer.plan(DESKTOP);
    if (steps.length && !(await confirmFirstTidy(steps.length))) return;
    if (auto) lastAutoVisit = Date.now();
    await runShow(steps);
  } finally {
    busy = false;
  }
}

const MAX_VISIBLE = 300;
const BATCH_MS = 100;

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 30000 }, (err, out) => resolve(err ? null : out)));
}

const jxa = (code) => run('osascript', ['-l', 'JavaScript', '-e', code]);
const REAL_DESKTOP = process.platform === 'darwin' && !process.env.NONNA_DESKTOP;

// Where each desktop icon sits (screen points, icon centre), by file name.
// Only macOS exposes this; elsewhere the renderer lays icons out itself.
async function iconPositions() {
  if (!REAL_DESKTOP) return {};
  const out = await jxa(
    'JSON.stringify(Application("Finder").desktop.items().map(i => [i.name(), i.desktopPosition()]))',
  );
  try {
    return Object.fromEntries(JSON.parse(out).map(([n, p]) => [n, p]));
  } catch {
    return {};
  }
}

// Nonna wants to see the desktop: hide every other app's windows, and bring
// them back once she has gone.
async function revealDesktop() {
  if (process.env.NONNA_DESKTOP) return async () => {};
  if (process.platform === 'darwin') {
    // One bulk Apple event: hiding app by app took ~9 s.
    const out = await run('osascript', [
      '-e', 'tell application "System Events"',
      '-e', 'set names to name of every process whose visible is true and name is not "Finder" and name is not "Nonna"',
      '-e', 'set visible of every process whose visible is true and name is not "Finder" and name is not "Nonna" to false',
      '-e', 'end tell',
      '-e', "set AppleScript's text item delimiters to linefeed",
      '-e', 'return names as text',
    ]);
    const hidden = (out || '').split('\n').map((n) => n.trim()).filter(Boolean);
    return async () => {
      if (!hidden.length) return;
      await run('osascript', [
        '-e', 'on run names',
        '-e', 'tell application "System Events"',
        '-e', 'repeat with n in names',
        '-e', 'try',
        '-e', 'set visible of process (n as text) to true',
        '-e', 'end try',
        '-e', 'end repeat',
        '-e', 'end tell',
        '-e', 'end run',
        ...hidden,
      ]);
    };
  }
  if (process.platform === 'win32') {
    const ps = (verb) => run('powershell', ['-NoProfile', '-Command', `(New-Object -ComObject Shell.Application).${verb}()`]);
    await ps('MinimizeAll');
    return () => ps('UndoMinimizeALL');
  }
  return async () => {};
}

// Picture files fly as their own thumbnail; everything else gets a category
// icon in the renderer. (app.getFileIcon crashed with many desktop files.)
const PICTURE = /\.(png|jpe?g|gif|webp|heic|bmp|svg|avif)$/i;
function fileIcon(file) {
  return PICTURE.test(file) ? pathToFileURL(file).href : null;
}

// The renderer drives the timing: it walks Nonna to a cluster of icons and
// asks for exactly those items to be moved, so files vanish under the broom.
async function runShow(steps) {
  const restoreApps = await revealDesktop();
  await new Promise((r) => setTimeout(r, steps.length ? 700 : 300));
  const area = screen.getPrimaryDisplay().workArea;
  const positions = await iconPositions();
  // Only so many icons fit on a screen; she sweeps those one cluster at a
  // time, and whatever is left (a desktop with millions of files) goes in
  // time-boxed batches afterwards.
  const visible = steps.slice(0, MAX_VISIBLE);
  const items = await Promise.all(
    visible.map(async (s) => {
      const p = positions[s.name];
      return {
        name: s.name,
        category: s.category,
        icon: fileIcon(s.from),
        x: p ? p.x - area.x : null,
        y: p ? p.y - area.y : null,
      };
    }),
  );

  return new Promise((resolve) => {
    const log = DRY_RUN ? null : moveLog.start();
    const moved = new Set();
    let movedAny = false;
    let next = visible.length; // first step of the batched remainder

    const move = (i) => {
      if (moved.has(i) || !steps[i]) return;
      moved.add(i);
      if (DRY_RUN) return;
      try {
        log.append(organizer.moveOne(steps[i]));
        movedAny = true;
      } catch (err) {
        console.error('move failed', steps[i].from, err);
      }
    };

    // `req` is either { indices } for icons she walked to, or { rest: n } to
    // move up to n of the remaining files within BATCH_MS.
    const onSweep = async (e, req) => {
      if (e.sender !== overlay.webContents) return;
      if (req.rest) {
        const t0 = Date.now();
        const categories = [];
        let n = 0;
        while (next < steps.length && n < req.rest && (n === 0 || Date.now() - t0 < BATCH_MS)) {
          if (categories.length < 3) categories.push(steps[next].category);
          move(next++);
          n++;
        }
        const done = moved.size >= steps.length;
        if (done && movedAny) arrangeDesktop();
        overlay.webContents.send('nonna:swept', { swept: n, categories, remaining: steps.length - next, done });
        return;
      }
      const indices = req.indices || [];
      indices.forEach(move);
      // Finder places new folders itself; tell the renderer where they are so
      // the icons can fly into them.
      const now = await iconPositions();
      const folders = {};
      for (const i of indices) {
        const c = steps[i]?.category;
        if (c && now[c]) folders[c] = { x: now[c].x - area.x, y: now[c].y - area.y };
      }
      const done = moved.size >= steps.length;
      if (done && movedAny) arrangeDesktop();
      overlay.webContents.send('nonna:swept', { indices, folders, remaining: steps.length - moved.size, done });
    };

    const onFinished = async (e) => {
      if (e.sender !== overlay.webContents) return;
      ipcMain.removeListener('nonna:sweep', onSweep);
      ipcMain.removeListener('nonna:finished', onFinished);
      log?.close();
      overlay.hide();
      overlay.setIgnoreMouseEvents(true, { forward: true });
      refreshMenus();
      await restoreApps();
      resolve();
    };

    ipcMain.on('nonna:sweep', onSweep);
    ipcMain.on('nonna:finished', onFinished);
    overlay.setBounds(area);
    overlay.showInactive();
    overlay.webContents.send('nonna:start', {
      count: steps.length,
      items,
      rest: steps.length - visible.length,
      muted: settings.muted,
      recordAudio: !!process.env.NONNA_RECORD_AUDIO,
    });
  });
}

// macOS: ask Finder to line the desktop icons up in a neat grid, sorted by
// kind, so the new folders sit together. Windows auto-arranges on its own.
function arrangeDesktop() {
  if (process.platform !== 'darwin' || process.env.NONNA_DESKTOP) return;
  execFile('osascript', ['-e', 'tell application "Finder" to clean up window of desktop by kind'], (err) => {
    if (err) console.error('arrange desktop failed', err.message);
  });
}

function undoLast() {
  const session = moveLog.last();
  if (!session) {
    dialog.showMessageBox({ message: 'Nothing to undo. Nonna has not touched anything yet.' });
    return;
  }
  const { restored, skipped } = organizer.undo(session.entries());
  session.drop();
  dialog.showMessageBox({
    message: `Put back ${restored.toLocaleString()} item${restored === 1 ? '' : 's'}.`,
    detail: skipped ? `${skipped.toLocaleString()} could not be restored because they were moved or replaced since.` : undefined,
  });
  refreshMenus();
}

function buildMenu() {
  const hasUndo = moveLog.count() > 0;
  return Menu.buildFromTemplate([
    { label: 'Call Nonna', click: () => callNonna() },
    { label: 'Undo last tidy-up', enabled: hasUndo, click: undoLast },
    { type: 'separator' },
    {
      label: 'Visit when the desktop gets messy',
      type: 'checkbox',
      checked: settings.autoVisit,
      click: (item) => {
        settings.autoVisit = item.checked;
        saveSettings();
      },
    },
    {
      label: 'Sounds',
      type: 'checkbox',
      checked: !settings.muted,
      click: (item) => {
        settings.muted = !item.checked;
        saveSettings();
      },
    },
    { type: 'separator' },
    { label: 'Quit Nonna', role: 'quit' },
  ]);
}

function refreshMenus() {
  const menu = buildMenu();
  tray?.setContextMenu(menu);
  if (process.platform === 'darwin') app.dock.setMenu(menu);
}

function watchClutter() {
  setInterval(() => {
    if (!settings.autoVisit || busy) return;
    if (Date.now() - lastAutoVisit < AUTO_VISIT_COOLDOWN_MS) return;
    try {
      if (organizer.clutterScore(DESKTOP) >= settings.clutterThreshold) callNonna({ auto: true });
    } catch (err) {
      console.error('clutter check failed', err);
    }
  }, WATCH_INTERVAL_MS);
}

// Demo recordings: NONNA_RECORD_AUDIO=/path/visit.webm saves what she played,
// with the wall-clock start time next to it for syncing with a screen capture.
ipcMain.on('nonna:audio', (e, { startedAt, bytes }) => {
  const out = process.env.NONNA_RECORD_AUDIO;
  if (!out || e.sender !== overlay?.webContents || !bytes) return;
  fs.writeFileSync(out, Buffer.from(bytes));
  fs.writeFileSync(out + '.json', JSON.stringify({ startedAt }));
});

ipcMain.on('nonna:hover', (e, over) => {
  if (e.sender === overlay?.webContents) overlay.setIgnoreMouseEvents(!over, { forward: true });
});

// Windows: clicking the pinned taskbar icon again launches a second instance,
// which we turn into another visit.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => callNonna());

  app.whenReady().then(() => {
    loadSettings();
    migrateMoveLog();
    createOverlay();
    const trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
    if (!trayIcon.isEmpty()) {
      tray = new Tray(trayIcon.resize({ height: process.platform === 'darwin' ? 18 : 16 }));
      tray.setToolTip('Nonna');
      tray.on('click', () => callNonna());
    }
    refreshMenus();
    watchClutter();
    // Launching the app is a visit (the busy guard drops macOS's launch-time
    // `activate`), unless started quietly, e.g. at login.
    if (!process.argv.includes('--no-visit')) overlay.webContents.once('did-finish-load', () => callNonna());
  });

  // macOS: every Dock click while running.
  app.on('activate', () => {
    if (overlay && !overlay.webContents.isLoading() && Date.now() - launchedAt > 1500) callNonna();
  });

  // Nonna lives in the dock/tray; closing the overlay never quits the app.
  app.on('window-all-closed', (e) => e.preventDefault());
}
