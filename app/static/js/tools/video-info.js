// Информация о видео: карточка, факты, описание, теги, главы, пересматриваемые моменты, JSON.
import { $, h, icon } from '../core/dom.js';
import { post } from '../core/api.js';
import { mountUrlForm } from '../core/url-form.js';
import { copyButton, copyText, downloadText, errorBox, skeleton, stagedStatus } from '../core/ui.js';
import { compact, date, num, timecode } from '../core/format.js';
import { areaChart } from '../core/charts.js';

const form = $('#info-form');
const out = $('#info-result');

const LIVE = { is_live: 'Идёт трансляция', was_live: 'Запись трансляции', is_upcoming: 'Запланированная трансляция', post_live: 'Трансляция обрабатывается' };
const AVAIL = { public: 'Открытое', unlisted: 'Доступ по ссылке', private: 'Приватное', needs_auth: 'Нужен вход', subscriber_only: 'Для спонсоров', premium_only: 'Premium' };

async function load(raw) {
  out.hidden = false;
  const statusBox = h('div');
  out.replaceChildren(statusBox, skeleton({ media: true, lines: 5 }));
  const status = stagedStatus(statusBox, [
    [0, 'Получаем информацию о видео…'],
    [4000, 'Собираем данные о форматах и субтитрах…'],
    [12000, 'YouTube отвечает медленнее обычного…'],
  ]);
  try {
    const info = await post('/api/video/info', { url: raw });
    status.stop();
    render(info, raw);
  } catch (error) {
    status.stop();
    out.replaceChildren(errorBox(error, { onRetry: () => load(raw) }));
  }
}

const fact = (label, value, extra) => h('div', { class: 'fact' }, h('dt', {}, label), h('dd', {}, value ?? '—', extra ? h('small', {}, ` ${extra}`) : null));

function section(title, action, ...children) {
  return h('section', { class: 'info-section' }, h('h3', {}, title, action), ...children);
}

