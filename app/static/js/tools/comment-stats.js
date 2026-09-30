// Статистика комментариев: показатели, активные авторы, частые слова, динамика по времени.
import { $, h, icon } from '../core/dom.js';
import { mountCommentsLoader } from '../comments/loader.js';
import { authorKey, hasLink, normText } from '../comments/filters.js';
import { commentCard, toCSV } from '../comments/render.js';
import { downloadText, emptyState } from '../core/ui.js';
import { histogram } from '../core/charts.js';
import { num, plural, slug } from '../core/format.js';

const view = $('#stats-view');

const STOP = new Set(`и в во не что он на я с со как а то все всё она так его но да ты к у же вы за бы по только ее её мне было вот от меня еще ещё нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это очень просто вообще тебе свой весь этих эта мои меня твой наш ваш которые который которая было будут есть просто типа вообще щас сейчас the a an and or but is are was were be been to of in on at for with this that it i you he she we they my your his her our their me him us them so not no do does did have has had just like what who how if as from by about all can will would there here when one get got im its dont thats youre really very too also more some any than then out up now only still even because why where which much many lol its it's i'm don't`.split(/\s+/));

function tokenize(text) {
  // Упоминания @имя в ответах — не слова обсуждения.
  return normText(text).replace(/@[\p{L}\p{N}._-]+/gu, ' ').match(/[\p{L}][\p{L}\p{N}'-]{2,}/gu) || [];
}

function compute(comments) {
  const authors = new Map();
  const words = new Map();
  let replies = 0; let links = 0; let questions = 0; let owner = 0; let chars = 0; let likes = 0;
  for (const c of comments) {
    const key = authorKey(c);
    const a = authors.get(key) || { name: c.author, url: c.author_url, count: 0, likes: 0 };
    a.count += 1;
    a.likes += c.likes;
    authors.set(key, a);
    if (c.reply) replies += 1;
    if (hasLink(c.text)) links += 1;
    if (c.text.includes('?')) questions += 1;
    if (c.by_uploader) owner += 1;
    chars += [...c.text].length;
    likes += c.likes;
    const seen = new Set();
    for (const w of tokenize(c.text)) {
      if (STOP.has(w) || /^\d+$/.test(w) || seen.has(w)) continue;
      seen.add(w);
      words.set(w, (words.get(w) || 0) + 1);
    }
  }
  const topAuthors = [...authors.values()].sort((a, b) => b.count - a.count || b.likes - a.likes).slice(0, 10);
  const topWords = [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const topLiked = [...comments].sort((a, b) => b.likes - a.likes).slice(0, 5);
  return {
    total: comments.length, replies, top: comments.length - replies, authors: authors.size, links, questions, owner,
    avgLength: comments.length ? Math.round(chars / comments.length) : 0, likes, topAuthors, topWords, topLiked,
    oneTime: [...authors.values()].filter((a) => a.count === 1).length,
  };
}

function timeline(comments) {
  const stamps = comments.map((c) => c.ts).filter(Boolean).sort((a, b) => a - b);
  if (stamps.length < 5) return null;
  const DAY = 86400;
  const span = stamps[stamps.length - 1] - stamps[0];
  const size = span > DAY * 730 ? DAY * 30 : span > DAY * 90 ? DAY * 7 : DAY;
  const unit = size === DAY ? 'день' : size === DAY * 7 ? 'неделя' : 'месяц';
  const start = Math.floor(stamps[0] / size) * size;
  const count = Math.min(120, Math.floor((stamps[stamps.length - 1] - start) / size) + 1);
  if (count < 2) return null;
  const buckets = Array.from({ length: count }, (_, i) => ({ from: start + i * size, value: 0 }));
  for (const ts of stamps) {
    const i = Math.min(count - 1, Math.floor((ts - start) / size));
    buckets[i].value += 1;
  }
  const label = (ts) => new Date(ts * 1000).toLocaleDateString('ru-RU', size === DAY * 30 ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
  return {
    unit,
    buckets: buckets.map((b) => ({ value: b.value, title: label(b.from), note: `${num(b.value)} комм.` })),
    first: label(start),
    last: label(buckets[count - 1].from),
  };
}

const kpi = (value, label) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-value' }, value), h('span', { class: 'kpi-label' }, label));

function bars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'bars' }, ...rows.map((r) => h('div', { class: 'bar-row', title: r.title || null },
    h('span', { class: 'bar-label' }, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener nofollow' }, r.label) : r.label),
    h('span', { class: 'bar-value' }, r.display ?? num(r.value)),
    h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { style: { width: `${(r.value / max) * 100}%` } })))));
}

