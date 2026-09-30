// Превью клипа: кадр нужного формата, видео, размытый фон, титры, перетаскивание, музыка.
import { h } from '../core/dom.js';
import { drawLayer } from './layers.js';
import { FORMATS, layerTimes, outDuration, placement } from './state.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const STYLE_KEYS = ['text', 'font', 'size', 'color', 'strokeColor', 'strokeWidth', 'bg', 'bgColor', 'shadow', 'glow', 'upper'];

export function createPreview(store, els) {
  const { box, frame, video, bg, layersBox, progress, safe, guideV, guideH } = els;
  const bgCtx = bg.getContext('2d');
  const items = new Map(); // id → { el, key, canvas }
  const listeners = { time: new Set(), play: new Set() };
  let music = null;
  let raf = 0;
  let drag = null;

  const outTime = (s) => (video.currentTime - s.start) / s.speed;

  function fitFrame() {
    const s = store.get();
    const { w, h: fh } = FORMATS[s.format];
    const availW = box.clientWidth;
    const availH = box.clientHeight;
    const scale = Math.min(availW / w, availH / fh);
    frame.style.width = `${Math.floor(w * scale)}px`;
    frame.style.height = `${Math.floor(fh * scale)}px`;
    bg.width = 96;
    bg.height = Math.round(96 * fh / w);
    drawBg();
  }

  function layout(s) {
    const p = placement(s);
    Object.assign(video.style, {
      left: `${(p.x / p.W) * 100}%`, top: `${(p.y / p.H) * 100}%`,
      width: `${(p.fw / p.W) * 100}%`, height: `${(p.fh / p.H) * 100}%`,
    });
    bg.hidden = s.background !== 'blur';
    frame.style.backgroundColor = s.background === 'color' ? s.bgColor : '#000';
    progress.hidden = s.progress === 'none';
    progress.dataset.pos = s.progress;
    progress.style.setProperty('--bar', s.progressColor);
    safe.hidden = !(s.safeZones && s.format === '9:16');
    frame.dataset.format = s.format;
  }

  function drawBg() {
    const s = store.get();
    if (s.background !== 'blur' || video.readyState < 2 || !video.videoWidth) return;
    const k = Math.max(bg.width / video.videoWidth, bg.height / video.videoHeight);
    const w = video.videoWidth * k;
    const hh = video.videoHeight * k;
    bgCtx.drawImage(video, (bg.width - w) / 2, (bg.height - hh) / 2, w, hh);
  }

  function syncLayers(s) {
    const W = FORMATS[s.format].w;
    const alive = new Set();
    for (const layer of s.layers) {
      alive.add(layer.id);
      let item = items.get(layer.id);
      if (!item) {
        const el = h('div', { class: 'layer', tabindex: '0', role: 'button', dataset: { id: layer.id } });
        layersBox.append(el);
        item = { el, key: '' };
        items.set(layer.id, item);
      }
      const key = JSON.stringify([...STYLE_KEYS.map((k) => layer[k]), W]);
      if (item.key !== key) {
        item.canvas = drawLayer(layer, W);
        item.key = key;
        item.el.replaceChildren(item.canvas);
      }
      item.el.style.left = `${layer.x * 100}%`;
      item.el.style.top = `${layer.y * 100}%`;
      item.el.style.width = `${(item.canvas.width / W) * 100}%`;
      item.el.setAttribute('aria-label', `Титр «${layer.text}». Перетащите или двигайте стрелками`);
      item.el.classList.toggle('is-selected', s.selected === layer.id);
    }
    for (const [id, item] of items) {
      if (!alive.has(id)) {
        item.el.remove();
        items.delete(id);
      }
    }
    updateTime();
  }

  function updateTime() {
    const s = store.get();
    const t = outTime(s);
    const total = outDuration(s);
    const frameH = frame.clientHeight;
    for (const layer of s.layers) {
      const item = items.get(layer.id);
      if (!item) continue;
      const { start, end } = layerTimes(layer, s);
      const inside = t >= start && t < end;
      let opacity = 1;
      let dy = 0;
      let scale = 1;
      if (inside && layer.anim !== 'none') {
        const a = t - start;
        opacity = clamp(Math.min(a, end - t) / 0.25, 0, 1);
        if (layer.anim === 'slide') dy = frameH * 0.06 * Math.max(0, 1 - a / 0.35) ** 2;
        if (layer.anim === 'pop') scale = Math.min(1, 0.55 + (0.45 * a) / 0.22);
      }
      const selected = s.selected === layer.id && video.paused;
      item.el.hidden = !inside && !selected;
      item.el.classList.toggle('is-outside', !inside);
      item.el.style.opacity = inside ? String(opacity) : '';
      item.el.style.transform = `translate(-50%, calc(-50% + ${dy.toFixed(1)}px)) scale(${scale.toFixed(3)})`;
    }
    progress.firstElementChild.style.width = `${clamp(total ? t / total : 0, 0, 1) * 100}%`;
    for (const fn of listeners.time) fn(video.currentTime, t);
  }

  // ---- Музыка ----
  function musicTime(s) {
    const length = s.music?.duration || music?.duration || 0;
    const pos = s.musicOffset + Math.max(0, outTime(s));
    return length ? pos % length : pos;
  }

  function syncMusic() {
    const s = store.get();
    if (!music || !s.music) return;
    music.currentTime = musicTime(s);
    if (!video.paused) music.play().catch(() => {});
    else music.pause();
  }

  function applyVolumes(s) {
    video.volume = clamp(s.volume, 0, 1);
    video.muted = s.volume === 0;
    if (music) music.volume = clamp(s.musicVolume, 0, 1);
    video.playbackRate = s.speed;
  }

  function setMusic(url) {
    if (music) {
      music.pause();
      music.src = '';
    }
    music = url ? new Audio(url) : null;
    if (music) music.loop = true;
    applyVolumes(store.get());
    syncMusic();
  }

  // ---- Воспроизведение ----
  function loop() {
    const s = store.get();
    if (video.currentTime >= s.end - 0.03) {
      if (s.loop) {
        video.currentTime = s.start;
        syncMusic();
      } else {
        video.pause();
      }
    }
    updateTime();
    drawBg();
    if (music && s.music && !music.paused && Math.abs(music.currentTime - musicTime(s)) > 0.3) music.currentTime = musicTime(s);
    raf = requestAnimationFrame(loop);
  }

  function play() {
    const s = store.get();
    if (video.currentTime < s.start || video.currentTime >= s.end - 0.05) video.currentTime = s.start;
    video.play().catch(() => {});
  }

  video.addEventListener('play', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
    syncMusic();
    listeners.play.forEach((fn) => fn(true));
  });
  video.addEventListener('pause', () => {
    cancelAnimationFrame(raf);
    music?.pause();
    updateTime();
    listeners.play.forEach((fn) => fn(false));
  });
  video.addEventListener('seeked', () => {
    drawBg();
    updateTime();
    syncMusic();
  });
  video.addEventListener('loadeddata', drawBg);
  video.addEventListener('timeupdate', () => { if (video.paused) updateTime(); });

  // ---- Перетаскивание титров и видео ----
  function moveLayer(id, x, y) {
    const s = store.get();
    const target = s.layers.find((l) => l.id === id);
    if (!target) return;
    const dx = x - target.x;
    const dy = y - target.y;
    const group = target.kind === 'subtitle';
    store.set({
      layers: s.layers.map((l) => (l.id === id || (group && l.kind === 'subtitle')
        ? { ...l, x: clamp(l.x + dx, 0, 1), y: clamp(l.y + dy, 0, 1) } : l)),
    });
  }

  frame.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const s = store.get();
    const rect = frame.getBoundingClientRect();
    const layerEl = event.target.closest('.layer');
    if (layerEl) {
      const layer = s.layers.find((l) => l.id === layerEl.dataset.id);
      if (!layer) return;
      if (s.selected !== layer.id) store.set({ selected: layer.id });
      drag = { type: 'layer', id: layer.id, x0: layer.x, y0: layer.y, px: event.clientX, py: event.clientY, rect };
    } else {
      const p = placement(s);
      drag = {
        type: 'pan', px: event.clientX, py: event.clientY, pan: [s.panX, s.panY],
        rangeX: ((p.W - p.fw) / p.W) * rect.width, rangeY: ((p.H - p.fh) / p.H) * rect.height,
      };
      if (s.selected) store.set({ selected: null });
    }
    frame.setPointerCapture(event.pointerId);
    frame.classList.add('is-dragging');
    event.preventDefault();
  });

  frame.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.px;
    const dy = event.clientY - drag.py;
    if (drag.type === 'layer') {
      let x = drag.x0 + dx / drag.rect.width;
      let y = drag.y0 + dy / drag.rect.height;
      const snapX = Math.abs(x - 0.5) < 0.018;
      const snapY = Math.abs(y - 0.5) < 0.012;
      if (snapX) x = 0.5;
      if (snapY) y = 0.5;
      guideV.hidden = !snapX;
      guideH.hidden = !snapY;
      moveLayer(drag.id, clamp(x, 0, 1), clamp(y, 0, 1));
    } else {
      const panX = Math.abs(drag.rangeX) > 1 ? clamp(drag.pan[0] + dx / drag.rangeX, 0, 1) : drag.pan[0];
      const panY = Math.abs(drag.rangeY) > 1 ? clamp(drag.pan[1] + dy / drag.rangeY, 0, 1) : drag.pan[1];
      store.set({ panX, panY });
    }
  });

  const endDrag = () => {
    drag = null;
    guideV.hidden = true;
    guideH.hidden = true;
    frame.classList.remove('is-dragging');
  };
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);

  layersBox.addEventListener('keydown', (event) => {
    const el = event.target.closest('.layer');
    if (!el) return;
    const layer = store.get().layers.find((l) => l.id === el.dataset.id);
    if (!layer) return;
    const step = event.shiftKey ? 0.02 : 0.005;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      moveLayer(layer.id, clamp(layer.x + moves[event.key][0], 0, 1), clamp(layer.y + moves[event.key][1], 0, 1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      store.set({ selected: layer.id });
    }
  });

  // Шрифт загрузился позже первой отрисовки — перерисовываем титры.
  document.fonts?.addEventListener?.('loadingdone', () => {
    for (const item of items.values()) item.key = '';
    syncLayers(store.get());
  });

  new ResizeObserver(fitFrame).observe(box);

  store.subscribe((s, patch) => {
    if ('sourceUrl' in patch) {
      video.src = s.sourceUrl;
      setMusic(null);
    }
    if ('format' in patch) fitFrame();
    layout(s);
    applyVolumes(s);
    if ('layers' in patch || 'selected' in patch || 'format' in patch) syncLayers(s);
    if (('start' in patch || 'end' in patch) && video.paused) updateTime();
    if ('background' in patch || 'format' in patch) drawBg();
  });

  video.src = store.get().sourceUrl;
  const s = store.get();
  layout(s);
  applyVolumes(s);
  fitFrame();

  return {
    video,
    play,
    pause: () => video.pause(),
    toggle: () => (video.paused ? play() : video.pause()),
    seek: (time) => { video.currentTime = time; },
    outTime: () => outTime(store.get()),
    setMusic,
    onTime: (fn) => listeners.time.add(fn),
    onPlay: (fn) => listeners.play.add(fn),
  };
}
