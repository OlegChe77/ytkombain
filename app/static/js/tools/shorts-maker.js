// Редактор Shorts и Stories: загрузка исходника с YouTube и запуск модулей редактора.
import { $, h } from '../core/dom.js';
import { runJob } from '../core/api.js';
import { mountUrlForm } from '../core/url-form.js';
import { createStatus, errorBox, setBusy, toast } from '../core/ui.js';
import { bytes, timecode } from '../core/format.js';
import { createStore, initialState } from '../editor/state.js';
import { createPreview } from '../editor/preview.js';
import { createTimeline } from '../editor/timeline.js';
import { createPanels } from '../editor/panels.js';
import { createExport } from '../editor/export.js';

const form = $('#ed-form');
const statusBox = $('#ed-status');
const root = $('#editor');
const submit = $('button[type="submit"]', form);
let store = null;
let currentRaw = '';
let controller = null;

async function open(raw) {
  controller?.abort();
  controller = new AbortController();
  currentRaw = raw;
  setBusy(submit, true, 'Загружаем…');
  const status = createStatus(statusBox, { onCancel: () => controller.abort() });
  status.set('Получаем информацию о видео…');
  try {
    const source = await runJob('/api/editor/source', { url: raw }, {
      signal: controller.signal,
      onUpdate: (job) => {
        const p = job.progress || {};
        status.set(job.status === 'queued' ? 'Ждём своей очереди…' : job.stage, {
          percent: p.percent ?? null,
          extra: [p.downloaded ? `${bytes(p.downloaded)} из ${p.total ? bytes(p.total) : '…'}` : null,
            p.eta ? `осталось ${timecode(p.eta)}` : null],
        });
      },
    });
    status.done('Видео загружено в редактор');
    setTimeout(() => { statusBox.hidden = true; }, 1500);
    start(source);
  } catch (error) {
    if (error.code === 'cancelled') {
      statusBox.hidden = true;
      toast('Загрузка отменена', 'info');
    } else {
      statusBox.replaceChildren(errorBox(error, { onRetry: () => open(raw) }));
    }
  } finally {
    setBusy(submit, false);
  }
}

function start(source) {
  root.hidden = false;
  if (store) {
    // Новое видео в уже открытом редакторе: модули подписаны на хранилище и перестроятся сами.
    store.set({ ...initialState(source) });
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  store = createStore(initialState(source));
  const preview = createPreview(store, {
    box: $('.stage-box', root), frame: $('#frame', root), video: $('#frame-video', root), bg: $('#frame-bg', root),
    layersBox: $('#frame-layers', root), progress: $('#frame-progress', root), safe: $('#safe-zones', root),
    guideV: $('.guide-v', root), guideH: $('.guide-h', root),
  });
  createTimeline(store, {
    root, track: $('#range-track', root), rangeStart: $('#range-start', root), rangeEnd: $('#range-end', root),
    startField: $('#ed-start', root), endField: $('#ed-end', root), info: $('#ed-length', root),
    time: $('#ed-time', root), playBtn: $('#ed-play', root), setStart: $('#ed-set-start', root),
    setEnd: $('#ed-set-end', root), loopBtn: $('#ed-loop', root),
  }, preview);
  createPanels(store, root, preview, { getRaw: () => currentRaw });
  createExport(store, {
    summary: $('#ed-summary', root), button: $('#ed-render', root), result: $('#ed-result', root), cover: $('#ed-cover', root),
  }, preview, { onExpired: () => open(currentRaw) });
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  root.prepend(h('p', { class: 'sr-only', role: 'status' }, `Видео «${source.video.title}» открыто в редакторе`));
}

mountUrlForm(form, { onSubmit: (_ref, raw) => open(raw) });