function report(data, s) {
  const rows = [
    ['Видео', data.video.title], ['Ссылка', data.video.url],
    ['Комментариев загружено', s.total], ['Основных', s.top], ['Ответов', s.replies],
    ['Уникальных авторов', s.authors], ['Авторов с одним комментарием', s.oneTime],
    ['Средняя длина, символов', s.avgLength], ['Сумма лайков', s.likes], ['Со ссылками', s.links],
    ['С вопросами', s.questions], ['От автора канала', s.owner],
    ['', ''], ['Самые активные авторы', 'Комментариев'], ...s.topAuthors.map((a) => [a.name, a.count]),
    ['', ''], ['Частые слова', 'Упоминаний'], ...s.topWords,
  ];
  return toCSV(rows, [{ title: 'Показатель', value: (r) => r[0] }, { title: 'Значение', value: (r) => r[1] }]);
}

function render(data) {
  const comments = data.comments;
  if (!comments.length) {
    view.replaceChildren(emptyState('chart', 'Комментариев нет.', 'Они отключены или их ещё никто не оставил.'));
    view.hidden = false;
    return;
  }
  const s = compute(comments);
  const pct = (n) => `${Math.round((n / s.total) * 100)}%`;
  const exportBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, icon('download'), 'Скачать отчёт');
  exportBtn.addEventListener('click', () => downloadText(`Статистика ${slug(data.video.title, 50)}.csv`, report(data, s), 'text/csv;charset=utf-8'));

  const kpis = h('div', { class: 'kpis' },
    kpi(num(s.total), `${plural(s.total, ['комментарий', 'комментария', 'комментариев'])} загружено`),
    kpi(num(s.authors), plural(s.authors, ['уникальный автор', 'уникальных автора', 'уникальных авторов'])),
    kpi(num(s.replies), `${plural(s.replies, ['ответ', 'ответа', 'ответов'])} (${pct(s.replies)})`),
    kpi(num(s.avgLength), `${plural(s.avgLength, ['символ', 'символа', 'символов'])} в среднем`),
    kpi(num(s.likes), `${plural(s.likes, ['лайк', 'лайка', 'лайков'])} суммарно`),
    kpi(num(s.owner), 'от автора канала'));

  const panels = [];
  panels.push(h('section', { class: 'panel' }, h('h3', {}, 'Самые активные'),
    bars(s.topAuthors.map((a) => ({ label: a.name, url: a.url, value: a.count, title: `${num(a.likes)} лайков` })))));
  panels.push(h('section', { class: 'panel' }, h('h3', {}, 'Частые слова'),
    s.topWords.length ? bars(s.topWords.map(([w, n]) => ({ label: w, value: n }))) : h('p', { class: 'detect-meta' }, 'Слишком мало текста для подсчёта.')));

  const tl = timeline(comments);
  if (tl) {
    panels.push(h('section', { class: 'panel stats-wide' },
      h('h3', {}, `Комментарии по времени (один столбец — ${tl.unit})`),
      histogram(tl.buckets, { describe: `Распределение комментариев с ${tl.first} по ${tl.last}` }),
      h('div', { class: 'histogram-axis' }, h('span', {}, tl.first), h('span', {}, tl.last)),
      h('p', { class: 'detect-meta' }, 'YouTube сообщает время приблизительно («3 дня назад»), поэтому график показывает общую картину.')));
  }
  panels.push(h('section', { class: 'panel' }, h('h3', {}, 'Из чего состоит обсуждение'),
    bars([
      { label: 'Основные комментарии', value: s.top, display: pct(s.top) },
      { label: 'Ответы в ветках', value: s.replies, display: pct(s.replies) },
      { label: 'С вопросом', value: s.questions, display: pct(s.questions) },
      { label: 'Со ссылками', value: s.links, display: pct(s.links) },
      { label: 'Авторы с одним комментарием', value: s.oneTime, display: `${Math.round((s.oneTime / s.authors) * 100)}% авторов` },
    ])));
  panels.push(h('section', { class: 'panel' }, h('h3', {}, 'Больше всего лайков'),
    h('div', {}, ...s.topLiked.map((c) => commentCard(c, { videoId: data.video.id })))));

  view.replaceChildren(
    h('div', { class: 'results-bar' }, h('p', {}, data.replies ? 'Статистика с учётом ответов' : 'Статистика без ответов — включите «Загружать ответы» для полной картины'), exportBtn),
    kpis,
    h('div', { class: 'stats-grid' }, ...panels));
  view.hidden = false;
}

mountCommentsLoader({
  onReset: () => { view.hidden = true; },
  onLoaded: (data) => render(data),
});
