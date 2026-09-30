// Распознавание ссылок YouTube в браузере — для мгновенных подсказок.
// Сервер проверяет ссылку заново (app/youtube/urls.py), поэтому здесь важна удобность, а не строгость.
import { parseTime } from './format.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{12,64}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^@[\p{L}\p{N}._\-·]{3,100}$/u;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

export const KIND_NAMES = {
  video: 'Видео',
  short: 'Shorts',
  live: 'Трансляция',
  playlist: 'Плейлист',
  'video+playlist': 'Видео из плейлиста',
  channel: 'Канал',
};

function fail(message) {
  return { ok: false, error: message };
}

export function parseYouTube(raw) {
  const value = String(raw || '').trim();
  if (!value) return fail('Вставьте ссылку на YouTube.');
  if (value.length > 2048) return fail('Ссылка слишком длинная.');
  if (VIDEO_ID.test(value)) return make({ videoId: value });
  if (HANDLE.test(value)) return make({ channelPath: value });

  let url;
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    return fail('Это не похоже на ссылку.');
  }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return fail('Нужна ссылка с youtube.com или youtu.be.');

  const q = url.searchParams;
  const parts = url.pathname.split('/').filter(Boolean);
  const start = parseTime(q.get('t') || q.get('start') || '');
  const list = PLAYLIST_ID.test(q.get('list') || '') ? q.get('list') : null;
  const head = (parts[0] || '').toLowerCase();

  if (host.endsWith('youtu.be')) {
    return VIDEO_ID.test(parts[0] || '') ? make({ videoId: parts[0], playlistId: list, start }) : fail('В короткой ссылке нет ID видео.');
  }
  if (head === 'watch' || (!parts.length && q.get('v'))) {
    if (VIDEO_ID.test(q.get('v') || '')) return make({ videoId: q.get('v'), playlistId: list, start });
    if (list) return make({ playlistId: list });
    return fail('В ссылке нет ID видео.');
  }
  if (['shorts', 'live', 'embed', 'v', 'e'].includes(head) && parts[1]) {
    if (head === 'embed' && parts[1] === 'videoseries' && list) return make({ playlistId: list });
    if (VIDEO_ID.test(parts[1])) return make({ videoId: parts[1], playlistId: list, start, isShort: head === 'shorts', isLive: head === 'live' });
    return fail('В ссылке нет корректного ID видео.');
  }
  if (head === 'playlist') return list ? make({ playlistId: list }) : fail('В ссылке на плейлист нет его ID.');
  if (head === 'channel' && CHANNEL_ID.test(parts[1] || '')) return make({ channelPath: `channel/${parts[1]}`, channelId: parts[1] });
  if (parts[0] && HANDLE.test(decodeURIComponent(parts[0]))) return make({ channelPath: decodeURIComponent(parts[0]) });
  if ((head === 'c' || head === 'user') && parts[1]) return make({ channelPath: `${head}/${decodeURIComponent(parts[1])}` });
  if (head === 'clip') return fail('Ссылки на клипы не поддерживаются — нужна ссылка на исходное видео.');
  return fail('Не удалось распознать ссылку YouTube.');
}

function make({ videoId = null, playlistId = null, channelPath = null, channelId = null, start = null, isShort = false, isLive = false }) {
  let kind;
  if (videoId && playlistId) kind = 'video+playlist';
  else if (videoId) kind = isShort ? 'short' : isLive ? 'live' : 'video';
  else if (playlistId) kind = 'playlist';
  else kind = 'channel';
  const ref = { ok: true, kind, videoId, playlistId, channelPath, channelId, start, isShort, isLive };
  ref.accepts = new Set();
  if (videoId) ref.accepts.add('video');
  if (playlistId) ref.accepts.add('playlist');
  if (channelPath) ref.accepts.add('channel');
  ref.label = KIND_NAMES[kind];
  ref.canonical = canonicalUrl(ref);
  return ref;
}

export function canonicalUrl(ref) {
  if (ref.videoId && ref.playlistId) return `https://www.youtube.com/watch?v=${ref.videoId}&list=${ref.playlistId}`;
  if (ref.videoId) return ref.isShort ? `https://www.youtube.com/shorts/${ref.videoId}` : `https://www.youtube.com/watch?v=${ref.videoId}`;
  if (ref.playlistId) return `https://www.youtube.com/playlist?list=${ref.playlistId}`;
  return `https://www.youtube.com/${ref.channelPath}`;
}

export const thumb = (videoId, name = 'mqdefault') => `https://i.ytimg.com/vi/${videoId}/${name}.jpg`;
export const watchUrl = (videoId, start) => `https://www.youtube.com/watch?v=${videoId}${start ? `&t=${start}s` : ''}`;
