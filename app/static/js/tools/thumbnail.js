// Превью видео: все размеры обложки прямо с i.ytimg.com, скачивание через сервер.
import { $, h, icon } from '../core/dom.js';
import { mountUrlForm } from '../core/url-form.js';
import { copyButton } from '../core/ui.js';

const form = $('#th-form');
const out = $('#th-result');

const COVERS = [
  { name: 'maxresdefault', label: 'Максимальное', w: 1280, h: 720 },
  { name: 'sddefault', label: 'Стандартное', w: 640, h: 480 },
  { name: 'hqdefault', label: 'Высокое', w: 480, h: 360 },
  { name: 'mqdefault', label: 'Среднее 16:9', w: 320, h: 180 },
  { name: 'default', label: 'Иконка', w: 120, h: 90 },
];
const WEBP = [
  { name: 'maxresdefault', label: 'Максимальное', w: 1280, h: 720, webp: true },
  { name: 'sddefault', label: 'Стандартное', w: 640, h: 480, webp: true },
  { name: 'hqdefault', label: 'Высокое', w: 480, h: 360, webp: true },
];
const FRAMES = [
  { name: 'hq1', label: 'Кадр 1 — начало', w: 480, h: 360 },
  { name: 'hq2', label: 'Кадр 2 — середина', w: 480, h: 360 },
  { name: 'hq3', label: 'Кадр 3 — конец', w: 480, h: 360 },
];

const src = (id, v) => `https://i.ytimg.com/${v.webp ? 'vi_webp' : 'vi'}/${id}/${v.name}.${v.webp ? 'webp' : 'jpg'}`;
const download = (id, v) => `/api/thumbnail/${id}/${v.name}${v.webp ? '?webp=true' : ''}`;

function card(id, v) {
  const url = src(id, v);
  const img = h('img', { src: url, alt: `${v.label} превью, ${v.w}×${v.h}`, loading: 'lazy', decoding: 'async', width: String(v.w), height: String(v.h) });
  const size = h('span', {}, `${v.w}×${v.h}`);
  const status = h('span', { class: 'badge badge-muted' }, v.webp ? 'WebP' : 'JPG');
  const dl = h('a', { class: 'btn btn-primary btn-sm', href: download(id, v), download: '' }, icon('download'), 'Скачать');
  const open = h('a', { class: 'btn btn-secondary btn-sm', href: url, target: '_blank', rel: 'noopener' }, icon('external'), 'Открыть');
  const box = h('article', { class: 'thumb-card' },
    h('div', { class: 'thumb-media' }, img),
    h('div', { class: 'thumb-info' },
      h('div', { class: 'thumb-title' }, h('strong', {}, `${v.name}${v.webp ? '.webp' : '.jpg'}`), status),
      h('div', { class: 'thumb-title' }, h('span', {}, v.label), size),
      h('div', { class: 'thumb-actions' }, dl, open)));
  const markMissing = () => {
    box.classList.add('is-missing');
    status.className = 'badge badge-warn';
    status.textContent = 'Нет у этого видео';
    dl.setAttribute('aria-disabled', 'true');
    dl.removeAttribute('href');
  };
  img.addEventListener('load', () => {
    // На отсутствующий вариант YouTube отвечает серой заглушкой 120×90.
    if (v.w > 120 && img.naturalWidth <= 120) markMissing();
    else size.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
  });
  img.addEventListener('error', markMissing);
  return box;
}

// Лучший доступный вариант: maxres → sd → hq (hq есть у всех видео).
function best(id, button, copy) {
  const chain = [COVERS[0], COVERS[1], COVERS[2]];
  let step = 0;
  const img = h('img', { src: src(id, chain[0]), alt: 'Превью в лучшем доступном качестве', width: '1280', height: '720', decoding: 'async' });
  const apply = () => {
    const v = chain[step];
    button.href = download(id, v);
    button.lastChild.textContent = `Скачать ${v.name}`;
    copy.dataset.value = src(id, v);
  };
  const next = () => {
    if (step >= chain.length - 1) return;
    step += 1;
    img.src = src(id, chain[step]);
    apply();
  };
  img.addEventListener('load', () => { if (img.naturalWidth <= 120) next(); });
  img.addEventListener('error', next);
  apply();
  return img;
}

function render(ref) {
  const id = ref.videoId;
  const button = h('a', { class: 'btn btn-primary', download: '' }, icon('download'), h('span'));
  const copy = copyButton(() => copy.dataset.value, { label: 'Копировать ссылку', size: '' });
  out.hidden = false;
  out.replaceChildren(
    h('div', { class: 'thumb-hero' },
      h('div', { class: 'thumb-media' }, best(id, button, copy)),
      h('div', { class: 'info-section' },
        h('h3', {}, 'Лучшее качество'),
        h('p', { class: 'detect-meta' }, 'Если максимальной версии нет, здесь показана наибольшая из доступных. Все варианты — ниже.'),
        h('div', { class: 'results-actions' }, button, copy))),
    h('section', { class: 'format-group' }, h('h3', {}, 'Обложка, JPG'), h('div', { class: 'thumb-grid' }, ...COVERS.map((v) => card(id, v)))),
    h('section', { class: 'format-group' }, h('h3', {}, 'Обложка, WebP', h('small', {}, 'легче на треть — для сайтов')), h('div', { class: 'thumb-grid' }, ...WEBP.map((v) => card(id, v)))),
    h('section', { class: 'format-group' }, h('h3', {}, 'Автоматические кадры'), h('div', { class: 'thumb-grid' }, ...FRAMES.map((v) => card(id, v)))));
}

mountUrlForm(form, { onSubmit: (ref) => render(ref) });
