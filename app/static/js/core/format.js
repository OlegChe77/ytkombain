// Форматирование чисел, дат, длительностей и склонения.

const numberFmt = new Intl.NumberFormat('ru-RU');
const compactFmt = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

export const num = (n) => (n == null ? '—' : numberFmt.format(n));
export const compact = (n) => (n == null ? '—' : n < 10000 ? numberFmt.format(n) : compactFmt.format(n));

export function bytes(value) {
  if (!value && value !== 0) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  let v = value;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toLocaleString('ru-RU', { maximumFractionDigits: v < 10 && i > 1 ? 1 : 0 })} ${units[i]}`;
}

export function plural(n, forms) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export const pluralN = (n, forms) => `${num(n)} ${plural(n, forms)}`;

// 90 → "1:30", 5140 → "1:25:40"; с pad=true минуты дополняются нулём: "01:30".
export function timecode(seconds, { pad = false } = {}) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (x) => String(x).padStart(2, '0');
  if (h) return `${h}:${two(m)}:${two(sec)}`;
  return `${pad ? two(m) : m}:${two(sec)}`;
}

export function durationWords(seconds) {
  if (!seconds) return '0 мин';
  const s = Math.round(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d} д`);
  if (h) parts.push(`${h} ч`);
  if (m || !parts.length) parts.push(`${m || (s < 60 ? '<1' : 0)} мин`);
  return parts.join(' ');
}

// Разбирает время: 90, 1:30, 01:25:40, 1h25m40s, 1ч 25м 40с.
export function parseTime(input) {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase().replace(',', '.');
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.floor(Number(value));
  if (/^\d{1,3}(:\d{1,2}){1,2}$/.test(value)) {
    const parts = value.split(':').map(Number);
    if (parts.slice(1).some((p) => p > 59)) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const units = { h: 3600, ч: 3600, m: 60, м: 60, s: 1, с: 1 };
  const re = /(\d+)\s*(h|ч|m|м|s|с)[a-zа-я]*/g;
  let total = 0;
  let matched = '';
  for (const match of value.matchAll(re)) {
    total += Number(match[1]) * units[match[2]];
    matched += match[0];
  }
  return matched.replace(/\s/g, '').length === value.replace(/\s/g, '').length && matched ? total : null;
}

export function date(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  if (withTime && iso.includes('T')) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('ru-RU', opts);
}

export const shortDate = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('ru-RU') : '—');

export function slug(text, max = 80) {
  return String(text || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || 'youtube';
}
