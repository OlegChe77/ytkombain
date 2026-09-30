// Плейлисты и каналы: таблица видео с поиском и выгрузкой или расчёт длительности просмотра.
import { $, h, icon } from '../core/dom.js';
import { runJob } from '../core/api.js';
import { mountUrlForm } from '../core/url-form.js';
import { copyText, createStatus, downloadText, emptyState, errorBox, setBusy, toast } from '../core/ui.js';
import { compact, durationWords, num, pluralN, slug, timecode } from '../core/format.js';
import { toCSV } from '../comments/render.js';

const mode = $('#tool-root').dataset.mode || 'list';
const form = $('#pl-form');
const out = $('#pl-result');
const tabField = $('[data-channel-only]', form);
const button = $('button[type="submit"]', form);
const VIDEO_FORMS = ['видео', 'видео', 'видео'];
const PAGE = 200;
let controller = null;

async function load(raw) {
  controller?.abort();
  controller = new AbortController();
  const { tab, limit } = Object.fromEntries(new FormData(form));
  setBusy(button, true, 'Загружаем…');
  out.hidden = false;
  const status = createStatus(out, { onCancel: () => controller.abort() });
  status.set('Открываем список…');
  try {
    const data = await runJob('/api/playlist', { url: raw, tab: tab || 'videos', limit: Number(limit) }, {
      signal: controller.signal,
      onUpdate: (job) => {
        const p = job.progress || {};
        status.set(job.status === 'queued' ? 'Ждём свободный обработчик…' : job.stage, p.current != null ? { current: p.current, total: p.total } : {});
      },
    });
    if (!data.items.length) {
      out.replaceChildren(emptyState('list', 'Список пуст.', 'В плейлисте нет доступных видео или у канала нет роликов на этой вкладке.'));
      return;
    }
    window.kombainGoal?.(mode === 'length' ? 'playlist_length' : 'playlist_list');
    if (mode === 'length') renderLength(data, raw);
    else renderList(data, raw);
  } catch (error) {
    if (error.code === 'cancelled') {
      out.hidden = true;
      toast('Загрузка отменена', 'info');
    } else {
      out.replaceChildren(errorBox(error, { onRetry: () => load(raw) }));
    }
  } finally {
    setBusy(button, false);
  }
}

function header(data) {
  const tabs = { videos: 'видео', shorts: 'Shorts', streams: 'трансляции' };
  const facts = [
    pluralN(data.items.length, VIDEO_FORMS),
    data.count > data.items.length ? `из ${num(data.count)}` : null,
    data.total_duration ? `общая длительность ${durationWords(data.total_duration)}` : null,
    data.tab ? `вкладка «${tabs[data.tab]}»` : null,
  ].filter(Boolean).join(', ');
  return h('div', { class: 'pl-summary' },
    h('div', { class: 'pl-title' },
      h('h2', {}, data.title || 'Без названия'),
      data.channel ? h('a', { href: data.channel_url || data.url, target: '_blank', rel: 'noopener' }, data.channel) : null),
    h('p', { class: 'detect-meta' }, facts),
    data.truncated ? h('p', { class: 'notice' }, 'Загружена только часть списка. Увеличьте лимит, чтобы получить остальные видео.') : null,
    data.unavailable ? h('p', { class: 'notice' }, `${pluralN(data.unavailable, VIDEO_FORMS)} недоступны (приватные или удалённые) — они отмечены в списке.`) : null);
}

function itemRow(item, raw) {
  return h('div', { class: `pl-row${item.unavailable ? ' is-unavailable' : ''}` },
    h('span', { class: 'pl-index' }, item.index),
    h('a', { class: 'pl-thumb', href: item.url, target: '_blank', rel: 'noopener', tabindex: '-1', 'aria-hidden': 'true' },
      h('img', { src: item.thumbnail, alt: '', loading: 'lazy', decoding: 'async', width: '320', height: '180' })),
    h('div', { class: 'pl-name' },
      h('a', { href: item.url, target: '_blank', rel: 'noopener' }, item.title || 'Без названия'),
      h('small', {}, [item.channel, item.views != null ? `${compact(item.views)} просмотров` : null].filter(Boolean).join(', '))),
    h('span', { class: 'pl-duration' }, item.duration ? timecode(item.duration) : '—'),
    item.unavailable ? h('span') : h('a', { class: 'btn btn-secondary btn-xs', href: `/youtube-downloader?url=${encodeURIComponent(item.url)}`, title: 'Скачать это видео' }, icon('download'), h('span', {}, 'Скачать')));
}

