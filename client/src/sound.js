// Sons sintetizados via WebAudio — sem arquivos externos.
let ctx = null;
let muted = false;

try {
  muted = localStorage.getItem('domino_muted') === '1';
} catch { /* ignore */ }

function ac() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone({ freq = 440, dur = 0.12, type = 'triangle', gain = 0.06, delay = 0, slideTo = null }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur = 0.07, gain = 0.05) {
  const c = ac();
  if (!c) return;
  const frames = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 1800;
  const g = c.createGain();
  g.gain.value = gain;
  src.buffer = buffer;
  src.connect(filter).connect(g).connect(c.destination);
  src.start();
}

export const sound = {
  get muted() { return muted; },
  setMuted(v) {
    muted = !!v;
    try { localStorage.setItem('domino_muted', muted ? '1' : '0'); } catch { /* ignore */ }
  },
  toggle() { sound.setMuted(!muted); return muted; },

  click() { tone({ freq: 660, dur: 0.06, type: 'square', gain: 0.03 }); },
  play() {
    tone({ freq: 520, dur: 0.09, type: 'triangle', gain: 0.07 });
    tone({ freq: 780, dur: 0.14, type: 'triangle', gain: 0.05, delay: 0.05 });
    noise(0.05, 0.03);
  },
  draw() { noise(0.09, 0.05); tone({ freq: 260, dur: 0.08, type: 'sine', gain: 0.03, delay: 0.02 }); },
  pass() { tone({ freq: 220, dur: 0.16, type: 'sine', gain: 0.05, slideTo: 150 }); },
  roundEnd() {
    tone({ freq: 523, dur: 0.16, gain: 0.06 });
    tone({ freq: 659, dur: 0.16, gain: 0.06, delay: 0.12 });
    tone({ freq: 784, dur: 0.3, gain: 0.07, delay: 0.24 });
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.25, gain: 0.07, delay: i * 0.11 }));
  },
  lose() {
    [440, 349, 262].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'sine', gain: 0.06, delay: i * 0.13 }));
  },
  found() {
    tone({ freq: 700, dur: 0.1, gain: 0.05 });
    tone({ freq: 1050, dur: 0.18, gain: 0.05, delay: 0.09 });
  },
};
