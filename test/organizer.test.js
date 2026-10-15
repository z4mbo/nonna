const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { categorize, plan, tidy, undo, clutterScore, MoveLog } = require('../src/main/organizer');

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
  assert.equal(restored.length, 6);
  assert.equal(skipped.length, 0);
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
  assert.equal(skipped.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'tax.pdf'), 'utf8'), 'new tax file');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Images')), ['cat.jpg']);
});

test('move log keeps sessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonna-log-'));
  const log = new MoveLog(path.join(dir, 'moves.json'));
  log.addSession([{ from: 'a', to: 'b' }]);
  log.addSession([{ from: 'c', to: 'd' }]);
  assert.equal(log.popSession().entries[0].from, 'c');
  assert.equal(log.read().sessions.length, 1);
});
