// Скачивание видео и аудио: список форматов → подготовка файла на сервере с прогрессом → сохранение.
import { $, h, icon } from '../core/dom.js';
import { post, runJob } from '../core/api.js';
import { mountUrlForm } from '../core/url-form.js';
import { badge, createStatus, errorBox, mediaCard, skeleton, stagedStatus, toast } from '../core/ui.js';
import { bytes, compact, date, timecode } from '../core/format.js';

const root = $('#tool-root');
const mode = root.dataset.mode || 'video';
const form = $('#dl-form');
const out = $('#dl-result');
let busy = false;
let controller = null;

const QUALITY = { 4320: '8K', 2160: '4K', 1440: '2K', 1080: 'Full HD', 720: 'HD' };

async function loadFormats(raw) {
  controller?.abort();
  out.hidden = false;
  const statusBox = h('div');
  out.replaceChildren(statusBox, skeleton({ media: true, lines: 4 }));
  const status = stagedStatus(statusBox, [
    [0, 'Получаем информацию о видео…'],
    [3500, 'Собираем список форматов…'],
    [10000, 'YouTube отвечает медленнее обычного…'],
    [22000, 'Всё ещё ждём ответа YouTube…'],
  ]);
  try {
    const info = await post('/api/video/info', { url: raw });
    status.stop();
    render(info, raw);
  } catch (error) {
    status.stop();
    out.replaceChildren(errorBox(error, { onRetry: () => loadFormats(raw) }));
  }
}

function formatRow(option, raw, info) {
  const specs = [];
  if (option.fps) specs.push(badge(`${option.fps} кадр/с`));
  if (option.codec) specs.push(badge(option.codec, option.codec === 'H.264' ? 'badge-ok' : ''));
  if (option.hdr) specs.push(badge('HDR', 'badge-warn'));
  if (option.bitrate && option.id.startsWith('mp3')) specs.push(badge('конвертация'));
  specs.push(badge(option.ext.toUpperCase(), 'badge-muted'));
  const quality = option.height ? QUALITY[option.height] || '' : '';
  const button = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, icon('download'), 'Скачать');
  button.addEventListener('click', () => startDownload(option, raw, info, button));
  return h('div', { class: 'format-row' },
    h('div', { class: 'format-q' }, option.height ? `${option.height}p` : option.codec, quality ? h('small', {}, quality) : option.bitrate ? h('small', {}, `${option.bitrate} кбит/с`) : null),
    h('div', { class: 'format-spec' }, ...specs),
    h('div', { class: 'format-size' }, option.size ? `≈ ${bytes(option.size)}` : 'размер неизвестен'),
    button);
}

function group(title, note, options, raw, info, { collapsed = false } = {}) {
  if (!options.length) return null;
  const list = h('div', { class: 'format-list' }, ...options.map((o) => formatRow(o, raw, info)));
  const section = h('section', { class: 'format-group' }, h('h3', {}, title, note ? h('small', {}, note) : null), list);
  if (!collapsed) return section;
  list.hidden = true;
  const toggle = h('button', { type: 'button', class: 'btn btn-ghost btn-sm format-more', 'aria-expanded': 'false' },
    icon('chevron-down'), `Показать (${options.length})`);
  toggle.addEventListener('click', () => {
    list.hidden = !list.hidden;
    toggle.setAttribute('aria-expanded', String(!list.hidden));
    toggle.lastChild.textContent = list.hidden ? `Показать (${options.length})` : 'Скрыть';
  });
  section.append(toggle);
  return section;
}

