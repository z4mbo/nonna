// Runs Nonna's visit with no words, only reactions: she storms in angry,
// hurls her slipper at the screen, sweeps the desktop clean, approves, and
// walks off. Uses the generated transparent clips in assets/nonna/ when
// present and an emoji stand-in otherwise.
const $ = (id) => document.getElementById(id);
const nonnaEl = $('nonna');
const vids = [...document.querySelectorAll('.clip')];
const CLIP_DIR = '../../assets/nonna/';
const STATES = ['angry', 'sweep', 'happy', 'leave'];
// Moments inside the generated clips (seconds).
const THROW_AT = 2.6; // slipper leaves her hand in angry.webm
const WALK_AT = 2.2; // she starts walking in leave.webm
const MARGIN = 24;
const SWEEP_SPEED = 140; // px per second while pacing

const ICONS = {
  Images: '🖼️', Screenshots: '📸', Documents: '📄', Spreadsheets: '📊', Presentations: '📽️',
  Videos: '🎞️', Audio: '🎵', Archives: '🗜️', Installers: '💿', Code: '📜', Apps: '📦',
  Folders: '📁', Other: '📄',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const available = {};
let x = 0; // Nonna's current left edge in px
let cur = 0; // index of the visible <video>

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

// Crossfades to the next clip on the hidden <video>, so switching between
// reactions never flashes. Resolves `ended` when a one-shot clip finishes.
async function play(state, { loop = false, fallbackMs = 1500 } = {}) {
  nonnaEl.classList.remove(...STATES);
  nonnaEl.classList.add(state);
  if (!available[state]) {
    vids.forEach((v) => v.classList.remove('on'));
    $('fallback').hidden = false;
    return { video: null, ended: loop ? new Promise(() => {}) : sleep(fallbackMs) };
  }
  $('fallback').hidden = true;
  const next = vids[1 - cur];
  const prev = vids[cur];
  next.loop = loop;
  next.src = CLIP_DIR + state + '.webm';
  await new Promise((r) => (next.oncanplay = r));
  await next.play();
  next.classList.add('on');
  prev.classList.remove('on');
  setTimeout(() => prev.pause(), 260);
  cur = 1 - cur;
  return { video: next, ended: loop ? new Promise(() => {}) : new Promise((r) => (next.onended = r)) };
}

function atTime(video, t) {
  if (!video) return sleep(t * 1000);
  return new Promise((resolve) => {
    const check = () => (video.currentTime >= t || video.ended ? resolve() : requestAnimationFrame(check));
    check();
  });
}

function nonnaWidth() {
  return nonnaEl.getBoundingClientRect().width;
}

function clampX(px) {
  return Math.min(Math.max(px, MARGIN), window.innerWidth - nonnaWidth() - MARGIN);
}

function place(px) {
  x = clampX(px);
  nonnaEl.style.transform = `translate3d(${x}px, 0, 0)`;
}

function glideTo(px, ms, easing = 'ease-in-out') {
  const to = clampX(px);
  const anim = nonnaEl.animate(
    [{ transform: `translate3d(${x}px,0,0)` }, { transform: `translate3d(${to}px,0,0)` }],
    { duration: ms, easing, fill: 'forwards' },
  );
  x = to;
  return anim.finished
    .then(() => {
      nonnaEl.style.transform = `translate3d(${x}px,0,0)`;
      anim.cancel();
    })
    .catch(() => {}); // cancelled by pace()'s stop
}

function fade(to, ms) {
  const anim = nonnaEl.animate([{ opacity: getComputedStyle(nonnaEl).opacity }, { opacity: to }], {
    duration: ms,
    fill: 'forwards',
  });
  // Commit the end value so cancelling animations later can't undo it.
  return anim.finished.then(() => {
    nonnaEl.style.opacity = to;
    anim.cancel();
  });
}

// The slipper flies out of her hand, spinning, and grows until it fills the
// screen; the glass cracks, everything shakes, and it drops away.
async function throwSlipper() {
  const s = $('slipper');
  const r = nonnaEl.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const box = s.getBoundingClientRect();
  const sw = box.width || H * 0.25;
  const sh = box.height || H * 0.6;
  const from = { x: r.left + r.width * 0.5 - sw / 2, y: r.top + r.height * 0.6 - sh / 2 };
  const hit = { x: W * 0.5 - sw / 2, y: H * 0.45 - sh / 2 };
  const grow = (H * 1.15) / sh; // tall enough to fill the screen
  s.style.opacity = 1;
  await s.animate(
    [
      { transform: `translate(${from.x}px, ${from.y}px) rotate(-30deg) scale(0.12)` },
      { transform: `translate(${(from.x + hit.x) / 2}px, ${hit.y - H * 0.15}px) rotate(220deg) scale(${grow * 0.35})`, offset: 0.55 },
      { transform: `translate(${hit.x}px, ${hit.y}px) rotate(350deg) scale(${grow})` },
    ],
    { duration: 620, easing: 'cubic-bezier(.35,.05,.7,1)', fill: 'forwards' },
  ).finished;

  const splat = $('splat');
  splat.hidden = true;
  void splat.offsetWidth;
  splat.style.left = W * 0.5 + 'px';
  splat.style.top = H * 0.45 + 'px';
  splat.hidden = false;
  $('stage').animate(
    [
      { transform: 'translate(0,0)' },
      { transform: 'translate(-18px,12px)' },
      { transform: 'translate(14px,-10px)' },
      { transform: 'translate(-8px,6px)' },
      { transform: 'translate(0,0)' },
    ],
    { duration: 380 },
  );
  // Stuck for a beat, then it slides down the glass and drops off.
  await sleep(350);
  await s.animate(
    [
      { transform: `translate(${hit.x}px, ${hit.y}px) rotate(350deg) scale(${grow})`, opacity: 1 },
      { transform: `translate(${hit.x}px, ${hit.y + H * 0.25}px) rotate(356deg) scale(${grow * 0.92})`, opacity: 1, offset: 0.5 },
      { transform: `translate(${hit.x}px, ${H * 1.6}px) rotate(380deg) scale(${grow * 0.8})`, opacity: 1 },
    ],
    { duration: 900, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' },
  ).finished;
  s.style.opacity = 0;
  s.getAnimations().forEach((a) => a.cancel());
}

// A file icon gets swept from where desktop icons live into the broom.
function sweepMote(category) {
  const el = document.createElement('div');
  el.className = 'mote';
  el.textContent = ICONS[category] || '📄';
  $('dust').append(el);
  const W = window.innerWidth;
  const mac = navigator.platform.startsWith('Mac');
  const start = { x: mac ? W - 80 - Math.random() * 260 : 40 + Math.random() * 260, y: 30 + Math.random() * window.innerHeight * 0.55 };
  const r = nonnaEl.getBoundingClientRect();
  const end = { x: r.left + r.width * (0.2 + Math.random() * 0.5), y: r.bottom - 30 };
  el.animate(
    [
      { transform: `translate(${start.x}px, ${start.y}px) rotate(0) scale(1)`, opacity: 1 },
      { transform: `translate(${(start.x + end.x) / 2}px, ${end.y - 160}px) rotate(200deg) scale(0.8)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${end.x}px, ${end.y}px) rotate(400deg) scale(0.2)`, opacity: 0 },
    ],
    { duration: 950, easing: 'ease-in', fill: 'forwards' },
  ).finished.then(() => el.remove());
}

// Main process answers each sweep request with the item it just moved.
let onSwept = () => {};
window.nonna.onSwept((res) => onSwept(res));

function sweepAll(count) {
  return new Promise((resolve) => {
    onSwept = (res) => {
      if (res.name) sweepMote(res.category);
      if (res.done) return resolve();
      setTimeout(() => window.nonna.sweep(), Math.max(110, 1500 / Math.sqrt(count)));
    };
    window.nonna.sweep();
  });
}

// Shuffles back and forth along the bottom of the screen while sweeping.
function pace() {
  let stopped = false;
  (async () => {
    const W = window.innerWidth;
    while (!stopped) {
      const target = x > W / 2 ? W * 0.12 : W * 0.75;
      await glideTo(target, (Math.abs(target - x) / SWEEP_SPEED) * 1000);
    }
  })();
  return () => {
    stopped = true;
    const m = new DOMMatrixReadOnly(getComputedStyle(nonnaEl).transform);
    nonnaEl.getAnimations().forEach((a) => a.cancel());
    place(m.m41);
    nonnaEl.style.opacity = 1;
  };
}

async function visit({ count }) {
  await probed;
  const W = window.innerWidth;
  place(W);
  nonnaEl.style.opacity = 0;

  if (count === 0) {
    // Already tidy: she appears, approves, and leaves.
    const happy = await play('happy');
    place(W - nonnaWidth() - W * 0.08);
    await fade(1, 350);
    await happy.ended;
  } else {
    const angry = await play('angry');
    place(W - nonnaWidth() - W * 0.08);
    await fade(1, 250);
    await atTime(angry.video, THROW_AT);
    await throwSlipper();
    await angry.ended;

    await play('sweep', { loop: true });
    const stopPacing = pace();
    await sweepAll(count);
    stopPacing();

    const happy = await play('happy');
    await happy.ended;
  }

  // She walks off to the right and fades out before the screen edge, so
  // she is never cut in half.
  const leave = await play('leave');
  await atTime(leave.video, WALK_AT);
  const walkMs = Math.max(1200, ((leave.video?.duration || 5) - WALK_AT) * 1000);
  const target = Math.min(x + W * 0.35, W - nonnaWidth() - MARGIN);
  await Promise.all([glideTo(target, walkMs, 'linear'), sleep(walkMs - 600).then(() => fade(0, 600))]);
  vids.forEach((v) => {
    v.pause();
    v.classList.remove('on');
  });
  window.nonna.finished();
}

nonnaEl.addEventListener('mouseenter', () => window.nonna.hover(true));
nonnaEl.addEventListener('mouseleave', () => window.nonna.hover(false));

window.nonna.onStart(visit);
