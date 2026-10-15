const { app, BrowserWindow, Tray, Menu, screen, ipcMain, dialog, nativeImage } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const organizer = require('./organizer');

// NONNA_DESKTOP points at a fake desktop for demos/tests; NONNA_DRY_RUN plays
// the whole show without moving anything.
const DESKTOP = process.env.NONNA_DESKTOP || app.getPath('desktop');
const DRY_RUN = process.env.NONNA_DRY_RUN === '1';
const WATCH_INTERVAL_MS = 60_000;
const AUTO_VISIT_COOLDOWN_MS = 60 * 60_000;

const settingsFile = path.join(app.getPath('userData'), 'settings.json');
const moveLog = new organizer.MoveLog(path.join(app.getPath('userData'), 'moves.json'));

let settings = { autoVisit: true, clutterThreshold: 15, confirmedFirstTidy: false };
let overlay = null;
let tray = null;
let busy = false;
let lastAutoVisit = 0;

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
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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

// The renderer drives the timing: it asks for each item to be swept so the
// files disappear in step with the broom.
function runShow(steps) {
  return new Promise((resolve) => {
    const entries = [];
    let i = 0;

    const onSweep = (e) => {
      if (e.sender !== overlay.webContents) return;
      if (i >= steps.length) return overlay.webContents.send('nonna:swept', { done: true });
      const step = steps[i++];
      if (!DRY_RUN) {
        try {
          entries.push(organizer.moveOne(step));
        } catch (err) {
          console.error('move failed', step.from, err);
        }
      }
      if (i >= steps.length && entries.length) arrangeDesktop();
      overlay.webContents.send('nonna:swept', { name: step.name, category: step.category, done: i >= steps.length });
    };

    const onFinished = (e) => {
      if (e.sender !== overlay.webContents) return;
      ipcMain.removeListener('nonna:sweep', onSweep);
      ipcMain.removeListener('nonna:finished', onFinished);
      moveLog.addSession(entries);
      overlay.hide();
      overlay.setIgnoreMouseEvents(true, { forward: true });
      refreshMenus();
      resolve();
    };

    ipcMain.on('nonna:sweep', onSweep);
    ipcMain.on('nonna:finished', onFinished);
    overlay.setBounds(screen.getPrimaryDisplay().workArea);
    overlay.showInactive();
    overlay.webContents.send('nonna:start', {
      count: steps.length,
      items: steps.map((s) => ({ name: s.name, category: s.category })),
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
  const session = moveLog.popSession();
  if (!session) {
    dialog.showMessageBox({ message: 'Nothing to undo. Nonna has not touched anything yet.' });
    return;
  }
  const { restored, skipped } = organizer.undo(session.entries);
  dialog.showMessageBox({
    message: `Put back ${restored.length} item${restored.length === 1 ? '' : 's'}.`,
    detail: skipped.length ? `${skipped.length} could not be restored because they were moved or replaced since.` : undefined,
  });
  refreshMenus();
}

function buildMenu() {
  const hasUndo = moveLog.read().sessions.length > 0;
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
    createOverlay();
    const trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'));
    if (!trayIcon.isEmpty()) {
      tray = new Tray(trayIcon);
      tray.setToolTip('Nonna');
      tray.on('click', () => callNonna());
    }
    refreshMenus();
    watchClutter();
    // Launching the app is a visit; the busy guard drops macOS's launch-time `activate`.
    overlay.webContents.once('did-finish-load', () => callNonna());
  });

  // macOS: every Dock click while running.
  app.on('activate', () => {
    if (overlay && !overlay.webContents.isLoading()) callNonna();
  });

  // Nonna lives in the dock/tray; closing the overlay never quits the app.
  app.on('window-all-closed', (e) => e.preventDefault());
}
