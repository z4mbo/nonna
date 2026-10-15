const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { categorize, plan, tidy, undo, clutterScore, folderParts, countBuckets, MoveLog } = require('../src/main/organizer');

function messyDesktop() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonna-'));
  for (const f of ['cat.jpg', 'tax.pdf', 'Screenshot 2026-10-15 at 10.00.png', 'song.mp3', 'thing', '.DS_Store']) {
    fs.writeFileSync(path.join(dir, f), f);
  }
  fs.mkdirSync(path.join(dir, 'old project'));
  fs.mkdirSync(path.join(dir, 'Calculator.app'));
  return dir;
}

test('categorize', () => {
  assert.equal(categorize('a.JPG', false), 'Images');
  assert.equal(categorize('Screenshot 1.png', false), 'Screenshots');
  assert.equal(categorize('Schermata 2026.png', false), 'Screenshots');
  assert.equal(categorize('Foo.app', true), 'Apps');
  assert.equal(categorize('dir', true), null);
  assert.equal(categorize('noext', false), 'Other');
  assert.equal(categorize('Registrazione schermo 2026.mov', false), 'Screen Recordings');
});

test('tidy files into category folders on the desktop, leave user folders, undo restores', () => {
  const dir = messyDesktop();
  assert.equal(clutterScore(dir), 6);
  const before = fs.readdirSync(dir).sort();
  const entries = tidy(dir);
  assert.equal(entries.length, 6);
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    '.DS_Store', 'Apps', 'Audio', 'Documents', 'Images', 'Other', 'Screenshots', 'old project',
  ]);
  assert.ok(fs.existsSync(path.join(dir, 'Images', 'cat.jpg')));
  assert.ok(fs.existsSync(path.join(dir, 'Apps', 'Calculator.app')));
  // Category folders and the user's own folders don't count as clutter.
  assert.equal(clutterScore(dir), 0);
  assert.equal(plan(dir).length, 0);

  const { restored, skipped } = undo(entries);
  assert.equal(restored, 6);
  assert.equal(skipped, 0);
  // Empty category folders Nonna created are removed again.
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
});

test('existing category folders are reused and kept on undo', () => {
  const dir = messyDesktop();
  fs.mkdirSync(path.join(dir, 'Images'));
  fs.writeFileSync(path.join(dir, 'Images', 'cat.jpg'), 'older cat');
  const entries = tidy(dir);
  assert.ok(entries.some((e) => e.to.endsWith(path.join('Images', 'cat (2).jpg'))));
  fs.writeFileSync(path.join(dir, 'tax.pdf'), 'new tax file');
  const { skipped } = undo(entries);
  assert.equal(skipped, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'tax.pdf'), 'utf8'), 'new tax file');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Images')), ['cat.jpg']);
});

test('folder rules: category, then month, then day, only when crowded', () => {
  const items = [];
  for (let i = 0; i < 1500; i++) items.push({ name: `img${i}.png`, category: 'Images', day: `2026-10-${String(1 + (i % 3)).padStart(2, '0')}` });
  for (let i = 0; i < 50; i++) items.push({ name: `x${i}.png`, category: 'Images', day: '2025-01-15' });
  for (let i = 0; i < 20; i++) items.push({ name: `doc${i}.pdf`, category: 'Documents', day: '2026-10-01' });
  const counts = countBuckets(items);
  assert.deepEqual(folderParts(items[0], counts), ['Images', '2026-10', '2026-10-01']);
  assert.deepEqual(folderParts(items[2], counts), ['Images', '2026-10', '2026-10-03']);
  assert.deepEqual(folderParts(items[1500], counts), ['Images', '2025-01']);
  assert.deepEqual(folderParts(items[1550], counts), ['Documents']);
  // Same input, same folders.
  assert.deepEqual(items.map((it) => folderParts(it, counts)), items.map((it) => folderParts(it, countBuckets(items))));
});

test('a crowded desktop is split into month folders and undo removes them all', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonna-big-'));
  const jan = new Date(2025, 0, 15);
  const oct = new Date(2026, 9, 15);
  for (let i = 0; i < 120; i++) {
    const f = path.join(dir, `photo${i}.jpg`);
    fs.writeFileSync(f, '');
    fs.utimesSync(f, i % 2 ? jan : oct, i % 2 ? jan : oct);
  }
  fs.writeFileSync(path.join(dir, 'tax.pdf'), '');
  const entries = tidy(dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Documents', 'Images']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Images')).sort(), ['2025-01', '2026-10']);
  assert.equal(fs.readdirSync(path.join(dir, 'Images', '2026-10')).length, 60);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Documents')), ['tax.pdf']);
  assert.equal(undo(entries).restored, 121);
  assert.equal(fs.readdirSync(dir).length, 121);
});

test('move log keeps sessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonna-log-'));
  const log = new MoveLog(path.join(dir, 'moves'));
  let s = log.start();
  s.append({ from: 'a', to: 'b' });
  s.close();
  s = log.start();
  s.append({ from: 'c', to: 'ç' });
  s.append({ from: 'e', to: 'f' });
  s.close();
  log.start().close(); // empty sessions leave nothing behind
  assert.equal(log.count(), 2);
  const last = log.last();
  assert.deepEqual([...last.entries()].map((e) => e.to), ['ç', 'f']);
  last.drop();
  assert.equal(log.count(), 1);
  assert.equal([...log.last().entries()][0].from, 'a');
});