function exportName(data) {
  return slug(data.title || 'Плейлист', 60);
}

function renderList(data, raw) {
  const search = h('input', { type: 'search', placeholder: 'Поиск по названию', autocomplete: 'off', 'aria-label': 'Поиск по названию' });
  const sort = h('select', { 'aria-label': 'Сортировка' },
    h('option', { value: 'index' }, 'Как в плейлисте'),
    h('option', { value: 'long' }, 'Сначала длинные'),
    h('option', { value: 'short' }, 'Сначала короткие'),
    h('option', { value: 'views' }, 'Сначала популярные'),
    h('option', { value: 'title' }, 'По названию'));
  const list = h('div', { class: 'pl-list' });
  const more = h('button', { type: 'button', class: 'btn btn-secondary btn-block', hidden: true });
  const counter = h('p', { class: 'detect-meta' });
  let filtered = data.items;
  let shown = 0;

  const csv = () => toCSV(filtered, [
    { title: '№', value: (i) => i.index },
    { title: 'Название', value: (i) => i.title },
    { title: 'Длительность', value: (i) => (i.duration ? timecode(i.duration) : '') },
    { title: 'Секунд', value: (i) => i.duration ?? '' },
    { title: 'Канал', value: (i) => i.channel || '' },
    { title: 'Просмотры', value: (i) => i.views ?? '' },
    { title: 'Ссылка', value: (i) => i.url },
  ]);
  const txt = () => filtered.map((i) => i.url).join('\n');
  const btn = (label, iconName, fn) => h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: fn }, icon(iconName), label);

  const draw = () => {
    const q = search.value.trim().toLowerCase().replace(/ё/g, 'е');
    filtered = data.items.filter((i) => !q || (i.title || '').toLowerCase().replace(/ё/g, 'е').includes(q));
    const sorters = {
      long: (a, b) => (b.duration || 0) - (a.duration || 0),
      short: (a, b) => (a.duration || Infinity) - (b.duration || Infinity),
      views: (a, b) => (b.views || 0) - (a.views || 0),
      title: (a, b) => (a.title || '').localeCompare(b.title || '', 'ru'),
    };
    if (sorters[sort.value]) filtered = [...filtered].sort(sorters[sort.value]);
    counter.textContent = q ? `Найдено: ${pluralN(filtered.length, VIDEO_FORMS)}` : '';
    list.replaceChildren();
    shown = 0;
    if (!filtered.length) list.append(emptyState('search', 'Ничего не нашлось.', 'Попробуйте другое слово.'));
    page();
  };
  const page = () => {
    const frag = document.createDocumentFragment();
    for (const item of filtered.slice(shown, shown + PAGE)) frag.append(itemRow(item, raw));
    list.append(frag);
    shown = Math.min(filtered.length, shown + PAGE);
    more.hidden = shown >= filtered.length;
    more.textContent = `Показать ещё (${num(filtered.length - shown)})`;
  };

  search.addEventListener('input', draw);
  sort.addEventListener('change', draw);
  more.addEventListener('click', page);
  out.replaceChildren(
    header(data),
    h('div', { class: 'pl-toolbar' },
      h('label', { class: 'url-field' }, icon('search', 'url-field-icon'), search),
      h('label', { class: 'select-field' }, sort),
      h('div', { class: 'results-actions' },
        btn('Копировать ссылки', 'copy', (e) => copyText(txt(), e.currentTarget)),
        btn('TXT', 'download', () => downloadText(`${exportName(data)}.txt`, txt())),
        btn('CSV', 'download', () => downloadText(`${exportName(data)}.csv`, csv(), 'text/csv;charset=utf-8')))),
    counter, list, more,
    h('div', { class: 'pl-cta' }, h('span', {}, 'Сколько времени займёт просмотр?'),
      h('a', { class: 'btn btn-secondary btn-sm', href: `/youtube-playlist-length?url=${encodeURIComponent(raw)}` }, icon('timer'), 'Посчитать длительность')));
  draw();
}

