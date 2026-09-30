// Таймкоды: ссылка на момент видео и проверка глав для описания. Всё считается в браузере.
import { $, $$, h, icon } from '../core/dom.js';
import { parseYouTube } from '../core/yturl.js';
import { parseTime, timecode, pluralN } from '../core/format.js';
import { copyButton } from '../core/ui.js';

const urlInput = $('#ts-url');
const timeInput = $('#ts-time');
const hint = $('#ts-hint');
const results = $('#ts-results');
const chaptersInput = $('#ts-chapter-input');
const check = $('#ts-check');
const chapterOut = $('#ts-chapter-output');
const tabs = $$('[role="tab"]');

function currentVideo() {
  const ref = parseYouTube(urlInput.value);
  return ref.ok && ref.videoId ? ref : null;
}

function row(label, note, value, openable = true) {
  return h('div', { class: 'copy-row' },
    h('span', { class: 'copy-label' }, label, note ? h('small', {}, note) : null),
    h('span', { class: 'copy-value' }, value),
    h('span', { class: 'copy-actions' },
      copyButton(value, { iconOnly: true, title: `Копировать: ${label}` }),
      openable ? h('a', { class: 'btn btn-secondary btn-xs', href: value, target: '_blank', rel: 'noopener', title: 'Проверить ссылку' }, icon('external')) : null));
}

function updateSingle() {
  const raw = urlInput.value.trim();
  const ref = raw ? parseYouTube(raw) : null;
  const seconds = parseTime(timeInput.value);
  hint.className = 'field-hint';
  results.hidden = true;
  if (raw && (!ref.ok || !ref.videoId)) {
    hint.className = 'field-hint is-error';
    hint.textContent = ref.ok ? 'Нужна ссылка на конкретное видео.' : ref.error;
    return;
  }
  if (timeInput.value.trim() && seconds == null) {
    hint.className = 'field-hint is-error';
    hint.textContent = 'Не получилось разобрать время. Примеры: 90, 1:30, 1:25:40, 1h25m40s.';
    return;
  }
  if (!ref) {
    hint.textContent = 'Вставьте ссылку на видео.';
    return;
  }
  const t = seconds ?? ref.start ?? 0;
  if (seconds == null && ref.start) timeInput.value = timecode(ref.start);
  hint.textContent = t ? `Видео откроется с ${timecode(t)} (${pluralN(t, ['секунда', 'секунды', 'секунд'])} от начала).` : 'Укажите время — пока ссылка ведёт на начало.';
  const id = ref.videoId;
  const q = t ? `?t=${t}` : '';
  results.replaceChildren(
    row('Короткая ссылка', 'для сообщений и соцсетей', `https://youtu.be/${id}${q}`),
    row('Полная ссылка', 'youtube.com', `https://www.youtube.com/watch?v=${id}${t ? `&t=${t}s` : ''}`),
    row('Для встраивания', 'параметр start', `https://www.youtube.com/embed/${id}${t ? `?start=${t}` : ''}`),
    row('Таймкод для текста', 'в описании и комментариях YouTube сам сделает его ссылкой', timecode(t, { pad: t >= 3600 }), false),
  );
  if (ref.isShort) results.append(h('p', { class: 'field-hint' }, 'Shorts не поддерживают переход ко времени, поэтому ссылки ведут в обычный плеер.'));
  results.hidden = false;
}

const LINE = /^\s*(?:(?<t1>\d{1,2}(?::\d{1,2}){1,2})\s*[-–—:.)]?\s*(?<title1>.*?)|(?<title2>.*?)\s*[-–—(]?\s*(?<t2>\d{1,2}(?::\d{1,2}){1,2})\)?)\s*$/u;

function updateChapters() {
  const lines = chaptersInput.value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    check.replaceChildren();
    chapterOut.hidden = true;
    return;
  }
  const chapters = [];
  const bad = [];
  for (const line of lines) {
    const m = line.match(LINE);
    const time = m ? parseTime(m.groups.t1 || m.groups.t2) : null;
    const title = m ? (m.groups.title1 ?? m.groups.title2 ?? '').trim() : '';
    if (time == null || !title) bad.push(line);
    else chapters.push({ time, title });
  }
  chapters.sort((a, b) => a.time - b.time);
  const short = chapters.filter((c, i) => i < chapters.length - 1 && chapters[i + 1].time - c.time < 10);
  const dup = chapters.filter((c, i) => i && chapters[i - 1].time === c.time);
  const rules = [
    [chapters[0]?.time === 0, 'Первая глава начинается с 0:00'],
    [chapters.length >= 3, `Глав не меньше трёх (сейчас ${chapters.length})`],
    [!short.length, short.length ? `Короче 10 секунд: ${short.map((c) => c.title).join(', ')}` : 'Каждая глава длиннее 10 секунд'],
    [!dup.length, dup.length ? 'Есть главы с одинаковым временем' : 'Время глав не повторяется'],
  ];
  if (bad.length) rules.push([false, `Не удалось разобрать строки: ${bad.map((b) => `«${b}»`).join(', ')}`]);
  check.replaceChildren(h('ul', { class: 'chapter-check' }, ...rules.map(([ok, text]) => h('li', {},
    h('span', { class: ok ? 'ok' : 'fail' }, icon(ok ? 'check' : 'x')), text))));

  if (!chapters.length) {
    chapterOut.hidden = true;
    return;
  }
  const long = chapters[chapters.length - 1].time >= 3600;
  const text = chapters.map((c) => `${timecode(c.time, { pad: long })} ${c.title}`).join('\n');
  const ref = currentVideo();
  const nodes = [
    h('div', { class: 'pane-title-row' }, h('h3', { class: 'h5' }, 'Готовый текст для описания'), copyButton(text, { label: 'Копировать', size: 'btn-sm', variant: 'btn-primary' })),
    h('pre', { class: 'code' }, text),
  ];
  if (ref) {
    const links = chapters.map((c) => `${c.title} — https://youtu.be/${ref.videoId}?t=${c.time}`).join('\n');
    nodes.push(h('div', { class: 'pane-title-row' }, h('h3', { class: 'h5' }, 'Ссылки на каждую главу'), copyButton(links, { label: 'Копировать', size: 'btn-sm' })),
      h('pre', { class: 'code' }, links));
  }
  chapterOut.replaceChildren(...nodes);
  chapterOut.hidden = false;
}

function selectTab(tab) {
  for (const t of tabs) {
    const active = t === tab;
    t.setAttribute('aria-selected', String(active));
    $(`#${t.getAttribute('aria-controls')}`).hidden = !active;
  }
}

tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab)));
urlInput.addEventListener('input', () => { updateSingle(); updateChapters(); });
timeInput.addEventListener('input', updateSingle);
chaptersInput.addEventListener('input', updateChapters);
$('#ts-form').addEventListener('submit', (e) => e.preventDefault());
for (const chip of $$('[data-time]')) {
  chip.addEventListener('click', () => {
    timeInput.value = chip.dataset.time;
    updateSingle();
  });
}
$('[data-paste]').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text.trim();
      updateSingle();
      updateChapters();
      timeInput.focus();
    }
  } catch {
    urlInput.focus();
  }
});

const params = new URLSearchParams(location.search);
if (params.get('url')) urlInput.value = params.get('url');
if (params.get('t')) timeInput.value = params.get('t');
updateSingle();