function render(info, raw) {
  const card = mediaCard({
    title: info.title, url: info.url, thumbnail: info.thumbnail, duration: timecode(info.duration),
    meta: [info.channel, date(info.published), info.views != null ? `${compact(info.views)} просмотров` : null],
  });
  const nodes = [card];
  if (info.is_live || ['is_live', 'is_upcoming', 'post_live'].includes(info.live_status)) {
    nodes.push(h('div', { class: 'alert alert-warn' }, icon('alert'), h('div', { class: 'alert-body' },
      h('strong', {}, 'Это прямая трансляция'),
      h('p', {}, 'Скачать эфир можно после его окончания, когда запись появится на канале.'))));
    out.replaceChildren(...nodes);
    return;
  }
  if (!info.ffmpeg) {
    nodes.push(h('div', { class: 'notice' }, icon('info'), h('p', {}, 'На сервере не установлен ffmpeg, поэтому доступны только готовые форматы без склейки и без MP3.')));
  }
  const d = info.downloads;
  const groups = mode === 'audio'
    ? [
      group('Только звук', 'исходная дорожка или MP3', d.audio, raw, info),
      group('Видео со звуком', 'MP4', d.video, raw, info, { collapsed: true }),
    ]
    : [
      group('Видео со звуком', 'MP4, дорожки склеиваются без потери качества', d.video, raw, info),
      group('Только звук', '', d.audio, raw, info),
      group('Только видео, без звука', 'для монтажа', d.video_only, raw, info, { collapsed: true }),
    ];
  const formats = h('div', { class: 'formats' }, ...groups.filter(Boolean));
  if (!formats.children.length) {
    nodes.push(h('div', { class: 'alert alert-warn' }, icon('alert'), h('div', { class: 'alert-body' },
      h('strong', {}, 'Для этого видео нет доступных форматов'),
      h('p', {}, 'YouTube не отдал ни одного файла. Попробуйте позже.'))));
  }
  const dlBox = h('div', { class: 'dl-card', id: 'dl-box', hidden: true });
  nodes.push(dlBox, formats);
  if (mode === 'audio') {
    nodes.push(h('p', { class: 'notice' }, 'Нужно видео? ', h('a', { href: `/youtube-downloader?url=${encodeURIComponent(raw)}` }, 'Откройте скачивание видео'), ' с той же ссылкой.'));
  }
  out.replaceChildren(...nodes);
}

async function startDownload(option, raw, info, button) {
  if (busy) {
    toast('Дождитесь окончания текущей загрузки.', 'info');
    return;
  }
  busy = true;
  const box = $('#dl-box');
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  controller = new AbortController();
  const label = `${option.label}${option.ext ? ` · ${option.ext.toUpperCase()}` : ''}`;
  const status = createStatus(box, { onCancel: () => controller.abort() });
  status.set(`Готовим ${label}…`);
  try {
    const result = await runJob('/api/download', { url: raw, option: option.id }, {
      signal: controller.signal,
      onUpdate: (job) => {
        const p = job.progress || {};
        const stage = job.status === 'queued' ? 'Ждём своей очереди…' : job.stage;
        status.set(stage, {
          percent: p.percent ?? null,
          extra: [
            p.downloaded ? `${bytes(p.downloaded)} из ${p.total ? bytes(p.total) : '…'}` : null,
            p.speed ? `${bytes(p.speed)}/с` : null,
            p.eta ? `осталось ${timecode(p.eta)}` : null,
          ],
        });
      },
    });
    ready(box, result, option, raw, info);
  } catch (error) {
    if (error.code === 'cancelled') {
      box.replaceChildren(h('p', {}, 'Загрузка отменена.'));
    } else {
      box.replaceChildren(errorBox(error, { onRetry: () => startDownload(option, raw, info, button) }));
    }
  } finally {
    busy = false;
  }
}

function ready(box, result, option, raw, info) {
  const link = h('a', { class: 'btn btn-primary', href: result.url, download: result.filename }, icon('download'), 'Сохранить файл');
  const again = h('button', { type: 'button', class: 'btn btn-secondary' }, icon('refresh'), 'Подготовить заново');
  again.addEventListener('click', () => startDownload(option, raw, info, again));
  const note = h('p', { class: 'status-sub' }, 'Загрузка началась. Если браузер её не показал, нажмите «Сохранить файл» в ближайшие полминуты.');
  box.replaceChildren(
    h('div', { class: 'dl-file' }, icon('file'), h('div', {}, h('strong', {}, result.filename), h('small', {}, bytes(result.size)))),
    h('div', { class: 'dl-actions' }, link, again),
    note);
  link.click();
  window.kombainGoal?.(mode === 'audio' ? 'download_audio' : 'download_video', { format: option.id });
  toast('Файл готов — браузер начал загрузку');
  setTimeout(() => {
    link.setAttribute('aria-disabled', 'true');
    note.textContent = 'Файл удалён с сервера. Чтобы скачать его ещё раз, нажмите «Подготовить заново».';
  }, 28000);
}

mountUrlForm(form, { onSubmit: (_ref, raw) => loadFormats(raw) });
