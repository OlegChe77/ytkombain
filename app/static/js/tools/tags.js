// Теги видео: список, объём по правилам YouTube, хештеги из названия и описания.
import { $, h, icon } from '../core/dom.js';
import { post } from '../core/api.js';
import { mountUrlForm } from '../core/url-form.js';
import { copyButton, copyText, emptyState, errorBox, mediaCard, skeleton, stagedStatus } from '../core/ui.js';
import { compact, date, pluralN, timecode } from '../core/format.js';

const form = $('#tags-form');
const out = $('#tags-result');
const LIMIT = 500;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;

// YouTube считает запятые между тегами, а теги с пробелами — вместе с кавычками.
const tagsLength = (tags) => tags.reduce((sum, t) => sum + [...t].length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

async function load(raw) {
  out.hidden = false;
  const statusBox = h('div');
  out.replaceChildren(statusBox, skeleton({ lines: 3 }));
  const status = stagedStatus(statusBox, [[0, 'Получаем данные ролика…'], [8000, 'YouTube отвечает медленнее обычного…']]);
  try {
    const info = await post('/api/video/info', { url: raw });
    status.stop();
    render(info, raw);
  } catch (error) {
    status.stop();
    out.replaceChildren(errorBox(error, { onRetry: () => load(raw) }));
  }
}

function chip(text) {
  const el = h('button', { type: 'button', class: 'tag-chip', title: 'Нажмите, чтобы скопировать' }, text);
  el.addEventListener('click', async () => {
    if (await copyText(text, null, `Скопировано: ${text}`)) {
      el.classList.add('is-copied');
      setTimeout(() => el.classList.remove('is-copied'), 1200);
    }
  });
  return el;
}

function render(info, raw) {
  const card = mediaCard({
    title: info.title, url: info.url, thumbnail: info.thumbnail, duration: timecode(info.duration),
    meta: [info.channel, date(info.published), info.views != null ? `${compact(info.views)} просмотров` : null],
  });
  const nodes = [card];
  const tags = info.tags;
  if (tags.length) {
    const used = tagsLength(tags);
    const meter = h('div', { class: `meter ${used > LIMIT ? 'is-over' : ''}` },
      h('span', {}, `${pluralN(tags.length, ['тег', 'тега', 'тегов'])}, ${used} из ${LIMIT} символов`),
      h('div', { class: 'progress' }, h('span', { style: { width: `${Math.min(100, (used / LIMIT) * 100)}%` } })));
    nodes.push(h('section', { class: 'info-section' },
      h('h3', {}, 'Теги автора', h('span', { class: 'results-actions' },
        copyButton(tags.join(', '), { label: 'Через запятую' }),
        copyButton(tags.join('\n'), { label: 'Списком' }))),
      meter,
      h('div', { class: 'tag-cloud' }, ...tags.map(chip))));
  } else {
    nodes.push(h('section', { class: 'info-section' }, emptyState('tag', 'У этого видео нет тегов.', 'Автор их не указал — так делают многие каналы.')));
  }
  const hashtags = [...new Set(`${info.title}\n${info.description}`.match(HASHTAG) || [])];
  nodes.push(h('section', { class: 'info-section' },
    h('h3', {}, `Хештеги в названии и описании${hashtags.length ? ` (${hashtags.length})` : ''}`,
      hashtags.length ? copyButton(hashtags.join(' '), { label: 'Копировать' }) : null),
    hashtags.length ? h('div', { class: 'tag-cloud' }, ...hashtags.map(chip)) : h('p', { class: 'detect-meta' }, 'Хештегов нет.')));
  nodes.push(h('p', { class: 'notice' }, icon('info'), h('span', {}, 'Все данные ролика — в инструменте ',
    h('a', { href: `/youtube-video-info?url=${encodeURIComponent(raw)}` }, '«Информация о видео»'), '.')));
  out.replaceChildren(...nodes);
}

mountUrlForm(form, { onSubmit: (_ref, raw) => load(raw) });
