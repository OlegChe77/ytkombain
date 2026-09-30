// Субтитры: выбор дорожки, просмотр с таймкодами, поиск, копирование и выгрузка в TXT/SRT/VTT.
import { $, h, icon, highlight } from '../core/dom.js';
import { post } from '../core/api.js';
import { mountUrlForm } from '../core/url-form.js';
import { copyText, downloadText, emptyState, errorBox, mediaCard, skeleton, stagedStatus } from '../core/ui.js';
import { num, pluralN, slug, timecode } from '../core/format.js';

const form = $('#tr-form');
const out = $('#tr-result');
let state = null;

const KIND_TITLES = { manual: 'Авторские', auto: 'Автоматические', translated: 'Автоперевод' };

async function load(raw) {
  out.hidden = false;
  const statusBox = h('div');
  out.replaceChildren(statusBox, skeleton({ lines: 6 }));
  const status = stagedStatus(statusBox, [[0, 'Ищем дорожки субтитров…'], [8000, 'YouTube отвечает медленнее обычного…']]);
  try {
    const info = await post('/api/video/info', { url: raw });
    status.stop();
    setup(info, raw);
  } catch (error) {
    status.stop();
    out.replaceChildren(errorBox(error, { onRetry: () => load(raw) }));
  }
}

function pickDefault(captions, language) {
  const manual = captions.filter((c) => c.kind === 'manual');
  return manual.find((c) => c.lang === language) || manual.find((c) => c.lang.startsWith('ru')) || manual[0]
    || captions.find((c) => c.kind === 'auto') || captions[0];
}

function setup(info, raw) {
  const card = mediaCard({ title: info.title, url: info.url, thumbnail: info.thumbnail, duration: timecode(info.duration), meta: [info.channel] });
  if (!info.captions.length) {
    out.replaceChildren(card, emptyState('captions', 'У этого видео нет субтитров.', 'Автор их не загрузил, а YouTube не создал автоматические.'));
    return;
  }
  const select = h('select', { id: 'tr-track' });
  for (const kind of ['manual', 'auto', 'translated']) {
    const tracks = info.captions.filter((c) => c.kind === kind);
    if (!tracks.length) continue;
    const group = h('optgroup', { label: KIND_TITLES[kind] });
    for (const t of tracks) group.append(h('option', { value: t.key }, kind === 'translated' ? `${t.name} (перевод)` : t.name));
    select.append(group);
  }
  select.value = pickDefault(info.captions, info.language).key;
  const search = h('input', { type: 'search', placeholder: 'Слово или фраза', autocomplete: 'off' });
  const timeToggle = h('input', { type: 'checkbox', checked: true });
  const toolbar = h('div', { class: 'tr-toolbar' },
    h('label', { class: 'select-field' }, h('span', {}, 'Дорожка'), select),
    h('label', { class: 'text-field' }, h('span', {}, 'Поиск по тексту'), search),
    h('label', { class: 'switch' }, timeToggle, h('span', { class: 'switch-track', 'aria-hidden': 'true' }), h('span', {}, 'Показывать время')));
  const view = h('div', { class: 'tr-view', 'aria-live': 'polite' });
  const foot = h('div', { class: 'tr-foot' });
  out.replaceChildren(card, toolbar, view, foot);
  state = { info, raw, segments: [], track: null, view, foot, search, timeToggle };

  select.addEventListener('change', () => fetchTrack(select.value));
  search.addEventListener('input', () => renderLines());
  timeToggle.addEventListener('change', () => view.classList.toggle('no-time', !timeToggle.checked));
  fetchTrack(select.value);
}

async function fetchTrack(key) {
  const { view, foot } = state;
  foot.replaceChildren();
  const statusBox = h('div');
  view.replaceChildren(statusBox);
  const status = stagedStatus(statusBox, [[0, 'Загружаем субтитры…'], [6000, 'Дорожка большая, ещё немного…']]);
  try {
    const data = await post('/api/transcript', { url: state.raw, track: key });
    status.stop();
    state.segments = data.segments;
    state.track = data.track;
    renderLines();
    renderFoot();
    window.kombainGoal?.('transcript_load', { kind: data.track.kind });
  } catch (error) {
    status.stop();
    view.replaceChildren(errorBox(error, { onRetry: () => fetchTrack(key) }));
  }
}

function renderLines() {
  const { view, segments, search, info } = state;
  const query = search.value.trim().toLowerCase();
  const words = query ? [query] : [];
  const list = query ? segments.filter((s) => s.text.toLowerCase().includes(query)) : segments;
  if (!list.length) {
    view.replaceChildren(emptyState('search', 'Совпадений нет.', 'Попробуйте другое слово или часть слова.'));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const s of list) {
    const t = Math.floor(s.start);
    frag.append(h('div', { class: 'tr-line' },
      h('a', { class: 'tr-time', href: `https://youtu.be/${info.id}?t=${t}`, target: '_blank', rel: 'noopener', title: 'Открыть видео с этого места' }, timecode(t)),
      h('span', {}, highlight(s.text, words))));
  }
  view.replaceChildren(frag);
  if (query) view.prepend(h('p', { class: 'detect-meta', style: { padding: '4px 10px 8px' } }, `Найдено: ${pluralN(list.length, ['фраза', 'фразы', 'фраз'])}`));
}

const pad = (n, len = 2) => String(n).padStart(len, '0');
function stamp(sec, sep) {
  const ms = Math.round((sec % 1) * 1000);
  const s = Math.floor(sec);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}${sep}${pad(ms, 3)}`;
}

function paragraphs(segments) {
  const out = [];
  let current = [];
  let prevEnd = 0;
  for (const s of segments) {
    if (current.length && (s.start - prevEnd > 2.5 || current.length >= 12)) {
      out.push(current.join(' '));
      current = [];
    }
    current.push(s.text);
    prevEnd = s.end;
  }
  if (current.length) out.push(current.join(' '));
  return out.join('\n\n');
}

const asText = (withTime) => (withTime
  ? state.segments.map((s) => `[${timecode(s.start)}] ${s.text}`).join('\n')
  : paragraphs(state.segments));

const asSRT = () => state.segments.map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(Math.max(s.end, s.start + 0.5), ',')}\n${s.text}\n`).join('\n');
const asVTT = () => `WEBVTT\n\n${state.segments.map((s) => `${stamp(s.start, '.')} --> ${stamp(Math.max(s.end, s.start + 0.5), '.')}\n${s.text}\n`).join('\n')}`;

function renderFoot() {
  const { foot, segments, info, track, timeToggle } = state;
  const wordsCount = segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  const base = `${slug(info.title, 60)} (${track.lang})`;
  const btn = (label, iconName, handler) => h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: handler }, icon(iconName), label);
  foot.replaceChildren(
    h('p', {}, `${pluralN(segments.length, ['фраза', 'фразы', 'фраз'])}, ${num(wordsCount)} слов. ${track.kind === 'manual' ? 'Авторская дорожка.' : 'Создана автоматически — возможны ошибки.'}`),
    h('div', { class: 'results-actions' },
      btn('Копировать', 'copy', (e) => copyText(asText(timeToggle.checked), e.currentTarget)),
      btn('TXT', 'download', () => downloadText(`${base}.txt`, asText(timeToggle.checked))),
      btn('SRT', 'download', () => downloadText(`${base}.srt`, asSRT(), 'application/x-subrip;charset=utf-8')),
      btn('VTT', 'download', () => downloadText(`${base}.vtt`, asVTT(), 'text/vtt;charset=utf-8'))));
}

mountUrlForm(form, { onSubmit: (_ref, raw) => load(raw) });
