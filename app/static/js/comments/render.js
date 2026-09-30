// Карточка комментария и выгрузка списков.
import { h, icon, highlight } from '../core/dom.js';
import { num, shortDate } from '../core/format.js';

export const commentUrl = (videoId, c) => `https://www.youtube.com/watch?v=${videoId}&lc=${encodeURIComponent(c.id)}`;

export function avatar(c, size = 40) {
  const letter = (c.author || '?').replace(/^@/, '').charAt(0).toUpperCase() || '?';
  const box = h('span', { class: 'comment-avatar', 'aria-hidden': 'true' }, letter);
  if (c.avatar) {
    const img = h('img', { src: c.avatar, alt: '', width: String(size), height: String(size), loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove(), { once: true });
    box.replaceChildren(img);
  }
  return box;
}

export function commentCard(c, { videoId, words = [] } = {}) {
  const badges = [];
  if (c.pinned) badges.push(h('span', { class: 'badge badge-muted' }, icon('pin'), 'Закреплён'));
  if (c.by_uploader) badges.push(h('span', { class: 'badge badge-track' }, 'Автор канала'));
  if (c.hearted) badges.push(h('span', { class: 'badge badge-muted' }, icon('heart'), 'Отмечен автором'));
  const author = c.author_url
    ? h('a', { class: 'comment-author', href: c.author_url, target: '_blank', rel: 'noopener nofollow' }, c.author)
    : h('span', { class: 'comment-author' }, c.author);
  return h('article', { class: 'comment' },
    avatar(c),
    h('div', { class: 'comment-body' },
      h('div', { class: 'comment-head' }, author, ...badges),
      h('p', { class: 'comment-text' }, highlight(c.text, words)),
      h('div', { class: 'comment-foot' },
        h('span', {}, icon('like'), num(c.likes)),
        c.reply ? h('span', {}, icon('reply'), 'Ответ') : null,
        c.time_text ? h('span', { title: c.ts ? `Примерно ${shortDate(c.ts)}` : null }, c.time_text) : null,
        videoId && c.id ? h('a', { href: commentUrl(videoId, c), target: '_blank', rel: 'noopener' }, 'Открыть на YouTube') : null)));
}

const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // защита от формул в Excel
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCSV(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.title)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return `﻿${lines.join('\r\n')}`;
}

export function commentsCSV(list, videoId) {
  return toCSV(list, [
    { title: 'Автор', value: (c) => c.author },
    { title: 'Текст', value: (c) => c.text },
    { title: 'Лайки', value: (c) => c.likes },
    { title: 'Дата (примерно)', value: (c) => (c.ts ? shortDate(c.ts) : c.time_text || '') },
    { title: 'Ответ', value: (c) => (c.reply ? 'да' : 'нет') },
    { title: 'Ссылка', value: (c) => commentUrl(videoId, c) },
  ]);
}

export function commentsTXT(list) {
  return list.map((c) => `${c.author}${c.reply ? ' (ответ)' : ''}, ${num(c.likes)} лайков:\n${c.text}`).join('\n\n');
}
