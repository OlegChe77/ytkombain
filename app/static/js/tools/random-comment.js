// Случайный комментарий: одна кнопка, история последних выборов.
import { $, h } from '../core/dom.js';
import { mountCommentsLoader } from '../comments/loader.js';
import { randomIndex } from '../comments/filters.js';
import { commentCard } from '../comments/render.js';
import { toast } from '../core/ui.js';

const box = $('#randomizer');
const button = $('#random-btn');
const card = $('#random-card');
const history = $('#random-history');
const historyList = $('ol', history);
let data = null;
const picks = [];

function roll() {
  if (!data?.comments.length) return;
  const comment = data.comments[randomIndex(data.comments.length)];
  button.classList.remove('is-rolling');
  void button.offsetWidth; // перезапуск анимации кубика
  button.classList.add('is-rolling');
  card.replaceChildren(commentCard(comment, { videoId: data.video.id }));
  if (picks.length) {
    const prev = picks[picks.length - 1];
    historyList.prepend(h('li', {}, h('strong', {}, prev.author), h('span', {}, prev.text)));
    while (historyList.children.length > 8) historyList.lastElementChild.remove();
    history.hidden = false;
  }
  picks.push(comment);
  if (picks.length === 1) window.kombainGoal?.('random_comment');
}

button.addEventListener('click', roll);
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || box.hidden || event.target.closest('input, textarea, select, button, a, dialog')) return;
  event.preventDefault();
  roll();
});

mountCommentsLoader({
  onReset: () => { box.hidden = true; },
  onLoaded: (loaded) => {
    data = loaded;
    picks.length = 0;
    historyList.replaceChildren();
    history.hidden = true;
    card.replaceChildren();
    box.hidden = !loaded.comments.length;
    if (!loaded.comments.length) {
      toast('Комментариев нет: они отключены или их ещё никто не оставил.', 'info', 4500);
      return;
    }
    button.focus();
  },
});
