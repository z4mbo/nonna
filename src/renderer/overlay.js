// Runs Nonna's visit with no words, only reactions: she storms in angry,
// hurls her slipper at the screen, walks from cluster to cluster of desktop
// icons sweeping each one into its folder, approves, and walks off screen.
// Uses the generated transparent clips in assets/nonna/ when present and an
// emoji stand-in otherwise.
const $ = (id) => document.getElementById(id);
const nonnaEl = $('nonna');
const vids = [...document.querySelectorAll('.clip')];
const CLIP_DIR = '../../assets/nonna/';
const STATES = ['angry', 'sweep', 'happy', 'leave'];
// Moments inside the generated clips (seconds).
const THROW_AT = 2.6; // slipper leaves her hand in angry.webm
const WALK_FROM = 2.4; // leave.webm: she is walking (to the right) from here…
const WALK_TO = 4.95; // …to here, which we loop as her walk cycle
const WALK_SPEED = 560; // px per second
// However messy the desktop, she makes at most this many stops, sweeping
// bigger handfuls of icons per stop, so a visit always takes ~15-20 s.
const MAX_STOPS = 8;
const CLUSTER_RADIUS = 300; // icons this close to the first are swept together
// Where the broom touches the floor, as a fraction of her box.
const BROOM = { x: 0.36, y: 0.97 };

const ICONS = {
  Images: '🖼️', Screenshots: '📸', Documents: '📄', Spreadsheets: '📊', Presentations: '📽️',
  Videos: '🎞️', Audio: '🎵', Archives: '🗜️', Installers: '💿', Code: '📜', Apps: '📦', Other: '📄',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const available = {};
let pos = { x: 0, y: 0 }; // Nonna's box top-left, px
let cur = 0; // index of the visible <video>
let walkLoop = null;

// fetch() can't read file:// URLs, so ask a throwaway <video> instead.
function probeClip(state) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.onloadedmetadata = () => resolve((available[state] = true));
    v.onerror = () => resolve((available[state] = false));
    v.src = CLIP_DIR + state + '.webm';
  });
}
const probed = Promise.all(STATES.map(probeClip));

$('slipper').onerror = () => {
  const s = document.createElement('div');
  s.id = 'slipper';
  s.textContent = '🥿';
  s.style.fontSize = '50vmin';
  s.style.lineHeight = '1';
  $('slipper').replaceWith(s);
};

const W = () => window.innerWidth;
const H = () => window.innerHeight;
const size = () => {
  const r = nonnaEl.getBoundingClientRect();
  return { w: r.width, h: r.height };
};

// ---- clips -----------------------------------------------------------------

// Crossfades to the next clip on the hidden <video>, so switching between
// reactions never flashes. `from`/`to` loop a segment (her walk cycle).
async function play(state, { loop = false, from = 0, to = null, fallbackMs = 1500 } = {}) {
  nonnaEl.classList.remove(...STATES, 'walk');
  nonnaEl.classList.add(to ? 'walk' : state);
  if (walkLoop) {
    cancelAnimationFrame(walkLoop);
    walkLoop = null;
  }
  if (!available[state]) {
    vids.forEach((v) => v.classList.remove('on'));
    $('fallback').hidden = false;
    return { video: null, ended: loop || to ? new Promise(() => {}) : sleep(fallbackMs) };
  }
  $('fallback').hidden = true;
  const next = vids[1 - cur];
  const prev = vids[cur];
  next.loop = loop && !to;
  if (!next.src.endsWith(state + '.webm')) {
    next.src = CLIP_DIR + state + '.webm';
    await new Promise((r) => (next.oncanplay = r));
  }
  next.currentTime = from;
  await next.play();
  if (to) {
    // Checked every frame: timeupdate fires too rarely to catch the loop point.
    const loopIt = () => {
      if (next.currentTime >= to || next.ended) {
        next.currentTime = from;
        next.play();
      }
      walkLoop = requestAnimationFrame(loopIt);
    };
    walkLoop = requestAnimationFrame(loopIt);
  }
  next.classList.add('on');
  prev.classList.remove('on');
  setTimeout(() => prev !== vids[cur] && prev.pause(), 220);
  cur = 1 - cur;
  return {
    video: next,
    ended: loop || to ? new Promise(() => {}) : new Promise((r) => (next.onended = r)),
  };
}