function renderLength(data, raw) {
  const items = data.items;
  const from = h('input', { type: 'number', min: '1', max: String(items.length), value: '1', inputmode: 'numeric' });
  const to = h('input', { type: 'number', min: '1', max: String(items.length), value: String(items.length), inputmode: 'numeric' });
  const perDay = h('input', { type: 'number', min: '5', max: '1440', value: '60', inputmode: 'numeric' });
  const result = h('div', { class: 'pl-summary' });

  const calc = () => {
    let a = Math.max(1, Math.min(items.length, Number(from.value) || 1));
    let b = Math.max(1, Math.min(items.length, Number(to.value) || items.length));
    if (a > b) [a, b] = [b, a];
    const slice = items.slice(a - 1, b);
    const known = slice.filter((i) => i.duration);
    const total = known.reduce((s, i) => s + i.duration, 0);
    const minutes = Math.max(5, Number(perDay.value) || 60);
    const speeds = [1, 1.25, 1.5, 1.75, 2];
    const longest = known.reduce((m, i) => (i.duration > (m?.duration || 0) ? i : m), null);
    const shortest = known.reduce((m, i) => (i.duration < (m?.duration ?? Infinity) ? i : m), null);
    result.replaceChildren(
      h('div', { class: 'speed-grid' }, ...speeds.map((s) => h('div', { class: `speed-card${s === 1 ? ' is-base' : ''}` },
        h('span', {}, s === 1 ? 'Обычная скорость' : `Скорость ${String(s).replace('.', ',')}×`),
        h('strong', {}, timecode(total / s)),
        h('span', {}, `${durationWords(total / s)}, ≈ ${pluralN(Math.ceil(total / s / 60 / minutes), ['день', 'дня', 'дней'])} по ${minutes} мин`)))),
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-value' }, num(slice.length)), h('span', { class: 'kpi-label' }, `видео с ${a}-го по ${b}-е`)),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-value' }, known.length ? timecode(total / known.length) : '—'), h('span', { class: 'kpi-label' }, 'средняя длительность')),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-value' }, longest ? timecode(longest.duration) : '—'), h('span', { class: 'kpi-label' }, 'самое длинное')),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-value' }, shortest ? timecode(shortest.duration) : '—'), h('span', { class: 'kpi-label' }, 'самое короткое'))),
      slice.length > known.length ? h('p', { class: 'notice' }, `У ${pluralN(slice.length - known.length, VIDEO_FORMS)} нет длительности (трансляции или недоступные) — они не учтены.`) : null);
  };

  for (const input of [from, to, perDay]) input.addEventListener('input', calc);
  out.replaceChildren(
    header(data),
    h('div', { class: 'panel' },
      h('div', { class: 'range-row' },
        h('label', { class: 'text-field' }, h('span', {}, 'С видео №'), from),
        h('label', { class: 'text-field' }, h('span', {}, 'по видео №'), to),
        h('label', { class: 'text-field' }, h('span', {}, 'Минут в день'), perDay))),
    result,
    h('div', { class: 'pl-cta' }, h('span', {}, 'Нужен полный список с названиями и ссылками?'),
      h('a', { class: 'btn btn-secondary btn-sm', href: `/youtube-playlist?url=${encodeURIComponent(raw)}` }, icon('list'), 'Открыть список видео')));
  calc();
}

mountUrlForm(form, {
  onChange: (ref) => { tabField.hidden = !(ref && ref.kind === 'channel'); },
  onSubmit: (ref, raw) => {
    tabField.hidden = ref.kind !== 'channel';
    load(raw);
  },
});
