// Sorts loose desktop files into category folders that sit right on the
// desktop (Images, Documents, …) and keeps a move log so every tidy-up can be
// undone. The user's own folders are left where they are.
const fs = require('node:fs');
const path = require('node:path');

const CATEGORIES = {
  Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'svg', 'raw', 'avif'],
  Screenshots: [], // matched by name, see categorize()
  Documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'md', 'pages', 'odt', 'epub'],
  Spreadsheets: ['xls', 'xlsx', 'csv', 'numbers', 'ods'],
  Presentations: ['ppt', 'pptx', 'key', 'odp'],
  Videos: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'],
  Audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'aiff'],
  Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
  Installers: ['dmg', 'pkg', 'exe', 'msi', 'appx', 'msix', 'iso'],
  Code: ['js', 'ts', 'py', 'json', 'html', 'css', 'sh', 'swift', 'java', 'c', 'cpp', 'go', 'rs', 'rb', 'yml', 'yaml'],
  Apps: ['app', 'lnk', 'url', 'webloc'],
  Other: [],
};

const SCREENSHOT_RE = /^(screenshot|screen shot|schermata|istantanea|capture d’écran)/i;

const CATEGORY_NAMES = new Set(Object.keys(CATEGORIES));

// Never touch these: system files, Windows desktop.ini, the recycle bin.
const IGNORED = new Set(['.DS_Store', '.localized', 'desktop.ini', 'Thumbs.db', '$RECYCLE.BIN']);

// null means "leave it": the user's own folders and Nonna's category folders.
function categorize(name, isDir) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (isDir && ext !== 'app') return null;
  if (SCREENSHOT_RE.test(name)) return 'Screenshots';
  for (const [cat, exts] of Object.entries(CATEGORIES)) {
    if (exts.includes(ext)) return cat;
  }
  return 'Other';
}

function listMessyItems(desktopDir) {
  return fs
    .readdirSync(desktopDir, { withFileTypes: true })
    .filter((d) => !IGNORED.has(d.name) && !d.name.startsWith('.'))
    .map((d) => ({ name: d.name, isDir: d.isDirectory(), category: categorize(d.name, d.isDirectory()) }))
    .filter((item) => item.category && !(item.isDir && CATEGORY_NAMES.has(item.name)));
}

function clutterScore(desktopDir) {
  return listMessyItems(desktopDir).length;
}

function uniqueTarget(dir, name) {
  let target = path.join(dir, name);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let i = 2; ; i++) {
    target = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(target)) return target;
  }
}

// Returns the planned moves without touching the filesystem.
function plan(desktopDir) {
  return listMessyItems(desktopDir).map(({ name, category }) => ({
    name,
    category,
    from: path.join(desktopDir, name),
    toDir: path.join(desktopDir, category),
  }));
}

// Moves one item and returns its log entry; used step by step so the
// animation can sweep items away one at a time.
function moveOne(step) {
  const createdDir = !fs.existsSync(step.toDir);
  if (createdDir) fs.mkdirSync(step.toDir);
  const to = uniqueTarget(step.toDir, step.name);
  fs.renameSync(step.from, to);
  return { from: step.from, to, category: step.category, createdDir, at: Date.now() };
}

function tidy(desktopDir) {
  return plan(desktopDir).map(moveOne);
}

// Reverses a session's moves, newest first. Skips anything the user has
// since moved or replaced, and never overwrites.
function undo(entries) {
  const restored = [];
  const skipped = [];
  for (const e of [...entries].reverse()) {
    if (!fs.existsSync(e.to) || fs.existsSync(e.from)) {
      skipped.push(e);
      continue;
    }
    fs.renameSync(e.to, e.from);
    restored.push(e);
  }
  // Remove category folders Nonna created, if nothing else ended up in them.
  for (const e of entries) {
    if (!e.createdDir) continue;
    const dir = path.dirname(e.to);
    try {
      if (fs.readdirSync(dir).every((n) => IGNORED.has(n))) fs.rmSync(dir, { recursive: true });
    } catch {}
  }
  return { restored, skipped };
}

class MoveLog {
  constructor(file) {
    this.file = file;
  }
  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { sessions: [] };
    }
  }
  write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }
  addSession(entries) {
    if (!entries.length) return;
    const data = this.read();
    data.sessions.push({ at: Date.now(), entries });
    this.write(data);
  }
  popSession() {
    const data = this.read();
    const last = data.sessions.pop();
    this.write(data);
    return last;
  }
}

module.exports = { CATEGORIES, categorize, clutterScore, plan, moveOne, tidy, undo, MoveLog };