function atTime(video, t) {
  if (!video) return sleep(t * 1000);
  return new Promise((resolve) => {
    const check = () => (video.currentTime >= t || video.ended ? resolve() : requestAnimationFrame(check));
    check();
  });
}

// ---- movement --------------------------------------------------------------

function clampOnScreen(p) {
  const { w, h } = size();
  return { x: Math.min(Math.max(p.x, 0), W() - w), y: Math.min(Math.max(p.y, 0), H() - h) };
}

function place(p) {
  pos = p;
  nonnaEl.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
}

function glide(to, ms, easing = 'ease-in-out') {
  const anim = nonnaEl.animate(
    [{ transform: `translate3d(${pos.x}px,${pos.y}px,0)` }, { transform: `translate3d(${to.x}px,${to.y}px,0)` }],
    { duration: ms, easing, fill: 'forwards' },
  );
  return anim.finished.then(() => {
    place(to);
    anim.cancel();
  });
}

function fade(to, ms) {
  const anim = nonnaEl.animate([{ opacity: getComputedStyle(nonnaEl).opacity }, { opacity: to }], {
    duration: ms,
    fill: 'forwards',
  });
  return anim.finished.then(() => {
    nonnaEl.style.opacity = to;
    anim.cancel();
  });
}

function broomPoint(p = pos) {
  const { w, h } = size();
  const bx = nonnaEl.classList.contains('flip') ? 1 - BROOM.x : BROOM.x;
  return { x: p.x + w * bx, y: p.y + h * BROOM.y };
}

// Where her box should stand so the broom lands on (x, y), kept on screen.
function standFor(x, y) {
  const { w, h } = size();
  return clampOnScreen({ x: x - w * BROOM.x, y: y + 18 - h * BROOM.y });
}

// Walks (with the walk cycle, facing the direction of travel) to `to`.
async function walkTo(to, { offscreen = false } = {}) {
  const target = offscreen ? to : clampOnScreen(to);
  const dist = Math.hypot(target.x - pos.x, target.y - pos.y);
  if (dist < 8) return;
  nonnaEl.classList.toggle('flip', target.x < pos.x);
  await play('leave', { from: WALK_FROM, to: WALK_TO });
  const stopSteps = footsteps();
  await glide(target, Math.max(380, (dist / WALK_SPEED) * 1000), offscreen ? 'ease-in' : 'ease-in-out');
  stopSteps();
}

// ---- effects ---------------------------------------------------------------

const SHOUT_SOUNDS = ['../../assets/sounds/shout-1.mp3', '../../assets/sounds/shout-2.mp3'];
const SHOUTS = ['WHAT IS THIS MESS?!', 'MAMMA MIA!', 'CLEAN YOUR DESKTOP!', 'MADONNA SANTA!', 'LOOK AT THIS DISASTER!'];

// A comic shout pops out next to her head, wobbles, and fades. Angry only.
async function shout(text, ms = 1100) {
  const el = document.createElement('div');
  el.className = 'shout';
  el.textContent = text;
  $('shouts').append(el);
  const r = nonnaEl.getBoundingClientRect();
  const bw = el.offsetWidth;
  const bh = el.offsetHeight;
  // Above her head, leaning into the screen, never off the edge.
  const x = Math.min(Math.max(r.left + r.width * 0.5 - bw * 0.75, 12), W() - bw - 12);
  const y = Math.max(r.top - bh - 18, 12);
  el.style.setProperty('--tail', `${Math.min(Math.max(r.left + r.width * 0.5 - x - 13, 20), bw - 40)}px`);
  const tilt = rand(-6, 6);
  await el.animate(
    [
      { transform: `translate(${x}px, ${y}px) scale(0.2) rotate(${tilt - 12}deg)`, opacity: 0 },
      { transform: `translate(${x}px, ${y}px) scale(1.18) rotate(${tilt + 4}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${x}px, ${y}px) scale(1) rotate(${tilt}deg)`, opacity: 1 },
    ],
    { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1.3)', fill: 'forwards' },
  ).finished;
  el.animate(
    [
      { transform: `translate(${x}px, ${y}px) rotate(${tilt}deg)` },
      { transform: `translate(${x - 4}px, ${y + 2}px) rotate(${tilt - 2}deg)` },
      { transform: `translate(${x + 4}px, ${y - 2}px) rotate(${tilt + 2}deg)` },
      { transform: `translate(${x}px, ${y}px) rotate(${tilt}deg)` },
    ],
    { duration: 140, iterations: Math.floor(ms / 140) },
  );
  await sleep(ms);
  await el.animate(
    [
      { transform: `translate(${x}px, ${y}px) scale(1) rotate(${tilt}deg)`, opacity: 1 },
      { transform: `translate(${x}px, ${y - 20}px) scale(0.9) rotate(${tilt}deg)`, opacity: 0 },
    ],
    { duration: 180, fill: 'forwards' },
  ).finished;
  el.remove();
}

