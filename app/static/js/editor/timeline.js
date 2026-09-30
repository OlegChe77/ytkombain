// Выбор отрезка: двойной ползунок, поля с таймкодами, кнопки «Начало/Конец здесь», воспроизведение.
import { icon } from '../core/dom.js';
import { outDuration } from './state.js';

const MIN_LENGTH = 0.5;

export function fmtTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

// «83.5», «1:23.5», «1:02:03» → секунды.
export function parseTimeInput(value) {
  const text = String(value).trim().replace(',', '.');
  if (!text) return null;
  if (!/^\d+(:\d{1,2})*(\.\d+)?$/.test(text)) return null;
  return text.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

export function createTimeline(store, els, preview) {
  const { track, rangeStart, rangeEnd, startField, endField, info, time, playBtn, setStart, setEnd, loopBtn } = els;
  const sel = track.querySelector('.range-sel');
  const head = track.querySelector('.range-head');

  function render(s) {
    const d = s.video.duration || 1;
    rangeStart.max = rangeEnd.max = String(d);
    rangeStart.value = String(s.start);
    rangeEnd.value = String(s.end);
    sel.style.left = `${(s.start / d) * 100}%`;
    sel.style.width = `${((s.end - s.start) / d) * 100}%`;
    if (document.activeElement !== startField) startField.value = fmtTime(s.start);
    if (document.activeElement !== endField) endField.value = fmtTime(s.end);
    const out = outDuration(s);
    const tooLong = out > s.maxClip + 0.05;
    info.classList.toggle('is-error', tooLong);
    info.textContent = tooLong
      ? `Клип ${out.toFixed(1).replace('.', ',')} с — длиннее ${s.maxClip} с. Сократите отрезок или ускорьте видео.`
      : `Длина клипа ${out.toFixed(1).replace('.', ',')} с${s.speed !== 1 ? ` при скорости ${String(s.speed).replace('.', ',')}×` : ''}`;
    loopBtn.setAttribute('aria-pressed', String(s.loop));
  }

  function setRange(start, end, seekTo) {
    const d = store.get().video.duration;
    let a = Math.max(0, Math.min(start, d - MIN_LENGTH));
    let b = Math.min(d, Math.max(end, a + MIN_LENGTH));
    a = Math.min(a, b - MIN_LENGTH);
    b = Math.max(b, a + MIN_LENGTH);
    store.set({ start: +a.toFixed(2), end: +b.toFixed(2) });
    if (seekTo != null) preview.seek(seekTo === 'start' ? a : Math.max(a, b - 0.05));
  }

  rangeStart.addEventListener('input', () => {
    const s = store.get();
    setRange(Math.min(Number(rangeStart.value), s.end - MIN_LENGTH), s.end, 'start');
  });
  rangeEnd.addEventListener('input', () => {
    const s = store.get();
    setRange(s.start, Math.max(Number(rangeEnd.value), s.start + MIN_LENGTH), 'end');
  });

  for (const [field, key] of [[startField, 'start'], [endField, 'end']]) {
    field.addEventListener('change', () => {
      const value = parseTimeInput(field.value);
      const s = store.get();
      if (value == null) {
        field.value = fmtTime(s[key]);
        field.classList.add('is-invalid');
        setTimeout(() => field.classList.remove('is-invalid'), 1200);
        return;
      }
      if (key === 'start') setRange(value, Math.max(s.end, value + MIN_LENGTH), 'start');
      else setRange(s.start, value, 'end');
      field.value = fmtTime(store.get()[key]);
    });
    field.addEventListener('keydown', (event) => { if (event.key === 'Enter') field.blur(); });
  }

  setStart.addEventListener('click', () => {
    const s = store.get();
    const now = preview.video.currentTime;
    const length = s.end - s.start;
    setRange(now, now < s.end - MIN_LENGTH ? s.end : now + length);
  });
  setEnd.addEventListener('click', () => {
    const s = store.get();
    const now = preview.video.currentTime;
    if (now <= s.start + MIN_LENGTH) setRange(Math.max(0, now - (s.end - s.start)), now);
    else setRange(s.start, now);
  });
  loopBtn.addEventListener('click', () => store.set({ loop: !store.get().loop }));
  playBtn.addEventListener('click', () => preview.toggle());

  // Клик по дорожке (не по ползункам) — перемотка.
  track.addEventListener('pointerdown', (event) => {
    const rect = track.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    preview.seek(Math.max(0, Math.min(1, ratio)) * store.get().video.duration);
  });

  preview.onTime((current) => {
    time.textContent = fmtTime(current);
    head.style.left = `${(current / (store.get().video.duration || 1)) * 100}%`;
  });
  preview.onPlay((playing) => {
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
  });

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.target.closest?.('input, textarea, select, button, a, [role="button"], dialog')) return;
    if (!els.root.offsetParent) return;
    event.preventDefault();
    preview.toggle();
  });

  store.subscribe((s, patch) => {
    if ('start' in patch || 'end' in patch || 'speed' in patch || 'loop' in patch || 'video' in patch) render(s);
  });
  render(store.get());
}
