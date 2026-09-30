// Панели настроек: кадр, титры, звук, фишки.
import { $, $$, h, icon } from '../core/dom.js';
import { post } from '../core/api.js';
import { toast } from '../core/ui.js';
import { timecode } from '../core/format.js';
import { EMOJI, FONTS, FONT_MAP, PRESETS, layerTimes, newId, outDuration } from './state.js';
import { ensureFont, wrapText } from './layers.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const STYLE_FIELDS = ['font', 'size', 'color', 'strokeColor', 'strokeWidth', 'bg', 'bgColor', 'shadow', 'glow', 'upper', 'anim'];
const WRAP = { '9:16': 24, '4:5': 28, '1:1': 30, '16:9': 44 };
const hex6 = (color) => (color || '#000000').slice(0, 7);

function pressGroup(buttons, attr, value) {
  for (const btn of buttons) btn.setAttribute('aria-pressed', String(btn.dataset[attr] === String(value)));
}

export function createPanels(store, root, preview, { getRaw }) {
  // ---- Вкладки ----
  const tabs = $$('.ed-tabs [role="tab"]', root);
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) {
        t.setAttribute('aria-selected', String(t === tab));
        $(`#${t.getAttribute('aria-controls')}`, root).hidden = t !== tab;
      }
    });
  }

  // ---- Кадр ----
  const formatBtns = $$('[data-format]', root);
  const fitBtns = $$('[data-fit]', root);
  const bgBtns = $$('[data-bg]', root);
  const bgColor = $('#ed-bg-color', root);
  const zoom = $('#ed-zoom', root);
  const zoomOut = $('#ed-zoom-out', root);
  const speedBtns = $$('[data-speed]', root);
  const fadeIn = $('#tab-frame [name="fade_in"]', root);
  const fadeOut = $('#tab-frame [name="fade_out"]', root);

  formatBtns.forEach((btn) => btn.addEventListener('click', () => {
    const s = store.get();
    // Субтитры переносим заново: в узком кадре строка должна быть короче.
    const layers = s.layers.map((l) => (l.kind === 'subtitle' ? { ...l, text: wrapText(l.source, WRAP[btn.dataset.format]) } : l));
    store.set({ format: btn.dataset.format, layers });
  }));
  fitBtns.forEach((btn) => btn.addEventListener('click', () => store.set({ fit: btn.dataset.fit, zoom: 1, panX: 0.5, panY: 0.5 })));
  bgBtns.forEach((btn) => btn.addEventListener('click', () => store.set({ background: btn.dataset.bg })));
  bgColor.addEventListener('input', () => store.set({ bgColor: bgColor.value, background: 'color' }));
  zoom.addEventListener('input', () => store.set({ zoom: Number(zoom.value) / 100 }));
  $('#ed-center', root).addEventListener('click', () => store.set({ panX: 0.5, panY: 0.5 }));
  speedBtns.forEach((btn) => btn.addEventListener('click', () => store.set({ speed: Number(btn.dataset.speed) })));
  fadeIn.addEventListener('change', () => store.set({ fadeIn: fadeIn.checked }));
  fadeOut.addEventListener('change', () => store.set({ fadeOut: fadeOut.checked }));

  function renderFrame(s) {
    for (const btn of formatBtns) btn.setAttribute('aria-checked', String(btn.dataset.format === s.format));
    pressGroup(fitBtns, 'fit', s.fit);
    pressGroup(bgBtns, 'bg', s.background);
    $('#bg-row', root).hidden = s.fit === 'cover' && s.zoom >= 1;
    zoom.value = String(Math.round(s.zoom * 100));
    zoomOut.textContent = `${Math.round(s.zoom * 100)}%`;
    speedBtns.forEach((btn) => btn.classList.toggle('is-active', Number(btn.dataset.speed) === s.speed));
  }

  // ---- Титры ----
  const list = $('#layer-list', root);
  const editor = $('#layer-editor', root);
  const fontSelect = $('#ed-font', root);
  const subsHint = $('#ed-subs-hint', root);
  fontSelect.append(...FONTS.map((f) => h('option', { value: f.id, style: { 'font-family': `"${f.family}"` } }, f.name)));

  const defaultY = () => ({ '9:16': 0.3, '4:5': 0.25, '1:1': 0.2, '16:9': 0.2 }[store.get().format]);

  async function addLayer(style, text, extra = {}) {
    const { title, ...props } = style;
    await ensureFont(props.font, text);
    const layer = { id: newId(), kind: 'text', text, x: 0.5, y: defaultY(), start: 0, end: null, ...props, ...extra };
    const s = store.get();
    store.set({ layers: [...s.layers, layer], selected: layer.id });
    if (text !== extra.text) $('textarea', editor)?.focus();
    return layer;
  }

  const presetBox = $('#ed-presets', root);
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (key === 'subtitle') continue;
    const font = FONT_MAP[preset.font];
    const btn = h('button', {
      type: 'button', class: 'preset', title: `Стиль «${preset.title}»`,
      style: { '--pc': preset.color, '--ps': preset.strokeWidth ? preset.strokeColor : 'transparent', '--pb': preset.bg ? hex6(preset.bgColor) : 'transparent', 'font-family': `"${font.family}"`, 'font-weight': String(font.weight) },
    }, h('span', {}, 'Аа'), h('small', {}, preset.title));
    btn.addEventListener('click', async () => {
      const s = store.get();
      const selected = s.layers.find((l) => l.id === s.selected);
      const style = Object.fromEntries(STYLE_FIELDS.map((f) => [f, preset[f]]));
      if (selected) {
        await ensureFont(style.font, selected.text);
        updateLayer(selected.id, style);
      } else {
        addLayer(preset, 'Ваш текст');
      }
    });
    presetBox.append(btn);
  }

  const emojiBox = $('#ed-emoji', root);
  for (const emoji of EMOJI) {
    const btn = h('button', { type: 'button', class: 'emoji-btn', 'aria-label': `Добавить стикер ${emoji}` }, emoji);
    btn.addEventListener('click', () => addLayer(PRESETS.classic, emoji, {
      text: emoji, size: 16, strokeWidth: 0, shadow: false, anim: 'pop', y: 0.5, x: 0.5 + (Math.random() - 0.5) * 0.3,
    }));
    emojiBox.append(btn);
  }

  $('#ed-add-text', root).addEventListener('click', () => addLayer(PRESETS.classic, 'Ваш текст'));

  function updateLayer(id, patch) {
    const s = store.get();
    store.set({ layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }

  function removeLayer(id) {
    const s = store.get();
    store.set({ layers: s.layers.filter((l) => l.id !== id), selected: s.selected === id ? null : s.selected });
  }

  function renderList(s) {
    const subs = s.layers.filter((l) => l.kind === 'subtitle');
    const rows = s.layers.filter((l) => l.kind !== 'subtitle').map((layer) => {
      const t = layerTimes(layer, s);
      const row = h('li', { class: `layer-row${s.selected === layer.id ? ' is-selected' : ''}` },
        h('button', { type: 'button', class: 'layer-pick', style: { 'font-family': `"${FONT_MAP[layer.font]?.family}"` } },
          h('span', {}, layer.text.split('\n')[0] || 'Пустой текст'),
          h('small', {}, `${timecode(t.start)}–${layer.end == null ? 'конец' : timecode(t.end)}`)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Удалить титр' }, icon('trash')));
      row.firstChild.addEventListener('click', () => store.set({ selected: layer.id }));
      row.lastChild.addEventListener('click', () => removeLayer(layer.id));
      return row;
    });
    if (subs.length) {
      const selected = subs.some((l) => l.id === s.selected);
      const row = h('li', { class: `layer-row${selected ? ' is-selected' : ''}` },
        h('button', { type: 'button', class: 'layer-pick' }, h('span', {}, `Субтитры: ${subs.length} фраз`), h('small', {}, 'двигаются вместе')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Удалить все субтитры' }, icon('trash')));
      row.firstChild.addEventListener('click', () => store.set({ selected: subs[0].id }));
      row.lastChild.addEventListener('click', () => store.set({ layers: s.layers.filter((l) => l.kind !== 'subtitle'), selected: selected ? null : s.selected }));
      rows.push(row);
    }
    list.replaceChildren(...rows);
    if (!rows.length) list.append(h('li', { class: 'layer-empty' }, 'Титров пока нет. Добавьте текст, стикер или субтитры из видео.'));
  }

  function renderEditor(s) {
    const layer = s.layers.find((l) => l.id === s.selected);
    editor.hidden = !layer;
    if (!layer) return;
    const f = editor.elements;
    if (document.activeElement !== f.text) f.text.value = layer.text;
    f.font.value = layer.font;
    f.size.value = String(layer.size);
    f.color.value = hex6(layer.color);
    f.strokeColor.value = hex6(layer.strokeColor);
    f.bgColor.value = hex6(layer.bgColor);
    f.strokeWidth.value = String(layer.strokeWidth);
    for (const key of ['bg', 'shadow', 'glow', 'upper']) f[key].checked = Boolean(layer[key]);
    f.anim.value = layer.anim;
    const isSub = layer.kind === 'subtitle';
    const t = layerTimes(layer, s);
    if (document.activeElement !== f.start) f.start.value = t.start.toFixed(1);
    if (document.activeElement !== f.end) f.end.value = layer.end == null && !isSub ? '' : t.end.toFixed(1);
    f.start.disabled = f.end.disabled = isSub;
    $('[data-out="size"]', editor).textContent = `${layer.size}%`;
    $('[data-out="strokeWidth"]', editor).textContent = `${Math.round(layer.strokeWidth * 100)}%`;
    $('[data-act="style-all"]', editor).hidden = !isSub;
    $('[data-act="from-now"]', editor).hidden = isSub;
    $('[data-act="to-now"]', editor).hidden = isSub;
    $('[data-act="duplicate"]', editor).hidden = isSub;
  }

  editor.addEventListener('input', async (event) => {
    const s = store.get();
    const layer = s.layers.find((l) => l.id === s.selected);
    const field = event.target;
    if (!layer || !field.name) return;
    let value = field.type === 'checkbox' ? field.checked : field.value;
    if (field.type === 'range') value = Number(value);
    if (field.name === 'start' || field.name === 'end') {
      const parsed = value === '' ? null : Number(String(value).replace(',', '.'));
      if (value !== '' && Number.isNaN(parsed)) return;
      value = parsed == null ? null : clamp(parsed, 0, outDuration(s));
      if (field.name === 'start') value = value ?? 0;
    }
    if (field.name === 'text' && layer.kind === 'subtitle') updateLayer(layer.id, { text: value, source: value.replace(/\n/g, ' ') });
    else updateLayer(layer.id, { [field.name]: value });
    if (field.name === 'font' || field.name === 'text') await ensureFont(field.name === 'font' ? value : layer.font, field.name === 'text' ? value : layer.text);
  });
  editor.addEventListener('submit', (event) => event.preventDefault());
  editor.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    const s = store.get();
    const layer = s.layers.find((l) => l.id === s.selected);
    if (!act || !layer) return;
    const now = clamp(preview.outTime(), 0, outDuration(s));
    if (act === 'from-now') updateLayer(layer.id, { start: +now.toFixed(2) });
    if (act === 'to-now') updateLayer(layer.id, { end: +Math.max(now, (layer.start || 0) + 0.3).toFixed(2) });
    if (act === 'delete') removeLayer(layer.id);
    if (act === 'duplicate') {
      const copy = { ...layer, id: newId(), y: clamp(layer.y + 0.07, 0, 1) };
      store.set({ layers: [...s.layers, copy], selected: copy.id });
    }
    if (act === 'style-all') {
      const style = Object.fromEntries(STYLE_FIELDS.map((f) => [f, layer[f]]));
      store.set({ layers: s.layers.map((l) => (l.kind === 'subtitle' ? { ...l, ...style } : l)) });
      toast('Стиль применён ко всем субтитрам');
    }
  });

  // Субтитры из самого видео
  $('#ed-subs', root).addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    subsHint.className = 'field-hint';
    subsHint.textContent = 'Ищем субтитры…';
    try {
      const raw = getRaw();
      const info = await post('/api/video/info', { url: raw });
      const manual = info.captions.filter((c) => c.kind === 'manual');
      const track = manual.find((c) => c.lang === info.language) || manual[0]
        || info.captions.find((c) => c.kind === 'auto');
      if (!track) throw new Error('У этого видео нет субтитров.');
      subsHint.textContent = `Загружаем «${track.name}»…`;
      const data = await post('/api/transcript', { url: raw, track: track.key });
      const s = store.get();
      const phrases = data.segments.filter((seg) => seg.end > s.start && seg.start < s.end).slice(0, 55);
      if (!phrases.length) throw new Error('В выбранном отрезке нет фраз с субтитрами.');
      const style = Object.fromEntries(STYLE_FIELDS.map((f) => [f, PRESETS.subtitle[f]]));
      await ensureFont(style.font, phrases.map((p) => p.text).join(' '));
      const y = { '9:16': 0.7, '4:5': 0.78, '1:1': 0.8, '16:9': 0.86 }[s.format]; // выше зоны подписи Shorts
      const subs = phrases.map((p) => ({
        id: newId(), kind: 'subtitle', text: wrapText(p.text, WRAP[s.format]), source: p.text,
        srcStart: Math.max(p.start, s.start), srcEnd: Math.min(p.end, s.end), x: 0.5, y, ...style,
      }));
      store.set({ layers: [...s.layers.filter((l) => l.kind !== 'subtitle'), ...subs], selected: subs[0].id });
      subsHint.textContent = `Добавлено фраз: ${subs.length} (${track.name}). Они привязаны ко времени видео.`;
    } catch (error) {
      subsHint.className = 'field-hint is-error';
      subsHint.textContent = error.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Звук ----
  const volume = $('#ed-volume', root);
  const volumeOut = $('#ed-volume-out', root);
  const mute = $('#ed-mute', root);
  const musicInput = $('#ed-music', root);
  const drop = $('#ed-drop', root);
  const musicInfo = $('#ed-music-info', root);
  const musicControls = $('#ed-music-controls', root);
  const mvol = $('#ed-mvol', root);
  const mvolOut = $('#ed-mvol-out', root);
  const moffset = $('#ed-moffset', root);
  const mfade = $('#ed-mfade', root);
  let lastVolume = 1;

  volume.addEventListener('input', () => store.set({ volume: Number(volume.value) / 100 }));
  mute.addEventListener('click', () => {
    const s = store.get();
    if (s.volume > 0) {
      lastVolume = s.volume;
      store.set({ volume: 0 });
    } else {
      store.set({ volume: lastVolume || 1 });
    }
  });
  mvol.addEventListener('input', () => store.set({ musicVolume: Number(mvol.value) / 100 }));
  moffset.addEventListener('change', () => {
    const value = Math.max(0, Number(moffset.value.replace(',', '.')) || 0);
    moffset.value = String(value);
    store.set({ musicOffset: value });
  });
  mfade.addEventListener('change', () => store.set({ musicFade: mfade.checked }));

  async function uploadMusic(file) {
    const s = store.get();
    if (!file) return;
    if (file.size > s.maxAudioMb * 1024 * 1024) {
      toast(`Файл больше ${s.maxAudioMb} МБ — выберите трек поменьше.`, 'error', 4500);
      return;
    }
    musicInfo.hidden = false;
    musicInfo.replaceChildren(h('span', {}, `Загружаем «${file.name}»…`));
    try {
      const response = await fetch(`/api/editor/${s.session}/audio`, {
        method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || 'Не удалось загрузить трек.');
      if (s.music?.url) URL.revokeObjectURL(s.music.url);
      const url = URL.createObjectURL(file);
      store.set({ music: { name: file.name, duration: data.duration, url } });
      preview.setMusic(url);
      toast('Музыка добавлена');
    } catch (error) {
      musicInfo.replaceChildren(h('span', { class: 'is-error' }, error.message));
    }
  }

  musicInput.addEventListener('change', () => uploadMusic(musicInput.files[0]));
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-dragover');
    uploadMusic(event.dataTransfer.files[0]);
  });

  function renderAudio(s) {
    volume.value = String(Math.round(s.volume * 100));
    volumeOut.textContent = `${Math.round(s.volume * 100)}%`;
    mute.setAttribute('aria-pressed', String(s.volume === 0));
    mute.replaceChildren(icon(s.volume === 0 ? 'volume' : 'volume-off'), s.volume === 0 ? 'Вернуть звук видео' : 'Выключить звук видео');
    mvol.value = String(Math.round(s.musicVolume * 100));
    mvolOut.textContent = `${Math.round(s.musicVolume * 100)}%`;
    musicControls.hidden = !s.music;
    if (s.music) {
      const remove = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Убрать музыку' }, icon('trash'));
      remove.addEventListener('click', async () => {
        await fetch(`/api/editor/${s.session}/audio`, { method: 'DELETE' }).catch(() => {});
        URL.revokeObjectURL(s.music.url);
        store.set({ music: null });
        preview.setMusic(null);
        musicInput.value = '';
      });
      musicInfo.hidden = false;
      musicInfo.replaceChildren(icon('music'), h('span', {}, h('strong', {}, s.music.name), h('small', {}, `длительность ${timecode(s.music.duration)}`)), remove);
    } else if (!musicInfo.querySelector('.is-error')) {
      musicInfo.hidden = true;
    }
  }

  // ---- Фишки ----
  const progressBtns = $$('[data-progress]', root);
  const progressColor = $('#ed-progress-color', root);
  const safe = $('#ed-safe', root);
  progressBtns.forEach((btn) => btn.addEventListener('click', () => store.set({ progress: btn.dataset.progress })));
  progressColor.addEventListener('input', () => store.set({ progressColor: progressColor.value, progress: store.get().progress === 'none' ? 'bottom' : store.get().progress }));
  safe.addEventListener('change', () => {
    store.set({ safeZones: safe.checked });
    if (safe.checked && store.get().format !== '9:16') toast('Зоны интерфейса показываются для формата 9:16.', 'info');
  });

  function renderExtra(s) {
    pressGroup(progressBtns, 'progress', s.progress);
  }

  store.subscribe((s, patch) => {
    renderFrame(s);
    if ('layers' in patch || 'selected' in patch || 'start' in patch || 'end' in patch || 'speed' in patch) {
      renderList(s);
      renderEditor(s);
    }
    if ('volume' in patch || 'music' in patch || 'musicVolume' in patch) renderAudio(s);
    renderExtra(s);
  });
  const s = store.get();
  renderFrame(s);
  renderList(s);
  renderEditor(s);
  renderAudio(s);
  renderExtra(s);
}
