// Состояние редактора Shorts и общие константы. Формула размещения совпадает с app/editor/render.py.

export const FORMATS = {
  '9:16': { w: 1080, h: 1920, label: 'Shorts' },
  '1:1': { w: 1080, h: 1080, label: 'квадрат' },
  '4:5': { w: 1080, h: 1350, label: '4:5' },
  '16:9': { w: 1920, h: 1080, label: '16:9' },
};

export const FONTS = [
  { id: 'montserrat', name: 'Montserrat — классика', family: 'Montserrat', weight: 800 },
  { id: 'geologica', name: 'Geologica — острый', family: 'Geologica', weight: 800 },
  { id: 'oswald', name: 'Oswald — узкий', family: 'Oswald', weight: 700 },
  { id: 'russo', name: 'Russo One — спортивный', family: 'Russo One', weight: 400 },
  { id: 'rubikmono', name: 'Rubik Mono One — жирный', family: 'Rubik Mono One', weight: 400 },
  { id: 'comfortaa', name: 'Comfortaa — округлый', family: 'Comfortaa', weight: 700 },
  { id: 'lobster', name: 'Lobster — вывеска', family: 'Lobster', weight: 400 },
  { id: 'pacifico', name: 'Pacifico — пляжный', family: 'Pacifico', weight: 400 },
  { id: 'caveat', name: 'Caveat — от руки', family: 'Caveat', weight: 700 },
  { id: 'amatic', name: 'Amatic SC — маркер', family: 'Amatic SC', weight: 700 },
  { id: 'pixel', name: 'Press Start 2P — пиксели', family: 'Press Start 2P', weight: 400 },
  { id: 'glitch', name: 'Rubik Glitch — глитч', family: 'Rubik Glitch', weight: 400 },
];
export const FONT_MAP = Object.fromEntries(FONTS.map((f) => [f.id, f]));

const BASE_STYLE = {
  font: 'montserrat', size: 8, color: '#ffffff', strokeColor: '#000000', strokeWidth: 0.12,
  bg: false, bgColor: '#ffd60a', shadow: true, glow: false, upper: false, anim: 'pop',
};

export const PRESETS = {
  classic: { title: 'Классика', ...BASE_STYLE },
  meme: { title: 'Мем', ...BASE_STYLE, font: 'oswald', size: 10, strokeWidth: 0.16, upper: true, shadow: false, anim: 'none' },
  plate: { title: 'Плашка', ...BASE_STYLE, color: '#111111', bg: true, bgColor: '#ffd60a', strokeWidth: 0, shadow: false, anim: 'slide' },
  neon: { title: 'Неон', ...BASE_STYLE, font: 'comfortaa', color: '#7df9ff', strokeWidth: 0, shadow: false, glow: true, anim: 'fade' },
  comic: { title: 'Комикс', ...BASE_STYLE, font: 'rubikmono', size: 7, color: '#ffe14d', strokeWidth: 0.18, anim: 'pop' },
  hand: { title: 'От руки', ...BASE_STYLE, font: 'caveat', size: 11, strokeWidth: 0, anim: 'fade' },
  retro: { title: 'Ретро', ...BASE_STYLE, font: 'lobster', size: 10, color: '#ff5fa2', strokeColor: '#ffffff', strokeWidth: 0.1 },
  pixel: { title: 'Пиксели', ...BASE_STYLE, font: 'pixel', size: 5, strokeWidth: 0.14, shadow: false, anim: 'pop' },
  glitch: { title: 'Глитч', ...BASE_STYLE, font: 'glitch', size: 10, strokeWidth: 0, shadow: true, anim: 'fade' },
  subtitle: { title: 'Субтитры', ...BASE_STYLE, size: 5.2, strokeWidth: 0, bg: true, bgColor: '#000000b3', shadow: false, anim: 'none' },
};

export const EMOJI = ['😂', '🔥', '😱', '👀', '💯', '❤️', '✨', '🤯', '👉', '⬇️', '✅', '❌', '🎉', '💸'];
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

let nextId = 1;
export const newId = () => `l${nextId++}`;

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const fn of listeners) fn(state, patch);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function initialState(source) {
  const duration = source.video.duration;
  const end = Math.min(duration, 30);
  return {
    session: source.session,
    sourceUrl: source.source,
    video: source.video,
    maxClip: source.limits.max_clip,
    maxAudioMb: source.limits.max_audio_mb,
    start: 0,
    end,
    format: '9:16',
    fit: 'cover',
    background: 'blur',
    bgColor: '#101014',
    zoom: 1,
    panX: 0.5,
    panY: 0.5,
    speed: 1,
    volume: 1,
    fadeIn: false,
    fadeOut: false,
    music: null, // { name, duration, url }
    musicVolume: 0.8,
    musicOffset: 0,
    musicFade: true,
    progress: 'none',
    progressColor: '#ff3b6b',
    safeZones: false,
    loop: true,
    layers: [],
    selected: null,
  };
}

export const outDuration = (s) => Math.max(0, (s.end - s.start) / s.speed);

// Размер и положение видео в кадре — в долях кадра.
export function placement(s) {
  const { w: W, h: H } = FORMATS[s.format];
  const iw = s.video.width;
  const ih = s.video.height;
  const base = s.fit === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  const fw = iw * base * s.zoom;
  const fh = ih * base * s.zoom;
  return { W, H, fw, fh, x: (W - fw) * s.panX, y: (H - fh) * s.panY };
}

// Время слоя в секундах итогового клипа. Субтитры привязаны к времени исходного видео.
export function layerTimes(layer, s) {
  const total = outDuration(s);
  if (layer.kind === 'subtitle') {
    return { start: Math.max(0, (layer.srcStart - s.start) / s.speed), end: Math.min(total, (layer.srcEnd - s.start) / s.speed) };
  }
  return { start: Math.min(layer.start || 0, total), end: layer.end == null ? total : Math.min(layer.end, total) };
}
