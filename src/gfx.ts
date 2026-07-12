// Framebuffer graphics. Every pixel we write is one of the four palette colors,
// so the final frame can never contain any other value — no alpha, no AA.

import { GW, GH, glyph, normalize } from "./font";

export const W = 256;
export const H = 224;

export type RGB = [number, number, number];

export const PAL = {
  BLACK: [0x00, 0x00, 0x00] as RGB,
  GRAY: [0x70, 0x70, 0x70] as RGB,
  LIGHT: [0xc8, 0xc8, 0xc8] as RGB,
  WHITE: [0xff, 0xff, 0xff] as RGB,
};

const PALETTE: RGB[] = [PAL.BLACK, PAL.GRAY, PAL.LIGHT, PAL.WHITE];

let img: ImageData;
let data: Uint8ClampedArray;
let camX = 0;
let camY = 0;

export function setCam(x: number, y: number) {
  camX = Math.round(x);
  camY = Math.round(y);
}

export function initGfx(ctx: CanvasRenderingContext2D) {
  img = ctx.createImageData(W, H);
  data = img.data;
}

export function present(ctx: CanvasRenderingContext2D) {
  ctx.putImageData(img, 0, 0);
}

function rawPixel(x: number, y: number, c: RGB) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  data[i] = c[0];
  data[i + 1] = c[1];
  data[i + 2] = c[2];
  data[i + 3] = 255;
}

// Camera-aware pixel (subject to screen shake).
export function px(x: number, y: number, c: RGB) {
  rawPixel((x + camX) | 0, (y + camY) | 0, c);
}

export function clear(c: RGB) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  }
}

export function rect(x: number, y: number, w: number, h: number, c: RGB) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c);
}

export function frame(x: number, y: number, w: number, h: number, c: RGB, t = 1) {
  for (let k = 0; k < t; k++) {
    for (let i = 0; i < w; i++) {
      px(x + i, y + k, c);
      px(x + i, y + h - 1 - k, c);
    }
    for (let j = 0; j < h; j++) {
      px(x + k, y + j, c);
      px(x + w - 1 - k, y + j, c);
    }
  }
}

// Standard UI box: black fill, 2px white border, 1px gray inner bevel.
export function uiBox(x: number, y: number, w: number, h: number) {
  rect(x, y, w, h, PAL.BLACK);
  frame(x, y, w, h, PAL.WHITE, 2);
  frame(x + 3, y + 3, w - 6, h - 6, PAL.GRAY, 1);
}

export function line(x0: number, y0: number, x1: number, y1: number, c: RGB) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    px(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

export const ADV = 6; // per-character advance (5px glyph + 1px letter spacing)

export function drawChar(ch: string, x: number, y: number, c: RGB) {
  const g = glyph(ch);
  for (let r = 0; r < GH; r++) {
    const row = g[r];
    for (let col = 0; col < GW; col++) {
      if (row[col] === "#") px(x + col, y + r, c);
    }
  }
}

export function textWidth(s: string): number {
  return s.length * ADV;
}

export function drawText(s: string, x: number, y: number, c: RGB) {
  const t = normalize(s);
  let cx = x;
  for (const ch of t) {
    drawChar(ch, cx, y, c);
    cx += ADV;
  }
}

export function drawTextCentered(s: string, cx: number, y: number, c: RGB) {
  drawText(s, cx - (textWidth(normalize(s)) >> 1), y, c);
}

// Word-wrap into lines no wider than maxChars.
export function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of normalize(text).split("\n")) {
    const words = para.split(" ");
    let cur = "";
    for (const w of words) {
      if (cur === "") cur = w;
      else if ((cur + " " + w).length <= maxChars) cur += " " + w;
      else { out.push(cur); cur = w; }
    }
    out.push(cur);
  }
  return out;
}

// Snap an arbitrary RGB to the nearest of the four palette entries.
export function snap(r: number, g: number, b: number): RGB {
  let best = PALETTE[0];
  let bestD = Infinity;
  for (const p of PALETTE) {
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// Debug: count how many distinct colors are present in the current frame.
export function paletteCensus() {
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
