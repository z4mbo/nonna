// Sorts loose desktop files into category folders that sit right on the
// desktop (Images, Documents, …) and keeps a move log so every tidy-up can be
// undone. The user's own folders are left where they are.
//
// The layout is decided by fixed rules, never guessed: extension and name
// pick the category; a category with lots of files is split by month (from
// the file's date); a month with lots of files is split by day.
// The same desktop always ends up with the same folders.
const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const CATEGORIES = {
  Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'svg', 'raw', 'avif'],
  Screenshots: [], // matched by name, see categorize()
  'Screen Recordings': [], // matched by name, see categorize()
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
const RECORDING_RE = /^(screen recording|registrazione schermo|registrazione dello schermo|enregistrement de l’écran)/i;

// A category with more files than this gets a folder per month; a month
// with more than DAY_SPLIT gets a folder per day.
const MONTH_SPLIT = 100;
const DAY_SPLIT = 1000;

const CATEGORY_NAMES = new Set(Object.keys(CATEGORIES));

// Never touch these: system files, Windows desktop.ini, the recycle bin.
const IGNORED = new Set(['.DS_Store', '.localized', 'desktop.ini', 'Thumbs.db', '$RECYCLE.BIN']);

// null means "leave it": the user's own folders and Nonna's category folders.
function categorize(name, isDir) {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (isDir && ext !== 'app') return null;
  if (SCREENSHOT_RE.test(name)) return 'Screenshots';
  if (RECORDING_RE.test(name)) return 'Screen Recordings';
  for (const [cat, exts] of Object.entries(CATEGORIES)) {
    if (exts.includes(ext)) return cat;
  }
  return 'Other';
}

