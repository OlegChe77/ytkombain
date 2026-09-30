// Аватар, шапка и идентификаторы канала.
import { $, h, icon } from '../core/dom.js';
import { post } from '../core/api.js';
import { mountUrlForm } from '../core/url-form.js';
import { copyButton, errorBox, skeleton, stagedStatus } from '../core/ui.js';
import { compact, slug } from '../core/format.js';

const form = $('#ch-form');
const out = $('#ch-result');

async function load(raw) {
  out.hidden = false;
  const statusBox = h('div');
  out.replaceChildren(statusBox, skeleton({ media: true, lines: 3 }));
  const status = stagedStatus(statusBox, [[0, 'Ищем канал…'], [6000, 'YouTube отвечает медленнее обычного…']]);
  try {
    const channel = await post('/api/channel', { url: raw });
    status.stop();
    render(channel, raw);
  } catch (error) {
    status.stop();
    out.replaceChildren(errorBox(error, { onRetry: () => load(raw) }));
  }
}

const proxy = (url, name) => `/api/image?src=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;

function artCard(title, url, name, note) {
  if (!url) {
    return h('section', { class: 'info-section' }, h('h3', {}, title), h('p', { class: 'detect-meta' }, note));
  }
  const img = h('img', { src: url, alt: title, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  const size = h('span', { class: 'detect-meta' });
  img.addEventListener('load', () => { size.textContent = `${img.naturalWidth}×${img.naturalHeight}`; });
  return h('section', { class: 'info-section' },
    h('h3', {}, title, size),
    h('div', { class: 'thumb-media' }, img),
    h('div', { class: 'thumb-actions' },
      h('a', { class: 'btn btn-primary btn-sm', href: proxy(url, name), download: '' }, icon('download'), 'Скачать'),
      h('a', { class: 'btn btn-secondary btn-sm', href: url, target: '_blank', rel: 'noopener' }, icon('external'), 'Открыть')));
}

function render(ch, raw) {
  const name = slug(ch.title, 60);
  const rows = [
    ['ID канала', ch.id, 'не меняется никогда'],
    ch.handle ? ['@имя', ch.handle, 'автор может сменить'] : null,
    ['Постоянная ссылка', ch.url, 'по ID'],
    ch.handle_url ? ['Ссылка по @имени', ch.handle_url, ''] : null,
    ['Ссылка на подписку', ch.subscribe_url, 'сразу открывает подписку'],
    ['RSS-лента', ch.rss, 'новые видео канала'],
  ].filter(Boolean);
  const avatarImg = ch.avatar ? h('img', { src: ch.avatar, alt: `Аватар канала «${ch.title}»`, referrerpolicy: 'no-referrer' }) : null;
  out.replaceChildren(
    h('div', { class: 'channel-card' },
      h('div', { class: 'channel-banner' }, ch.banner ? h('img', { src: ch.banner, alt: `Шапка канала «${ch.title}»`, referrerpolicy: 'no-referrer' }) : null),
      h('div', { class: 'channel-body' },
        h('div', { class: 'channel-avatar' }, avatarImg),
        h('div', { class: 'channel-title' },
          h('h2', {}, ch.title, ch.verified ? ' ' : null, ch.verified ? h('span', { class: 'badge badge-ok' }, icon('check'), 'Подтверждён') : null),
          h('p', {}, [ch.handle, ch.followers != null ? `${compact(ch.followers)} подписчиков` : null].filter(Boolean).join(', '))))),
    h('div', { class: 'art-grid' },
      artCard('Аватар', ch.avatar, `${name} — аватар`, 'У канала нет аватара.'),
      artCard('Шапка', ch.banner, `${name} — шапка`, 'У канала нет шапки.')),
    h('section', { class: 'info-section' }, h('h3', {}, 'Идентификаторы и ссылки'),
      h('div', { class: 'copy-list' }, ...rows.map(([label, value, note]) => h('div', { class: 'copy-row' },
        h('span', { class: 'copy-label' }, label, note ? h('small', {}, note) : null),
        h('span', { class: 'copy-value' }, value),
        h('span', { class: 'copy-actions' }, copyButton(value, { iconOnly: true, title: `Копировать: ${label}` })))))),
    ch.description ? h('section', { class: 'info-section' }, h('h3', {}, 'Описание канала', copyButton(ch.description, { label: 'Копировать' })), h('div', { class: 'description is-open' }, ch.description)) : null,
    h('div', { class: 'pl-cta' }, h('span', {}, 'Нужен список всех видео канала?'),
      h('a', { class: 'btn btn-secondary btn-sm', href: `/youtube-playlist?url=${encodeURIComponent(raw)}` }, icon('list'), 'Открыть список видео')));
}

mountUrlForm(form, { onSubmit: (_ref, raw) => load(raw) });
