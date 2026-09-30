// Лёгкие графики без библиотек: область (пересматриваемые моменты) и гистограмма (динамика комментариев).
import { h, svg } from './dom.js';

function tooltip(wrap) {
  const tip = h('div', { class: 'chart-tip', role: 'status', hidden: true });
  wrap.append(tip);
  return {
    show(x, lines) {
      tip.replaceChildren(...lines.map((line, i) => (i === 0 ? h('strong', {}, line) : h('span', {}, line))));
      tip.hidden = false;
      const max = wrap.clientWidth - tip.offsetWidth - 4;
      tip.style.left = `${Math.max(4, Math.min(max, x - tip.offsetWidth / 2))}px`;
    },
    hide() { tip.hidden = true; },
  };
}

// points: [{t, v}] — время в секундах и значение 0..1.
export function areaChart(points, { format, describe, onPick } = {}) {
  const wrap = h('div', { class: 'chart' });
  const n = points.length;
  const xs = points.map((_, i) => (i / Math.max(1, n - 1)) * 100);
  const ys = points.map((p) => 40 - p.v * 36);
  const line = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${ys[i].toFixed(2)}`).join(' ');
  const chart = svg('svg', { viewBox: '0 0 100 40', preserveAspectRatio: 'none', class: 'heatmap', role: 'img', 'aria-label': describe || '' });
  chart.append(
    svg('path', { d: `${line} L100,40 L0,40 Z`, fill: 'currentColor', 'fill-opacity': '.16' }),
    svg('path', { d: line, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }),
  );
  const cursor = h('div', { class: 'chart-cursor', hidden: true });
  wrap.append(chart, cursor);
  const tip = tooltip(wrap);
  const pick = (event) => {
    const rect = chart.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const index = Math.round(ratio * (n - 1));
    const x = (index / Math.max(1, n - 1)) * rect.width;
    cursor.hidden = false;
    cursor.style.left = `${x}px`;
    tip.show(x, [format(points[index].t), `интерес ${Math.round(points[index].v * 100)}%`]);
    return points[index];
  };
  chart.addEventListener('pointermove', pick);
  chart.addEventListener('pointerleave', () => { cursor.hidden = true; tip.hide(); });
  if (onPick) chart.addEventListener('click', (event) => onPick(pick(event)));
  return wrap;
}

// buckets: [{value, title, note}]
export function histogram(buckets, { describe } = {}) {
  const wrap = h('div', { class: 'chart' });
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const bars = h('div', { class: 'histogram', role: 'img', 'aria-label': describe || '' },
    ...buckets.map((b) => h('span', { style: { height: `${(b.value / max) * 100}%` }, 'data-title': b.title, 'data-note': b.note })));
  wrap.append(bars);
  const tip = tooltip(wrap);
  bars.addEventListener('pointerover', (event) => {
    const bar = event.target.closest('span');
    if (!bar) return;
    tip.show(bar.offsetLeft + bar.offsetWidth / 2, [bar.dataset.title, bar.dataset.note]);
  });
  bars.addEventListener('pointerleave', () => tip.hide());
  return wrap;
}
