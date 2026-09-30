// Общие элементы интерфейса: уведомления, копирование, статусы, ошибки, скелетоны.
import { h, icon } from './dom.js';
import { num } from './format.js';

export function toast(message, type = 'ok', timeout = 3200) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const names = { ok: 'check', error: 'alert', info: 'info' };
  const el = h('div', { class: `toast toast-${type}` }, icon(names[type] || 'info'), h('span', {}, message));
  box.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

export async function copyText(text, button = null, doneLabel = 'Скопировано') {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = h('textarea', { style: { position: 'fixed', opacity: '0' } });
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  } catch {
    toast('Браузер не дал доступ к буферу обмена. Выделите текст и скопируйте вручную.', 'error', 4500);
    return false;
  }
  if (button) flashButton(button, doneLabel);
  else toast(doneLabel);
  return true;
}

export function flashButton(button, label) {
  if (button._flashTimer) clearTimeout(button._flashTimer);
  const original = button._original || [...button.childNodes];
  button._original = original;
  button.replaceChildren(icon('check'), h('span', {}, label));
  button.classList.add('is-done');
  button._flashTimer = setTimeout(() => {
    button.replaceChildren(...original);
    button.classList.remove('is-done');
    button._original = null;
  }, 1600);
}

export function copyButton(getText, { label = 'Копировать', size = 'btn-xs', variant = 'btn-secondary', iconOnly = false, title } = {}) {
  const btn = h('button', { type: 'button', class: `btn ${variant} ${size}`, title: title || label, 'aria-label': iconOnly ? (title || label) : null },
    icon('copy'), iconOnly ? null : h('span', {}, label));
  btn.addEventListener('click', () => copyText(typeof getText === 'function' ? getText() : getText, btn, iconOnly ? '' : 'Скопировано'));
  return btn;
}

export function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Файл «${filename}» сохранён`);
}

export function setBusy(button, busy, label = 'Подождите…') {
  if (!button) return;
  button.classList.toggle('is-busy', busy);
  button.dataset.busy = label;
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
  button.disabled = busy;
}

// Блок статуса долгой операции с прогрессом.
export function createStatus(container, { onCancel } = {}) {
  const text = h('span', { class: 'status-text' });
  const count = h('span', { class: 'status-count' });
  const bar = h('span');
  const progress = h('div', { class: 'progress is-indeterminate', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
  const sub = h('p', { class: 'status-sub' });
  const cancel = onCancel ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm status-cancel', onclick: onCancel }, icon('stop'), 'Отменить') : null;
  const root = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'status-row' }, h('span', { class: 'status-dot', 'aria-hidden': 'true' }), text, count, cancel), progress, sub);
  container.replaceChildren(root);
  container.hidden = false;

  return {
    el: root,
    set(stage, { current, total, percent, extra } = {}) {
      if (stage) text.textContent = stage;
      if (current != null && total) count.textContent = `${num(current)} из ${total > current ? '~' : ''}${num(total)}`;
      else if (current != null) count.textContent = num(current);
      else count.textContent = '';
      const value = percent ?? (current != null && total ? Math.min(100, (current / total) * 100) : null);
      if (value == null) {
        progress.classList.add('is-indeterminate');
        bar.style.width = '';
        progress.removeAttribute('aria-valuenow');
      } else {
        progress.classList.remove('is-indeterminate');
        bar.style.width = `${Math.max(2, value)}%`;
        progress.setAttribute('aria-valuenow', String(Math.round(value)));
      }
      sub.replaceChildren(...(extra || []).filter(Boolean).map((t) => h('span', {}, t)));
    },
    done(message) {
      root.classList.add('is-done');
      text.textContent = message;
      bar.style.width = '100%';
      progress.classList.remove('is-indeterminate');
      cancel?.remove();
    },
    remove() {
      root.remove();
    },
  };
}

// Для коротких синхронных запросов: меняем подпись, если ответ задерживается.
export function stagedStatus(container, stages) {
  const status = createStatus(container);
  const timers = stages.map(([delay, message]) => setTimeout(() => status.set(message), delay));
  status.stop = () => timers.forEach(clearTimeout);
  return status;
}

export function errorBox(error, { onRetry, retryLabel = 'Повторить' } = {}) {
  const message = error?.message || 'Что-то пошло не так.';
  const hint = error?.hint;
  const actions = onRetry ? h('div', { class: 'alert-actions' },
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: onRetry }, icon('refresh'), retryLabel)) : null;
  return h('div', { class: 'alert alert-error', role: 'alert' },
    icon('alert'),
    h('div', { class: 'alert-body' }, h('strong', {}, message), hint ? h('p', {}, hint) : null, actions));
}

export function emptyState(iconName, title, text) {
  return h('div', { class: 'empty' }, icon(iconName), h('p', {}, h('strong', {}, title), text ? ` ${text}` : ''));
}

export function skeleton({ lines = 3, media = false } = {}) {
  return h('div', { class: 'skeleton-card', 'aria-hidden': 'true' },
    media ? h('div', { class: 'skeleton', style: { 'aspect-ratio': '16 / 9', 'max-width': '320px' } }) : null,
    ...Array.from({ length: lines }, (_, i) => h('div', { class: 'skeleton skeleton-line', style: { width: `${[92, 70, 84, 55, 76][i % 5]}%` } })));
}

export function mediaCard({ title, url, thumbnail, duration, meta = [] }) {
  return h('div', { class: 'media-card' },
    h('div', { class: 'media-thumb' },
      thumbnail ? h('img', { src: thumbnail, alt: '', loading: 'lazy', decoding: 'async', width: '320', height: '180' }) : null,
      duration ? h('span', { class: 'duration' }, duration) : null),
    h('div', { class: 'media-body' },
      h('p', { class: 'media-title' }, url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, title || 'Без названия') : title),
      h('p', { class: 'media-meta' }, ...meta.filter(Boolean).map((m) => h('span', {}, m)))));
}

export function badge(text, variant = '', iconName = null) {
  return h('span', { class: `badge ${variant}`.trim() }, iconName ? icon(iconName) : null, text);
}
