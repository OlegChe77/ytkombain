// Розыгрыш по комментариям: условия → честный случайный выбор → барабан → победители.
import { $, h, icon } from '../core/dom.js';
import { mountCommentsLoader, COMMENT_FORMS } from '../comments/loader.js';
import { applyFilters, authorKey, describeFilters, randomIndex, readFilters } from '../comments/filters.js';
import { avatar, commentCard, commentUrl } from '../comments/render.js';
import { copyText, toast } from '../core/ui.js';
import { fanfare, fireworks, setSound, soundOn, tick, unlockAudio } from '../core/fx.js';
import { num, plural, pluralN } from '../core/format.js';

const picker = $('#picker');
const filtersForm = $('#picker-filters');
const winnersInput = $('#winners');
const pool = $('#pool');
const drawBtn = $('#draw');
const stage = $('#stage');
const stageEmpty = $('#stage-empty');
const reel = $('#reel');
const strip = $('.reel-strip', reel);
const winnersBox = $('#winners-list');
const soundBtn = $('#sound-toggle');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let data = null;
let candidates = [];
let winners = [];
let rejected = new Set();
let drawing = false;
let drawnAt = null;

function updatePool() {
  if (!data) return;
  const filters = readFilters(filtersForm);
  candidates = applyFilters(data.comments, filters);
  const authors = new Set(candidates.map(authorKey)).size;
  const wanted = Math.max(1, Math.min(50, Number(winnersInput.value) || 1));
  pool.replaceChildren();
  if (!candidates.length) {
    pool.append(h('strong', {}, 'Никто не подходит под условия.'), ' Ослабьте фильтры или проверьте ключевое слово.');
  } else {
    pool.append('В розыгрыше ', filters.unique
      ? h('strong', {}, pluralN(candidates.length, ['участник', 'участника', 'участников']))
      : [h('strong', {}, pluralN(candidates.length, COMMENT_FORMS)), ' от ', h('strong', {}, pluralN(authors, ['участника', 'участников', 'участников']))], '.');
    if (wanted > candidates.length) pool.append(` Победителей не может быть больше, чем ${num(candidates.length)}.`);
  }
  drawBtn.disabled = !candidates.length || drawing;
}

function spin(winner, duration = 2600) {
  const count = 32;
  const items = Array.from({ length: count }, () => candidates[randomIndex(candidates.length)]);
  items.push(winner, candidates[randomIndex(candidates.length)], candidates[randomIndex(candidates.length)]);
  strip.replaceChildren(...items.map((c) => h('div', { class: 'reel-item' }, avatar(c), h('span', {}, c.author))));
  reel.hidden = false;
  const itemH = strip.firstElementChild.offsetHeight;
  const center = (reel.clientHeight - itemH) / 2;
  const end = center - count * itemH;
  if (reduceMotion || duration === 0) {
    strip.style.transform = `translateY(${end}px)`;
    return Promise.resolve();
  }
  const animation = strip.animate(
    [{ transform: `translateY(${center}px)` }, { transform: `translateY(${end}px)` }],
    { duration, easing: 'cubic-bezier(.12,.75,.12,1)', fill: 'forwards' },
  );
  // Щелчок каждый раз, когда через рамку проходит очередное имя.
  let lastIndex = 0;
  const listen = () => {
    if (animation.playState !== 'running') return;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(strip).transform);
    const index = Math.round((center - matrix.m42) / itemH);
    if (index !== lastIndex) {
      lastIndex = index;
      tick(index / count);
    }
    requestAnimationFrame(listen);
  };
  requestAnimationFrame(listen);
  // Во вкладке в фоне анимации стоят на паузе — результат всё равно показываем вовремя.
  const timeout = new Promise((resolve) => { setTimeout(resolve, duration + 250); });
  return Promise.race([animation.finished, timeout]).then(() => {
    animation.cancel();
    strip.style.transform = `translateY(${end}px)`;
  });
}

function celebrate() {
  fanfare();
  fireworks(stage, { bursts: winners.length > 1 ? 5 : 4 });
}

function renderSound() {
  const on = soundOn();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.replaceChildren(icon(on ? 'volume' : 'volume-off'), on ? 'Звук включён' : 'Звук выключен');
}

function pickOne(exclude) {
  const available = candidates.filter((c) => !exclude.has(c.id) && !exclude.has(`a:${authorKey(c)}`));
  if (!available.length) return null;
  return available[randomIndex(available.length)];
}

function excludeSet() {
  const set = new Set(rejected);
  for (const w of winners) {
    set.add(w.id);
    set.add(`a:${authorKey(w)}`); // один человек не может выиграть дважды
  }
  return set;
}

