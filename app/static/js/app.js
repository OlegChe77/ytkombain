// Общий код всех страниц: тема, меню, мобильная панель, поиск.
import { $, $$ } from './core/dom.js';
import { readClipboard } from './core/url-form.js';

const THEME_KEY = 'kombain-theme';
const root = document.documentElement;

function applyTheme(theme) {
  root.dataset.theme = theme;
  const next = theme === 'dark' ? 'светлую' : 'тёмную';
  for (const btn of $$('[data-theme-toggle]')) {
    btn.setAttribute('aria-label', `Включить ${next} тему`);
    const label = $('[data-theme-label]', btn);
    if (label) label.textContent = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  }
  const meta = $$('meta[name="theme-color"]');
  meta.forEach((m) => m.setAttribute('content', theme === 'dark' ? '#1b1c21' : '#f3f4f6'));
}

function initTheme() {
  applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark');
  for (const btn of $$('[data-theme-toggle]')) {
    btn.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      try { localStorage.setItem(THEME_KEY, theme); } catch { /* хранилище недоступно */ }
    });
  }
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change', (event) => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* ничего */ }
    if (!saved) applyTheme(event.matches ? 'dark' : 'light');
  });
}

function initMenus() {
  const items = $$('[data-menu]');
  const closeAll = (except) => {
    for (const item of items) {
      if (item === except) continue;
      const btn = $('button', item);
      btn.setAttribute('aria-expanded', 'false');
      $('.menu', item).hidden = true;
    }
  };
  for (const item of items) {
    const btn = $('button', item);
    const menu = $('.menu', item);
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      closeAll(item);
      btn.setAttribute('aria-expanded', String(!open));
      menu.hidden = open;
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeAll();
        btn.focus();
      }
    });
  }
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-menu]')) closeAll();
  });
}

function initDrawer() {
  const drawer = $('#drawer');
  if (!drawer) return;
  for (const btn of $$('[data-open-drawer]')) btn.addEventListener('click', () => drawer.showModal());
  $('[data-close]', drawer)?.addEventListener('click', () => drawer.close());
  drawer.addEventListener('click', (event) => { if (event.target === drawer) drawer.close(); });
  drawer.addEventListener('click', (event) => { if (event.target.closest('a')) drawer.close(); });
}

let palettePromise = null;
function openPalette(prefill) {
  palettePromise ||= import('./search.js');
  palettePromise.then((mod) => mod.openPalette(prefill));
}

function initSearch() {
  for (const btn of $$('[data-open-search]')) btn.addEventListener('click', () => openPalette());
  document.addEventListener('keydown', (event) => {
    const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]');
    if ((event.key === 'k' || event.key === 'K' || event.key === 'л' || event.key === 'Л') && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      openPalette();
    } else if (event.key === '/' && !typing) {
      event.preventDefault();
      openPalette();
    }
  });
  for (const btn of $$('[data-paste-link]')) {
    btn.addEventListener('click', async () => {
      const text = await readClipboard();
      openPalette(text || '');
    });
  }
}

initTheme();
initMenus();
initDrawer();
initSearch();
