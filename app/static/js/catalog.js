// Страница «Все инструменты»: фильтр по словам и категориям без перезагрузки.
import { $, $$ } from './core/dom.js';

const search = $('[data-catalog-search]');
const items = $$('.catalog-item');
const chips = $$('[data-catalog-cat]');
const empty = $('[data-catalog-empty]');
let category = '';

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').trim();
const stem = (w) => (w.length > 5 ? w.slice(0, Math.max(4, w.length - 3)) : w);

function apply() {
  const words = norm(search.value).split(/\s+/).filter(Boolean).map(stem);
  let visible = 0;
  for (const item of items) {
    const text = norm(item.dataset.search);
    const match = (!category || item.dataset.cat === category) && words.every((w) => text.includes(w));
    item.hidden = !match;
    if (match) visible += 1;
  }
  empty.hidden = visible > 0;
}

search.addEventListener('input', apply);
for (const chip of chips) {
  chip.addEventListener('click', () => {
    category = chip.dataset.catalogCat;
    chips.forEach((c) => c.classList.toggle('is-active', c === chip));
    apply();
  });
}
const q = new URLSearchParams(location.search).get('q');
if (q) {
  search.value = q;
  apply();
}
