// Генератор iframe: настройки → живое превью и код. Работает в браузере.
import { $, $$, h, formValues } from '../core/dom.js';
import { api } from '../core/api.js';
import { parseYouTube } from '../core/yturl.js';
import { parseTime } from '../core/format.js';
import { copyText } from '../core/ui.js';

const form = $('#embed-form');
const urlInput = $('#embed-url');
const hint = $('#embed-hint');
const stage = $('#embed-stage');
const codeBox = $('#embed-code');
const copyBtn = $('#embed-copy');
const sizeBox = $('#embed-size');
const output = $('.embed-output');
let code = '';
let lastSrc = '';
let title = 'YouTube video player';
let titleFor = '';
let timer = null;

const ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

function build() {
  const v = formValues(form);
  const ref = parseYouTube(v.url);
  if (!v.url.trim()) return { error: '' };
  if (!ref.ok) return { error: ref.error };
  if (!ref.videoId && !ref.playlistId) return { error: 'Встроить можно видео или плейлист, но не канал.' };
  const host = v.nocookie ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com';
  const params = new URLSearchParams();
  let path;
  if (ref.videoId) {
    path = `/embed/${ref.videoId}`;
    if (ref.playlistId) params.set('list', ref.playlistId);
  } else {
    path = '/embed/videoseries';
    params.set('list', ref.playlistId);
  }
  const start = parseTime(v.start) ?? ref.start;
  const end = parseTime(v.end);
  if (v.autoplay) { params.set('autoplay', '1'); params.set('mute', '1'); }
  if (v.loop) {
    params.set('loop', '1');
    if (ref.videoId && !ref.playlistId) params.set('playlist', ref.videoId);
  }
  if (!v.controls) params.set('controls', '0');
  if (v.cc) params.set('cc_load_policy', '1');
  if (v.rel) params.set('rel', '0');
  if (!v.fs) params.set('fs', '0');
  if (start) params.set('start', String(start));
  if (end && (!start || end > start)) params.set('end', String(end));
  params.set('playsinline', '1');
  const src = `${host}${path}${params.toString() ? `?${params}` : ''}`;
  const width = Math.min(3840, Math.max(200, Number(v.width) || 560));
  const height = Math.min(2160, Math.max(113, Number(v.height) || 315));
  const warnings = [];
  if (v.start && start == null) warnings.push('Не получилось разобрать время начала.');
  if (v.end && end == null) warnings.push('Не получилось разобрать время окончания.');
  if (end && start && end <= start) warnings.push('Время окончания должно быть позже начала.');
  return { ref, src, width, height, responsive: v.responsive, lazy: v.lazy, fs: v.fs, warnings, raw: v.url.trim() };
}

function attrs(cfg) {
  const list = [];
  if (cfg.responsive) list.push(['style', 'width: 100%; height: auto; aspect-ratio: 16 / 9; border: 0;']);
  else list.push(['width', String(cfg.width)], ['height', String(cfg.height)], ['style', 'border: 0;']);
  list.push(['src', cfg.src], ['title', title], ['allow', ALLOW], ['referrerpolicy', 'strict-origin-when-cross-origin']);
  if (cfg.lazy) list.push(['loading', 'lazy']);
  return list;
}

function renderCode(cfg) {
  const list = attrs(cfg);
  const esc = (val) => val.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  code = `<iframe ${list.map(([k, val]) => `${k}="${esc(val)}"`).join(' ')}${cfg.fs ? ' allowfullscreen' : ''}></iframe>`;
  const nodes = [h('span', { class: 'tok-tag' }, '<iframe')];
  for (const [k, val] of list) nodes.push('\n  ', h('span', { class: 'tok-attr' }, k), '=', h('span', { class: 'tok-str' }, `"${val}"`));
  if (cfg.fs) nodes.push('\n  ', h('span', { class: 'tok-attr' }, 'allowfullscreen'));
  nodes.push(h('span', { class: 'tok-tag' }, '>'), h('span', { class: 'tok-tag' }, '</iframe>'));
  codeBox.replaceChildren(h('code', {}, ...nodes));
  copyBtn.disabled = false;
}

function renderPreview(cfg) {
  if (cfg.src === lastSrc && stage.dataset.mode === String(cfg.responsive)) {
    const frame = $('iframe', stage);
    if (frame && !cfg.responsive) { frame.width = cfg.width; frame.height = cfg.height; }
    return;
  }
  lastSrc = cfg.src;
  stage.dataset.mode = String(cfg.responsive);
  const frame = h('iframe', { src: cfg.src, title, allow: ALLOW, referrerpolicy: 'strict-origin-when-cross-origin', allowfullscreen: cfg.fs });
  if (!cfg.responsive) { frame.width = cfg.width; frame.height = cfg.height; }
  stage.replaceChildren(cfg.responsive ? h('div', { class: 'is-responsive' }, frame) : frame);
}

async function fetchTitle(cfg) {
  if (titleFor === cfg.raw) return;
  titleFor = cfg.raw;
  try {
    const data = await api(`/api/preview?url=${encodeURIComponent(cfg.raw)}`);
    if (data.title) {
      title = data.title;
      const current = build();
      if (current.src) renderCode(current);
    }
  } catch { /* необязательно */ }
}

function update() {
  const cfg = build();
  sizeBox.hidden = Boolean(formValues(form).responsive);
  if (!cfg.src) {
    hint.textContent = cfg.error;
    hint.className = `field-hint ${cfg.error ? 'is-error' : ''}`;
    copyBtn.disabled = true;
    return;
  }
  hint.className = 'field-hint';
  hint.textContent = cfg.warnings.join(' ') || (cfg.ref.playlistId && !cfg.ref.videoId ? 'Будет встроен весь плейлист.' : '');
  renderCode(cfg);
  clearTimeout(timer);
  timer = setTimeout(() => renderPreview(cfg), 350);
  fetchTitle(cfg);
}

form.addEventListener('input', update);
form.addEventListener('change', update);
form.addEventListener('submit', (e) => e.preventDefault());
copyBtn.addEventListener('click', () => copyText(code, copyBtn));
$('[data-paste]', form).addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) { urlInput.value = text.trim(); update(); }
  } catch { urlInput.focus(); }
});
for (const tab of $$('.embed-tabs [role="tab"]')) {
  tab.addEventListener('click', () => {
    const code = tab.id === 'embed-tab-code';
    output.classList.toggle('show-code', code);
    for (const t of $$('.embed-tabs [role="tab"]')) t.setAttribute('aria-selected', String(t === tab));
  });
}

const initial = new URLSearchParams(location.search).get('url');
if (initial) urlInput.value = initial;
update();