async function shoutSequence(untilSeconds, video) {
  const lines = [...SHOUTS].sort(() => Math.random() - 0.5).slice(0, 2);
  lines.splice(1, 0, 'CLEAN YOUR DESKTOP!');
  const unique = [...new Set(lines)];
  const each = Math.max(700, ((untilSeconds - 0.3) * 1000) / unique.length - 220);
  for (const line of unique) {
    if (video && video.currentTime > untilSeconds - 0.4) break;
    await shout(line, each - 260);
  }
}

// Footsteps while she walks; returns a stop function.
function footsteps(intervalMs = 280) {
  Sfx.step();
  const t = setInterval(() => Sfx.step(), intervalMs);
  return () => clearInterval(t);
}

function puff(x, y, big = false) {
  const el = document.createElement('div');
  el.className = 'puff';
  const s = big ? rand(70, 120) : rand(24, 52);
  el.style.width = el.style.height = s + 'px';
  $('dust').append(el);
  const dx = rand(-40, 40);
  const dy = rand(-50, -10);
  el.animate(
    [
      { transform: `translate(${x - s / 2}px, ${y - s / 2}px) scale(0.4)`, opacity: 0.9 },
      { transform: `translate(${x - s / 2 + dx}px, ${y - s / 2 + dy}px) scale(1.6)`, opacity: 0 },
    ],
    { duration: rand(600, 1000), easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' },
  ).finished.then(() => el.remove());
}

function dustWhileSweeping() {
  let n = 0;
  Sfx.swish();
  const t = setInterval(() => {
    const b = broomPoint();
    puff(b.x + rand(-30, 30), b.y + rand(-12, 4));
    if (++n % 4 === 0) Sfx.swish();
  }, 90);
  return () => clearInterval(t);
}

function shake(el, px = 16, ms = 420) {
  return el.animate(
    [
      { transform: 'translate(0,0)' },
      { transform: `translate(${-px}px,${px * 0.6}px)` },
      { transform: `translate(${px * 0.8}px,${-px * 0.5}px)` },
      { transform: `translate(${-px * 0.5}px,${px * 0.3}px)` },
      { transform: 'translate(0,0)' },
    ],
    { duration: ms },
  ).finished;
}

// The slipper flies out of her hand, spinning, and grows until it fills the
// whole screen; the screen shakes, and it drops away.
async function throwSlipper() {
  const s = $('slipper');
  const r = nonnaEl.getBoundingClientRect();
  const box = s.getBoundingClientRect();
  const sw = box.width || H() * 0.25;
  const sh = box.height || H() * 0.6;
  const from = { x: r.left + r.width * 0.5 - sw / 2, y: r.top + r.height * 0.6 - sh / 2 };
  const hit = { x: W() * 0.5 - sw / 2, y: H() * 0.5 - sh / 2 };
  // Big enough that the slipper covers every corner of the screen.
  const grow = Math.max(W() / sw, H() / sh) * 1.4;
  s.style.opacity = 1;
  Sfx.whoosh(650);
  await s.animate(
    [
      { transform: `translate(${from.x}px, ${from.y}px) rotate(-30deg) scale(0.12)` },
      { transform: `translate(${(from.x + hit.x) / 2}px, ${hit.y - H() * 0.2}px) rotate(200deg) scale(${grow * 0.25})`, offset: 0.55 },
      { transform: `translate(${hit.x}px, ${hit.y}px) rotate(358deg) scale(${grow})` },
    ],
    { duration: 650, easing: 'cubic-bezier(.35,.05,.7,1)', fill: 'forwards' },
  ).finished;
  Sfx.thwack();
  shake($('stage'), 22, 450);
  await sleep(420);
  Sfx.huff();
  await s.animate(
    [
      { transform: `translate(${hit.x}px, ${hit.y}px) rotate(358deg) scale(${grow})`, opacity: 1 },
      { transform: `translate(${hit.x}px, ${hit.y + H() * 0.3}px) rotate(362deg) scale(${grow * 0.9})`, opacity: 1, offset: 0.45 },
      { transform: `translate(${hit.x}px, ${H() * 2}px) rotate(380deg) scale(${grow * 0.75})`, opacity: 1 },
    ],
    { duration: 950, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' },
  ).finished;
  s.style.opacity = 0;
  s.getAnimations().forEach((a) => a.cancel());
}

// A desktop icon tumbles from its spot into the broom, then flies into its
// category folder (or disappears into the dust if we don't know where that is).
// Thumbnails must be in memory before the files move away under the broom.
function preloadIcons(items) {
  return Promise.all(
    items
      .filter((it) => it.icon)
      .map((it) => {
        it.img = new Image();
        it.img.src = it.icon;
        return it.img.decode().catch(() => (it.icon = null));
      }),
  );
}

function makeMote(item) {
  let el;
  if (item.icon && item.img) {
    el = item.img.cloneNode();
  } else {
    el = document.createElement('div');
    el.classList.add('emoji');
    el.textContent = ICONS[item.category] || '📄';
  }
  el.classList.add('mote');
  $('motes').append(el);
  el.style.transform = `translate(${item.x}px, ${item.y}px)`;
  return el;
}

async function tumble(el, item, folderPromise) {
  const b = broomPoint();
  const spin = rand(140, 260) * (Math.random() < 0.5 ? -1 : 1);
  const mid = { x: (item.x + b.x) / 2 + rand(-30, 30), y: Math.min(item.y, b.y) - rand(30, 70) };
  await el.animate(
    [
      { transform: `translate(${item.x}px, ${item.y}px) rotate(0) scale(1)` },
      { transform: `translate(${item.x + rand(-6, 6)}px, ${item.y - 14}px) rotate(${spin * 0.1}deg) scale(1.05)`, offset: 0.15 },
      { transform: `translate(${mid.x}px, ${mid.y}px) rotate(${spin * 0.6}deg) scale(0.95)`, offset: 0.55 },
      { transform: `translate(${b.x}px, ${b.y - 10}px) rotate(${spin}deg) scale(0.8)` },
    ],
    { duration: rand(520, 700), easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' },
  ).finished;
  puff(b.x, b.y, true);
  const folder = (await folderPromise)?.[item.category];
  if (folder) {
    const top = { x: (b.x + folder.x) / 2, y: Math.min(b.y, folder.y) - rand(120, 220) };
    await el.animate(
      [
        { transform: `translate(${b.x}px, ${b.y - 10}px) rotate(${spin}deg) scale(0.8)`, opacity: 1 },
        { transform: `translate(${top.x}px, ${top.y}px) rotate(${spin * 1.6}deg) scale(0.65)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${folder.x}px, ${folder.y}px) rotate(${spin * 2}deg) scale(0.2)`, opacity: 0.2 },
      ],
      { duration: rand(650, 850), easing: 'cubic-bezier(.3,0,.5,1)', fill: 'forwards' },
    ).finished;
    puff(folder.x, folder.y);
    Sfx.pop(rand(0.85, 1.25));
  } else {
    await el.animate(
      [
        { transform: `translate(${b.x}px, ${b.y - 10}px) rotate(${spin}deg) scale(0.8)`, opacity: 1 },
        { transform: `translate(${b.x + rand(-40, 40)}px, ${b.y + 10}px) rotate(${spin * 1.4}deg) scale(0.1)`, opacity: 0 },
      ],
      { duration: 400, fill: 'forwards' },
    ).finished;
  }
  el.remove();
}

// ---- sweeping --------------------------------------------------------------

// Fill in positions for icons the OS couldn't tell us about: a grid in the
// corner where that OS puts new desktop icons.
function layoutMissing(items) {
  const mac = navigator.platform.startsWith('Mac');
  let n = 0;
  for (const it of items) {
    if (it.x != null && it.y != null) continue;
    const col = Math.floor(n / 7);
    const row = n % 7;
    it.x = mac ? W() - 60 - col * 96 : 50 + col * 96;
    it.y = 60 + row * 100;
    n++;
  }
}

// Greedy route: nearest unswept icon to the broom, plus its neighbours.
function nextCluster(items, left, perStop) {
  const b = broomPoint();
  let best = null;
  for (const i of left) {
    const d = Math.hypot(items[i].x - b.x, items[i].y - b.y);
    if (!best || d < best.d) best = { i, d };
  }
  const seed = items[best.i];
  return [...left]
    .map((i) => ({ i, d: Math.hypot(items[i].x - seed.x, items[i].y - seed.y) }))
    .sort((a, b) => a.d - b.d)
    .filter((c, k) => k === 0 || c.d <= CLUSTER_RADIUS * Math.max(1, perStop / 8))
    .slice(0, perStop)
    .map((c) => c.i);
}

let onSwept = () => {};
window.nonna.onSwept((res) => onSwept(res));
const requestSweep = (indices) =>
  new Promise((resolve) => {
    onSwept = resolve;
    window.nonna.sweep(indices);
  });

async function sweepDesktop(items) {
  layoutMissing(items);
  const left = new Set(items.map((_, i) => i));
  const perStop = Math.max(4, Math.ceil(items.length / MAX_STOPS));
  // Only a few icons per stop get the full tumble; the rest just whisk away.
  const stagger = Math.min(70, 600 / Math.min(perStop, 12));
  while (left.size) {
    const cluster = nextCluster(items, left, perStop);
    cluster.forEach((i) => left.delete(i));
    const cx = cluster.reduce((s, i) => s + items[i].x, 0) / cluster.length;
    const cy = cluster.reduce((s, i) => s + items[i].y, 0) / cluster.length;
    await walkTo(standFor(cx, cy));

    await play('sweep', { loop: true, from: rand(0, 3) });
    const stopDust = dustWhileSweeping();
    await sleep(160);
    // Icons pop off their spots as the real files move, then into the folders.
    // At most a dozen animate per stop; on huge desktops the rest just vanish.
    const shown = cluster.slice(0, 12);
    const motes = shown.map((i) => makeMote(items[i]));
    const reply = requestSweep(cluster);
    const folders = reply.then((r) => r.folders);
    await Promise.all(
      shown.map((i, k) => sleep(k * stagger).then(() => tumble(motes[k], items[i], folders))),
    );
    await sleep(Math.max(0, 450 - shown.length * stagger));
    stopDust();
    await reply;
  }
}

// ---- the visit ---------------------------------------------------------------

async function visit({ count, items, muted, recordAudio }) {
  await probed;
  Sfx.setMuted(muted);
  const audioStart = recordAudio ? Sfx.startRecording() : null;
  const { w, h } = size();
  nonnaEl.style.opacity = 0;
  nonnaEl.classList.remove('flip');
  const start = clampOnScreen({ x: W() - w - W() * 0.06, y: H() - h });

  if (count === 0) {
    // Already tidy: she appears, approves, and leaves.
    const happy = await play('happy');
    place(start);
    await fade(1, 350);
    setTimeout(() => Sfx.approve(), 900);
    await happy.ended;
  } else {
    const icons = preloadIcons(items);
    const angry = await play('angry');
    place(start);
    await fade(1, 250);
    Sfx.shout(SHOUT_SOUNDS);
    await Promise.all([shoutSequence(THROW_AT, angry.video), atTime(angry.video, THROW_AT)]);
    await throwSlipper();
    await angry.ended;

    await icons;
    await sweepDesktop(items);

    // Back down to the floor to approve.
    await walkTo({ x: pos.x, y: H() - h });
    nonnaEl.classList.remove('flip');
    const happy = await play('happy');
    setTimeout(() => Sfx.approve(), 900);
    await happy.ended;
  }

  // Broom on the shoulder, she walks right until she's gone off the screen.
  nonnaEl.classList.remove('flip');
  const leave = await play('leave');
  await atTime(leave.video, WALK_FROM);
  await walkTo({ x: W() + 20, y: pos.y }, { offscreen: true });
  vids.forEach((v) => {
    v.pause();
    v.classList.remove('on');
  });
  if (recordAudio) {
    await sleep(600);
    window.nonna.audio({ startedAt: audioStart, bytes: await Sfx.stopRecording() });
  }
  window.nonna.finished();
}

nonnaEl.addEventListener('mouseenter', () => window.nonna.hover(true));
nonnaEl.addEventListener('mouseleave', () => window.nonna.hover(false));

window.nonna.onStart(visit);
