const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { categorize, plan, tidy, undo, clutterScore, MoveLog, TIDY_DIR } = require('../src/main/organizer');

function messyDesktop() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonna-'));
  for (const f of ['cat.jpg', 'tax.pdf', 'Screenshot 2026-10-15 at 10.00.png', 'song.mp3', 'thing', '.DS_Store']) {
    fs.writeFileSync(path.join(dir, f), f);
  }
  fs.mkdirSync(path.join(dir, 'old project'));
  fs.writeFileSync(path.join(dir, TIDY_DIR + '.txt'), 'not the tidy dir');
  return dir;
}

test('categorize', () => {
  assert.equal(categorize('a.JPG', false), 'Images');
  assert.equal(categorize('Screenshot 1.png', false), 'Screenshots');
  assert.equal(categorize('Schermata 2026.png', false), 'Screenshots');
  assert.equal(categorize('Foo.app', true), 'Apps');
  assert.equal(categorize('dir', true), 'Folders');
  assert.equal(categorize('noext', false), 'Other');
});

test('tidy moves everything except hidden files, and undo restores it', () => {
  const dir = messyDesktop();
  assert.equal(clutterScore(dir), 7);
  const before = fs.readdirSync(dir).sort();
  const entries = tidy(dir);
  assert.equal(entries.length, 7);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.DS_Store', TIDY_DIR]);
  assert.ok(fs.existsSync(path.join(dir, TIDY_DIR, 'Images', 'cat.jpg')));
  assert.ok(fs.existsSync(path.join(dir, TIDY_DIR, 'Folders', 'old project')));
  assert.equal(clutterScore(dir), 0);
  assert.equal(plan(dir).length, 0);

  const { restored, skipped } = undo(entries);
  assert.equal(restored.length, 7);
  assert.equal(skipped.length, 0);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f !== TIDY_DIR).sort(), before);
});

test('name collisions get a suffix, undo never overwrites', () => {
  const dir = messyDesktop();
  fs.mkdirSync(path.join(dir, TIDY_DIR, 'Images'), { recursive: true });
  fs.writeFileSync(path.join(dir, TIDY_DIR, 'Images', 'cat.jpg'), 'older cat');
  const entries = tidy(dir);
  assert.ok(entries.some((e) => e.to.endsWith('cat (2).jpg')));
  fs.writeFileSync(path.join(dir, 'tax.pdf'), 'new tax file');
  const { skipped } = undo(entries);
  assert.equal(skipped.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'tax.pdf'), 'utf8'), 'new tax file');
});

test('move log keeps sessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonna-log-'));
  const log = new MoveLog(path.join(dir, 'moves.json'));
  log.addSession([{ from: 'a', to: 'b' }]);
  log.addSession([{ from: 'c', to: 'd' }]);
  assert.equal(log.popSession().entries[0].from, 'c');
  assert.equal(log.read().sessions.length, 1);
});
