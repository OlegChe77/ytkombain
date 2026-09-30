// Фильтр комментариев: мгновенный отбор, подсветка совпадений, выгрузка.
import { $, $$ } from '../core/dom.js';
import { mountCommentsLoader, COMMENT_FORMS } from '../comments/loader.js';
import { applyFilters, readFilters } from '../comments/filters.js';
import { commentCard, commentsCSV, commentsTXT } from '../comments/render.js';
import { copyText, downloadText, emptyState } from '../core/ui.js';
import { num, plural, slug } from '../core/format.js';

const view = $('#filter-view');
const filtersForm = $('#cf-filters');
const sortSelect = $('#cf-sort');
const count = $('#cf-count');
const list = $('#cf-list');
const more = $('#cf-more');
const PAGE = 100;
let data = null;
let result = [];
let shown = 0;
let timer = null;

const SORTS = {
  original: null,
  likes: (a, b) => b.likes - a.likes,
  length: (a, b) => b.text.length - a.text.length,
  new: (a, b) => (b.ts || 0) - (a.ts || 0),
};

function apply() {
  if (!data) return;
  const filters = readFilters(filtersForm);
  result = applyFilters(data.comments, filters);
  const sorter = SORTS[sortSelect.value];
  if (sorter) result = [...result].sort(sorter);
  count.textContent = `Найдено ${num(result.length)} ${plural(result.length, COMMENT_FORMS)} из ${num(data.comments.length)}`;
  shown = 0;
  list.replaceChildren();
  if (!result.length) {
    list.append(emptyState('filter', 'Под условия ничего не подходит.', 'Уберите часть слов или ослабьте ограничения по длине.'));
    more.hidden = true;
    return;
  }
  renderMore(filters.include);
}

function renderMore(words = readFilters(filtersForm).include) {
  const frag = document.createDocumentFragment();
  for (const c of result.slice(shown, shown + PAGE)) frag.append(commentCard(c, { videoId: data.video.id, words }));
  list.append(frag);
  shown = Math.min(result.length, shown + PAGE);
  more.hidden = shown >= result.length;
  more.textContent = `Показать ещё (${num(result.length - shown)})`;
}

const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(apply, 150);
};

filtersForm.addEventListener('input', schedule);
filtersForm.addEventListener('change', schedule);
sortSelect.addEventListener('change', apply);
more.addEventListener('click', () => renderMore());

for (const btn of $$('[data-export]')) {
  btn.addEventListener('click', () => {
    if (!result.length) return;
    const name = `Комментарии ${slug(data.video.title, 50)}`;
    if (btn.dataset.export === 'copy') copyText(commentsTXT(result), btn);
    if (btn.dataset.export === 'txt') downloadText(`${name}.txt`, commentsTXT(result));
    if (btn.dataset.export === 'csv') downloadText(`${name}.csv`, commentsCSV(result, data.video.id), 'text/csv;charset=utf-8');
  });
}

mountCommentsLoader({
  onReset: () => { view.hidden = true; },
  onLoaded: (loaded) => {
    data = loaded;
    view.hidden = false;
    if (!loaded.comments.length) {
      count.textContent = '';
      list.replaceChildren(emptyState('message', 'Комментариев нет.', 'Они отключены или их ещё никто не оставил.'));
      more.hidden = true;
      return;
    }
    apply();
  },
});
