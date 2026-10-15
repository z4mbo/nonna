// Runs Nonna's visit: storm in, throw the ciabatta, sweep, approve, leave.
// Uses the generated transparent clips in assets/nonna/ when present and an
// emoji stand-in otherwise, so the app works before the assets exist.
const $ = (id) => document.getElementById(id);
const nonnaEl = $('nonna');
const clip = $('clip');
const bubble = $('bubble');
const CLIP_DIR = '../../assets/nonna/';
const STATES = ['angry', 'sweep', 'happy', 'leave'];

const LINES = {
  angry: ['Ma che disastro è questo?!', 'Madonna mia, che casino!', 'Ma ti sembra il modo?!'],
  sweep: ['Adesso ci penso io…', 'Sempre io devo fare tutto!', 'Guarda qua, guarda…'],
  happy: ['Ecco! Così si fa!', 'Brava la Nonna!', 'Pulito come casa mia!'],
  clean: ['Bravo! Tutto in ordine!', 'Che bravo nipote!'],
  leave: ['Ciao bello! Mangia qualcosa!', 'Ciao ciao! Copriti!'],
};

const THROW_AT = 4.55;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const available = {};

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

function say(text, ms = 2200) {
  bubble.textContent = text;
  bubble.hidden = false;
  clearTimeout(say.t);
  say.t = setTimeout(() => (bubble.hidden = true), ms);
}

// Plays a state's clip (looping or once) or switches the fallback pose.
// Resolves when a one-shot clip ends, or straight away for loops.
function pose(state, { loop = false, fallbackMs = 1500 } = {}) {
  nonnaEl.className = nonnaEl.className.replace(/\b(angry|sweeping|happy|leaving)\b/g, '').trim();
  nonnaEl.classList.add({ angry: 'angry', sweep: 'sweeping', happy: 'happy', leave: 'leaving' }[state]);
  if (!available[state]) {
    clip.hidden = true;
    $('fallback').hidden = false;
    return loop ? Promise.resolve() : sleep(fallbackMs);
  }
  $('fallback').hidden = true;
  clip.hidden = false;
  clip.loop = loop;
  clip.src = CLIP_DIR + state + '.webm';
  clip.play();
  if (loop) return Promise.resolve();
  return new Promise((r) => (clip.onended = r));
}

function atClipTime(t) {
  return new Promise((resolve) => {
    const check = () => (clip.currentTime >= t || clip.ended ? resolve() : requestAnimationFrame(check));
    check();
  });
}

function moveTo(leftPx, ms = 1600) {
  nonnaEl.style.transition = `left ${ms}ms ease-in-out`;
  nonnaEl.style.left = leftPx + 'px';
  return sleep(ms);
}

async function throwCiabatta() {
  const bread = $('ciabatta');
  const r = nonnaEl.getBoundingClientRect();
  const start = { x: r.left + r.width * 0.3, y: r.top + r.height * 0.3 };
  const end = { x: window.innerWidth * (0.35 + Math.random() * 0.3), y: window.innerHeight * (0.3 + Math.random() * 0.2) };
  const anim = bread.animate(
    [
      { opacity: 1, transform: `translate(${start.x}px, ${start.y}px) rotate(0deg) scale(0.6)` },
      { opacity: 1, transform: `translate(${(start.x + end.x) / 2}px, ${end.y - 200}px) rotate(540deg) scale(1.6)` },
      { opacity: 1, transform: `translate(${end.x}px, ${end.y}px) rotate(1080deg) scale(4)` },
    ],
    { duration: 650, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'forwards' },
  );
  await anim.finished;
  bread.style.opacity = 0;
  anim.cancel();
  const splat = $('splat');
  splat.hidden = true;
  void splat.offsetWidth;
  splat.style.left = end.x + 'px';
  splat.style.top = end.y + 'px';
  splat.hidden = false;
  document.body.animate(
    [{ transform: 'translate(0,0)' }, { transform: 'translate(-12px,8px)' }, { transform: 'translate(10px,-6px)' }, { transform: 'translate(0,0)' }],
    { duration: 300 },
  );
}

function showSwept({ name, category }) {
  const el = document.createElement('div');
  el.className = 'item';
  el.append(name + ' → ');
  const b = document.createElement('b');
  b.textContent = category;
  el.append(b);
  const r = nonnaEl.getBoundingClientRect();
  el.style.left = r.left - 40 + 'px';
  $('dust').append(el);
  setTimeout(() => el.remove(), 1200);
}

// Main process answers each sweep request with the item it just moved.
let onSwept = () => {};
window.nonna.onSwept((res) => onSwept(res));

function sweepAll(count) {
  return new Promise((resolve) => {
    let done = 0;
    const counter = $('counter');
    counter.hidden = false;
    counter.textContent = `Nonna is tidying… 0 / ${count}`;
    onSwept = (res) => {
      if (res.name) {
        done++;
        showSwept(res);
        counter.textContent = `Nonna is tidying… ${done} / ${count}`;
      }
      if (res.done) {
        counter.hidden = true;
        return resolve();
      }
      setTimeout(() => window.nonna.sweep(), Math.max(120, 1600 / Math.sqrt(count)));
    };
    window.nonna.sweep();
  });
}

async function visit({ count }) {
  await probed;
  const W = window.innerWidth;
  const h = nonnaEl.getBoundingClientRect().width;
  nonnaEl.style.transition = 'none';
  nonnaEl.style.left = W + 'px';
  nonnaEl.classList.add('flip');
  void nonnaEl.offsetWidth;

  if (count === 0) {
    pose('happy', { loop: true });
    await moveTo(W - h * 1.1);
    say(pick(LINES.clean));
    await sleep(2400);
  } else {
    const angry = pose('angry', { fallbackMs: 1400 });
    await moveTo(W - h * 1.1, 500);
    say(pick(LINES.angry), 2600);
    // In the generated clip the ciabatta leaves her hand at ~4.6 s.
    if (available.angry) await atClipTime(THROW_AT);
    else await sleep(500);
    await throwCiabatta();
    await angry;
    await sleep(300);

    pose('sweep', { loop: true });
    say(pick(LINES.sweep), 2400);
    const sweeping = sweepAll(count);
    // Pace across the bottom of the screen while the files get swept.
    nonnaEl.style.transition = 'left 3s ease-in-out';
    let toLeft = true;
    const pacing = setInterval(() => {
      nonnaEl.classList.toggle('flip', toLeft);
      nonnaEl.style.left = (toLeft ? W * 0.15 : W - h * 1.1) + 'px';
      toLeft = !toLeft;
    }, 3000);
    nonnaEl.style.left = W * 0.4 + 'px';
    await sweeping;
    clearInterval(pacing);

    await pose('happy', { fallbackMs: 1800 });
    say(pick(LINES.happy), 2200);
    await sleep(available.happy ? 600 : 1200);
  }

  say(pick(LINES.leave), 2400);
  nonnaEl.classList.add('flip');
  if (available.leave) {
    // The clip waves first, then walks off to the right.
    const leaving = pose('leave');
    await atClipTime(2.6);
    await moveTo(W + 40, 2400);
    await leaving;
  } else {
    pose('leave', { loop: true });
    await moveTo(W + 40, 2200);
  }
  clip.pause();
  window.nonna.finished();
}

nonnaEl.addEventListener('mouseenter', () => window.nonna.hover(true));
nonnaEl.addEventListener('mouseleave', () => window.nonna.hover(false));
// A little poke makes her grumble.
nonnaEl.addEventListener('click', () => say(pick(LINES.angry), 1500));

window.nonna.onStart(visit);