function render(info, raw) {
  const enc = encodeURIComponent(raw);
  const thumbImg = h('img', { src: `https://i.ytimg.com/vi/${info.id}/maxresdefault.jpg`, alt: `Превью видео «${info.title}»`, width: '1280', height: '720', decoding: 'async' });
  thumbImg.addEventListener('load', () => { if (thumbImg.naturalWidth <= 120) thumbImg.src = info.thumbnail; }, { once: true });
  const hero = h('div', { class: 'info-hero' },
    h('div', { class: 'media-thumb' }, thumbImg, info.duration ? h('span', { class: 'duration' }, timecode(info.duration)) : null),
    h('div', { class: 'info-hero-body' },
      h('h2', {}, info.title),
      h('p', { class: 'info-channel' },
        info.channel_url ? h('a', { href: info.channel_url, target: '_blank', rel: 'noopener' }, info.channel) : info.channel,
        info.channel_verified ? h('span', { class: 'badge badge-ok' }, icon('check'), 'Подтверждён') : null,
        info.channel_followers != null ? h('span', {}, `${compact(info.channel_followers)} подписчиков`) : null)));

  const published = info.published ? date(info.published, true) : '—';
  const facts = h('dl', { class: 'facts' },
    fact('Опубликовано', published),
    fact('Длительность', timecode(info.duration), info.duration ? `(${num(info.duration)} с)` : ''),
    fact('Просмотры', num(info.views)),
    fact('Лайки', num(info.likes)),
    fact('Комментарии', num(info.comments)),
    fact('Максимальное качество', info.max_height ? `${info.max_height}p` : '—', info.fps ? `${info.fps} кадр/с` : ''),
    fact('Формат кадра', info.width && info.height ? `${info.width}×${info.height}` : '—', info.is_vertical ? 'вертикальное' : ''),
    fact('Доступ', AVAIL[info.availability] || info.availability || '—'),
    fact('Категория', info.categories.join(', ') || '—'),
    fact('Язык', info.language || '—'),
    fact('Возрастное ограничение', info.age_limit ? `${info.age_limit}+` : 'нет'),
    fact('Встраивание', info.embeddable === false ? 'запрещено' : 'разрешено'),
    info.live_status && LIVE[info.live_status] ? fact('Трансляция', LIVE[info.live_status]) : null,
    fact('ID видео', info.id));

  const links = h('div', { class: 'copy-list' },
    ...[
      ['Ссылка', info.url], ['Короткая', info.short_url], ['Встраивание', info.embed_url],
      info.channel_url ? ['Канал', info.channel_url] : null, info.channel_id ? ['ID канала', info.channel_id] : null,
    ].filter(Boolean).map(([label, value]) => h('div', { class: 'copy-row' },
      h('span', { class: 'copy-label' }, label), h('span', { class: 'copy-value' }, value),
      h('span', { class: 'copy-actions' }, copyButton(value, { iconOnly: true, title: `Копировать: ${label}` })))));

  const side = [section('Ссылки и идентификаторы', null, links)];

  if (info.heatmap.length > 3) {
    const tail = info.heatmap.slice(Math.ceil(info.heatmap.length * 0.05));
    const peak = tail.reduce((a, b) => (b.v > a.v ? b : a), tail[0]); // начало ролика всегда «пиковое» — его не считаем
    const chart = areaChart(info.heatmap, {
      format: (t) => timecode(t),
      describe: `График повторных просмотров, пик на ${timecode(peak.t)}`,
      onPick: (p) => window.open(`https://youtu.be/${info.id}?t=${Math.floor(p.t)}`, '_blank', 'noopener'),
    });
    side.push(section('Самые пересматриваемые моменты', null,
      chart,
      h('div', { class: 'heatmap-axis' }, h('span', {}, '0:00'), h('span', {}, timecode(info.duration))),
      h('p', { class: 'detect-meta' }, 'Пик интереса — ', h('a', { href: `https://youtu.be/${info.id}?t=${Math.floor(peak.t)}`, target: '_blank', rel: 'noopener' }, timecode(peak.t)),
        '. Нажмите на график, чтобы открыть видео с этого места.')));
  }

  if (info.chapters.length) {
    side.push(section(`Главы (${info.chapters.length})`, copyButton(() => info.chapters.map((c) => `${timecode(c.start)} ${c.title}`).join('\n'), { label: 'Копировать' }),
      h('div', { class: 'chapters' }, ...info.chapters.map((c) => h('a', { href: `https://youtu.be/${info.id}?t=${c.start}`, target: '_blank', rel: 'noopener' },
        h('time', {}, timecode(c.start)), h('span', {}, c.title))))));
  }

  const main = [hero, facts];
  if (info.description) {
    const text = h('div', { class: 'description' }, info.description);
    const more = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Развернуть');
    more.addEventListener('click', () => {
      text.classList.toggle('is-open');
      more.textContent = text.classList.contains('is-open') ? 'Свернуть' : 'Развернуть';
    });
    main.push(section('Описание', copyButton(info.description, { label: 'Копировать' }), text, info.description.length > 400 ? more : null));
  }
  if (info.tags.length) {
    main.push(section(`Теги (${info.tags.length})`, copyButton(info.tags.join(', '), { label: 'Копировать' }),
      h('div', { class: 'tag-cloud' }, ...info.tags.map((t) => h('span', { class: 'tag-chip' }, t))),
      h('a', { href: `/youtube-tags?url=${enc}`, class: 'related-more' }, 'Подробнее в инструменте «Теги видео»')));
  }
  const manual = info.captions.filter((c) => c.kind === 'manual');
  const auto = info.captions.filter((c) => c.kind === 'auto');
  const translated = info.captions.filter((c) => c.kind === 'translated');
  side.push(section('Субтитры', null,
    h('p', { class: 'detect-meta' }, info.captions.length
      ? [manual.length ? `Авторские: ${manual.map((c) => c.name).join(', ')}.` : 'Авторских нет.',
        auto.length ? ` Автоматические: ${auto.map((c) => c.name).join(', ')}.` : '',
        translated.length ? ` Автоперевод на ${translated.length} языков.` : ''].join('')
      : 'У видео нет субтитров.'),
    info.captions.length ? h('a', { href: `/youtube-transcript?url=${enc}`, class: 'btn btn-secondary btn-sm' }, icon('captions'), 'Открыть расшифровку') : null));

  const json = () => JSON.stringify({ ...info, downloads: undefined, captions: info.captions.map(({ lang, name, kind }) => ({ lang, name, kind })) }, null, 2);
  const actions = h('div', { class: 'results-actions' },
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: (e) => copyText(json(), e.currentTarget) }, icon('copy'), 'Копировать JSON'),
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => downloadText(`${info.id}.json`, json(), 'application/json') }, icon('json'), 'Скачать JSON'),
    h('a', { class: 'btn btn-secondary btn-sm', href: `/youtube-downloader?url=${enc}` }, icon('download'), 'Скачать видео'));

  out.replaceChildren(
    h('div', { class: 'results-bar' }, h('p', {}, 'Данные получены с публичной страницы ролика'), actions),
    h('div', { class: 'info-layout' }, h('div', { class: 'info-main' }, ...main), h('div', { class: 'info-main' }, ...side)));
}

mountUrlForm(form, { onSubmit: (_ref, raw) => load(raw) });
