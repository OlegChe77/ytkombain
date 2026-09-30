// Сборка клипа на сервере и сохранение обложки.
import { h, icon } from '../core/dom.js';
import { runJob } from '../core/api.js';
import { createStatus, downloadText, errorBox, setBusy, toast } from '../core/ui.js';
import { bytes, slug } from '../core/format.js';
import { drawLayer, ensureFont } from './layers.js';
import { FORMATS, layerTimes, outDuration, placement } from './state.js';

const round = (v, d = 3) => Number(v.toFixed(d));

export function createExport(store, els, preview, { onExpired }) {
  const { summary, button, result } = els;
  let controller = null;

  function renderSummary(s) {
    const { w, h: hh } = FORMATS[s.format];
    const out = outDuration(s);
    const tooLong = out > s.maxClip + 0.05;
    summary.textContent = `${w}×${hh}, ${out.toFixed(1).replace('.', ',')} с, MP4 (H.264)`
      + `${s.layers.length ? `, титров: ${s.layers.length}` : ''}${s.music ? ', своя музыка' : ''}`;
    summary.classList.toggle('is-error', tooLong);
    button.disabled = tooLong;
  }

  async function overlays(s) {
    const { w: W, h: H } = FORMATS[s.format];
    await Promise.all([...new Set(s.layers.map((l) => l.font))].map((font) => ensureFont(font, s.layers.map((l) => l.text).join(' '))));
    const list = [];
    for (const layer of s.layers) {
      if (!layer.text.trim()) continue;
      const t = layerTimes(layer, s);
      if (t.end - t.start < 0.05) continue;
      const canvas = drawLayer(layer, W);
      list.push({
        png: canvas.toDataURL('image/png'),
        x: Math.round(layer.x * W - canvas.width / 2),
        y: Math.round(layer.y * H - canvas.height / 2),
        start: round(t.start), end: round(t.end), anim: layer.anim,
      });
    }
    return list;
  }

  async function render() {
    const s = store.get();
    preview.pause();
    controller?.abort();
    controller = new AbortController();
    setBusy(button, true, 'Собираем…');
    result.hidden = false;
    const status = createStatus(result, { onCancel: () => controller.abort() });
    status.set('Готовим титры…');
    try {
      const body = {
        start: round(s.start, 2), end: round(s.end, 2), format: s.format, fit: s.fit, background: s.background,
        bg_color: s.bgColor, zoom: round(s.zoom), pan_x: round(s.panX), pan_y: round(s.panY), speed: s.speed,
        volume: round(s.volume), use_music: Boolean(s.music), music_volume: round(s.musicVolume),
        music_offset: round(s.musicOffset), music_fade: s.musicFade, fade_in: s.fadeIn, fade_out: s.fadeOut,
        progress: s.progress, progress_color: s.progressColor, overlays: await overlays(s),
      };
      status.set('Отправляем на сборку…');
      const data = await runJob(`/api/editor/${s.session}/render`, body, {
        signal: controller.signal,
        onUpdate: (job) => status.set(job.status === 'queued' ? 'Ждём очереди на сборку…' : job.stage,
          { percent: job.progress?.percent ?? null }),
      });
      ready(data);
    } catch (error) {
      if (error.code === 'cancelled') {
        result.replaceChildren(h('p', { class: 'field-hint' }, 'Сборка отменена.'));
      } else if (error.code === 'session_expired') {
        result.replaceChildren(errorBox(error, { onRetry: onExpired, retryLabel: 'Загрузить видео заново' }));
      } else {
        result.replaceChildren(errorBox(error, { onRetry: render }));
      }
    } finally {
      setBusy(button, false);
      renderSummary(store.get());
    }
  }

  function ready(data) {
    const link = h('a', { class: 'btn btn-primary', href: data.url, download: data.filename }, icon('download'), 'Скачать MP4');
    const note = h('p', { class: 'field-hint' }, 'Загрузка началась. Файл удалится с сервера через полминуты после скачивания — поменяйте настройки и соберите новый вариант, если нужно.');
    result.replaceChildren(
      h('div', { class: 'dl-file' }, icon('film'), h('div', {}, h('strong', {}, data.filename), h('small', {}, `${bytes(data.size)}, ${String(data.duration).replace('.', ',')} с`))),
      h('div', { class: 'dl-actions' }, link),
      note);
    link.click();
    window.kombainGoal?.('shorts_render', { format: store.get().format });
    toast('Клип готов');
    setTimeout(() => {
      link.setAttribute('aria-disabled', 'true');
      note.textContent = 'Файл удалён с сервера. Чтобы скачать ещё раз, нажмите «Создать видео».';
    }, 28000);
  }

  // Обложка: текущий кадр со всеми видимыми титрами.
  async function cover() {
    const s = store.get();
    const video = preview.video;
    if (video.readyState < 2) {
      toast('Видео ещё загружается.', 'info');
      return;
    }
    const p = placement(s);
    const canvas = document.createElement('canvas');
    canvas.width = p.W;
    canvas.height = p.H;
    const ctx = canvas.getContext('2d');
    if (s.background === 'blur') {
      const k = Math.max(p.W / video.videoWidth, p.H / video.videoHeight);
      ctx.filter = 'blur(40px) brightness(0.94)';
      ctx.drawImage(video, (p.W - video.videoWidth * k) / 2, (p.H - video.videoHeight * k) / 2, video.videoWidth * k, video.videoHeight * k);
      ctx.filter = 'none';
    } else {
      ctx.fillStyle = s.bgColor;
      ctx.fillRect(0, 0, p.W, p.H);
    }
    ctx.drawImage(video, p.x, p.y, p.fw, p.fh);
    const t = preview.outTime();
    for (const layer of s.layers) {
      const lt = layerTimes(layer, s);
      if (t < lt.start || t >= lt.end || !layer.text.trim()) continue;
      await ensureFont(layer.font, layer.text);
      const img = drawLayer(layer, p.W);
      ctx.drawImage(img, Math.round(layer.x * p.W - img.width / 2), Math.round(layer.y * p.H - img.height / 2));
    }
    canvas.toBlob((blob) => downloadText(`${slug(s.video.title, 50)} — обложка.png`, blob), 'image/png');
  }

  button.addEventListener('click', render);
  els.cover.addEventListener('click', cover);
  store.subscribe((s) => renderSummary(s));
  renderSummary(store.get());
}
