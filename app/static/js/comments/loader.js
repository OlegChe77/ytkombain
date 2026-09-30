// Общая загрузка комментариев для четырёх инструментов категории «Комментарии».
import { $, h, formValues } from '../core/dom.js';
import { runJob } from '../core/api.js';
import { mountUrlForm } from '../core/url-form.js';
import { createStatus, errorBox, mediaCard, setBusy, toast } from '../core/ui.js';
import { num, pluralN } from '../core/format.js';

export const COMMENT_FORMS = ['комментарий', 'комментария', 'комментариев'];

export function mountCommentsLoader({ onLoaded, onReset } = {}) {
  const form = $('#cm-form');
  const summary = $('#cm-summary');
  const button = $('button[type="submit"]', form);
  let controller = null;

  async function load(raw) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const options = formValues(form);
    onReset?.();
    setBusy(button, true, 'Загружаем…');
    const status = createStatus(summary, { onCancel: () => controller.abort() });
    status.set('Отправляем запрос…');
    try {
      const data = await runJob('/api/comments', {
        url: raw, limit: Number(options.limit), sort: options.sort, replies: Boolean(options.replies),
      }, {
        signal,
        onUpdate: (job) => {
          const p = job.progress || {};
          status.set(job.status === 'queued' ? 'Ждём свободный обработчик…' : job.stage,
            p.current != null ? { current: p.current, total: p.total } : {});
        },
      });
      renderSummary(data);
      window.kombainGoal?.('comments_load');
      onLoaded?.(data, raw);
    } catch (error) {
      if (error.code === 'cancelled') {
        summary.hidden = true;
        toast('Загрузка отменена', 'info');
      } else {
        summary.replaceChildren(errorBox(error, { onRetry: () => load(raw) }));
      }
    } finally {
      setBusy(button, false);
    }
  }

  function renderSummary(data) {
    const v = data.video;
    const count = data.comments.length;
    const total = v.comment_count;
    const meta = [
      v.channel,
      `Загружено ${pluralN(count, COMMENT_FORMS)}${total ? ` из ${num(total)} на YouTube` : ''}`,
      data.replies ? 'вместе с ответами' : 'без ответов',
    ];
    const card = mediaCard({ title: v.title, url: v.url, thumbnail: v.thumbnail, meta });
    const nodes = [h('div', { class: 'cm-summary' }, card)];
    if (data.truncated) {
      nodes.push(h('div', { class: 'notice' }, h('p', {},
        'Под видео больше комментариев, чем загружено. Если нужны все, увеличьте лимит и загрузите заново.')));
    }
    if (!data.replies && total && count < total && !data.truncated) {
      nodes.push(h('p', { class: 'notice' },
        'Счётчик YouTube включает ответы и скрытые комментарии, поэтому загруженных может быть меньше.'));
    }
    summary.replaceChildren(...nodes);
  }

  mountUrlForm(form, { onSubmit: (_ref, raw) => load(raw) });
  return { reload: load };
}
