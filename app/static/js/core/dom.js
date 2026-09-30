// Небольшие помощники для DOM. Пользовательские данные вставляются только как текст — без innerHTML.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, val] of Object.entries(value)) el.style.setProperty(prop, val);
    } else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const spriteUrl = () => document.body?.dataset.icons || '/static/img/icons.svg';

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${spriteUrl()}#i-${name}`);
  svg.append(use);
  return svg;
}

export function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

export function show(el, visible = true) {
  if (el) el.hidden = !visible;
}

export function formValues(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'number') data[el.name] = el.value === '' ? null : Number(el.value);
    else data[el.name] = el.value;
  }
  return data;
}

export function highlight(text, words) {
  // Возвращает фрагмент с <mark> вокруг найденных слов; текст остаётся текстом.
  const frag = document.createDocumentFragment();
  if (!words?.length || !text) {
    frag.append(text || '');
    return frag;
  }
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  if (!escaped.length) {
    frag.append(text);
    return frag;
  }
  const re = new RegExp(`(${escaped.join('|')})`, 'giu');
  let last = 0;
  for (const match of text.matchAll(re)) {
    frag.append(text.slice(last, match.index));
    frag.append(h('mark', {}, match[0]));
    last = match.index + match[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}
