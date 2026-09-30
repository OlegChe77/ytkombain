// Звуки и фейерверк без файлов: звук синтезируется Web Audio, частицы рисуются на canvas.
import { h } from './dom.js';

const SOUND_KEY = 'kombain-sound';
const COLORS = ['#7482ff', '#e46fd5', '#f1c84b', '#43c9e3', '#4fcf87', '#ffffff'];
let audioCtx = null;

export function soundOn() {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function setSound(on) {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* хранилище недоступно */ }
}

function ctx() {
  if (!soundOn()) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx ||= new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Готовит звук по нажатию пользователя: браузеры разрешают аудио только после жеста.
export function unlockAudio() {
  ctx();
}

function tone(ac, { freq, start = 0, duration = 0.15, type = 'triangle', gain = 0.18, slide = null }) {
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + duration);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// Щелчок барабана; pitch чуть меняется, чтобы звук не был механическим.
export function tick(progress = 0) {
  const ac = ctx();
  if (!ac) return;
  tone(ac, { freq: 1500 + Math.random() * 300 - progress * 400, duration: 0.045, type: 'square', gain: 0.05 });
}

// Фанфары победителя: арпеджио до-мажора и финальный аккорд с искрами.
export function fanfare() {
  const ac = ctx();
  if (!ac) return;
  [523.25, 659.25, 783.99].forEach((freq, i) => tone(ac, { freq, start: i * 0.1, duration: 0.18, gain: 0.16 }));
  [523.25, 659.25, 783.99, 1046.5].forEach((freq) => tone(ac, { freq, start: 0.32, duration: 0.9, gain: 0.09 }));
  tone(ac, { freq: 1046.5, start: 0.32, duration: 0.9, type: 'square', gain: 0.03 });
  for (let i = 0; i < 7; i += 1) {
    tone(ac, { freq: 2000 + Math.random() * 2200, start: 0.45 + i * 0.07, duration: 0.12, type: 'sine', gain: 0.05 });
  }
}

export function fireworks(container, { bursts = 4 } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = container.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h('canvas', { class: 'fireworks', 'aria-hidden': 'true' });
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  container.append(canvas);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const particles = [];
  const burst = (x, y) => {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    for (let i = 0; i < 46; i += 1) {
      const angle = (Math.PI * 2 * i) / 46 + Math.random() * 0.2;
      const speed = 2 + Math.random() * 3.2;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, color: Math.random() < 0.25 ? '#ffffff' : color });
    }
  };
  for (let i = 0; i < bursts; i += 1) {
    setTimeout(() => burst(rect.width * (0.2 + Math.random() * 0.6), rect.height * (0.15 + Math.random() * 0.35)), i * 260);
  }
  const started = performance.now();
  const frame = (now) => {
    g.clearRect(0, 0, rect.width, rect.height);
    for (const p of particles) {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.06;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.012;
      if (p.life <= 0) continue;
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      g.fill();
    }
    if (now - started < 2600) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
  setTimeout(() => canvas.remove(), 4000); // во вкладке в фоне анимация не идёт — убираем холст в любом случае
}
