// Фильтрация комментариев — общая для розыгрыша и фильтра.
import { formValues } from '../core/dom.js';

const LINK_RE = /(https?:\/\/|www\.|\b[\p{L}\p{N}-]+\.(com|ru|net|org|io|me|be|ly|gg|tv|рф|su|info|site|shop|link|app)\b)/iu;

export const normText = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const normUser = (s) => normText(s).trim().replace(/^@/, '');
const words = (value) => normText(value).split(/[,;\n]+/).map((w) => w.trim()).filter(Boolean);

export function readFilters(form) {
  const v = formValues(form);
  return {
    include: words(v.include),
    exclude: words(v.exclude),
    minLen: Number(v.min_len) || 0,
    maxLen: Number(v.max_len) || 0,
    excludeUsers: new Set(words(v.exclude_users).map(normUser)),
    unique: Boolean(v.unique),
    noReplies: Boolean(v.no_replies),
    noLinks: Boolean(v.no_links),
    noOwner: Boolean(v.no_owner),
  };
}

export const hasLink = (text) => LINK_RE.test(text || '');
export const authorKey = (c) => c.author_id || normUser(c.author);

export function applyFilters(comments, f) {
  let list = comments.filter((c) => {
    if (f.noReplies && c.reply) return false;
    if (f.noOwner && c.by_uploader) return false;
    if (f.noLinks && hasLink(c.text)) return false;
    const length = [...(c.text || '')].length;
    if (f.minLen && length < f.minLen) return false;
    if (f.maxLen && length > f.maxLen) return false;
    const text = normText(c.text);
    if (f.include.length && !f.include.some((w) => text.includes(w))) return false;
    if (f.exclude.length && f.exclude.some((w) => text.includes(w))) return false;
    if (f.excludeUsers.size && (f.excludeUsers.has(normUser(c.author)) || f.excludeUsers.has(normText(c.author_id)))) return false;
    return true;
  });
  if (f.unique) {
    const seen = new Set();
    list = list.filter((c) => {
      const key = authorKey(c);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return list;
}

export function describeFilters(f) {
  const parts = [];
  if (f.include.length) parts.push(`содержит: ${f.include.join(', ')}`);
  if (f.exclude.length) parts.push(`не содержит: ${f.exclude.join(', ')}`);
  if (f.minLen) parts.push(`от ${f.minLen} символов`);
  if (f.maxLen) parts.push(`до ${f.maxLen} символов`);
  if (f.unique) parts.push('один шанс на автора');
  if (f.noReplies) parts.push('без ответов');
  if (f.noLinks) parts.push('без ссылок');
  if (f.noOwner) parts.push('без автора канала');
  if (f.excludeUsers.size) parts.push(`исключено пользователей: ${f.excludeUsers.size}`);
  return parts;
}

// Криптографически стойкий случайный индекс без смещения.
export function randomIndex(max) {
  if (max <= 0) return -1;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}