// Local calendar day, e.g. "2026-10-15"; its first 7 characters are the month.
function dayOf(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// How many items share each category and each category's month; the folder
// rules below only look at these counts.
function countBuckets(items) {
  const counts = new Map();
  const bump = (k) => counts.set(k, (counts.get(k) || 0) + 1);
  for (const it of items) {
    bump(it.category);
    bump(`${it.category}/${it.day.slice(0, 7)}`);
  }
  return counts;
}

// The folder path, as parts under the desktop, that an item goes into.
function folderParts(item, counts) {
  const parts = [item.category];
  if ((counts.get(item.category) || 0) <= MONTH_SPLIT) return parts;
  const month = item.day.slice(0, 7);
  parts.push(month);
  if ((counts.get(`${item.category}/${month}`) || 0) <= DAY_SPLIT) return parts;
  parts.push(item.day);
  return parts;
}

function listMessyItems(desktopDir) {
  const items = [];
  const dir = fs.opendirSync(desktopDir);
  try {
    for (let d; (d = dir.readSync()); ) {
      if (IGNORED.has(d.name) || d.name.startsWith('.')) continue;
      const isDir = d.isDirectory();
      const category = categorize(d.name, isDir);
      if (!category || (isDir && CATEGORY_NAMES.has(d.name))) continue;
      items.push({ name: d.name, category });
    }
  } finally {
    dir.closeSync();
  }
  return items;
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
  const items = listMessyItems(desktopDir);
  for (const it of items) {
    let ms = Date.now();
    try {
      ms = fs.lstatSync(path.join(desktopDir, it.name)).mtimeMs;
    } catch {}
    it.day = dayOf(ms);
  }
  const counts = countBuckets(items);
  const dirs = new Map(); // one shared string per folder, not one per file
  return items.map((it) => {
    const rel = folderParts(it, counts).join(path.sep);
    if (!dirs.has(rel)) dirs.set(rel, path.join(desktopDir, rel));
    return { name: it.name, category: it.category, from: path.join(desktopDir, it.name), toDir: dirs.get(rel) };
  });
}

// Creates toDir and any missing parents; returns the ones it created,
// outermost first, so undo can remove them again.
function ensureDir(toDir) {
  const missing = [];
  for (let d = toDir; !fs.existsSync(d); d = path.dirname(d)) missing.unshift(d);
  for (const d of missing) fs.mkdirSync(d);
  return missing;
}

// Moves one item and returns its log entry; the main process calls it in
// batches so the animation can keep sweeping while files go.
function moveOne(step) {
  const createdDirs = ensureDir(step.toDir);
  const to = uniqueTarget(step.toDir, step.name);
  fs.renameSync(step.from, to);
  const entry = { from: step.from, to, category: step.category, at: Date.now() };
  if (createdDirs.length) entry.createdDirs = createdDirs;
  return entry;
}

function tidy(desktopDir) {
  return plan(desktopDir).map(moveOne);
}

// Reverses a session's moves. Skips anything the user has since moved or
// replaced, and never overwrites. `entries` can be any iterable, so a huge
// session streams from the log instead of sitting in memory.
function undo(entries) {
  let restored = 0;
  let skipped = 0;
  const created = new Set();
  for (const e of entries) {
    for (const d of e.createdDirs || []) created.add(d);
    if (e.createdDir) created.add(path.dirname(e.to)); // logs from before nested folders
    if (!fs.existsSync(e.to) || fs.existsSync(e.from)) {
      skipped++;
      continue;
    }
    fs.renameSync(e.to, e.from);
    restored++;
  }
  // Remove folders Nonna created, deepest first, if nothing else ended up in them.
  for (const dir of [...created].sort((a, b) => b.length - a.length)) {
    try {
      if (fs.readdirSync(dir).every((n) => IGNORED.has(n))) fs.rmSync(dir, { recursive: true });
    } catch {}
  }
  return { restored, skipped };
}

// One NDJSON file per tidy-up, appended as items move, so a visit with
// millions of files never holds its whole log in memory.
class MoveLog {
  constructor(dir) {
    this.dir = dir;
  }
  files() {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((n) => n.endsWith('.ndjson'))
        .sort((a, b) => sessionKey(a) - sessionKey(b));
    } catch {
      return [];
    }
  }
  count() {
    return this.files().length;
  }
  start() {
    fs.mkdirSync(this.dir, { recursive: true });
    const at = Date.now();
    let file = path.join(this.dir, `${at}.ndjson`);
    for (let i = 2; fs.existsSync(file); i++) file = path.join(this.dir, `${at}-${i}.ndjson`);
    const fd = fs.openSync(file, 'a');
    let buf = '';
    let n = 0;
    const flush = () => {
      if (buf) fs.writeSync(fd, buf);
      buf = '';
    };
    return {
      append(entry) {
        buf += JSON.stringify(entry) + '\n';
        n++;
        if (buf.length > 1 << 20) flush();
      },
      close() {
        flush();
        fs.closeSync(fd);
        if (!n) fs.rmSync(file);
      },
    };
  }
  // The newest session, or null. Its entries are read lazily; drop() it
  // once it has been undone.
  last() {
    const name = this.files().pop();
    if (!name) return null;
    const file = path.join(this.dir, name);
    return { entries: () => readLines(file), drop: () => fs.rmSync(file, { force: true }) };
  }
}

// "<ms>.ndjson" or "<ms>-<n>.ndjson" for sessions started in the same ms.
function sessionKey(name) {
  const [, ms, n = '1'] = name.match(/^(\d+)(?:-(\d+))?/) || [, '0'];
  return Number(ms) * 1000 + Number(n);
}

function* readLines(file) {
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(1 << 20);
  const decoder = new StringDecoder('utf8');
  let rest = '';
  try {
    for (let n; (n = fs.readSync(fd, chunk)) > 0; ) {
      const lines = (rest + decoder.write(chunk.subarray(0, n))).split('\n');
      rest = lines.pop();
      for (const l of lines) if (l) yield JSON.parse(l);
    }
    rest += decoder.end();
    if (rest) yield JSON.parse(rest);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  CATEGORIES,
  MONTH_SPLIT,
  DAY_SPLIT,
  categorize,
  dayOf,
  countBuckets,
  folderParts,
  clutterScore,
  plan,
  moveOne,
  tidy,
  undo,
  MoveLog,
};
