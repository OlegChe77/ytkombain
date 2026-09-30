// Палитра поиска: ищет инструменты по задаче и понимает вставленные ссылки YouTube.
import { $, h, icon } from './core/dom.js';
import { api } from './core/api.js';
import { parseYouTube, thumb } from './core/yturl.js';

const dialog = $('#palette');
const input = $('#palette-input');
const list = $('#palette-list');
const context = $('#palette-context');
let catalog = null;
let items = [];
let active = 0;
let previewTimer = null;

const norm = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim();
const stem = (w) => (w.length > 5 ? w.slice(0, Math.max(4, w.length - 3)) : w);
const tokens = (s) => norm(s).split(/\s+/).filter(Boolean);

async function loadCatalog() {
  if (catalog) return catalog;
  catalog = await api('/api/catalog');
  for (const tool of catalog.tools) {
    tool._fields = [
      [tokens(tool.name), 6],
      [tokens(tool.keywords.join(' ')), 4],
      [tokens(tool.h1), 3],
      [tokens(tool.blurb), 2],
      [tokens(tool.categoryName), 2],
    ];
  }
  return catalog;
}

function score(tool, queryTokens) {
  let total = 0;
  for (const q of queryTokens) {
    let best = 0;
    const qs = stem(q);
    for (const [words, weight] of tool._fields) {
      for (const w of words) {
        let s = 0;
        if (w === q) s = weight * 1.2;
        else if (w.startsWith(q)) s = weight;
        else if (q.length >= 4 && (w.startsWith(qs) || q.startsWith(stem(w)))) s = weight * 0.75;
        else if (q.length >= 3 && w.includes(q)) s = weight * 0.4;
        if (s > best) best = s;
      }
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

function toolItem(tool, href) {
  return {
    href: href || tool.url,
    node: (id, selected) => h('li', { class: 'palette-item', role: 'option', id, 'aria-selected': String(selected), style: { '--track': `var(--c-${tool.category})` } },
      h('a', { href: href || tool.url, tabindex: '-1' },
        h('span', { class: 'palette-icon' }, icon(tool.icon)),
        h('span', {}, h('strong', {}, tool.name), h('small', {}, tool.blurb)))),
  };
}

function render(groups) {
  items = [];
  const nodes = [];
  for (const group of groups) {
    if (!group.items.length) continue;
    nodes.push(h('li', { class: 'palette-group', role: 'presentation' }, group.title));
    for (const item of group.items) {
      const index = items.length;
      items.push(item);
      nodes.push(item.node(`palette-opt-${index}`, index === active));
    }
  }
  if (!items.length) {
    nodes.push(h('li', { class: 'palette-empty', role: 'presentation' },
      'Ничего не нашлось. Попробуйте другое слово — например, «скачать», «субтитры» или «комментарии».'));
  }
  list.replaceChildren(...nodes);
  input.setAttribute('aria-activedescendant', items.length ? `palette-opt-${active}` : '');
}

function setActive(index) {
  if (!items.length) return;
  active = (index + items.length) % items.length;
  for (const el of list.querySelectorAll('.palette-item')) el.setAttribute('aria-selected', 'false');
  const el = document.getElementById(`palette-opt-${active}`);
  el?.setAttribute('aria-selected', 'true');
  el?.scrollIntoView({ block: 'nearest' });
  input.setAttribute('aria-activedescendant', `palette-opt-${active}`);
}

function showContext(ref, raw) {
  clearTimeout(previewTimer);
  context.hidden = false;
  const img = ref.videoId ? h('img', { src: thumb(ref.videoId), alt: '', width: '64', height: '36' }) : null;
  const title = h('strong', {}, ref.label);
  const meta = h('span', {}, 'Выберите, что сделать с этой ссылкой');
  context.replaceChildren(...[img, h('div', {}, title, meta)].filter(Boolean));
  if (ref.kind === 'channel') return;
  previewTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/preview?url=${encodeURIComponent(raw)}`);
      if (data.title && input.value.trim() === raw) {
        title.textContent = data.title;
        meta.textContent = `${ref.label}${data.author ? `, ${data.author}` : ''}`;
      }
    } catch { /* превью не обязательно */ }
  }, 250);
}

async function update() {
  const raw = input.value.trim();
  await loadCatalog();
  active = 0;
  const ref = raw ? parseYouTube(raw) : null;
  if (ref?.ok) {
    showContext(ref, raw);
    const matching = catalog.tools.filter((t) => t.accepts.some((k) => ref.accepts.has(k)));
    render([{ title: 'Что можно сделать', items: matching.map((t) => toolItem(t, `${t.url}?url=${encodeURIComponent(raw)}`)) }]);
    return;
  }
  context.hidden = true;
  if (!raw) {
    render(catalog.categories.map((c) => ({ title: c.name, items: catalog.tools.filter((t) => t.category === c.slug).map((t) => toolItem(t)) })));
    return;
  }
  const q = tokens(raw);
  const ranked = catalog.tools.map((t) => [t, score(t, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  render([{ title: 'Инструменты', items: ranked.map(([t]) => toolItem(t)) }]);
}

input.addEventListener('input', update);
input.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(active - 1); }
  else if (event.key === 'Enter') {
    event.preventDefault();
    if (items[active]) window.location.href = items[active].href;
  }
});
list.addEventListener('mousemove', (event) => {
  const li = event.target.closest('.palette-item');
  if (!li) return;
  const index = Number(li.id.replace('palette-opt-', ''));
  if (index !== active) setActive(index);
});
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
$('[data-palette-paste]', dialog).addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      input.value = text.trim();
      update();
    }
  } catch {
    input.focus();
  }
});

export async function openPalette(prefill = '') {
  if (!dialog.open) dialog.showModal();
  input.value = prefill;
  input.focus();
  try {
    await update();
  } catch {
    list.replaceChildren(h('li', { class: 'palette-empty' }, 'Не удалось загрузить список инструментов. Проверьте соединение.'));
  }
}
