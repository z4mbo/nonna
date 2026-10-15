// Nonna's sound effects, all synthesized with Web Audio (no sound files, so
// nothing to license). Everything goes through one master gain, which can be
// muted and, for demo recordings, captured to a file.
const Sfx = (() => {
  let ctx = null;
  let master = null;
  let muted = false;
  let recorder = null;
  let chunks = [];

  function init() {
    if (ctx) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    Sfx.out = comp;
  }

  const now = () => ctx.currentTime;

  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function env(gain, t, attack, hold, release, peak = 1) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.setValueAtTime(peak, t + attack + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  function noise({ t = now(), dur = 0.3, type = 'bandpass', freq = 1000, freqTo = null, q = 1, peak = 0.5, attack = 0.01, release = 0.2 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + release + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = ctx.createGain();
    env(g, t, attack, Math.max(0, dur - attack), release, peak);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + release + 0.05);
  }

  function tone({ t = now(), freq = 440, freqTo = null, dur = 0.2, type = 'sine', peak = 0.3, attack = 0.005, release = 0.15, vibrato = 0 }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 6;
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + release);
    }
    const g = ctx.createGain();
    env(g, t, attack, Math.max(0, dur - attack), release, peak);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + release + 0.05);
  }

  // A voiced "grumble": a buzzy low source through two moving vowel formants.
  function voice({ t = now(), dur = 0.8, pitch = 190, pitchTo = 150, vowels = [[700, 1200], [500, 900]], peak = 0.5, wobble = 18 }) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch, t);
    o.frequency.exponentialRampToValueAtTime(pitchTo, t + dur);
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 7;
    lg.gain.value = wobble;
    lfo.connect(lg).connect(o.frequency);
    const out = ctx.createGain();
    env(out, t, 0.04, dur - 0.1, 0.12, peak);
    for (let k = 0; k < 2; k++) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 6;
      vowels.forEach((v, i) => f.frequency.setValueAtTime(v[k], t + (dur * i) / vowels.length));
      o.connect(f).connect(out);
    }
    out.connect(master);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.2);
    lfo.stop(t + dur + 0.2);
  }

  const play = (fn) => (...args) => {
    if (muted) return;
    init();
    if (ctx.state === 'suspended') ctx.resume();
    fn(...args);
  };

  return {
    setMuted(m) {
      muted = !!m;
    },

    // Angry Italian-grandma grumbling: a few vowel-y bursts plus a huff.
    grumble: play(() => {
      const t = now();
      voice({ t, dur: 0.55, pitch: 230, pitchTo: 300, vowels: [[800, 1250], [650, 1100], [500, 900]], peak: 0.45 });
      voice({ t: t + 0.6, dur: 0.45, pitch: 280, pitchTo: 210, vowels: [[400, 2000], [700, 1200]], peak: 0.45 });
      voice({ t: t + 1.1, dur: 0.7, pitch: 260, pitchTo: 170, vowels: [[750, 1150], [600, 1000], [450, 850]], peak: 0.5 });
      noise({ t: t + 1.9, dur: 0.25, type: 'bandpass', freq: 1500, q: 0.8, peak: 0.35, release: 0.3 });
    }),

    // A recorded (generated) old-lady shout, routed through the same master
    // so mute and demo recording apply to it too.
    shout: play((urls) => {
      const a = new Audio(urls[Math.floor(Math.random() * urls.length)]);
      ctx.createMediaElementSource(a).connect(master);
      a.play().catch(() => {});
    }),

    huff: play(() => noise({ dur: 0.22, type: 'bandpass', freq: 1300, q: 0.7, peak: 0.4, release: 0.3 })),

    whoosh: play((ms = 650) => {
      const d = ms / 1000;
      noise({ dur: d, type: 'bandpass', freq: 300, freqTo: 3200, q: 1.5, peak: 0.55, attack: d * 0.6, release: 0.08 });
    }),

    // The slipper hitting the screen: a dull thump plus a slap.
    thwack: play(() => {
      const t = now();
      tone({ t, freq: 140, freqTo: 45, dur: 0.18, type: 'sine', peak: 0.9, release: 0.25 });
      noise({ t, dur: 0.05, type: 'highpass', freq: 1200, peak: 0.9, attack: 0.002, release: 0.12 });
      noise({ t, dur: 0.12, type: 'lowpass', freq: 600, peak: 0.6, attack: 0.002, release: 0.2 });
    }),

    step: play(() => {
      const t = now();
      tone({ t, freq: 95, freqTo: 60, dur: 0.05, peak: 0.35, release: 0.08 });
      noise({ t, dur: 0.04, type: 'bandpass', freq: 700, q: 2, peak: 0.15, release: 0.06 });
    }),

    swish: play(() => {
      noise({ dur: 0.2, type: 'bandpass', freq: 2500, freqTo: 4500, q: 1.2, peak: 0.22, attack: 0.08, release: 0.15 });
    }),

    // An icon landing in its folder.
    pop: play((pitch = 1) => {
      tone({ freq: 520 * pitch, freqTo: 900 * pitch, dur: 0.06, type: 'sine', peak: 0.25, release: 0.1 });
    }),

    // Satisfied "mmh!" hum and a little chime.
    approve: play(() => {
      const t = now();
      voice({ t, dur: 0.6, pitch: 210, pitchTo: 260, vowels: [[300, 900], [300, 900]], peak: 0.35, wobble: 4 });
      [784, 988, 1319].forEach((f, i) => tone({ t: t + 0.55 + i * 0.12, freq: f, dur: 0.12, type: 'triangle', peak: 0.22, release: 0.5 }));
    }),

    // For demo recordings: capture everything she plays into a WebM.
    startRecording() {
      init();
      const dest = ctx.createMediaStreamDestination();
      Sfx.out.connect(dest);
      chunks = [];
      recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.start();
      return Date.now();
    },
    async stopRecording() {
      if (!recorder) return null;
      const done = new Promise((r) => (recorder.onstop = r));
      recorder.stop();
      await done;
      recorder = null;
      return new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer());
    },
  };
})();
