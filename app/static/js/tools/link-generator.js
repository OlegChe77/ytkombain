// Генератор ссылок для видео, плейлистов и каналов.
import { $, h, icon } from '../core/dom.js';
import { post } from '../core/api.js';
import { mountUrlForm } from '../core/url-form.js';
import { copyButton, errorBox, stagedStatus } from '../core/ui.js';

const form = $('#lg-form');
const out = $('#lg-result');

function row([label, note, value, openable = true]) {
  return h('div', { class: 'copy-row' },
    h('span', { class: 'copy-label' }, label, note ? h('small', {}, note) : null),
    h('span', { class: 'copy-value', title: value }, value),
    h('span', { class: 'copy-actions' },
      copyButton(value, { iconOnly: true, title: `Копировать: ${label}` }),
      openable ? h('a', { class: 'btn btn-secondary btn-xs', href: value, target: '_blank', rel: 'noopener', title: 'Открыть' }, icon('external')) : null));
}

const group = (title, rows) => h('section', { class: 'format-group' }, h('h3', {}, title), h('div', { class: 'copy-list' }, ...rows.filter(Boolean).map(row)));

function videoRows(ref) {
  const id = ref.videoId;
  const t = ref.start;
  return [
    ['Полная ссылка', 'youtube.com/watch', `https://www.youtube.com/watch?v=${id}`],
    ['Короткая ссылка', 'youtu.be', `https://youtu.be/${id}`],
    t ? ['С отметкой времени', `с ${t} секунды`, `https://youtu.be/${id}?t=${t}`] : null,
    ref.isShort ? ['Shorts в обычном плеере', 'с перемоткой и выбором качества', `https://www.youtube.com/watch?v=${id}`] : ['В плеере Shorts', 'для вертикальных роликов', `https://www.youtube.com/shorts/${id}`],
    ['Мобильная версия', 'm.youtube.com', `https://m.youtube.com/watch?v=${id}`],
    ['YouTube Music', 'если это музыка', `https://music.youtube.com/watch?v=${id}`],
    ['Для встраивания', 'адрес для iframe', `https://www.youtube.com/embed/${id}`],
    ['Встраивание без cookies', 'youtube-nocookie.com', `https://www.youtube-nocookie.com/embed/${id}`],
    ['Превью 1280×720', 'если есть у видео', `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`],
    ['Превью 480×360', 'есть у всех видео', `https://i.ytimg.com/vi/${id}/hqdefault.jpg`],
  ];
}

function playlistRows(ref) {
  const list = ref.playlistId;
  return [
    ['Страница плейлиста', '', `https://www.youtube.com/playlist?list=${list}`],
    ref.videoId ? ['Воспроизвести с этого видео', 'с автопереходом дальше', `https://www.youtube.com/watch?v=${ref.videoId}&list=${list}`] : null,
    ['Для встраивания', 'весь плейлист в iframe', `https://www.youtube.com/embed/videoseries?list=${list}`],
    ['YouTube Music', '', `https://music.youtube.com/playlist?list=${list}`],
    ['RSS-лента', 'новые видео в плейлисте', `https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`],
  ];
}

function channelRows(ch) {
  const base = `https://www.youtube.com/channel/${ch.id}`;
  return [
    ['Постоянная ссылка', 'по ID, не меняется', base],
    ch.handle_url ? ['Ссылка по @имени', ch.handle, ch.handle_url] : null,
    ['Ссылка на подписку', 'сразу открывает окно подписки', `${base}?sub_confirmation=1`],
    ['Видео', 'вкладка', `${base}/videos`],
    ['Shorts', 'вкладка', `${base}/shorts`],
    ['Трансляции', 'вкладка', `${base}/streams`],
    ['Все загрузки плейлистом', 'можно встроить или выгрузить', `https://www.youtube.com/playlist?list=UU${ch.id.slice(2)}`],
    ['RSS-лента', 'новые видео канала', ch.rss],
    ['ID канала', 'для сервисов и интеграций', ch.id, false],
  ];
}

async function render(ref, raw) {
  out.hidden = false;
  const groups = [];
  if (ref.videoId) groups.push(group('Видео', videoRows(ref)));
  if (ref.playlistId) groups.push(group('Плейлист', playlistRows(ref)));
  if (ref.channelPath) {
    const statusBox = h('div');
    out.replaceChildren(statusBox);
    const status = stagedStatus(statusBox, [[0, 'Определяем ID канала…'], [6000, 'YouTube отвечает медленнее обычного…']]);
    try {
      const ch = await post('/api/channel', { url: raw });
      status.stop();
      groups.push(group(`Канал «${ch.title}»`, channelRows(ch)));
    } catch (error) {
      status.stop();
      out.replaceChildren(errorBox(error, { onRetry: () => render(ref, raw) }));
      return;
    }
  }
  out.replaceChildren(...groups);
}

mountUrlForm(form, { onSubmit: (ref, raw) => render(ref, raw) });
