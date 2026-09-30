// Главная: «Что вы хотите сделать с YouTube?» — распознаёт ссылку и подсвечивает подходящие инструменты.
import { $, $$, h } from './core/dom.js';
import { api } from './core/api.js';
import { parseYouTube, thumb } from './core/yturl.js';
import { readClipboard } from './core/url-form.js';
import { toast } from './core/ui.js';

const form = $('#detector');
const input = $('#detector-input');
const field = input.closest('.url-field');
const hint = $('[data-hint]', form);
const result = $('#detect-result');
const quick = $('#quick');
const timeline = $('#timeline');
const clips = $$('.tl-clip', timeline);
let previewTimer = null;
let lastRaw = '';
let lastShown = '';
const moreBtn = $('[data-more]', result);

// Главные действия для видео — остальные прячутся под «Ещё», чтобы не рассеивать внимание.
const PRIMARY_VIDEO = ['youtube-downloader', 'youtube-audio-downloader', 'youtube-shorts-maker', 'youtube-transcript', 'youtube-video-info',
  'youtube-thumbnail', 'youtube-timestamp', 'youtube-embed'];

const LEADS = {
  video: 'Это видео. Вот что с ним можно сделать:',
  short: 'Это Shorts — с ним работают те же инструменты, что и с обычным видео:',
  live: 'Это трансляция. Скачать её можно после окончания эфира, остальное доступно уже сейчас:',
  'video+playlist': 'Видео внутри плейлиста — можно работать и с роликом, и со всем списком:',
  playlist: 'Это плейлист. Доступные инструменты:',
  channel: 'Это канал. Доступные инструменты:',
};

function resetTimeline() {
  timeline?.classList.remove('is-filtered');
  clips.forEach((c) => c.classList.remove('is-match'));
}

function hide() {
  result.hidden = true;
  quick.hidden = false;
  field.classList.remove('is-valid', 'is-invalid');
  resetTimeline();
}

function showError(message) {
  hide();
  field.classList.add('is-invalid');
  hint.className = 'field-hint is-error';
  hint.textContent = message;
}

