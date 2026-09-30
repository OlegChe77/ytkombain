// Поле ссылки инструмента: вставка из буфера, перетаскивание, проверка, ?url= в адресе.
import { $, $$, h } from './dom.js';
import { parseYouTube } from './yturl.js';
import { toast } from './ui.js';

const STORAGE_KEY = 'kombain:last-url';

const accepts = (ref, allowed) => allowed.some((kind) => ref.accepts.has(kind));

function remember(value) {
  try { sessionStorage.setItem(STORAGE_KEY, value); } catch { /* приватный режим */ }
}

function recall() {
  try { return sessionStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

export async function readClipboard() {
  if (!navigator.clipboard?.readText) return null;
  try {
    return (await navigator.clipboard.readText()).trim();
  } catch {
    return null;
  }
}

function kindMessage(allowed) {
  const names = { video: 'видео', playlist: 'плейлист', channel: 'канал' };
  return `Этому инструменту нужна ссылка на ${allowed.map((k) => names[k]).join(' или ')}.`;
}

// Обновляет ссылки на похожие инструменты: они откроются сразу с той же ссылкой.
function propagate(ref, raw) {
  for (const link of $$('a[data-accepts]')) {
    if (link.closest('.detect-actions, .timeline')) continue;
    const kinds = link.dataset.accepts.split(' ');
    const base = link.getAttribute('href').split('?')[0];
    link.setAttribute('href', kinds.some((k) => ref.accepts.has(k)) ? `${base}?url=${encodeURIComponent(raw)}` : base);
  }
}

export function mountUrlForm(form, { onSubmit, onChange } = {}) {
  const input = $('input[name="url"]', form);
  const field = input.closest('.url-field');
  const hint = $('[data-hint]', form);
  const allowed = (form.dataset.accepts || 'video').split(' ');
  const autostart = form.dataset.autostart !== 'false';

  const setHint = (text, state = '') => {
    if (!hint) return;
    hint.className = `field-hint ${state ? `is-${state}` : ''}`.trim();
    hint.replaceChildren();
    if (text instanceof Node) hint.append(text);
    else if (text) hint.textContent = text;
  };

  const validate = (showErrors) => {
    const raw = input.value.trim();
    field.classList.remove('is-valid', 'is-invalid');
    if (!raw) {
      setHint('');
      return null;
    }
    const ref = parseYouTube(raw);
    if (ref.ok && accepts(ref, allowed)) {
      field.classList.add('is-valid');
      setHint(h('span', { class: 'kind' }, ref.label), 'ok');
      return ref;
    }
    if (showErrors) {
      field.classList.add('is-invalid');
      setHint(ref.ok ? kindMessage(allowed) : ref.error, 'error');
    } else {
      setHint('');
    }
    return null;
  };

  const submit = () => {
    const raw = input.value.trim();
    if (!raw) {
      field.classList.add('is-invalid');
      setHint('Вставьте ссылку на YouTube.', 'error');
      input.focus();
      return;
    }
    const ref = validate(true);
    if (!ref) {
      input.focus();
      return;
    }
    remember(raw);
    const url = new URL(window.location.href);
    url.searchParams.set('url', raw);
    history.replaceState(null, '', url);
    propagate(ref, raw);
    onSubmit?.(ref, raw);
  };

  const setValue = (value, { run = autostart } = {}) => {
    input.value = value;
    const ref = validate(false);
    onChange?.(ref);
    if (ref && run) submit();
    else if (!ref && value) validate(true);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  input.addEventListener('input', () => onChange?.(validate(false)));
  input.addEventListener('blur', () => { if (input.value.trim()) validate(true); });
  input.addEventListener('paste', () => {
    setTimeout(() => {
      const ref = validate(false);
      onChange?.(ref);
      if (ref && autostart) submit();
    }, 0);
  });

  $('[data-paste]', form)?.addEventListener('click', async () => {
    const text = await readClipboard();
    if (text) {
      setValue(text);
      if (!autostart) $('button[type="submit"]', form)?.focus();
    } else {
      input.focus();
      toast('Вставьте ссылку сочетанием Ctrl+V или долгим нажатием на поле.', 'info', 4000);
    }
  });

  field.addEventListener('dragover', (event) => {
    event.preventDefault();
    field.classList.add('is-dragover');
  });
  field.addEventListener('dragleave', () => field.classList.remove('is-dragover'));
  field.addEventListener('drop', (event) => {
    event.preventDefault();
    field.classList.remove('is-dragover');
    const text = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    if (text) setValue(text.split('\n')[0].trim(), { run: true });
  });

  const fromQuery = new URLSearchParams(window.location.search).get('url');
  if (fromQuery) {
    setValue(fromQuery);
  } else {
    const last = recall();
    const ref = last ? parseYouTube(last) : null;
    if (ref?.ok && accepts(ref, allowed)) setValue(last, { run: false });
  }

  return { input, submit, setValue, validate };
}
