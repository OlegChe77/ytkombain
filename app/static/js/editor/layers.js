// Отрисовка титров на canvas. Один и тот же холст показывается в превью и уходит на сервер как PNG,
// поэтому клип выглядит ровно так, как в редакторе, — со шрифтами и эмодзи.
import { FONT_MAP, FONTS } from './state.js';

const EMOJI_FONTS = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const MAX_SIDE = 4096;

function fontString(font, px) {
  return `${font.weight} ${px}px "${font.family}", ${EMOJI_FONTS}`;
}

export async function ensureFont(fontId, text = 'АаZz') {
  const font = FONT_MAP[fontId] || FONTS[0];
  try {
    await document.fonts.load(`${font.weight} 40px "${font.family}"`, text);
  } catch { /* если шрифт не загрузился, браузер нарисует запасной */ }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Рисует слой в масштабе итогового кадра шириной frameW. Возвращает canvas.
export function drawLayer(layer, frameW) {
  const font = FONT_MAP[layer.font] || FONTS[0];
  const px = Math.max(8, (layer.size / 100) * frameW);
  const text = layer.upper ? layer.text.toLocaleUpperCase('ru') : layer.text;
  const lines = text.split('\n');
  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');
  ctx.font = fontString(font, px);
  const widths = lines.map((line) => ctx.measureText(line || ' ').width);
  const lineH = px * 1.22;
  const stroke = layer.strokeWidth ? px * layer.strokeWidth : 0;
  const glow = layer.glow ? px * 0.55 : 0;
  const shadow = layer.shadow ? px * 0.07 : 0;
  const padX = layer.bg ? px * 0.45 : 0;
  const padY = layer.bg ? px * 0.22 : 0;
  const margin = Math.ceil(stroke + glow + shadow * 2 + 2);
  const contentW = Math.max(...widths);
  const contentH = lines.length * lineH;
  canvas.width = Math.min(MAX_SIDE, Math.ceil(contentW + padX * 2 + margin * 2));
  canvas.height = Math.min(MAX_SIDE, Math.ceil(contentH + padY * 2 + margin * 2));
  ctx = canvas.getContext('2d');
  ctx.font = fontString(font, px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  if (layer.bg) {
    ctx.fillStyle = layer.bgColor;
    roundRect(ctx, margin, margin, contentW + padX * 2, contentH + padY * 2, Math.min(px * 0.35, (contentH + padY * 2) / 2));
    ctx.fill();
  }
  const cx = canvas.width / 2;
  lines.forEach((line, i) => {
    const y = margin + padY + lineH * (i + 0.5);
    if (glow) {
      ctx.save();
      ctx.shadowColor = layer.color;
      ctx.shadowBlur = glow;
      ctx.fillStyle = layer.color;
      ctx.fillText(line, cx, y);
      ctx.fillText(line, cx, y);
      ctx.restore();
    }
    if (shadow) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, .55)';
      ctx.strokeStyle = 'rgba(0, 0, 0, .55)';
      ctx.lineWidth = stroke * 2;
      if (stroke) ctx.strokeText(line, cx + shadow, y + shadow);
      ctx.fillText(line, cx + shadow, y + shadow);
      ctx.restore();
    }
    if (stroke) {
      ctx.lineWidth = stroke * 2;
      ctx.strokeStyle = layer.strokeColor;
      ctx.strokeText(line, cx, y);
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(line, cx, y);
  });
  return canvas;
}

// Переносит длинную фразу по словам, чтобы субтитры не вылезали за кадр.
export function wrapText(text, maxChars) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}