function winnerCard(c, index) {
  const reroll = h('button', { type: 'button', class: 'btn btn-secondary btn-xs' }, icon('refresh'), 'Перевыбрать');
  reroll.addEventListener('click', () => rerollWinner(index));
  return h('div', { class: 'winner' },
    h('div', { class: 'winner-rank', 'aria-label': `Победитель ${index + 1}` }, String(index + 1)),
    h('div', {}, commentCard(c, { videoId: data.video.id, words: readFilters(filtersForm).include }),
      h('div', { class: 'winner-actions' }, reroll)));
}

function renderWinners() {
  const filters = readFilters(filtersForm);
  const toolbar = h('div', { class: 'stage-toolbar' },
    h('h2', {}, winners.length === 1 ? 'Победитель' : `Победители (${winners.length})`),
    h('div', { class: 'results-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: (e) => copyText(listText(), e.currentTarget) }, icon('copy'), 'Копировать итоги'),
      document.fullscreenEnabled ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: toggleFullscreen }, icon('expand'), 'На весь экран') : null));
  const meta = h('div', { class: 'draw-meta' },
    h('span', {}, `Участвовало: ${pluralN(candidates.length, COMMENT_FORMS)}`),
    h('span', {}, `Время выбора: ${drawnAt.toLocaleString('ru-RU')}`),
    h('span', {}, 'Генератор: crypto.getRandomValues'),
    ...describeFilters(filters).map((f) => h('span', {}, f)));
  winnersBox.replaceChildren(toolbar, ...winners.map((w, i) => winnerCard(w, i)), meta);
  winnersBox.hidden = false;
}

function listText() {
  const lines = winners.map((w, i) => `${i + 1}. ${w.author} — ${commentUrl(data.video.id, w)}`);
  return `Итоги розыгрыша: ${data.video.title}\n${data.video.url}\n\n${lines.join('\n')}\n\nУчаствовало: ${num(candidates.length)}. Выбор: ${drawnAt.toLocaleString('ru-RU')}.`;
}

async function draw() {
  if (drawing || !candidates.length) return;
  const wanted = Math.max(1, Math.min(50, Number(winnersInput.value) || 1, candidates.length));
  drawing = true;
  unlockAudio();
  drawBtn.disabled = true;
  stageEmpty.hidden = true;
  winnersBox.hidden = true;
  winners = [];
  rejected = new Set();
  drawnAt = new Date();
  const selected = [];
  for (let i = 0; i < wanted; i += 1) {
    const exclude = new Set();
    for (const w of selected) { exclude.add(w.id); exclude.add(`a:${authorKey(w)}`); }
    const next = pickOne(exclude) || pickOne(new Set(selected.map((w) => w.id)));
    if (!next) break;
    selected.push(next);
  }
  if (selected.length < wanted) toast(`Удалось выбрать ${pluralN(selected.length, ['победителя', 'победителей', 'победителей'])}: участников меньше, чем мест.`, 'info', 4500);
  // Барабан крутится для первого победителя, остальные появляются следом.
  await spin(selected[0]);
  winners = selected;
  window.kombainGoal?.('picker_draw', { winners: selected.length });
  renderWinners();
  reel.hidden = true;
  celebrate();
  drawing = false;
  updatePool();
  stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function rerollWinner(index) {
  if (drawing) return;
  rejected.add(winners[index].id);
  const exclude = excludeSet();
  const next = pickOne(exclude);
  if (!next) {
    toast('Больше некого выбрать: все подходящие участники уже среди победителей.', 'info', 4500);
    return;
  }
  drawing = true;
  unlockAudio();
  winnersBox.hidden = true;
  await spin(next, 1600);
  winners[index] = next;
  reel.hidden = true;
  renderWinners();
  celebrate();
  drawing = false;
  toast(`Победитель №${index + 1} перевыбран`);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen?.().catch(() => toast('Браузер не разрешил полноэкранный режим.', 'error'));
}

filtersForm.addEventListener('input', updatePool);
filtersForm.addEventListener('change', updatePool);
winnersInput.addEventListener('input', updatePool);
drawBtn.addEventListener('click', draw);
soundBtn.addEventListener('click', () => {
  setSound(!soundOn());
  renderSound();
  if (soundOn()) {
    unlockAudio();
    tick();
  }
});
renderSound();

mountCommentsLoader({
  onReset: () => { picker.hidden = true; },
  onLoaded: (loaded) => {
    data = loaded;
    winners = [];
    winnersBox.hidden = true;
    reel.hidden = true;
    stageEmpty.hidden = false;
    picker.hidden = !loaded.comments.length;
    if (!loaded.comments.length) {
      toast('Комментариев нет: они отключены или их ещё никто не оставил.', 'info', 4500);
      return;
    }
    updatePool();
    const noun = plural(loaded.comments.length, COMMENT_FORMS);
    toast(`Загружено ${num(loaded.comments.length)} ${noun}`);
  },
});