function show(ref, raw) {
  if (raw !== lastShown) window.kombainGoal?.('detector_url', { kind: ref.kind });
  lastShown = raw;
  hint.textContent = '';
  hint.className = 'field-hint';
  field.classList.remove('is-invalid');
  field.classList.add('is-valid');
  quick.hidden = true;
  result.hidden = false;

  $('[data-kind]', result).textContent = ref.label;
  $('[data-lead]', result).textContent = LEADS[ref.kind];
  const title = $('[data-title]', result);
  const meta = $('[data-meta]', result);
  title.textContent = ref.videoId ? `ID видео: ${ref.videoId}` : ref.playlistId ? `ID плейлиста: ${ref.playlistId}` : ref.channelPath;
  meta.textContent = ref.start ? `Отметка времени: ${ref.start} с` : '';

  const thumbBox = $('[data-thumb]', result);
  if (ref.videoId) {
    let img = $('img', thumbBox);
    if (!img) {
      img = h('img', { width: '160', height: '90', decoding: 'async', alt: '' });
      thumbBox.append(img);
    }
    img.src = thumb(ref.videoId);
    img.alt = `Превью видео ${ref.videoId}`;
    thumbBox.hidden = false;
  } else {
    thumbBox.hidden = true;
  }

  const encoded = encodeURIComponent(raw);
  const secondary = [];
  for (const li of $$('.detect-actions li', result)) {
    const kinds = li.dataset.accepts.split(' ');
    const match = kinds.some((k) => ref.accepts.has(k));
    const allowed = match && !(ref.isLive && li.dataset.slug.includes('downloader'));
    const primary = !ref.videoId || PRIMARY_VIDEO.includes(li.dataset.slug) || (ref.playlistId && kinds.includes('playlist'));
    li.hidden = !allowed || !primary;
    if (allowed && !primary) secondary.push(li);
    const link = $('a', li);
    link.href = `${link.getAttribute('href').split('?')[0]}?url=${encoded}`;
  }
  moreBtn.hidden = !secondary.length;
  moreBtn.textContent = `Ещё ${secondary.length}: комментарии, теги, ссылки`;
  moreBtn.onclick = () => {
    secondary.forEach((li) => { li.hidden = false; });
    moreBtn.hidden = true;
    $('a', secondary[0])?.focus();
  };

  timeline?.classList.add('is-filtered');
  for (const clip of clips) {
    const match = clip.dataset.accepts.split(' ').some((k) => ref.accepts.has(k));
    clip.classList.toggle('is-match', match);
    clip.href = `${clip.getAttribute('href').split('?')[0]}${match ? `?url=${encoded}` : ''}`;
  }

  clearTimeout(previewTimer);
  if (ref.kind === 'channel') return;
  previewTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/preview?url=${encoded}`);
      if (lastRaw !== raw) return;
      if (data.title) {
        title.textContent = data.title;
        const img = $('[data-thumb] img', result);
        if (img) img.alt = `Превью: ${data.title}`;
        meta.textContent = [data.author, ref.start ? `с отметки ${ref.start} с` : ''].filter(Boolean).join(', ');
      } else if (data.unavailable) {
        meta.textContent = 'YouTube не показывает данные этого ролика: возможно, он приватный или удалён.';
      }
    } catch { /* превью необязательно */ }
  }, 200);
}

function detect(showErrors = false) {
  const raw = input.value.trim();
  lastRaw = raw;
  if (!raw) {
    hint.textContent = '';
    hide();
    return null;
  }
  const ref = parseYouTube(raw);
  if (ref.ok) {
    show(ref, raw);
    return ref;
  }
  if (showErrors) showError(ref.error);
  else hide();
  return null;
}

input.addEventListener('input', () => detect(false));
input.addEventListener('paste', () => setTimeout(() => detect(true), 0));
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!input.value.trim()) {
    showError('Вставьте ссылку на видео, плейлист или канал.');
    input.focus();
    return;
  }
  if (detect(true)) $('.detect-actions li:not([hidden]) a', result)?.focus();
});
$('[data-paste]', form).addEventListener('click', async () => {
  const text = await readClipboard();
  if (text) {
    input.value = text;
    detect(true);
  } else {
    input.focus();
    toast('Вставьте ссылку сочетанием Ctrl+V или долгим нажатием на поле.', 'info', 4000);
  }
});
field.addEventListener('dragover', (event) => { event.preventDefault(); field.classList.add('is-dragover'); });
field.addEventListener('dragleave', () => field.classList.remove('is-dragover'));
field.addEventListener('drop', (event) => {
  event.preventDefault();
  field.classList.remove('is-dragover');
  input.value = (event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
  detect(true);
});

const initial = new URLSearchParams(location.search).get('url');
if (initial) {
  input.value = initial;
  detect(true);
}

// Единственная «сцена» на странице: воспроизводящая головка проходит по дорожкам при загрузке.
function playIntro() {
  const head = $('.tl-playhead', timeline);
  const tc = $('[data-timecode]', timeline);
  if (!head || !timeline.offsetParent) return;
  const lane = $('.tl-lane', timeline);
  const startX = lane.offsetLeft;
  const width = lane.offsetWidth;
  const target = 0.64;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduce ? 0 : 1800;
  const t0 = performance.now();
  const two = (n) => String(n).padStart(2, '0');
  const frame = (now) => {
    const p = duration ? Math.min(1, (now - t0) / duration) : 1;
    const eased = 1 - (1 - p) ** 3;
    const pos = eased * target;
    head.style.left = `${startX + pos * width}px`;
    const seconds = pos * 60;
    const f = Math.floor((seconds % 1) * 25);
    tc.textContent = `00:${two(Math.floor(seconds / 60))}:${two(Math.floor(seconds % 60))}:${two(f)}`;
    for (const clip of clips) {
      const passed = clip.offsetLeft <= startX + pos * width;
      clip.style.opacity = timeline.classList.contains('is-filtered') ? '' : passed ? '1' : '.55';
    }
    if (p < 1) requestAnimationFrame(frame);
    else clips.forEach((c) => { c.style.opacity = ''; });
  };
  requestAnimationFrame(frame);
}

if (timeline) {
  if (document.readyState === 'complete') playIntro();
  else window.addEventListener('load', playIntro, { once: true });
}
