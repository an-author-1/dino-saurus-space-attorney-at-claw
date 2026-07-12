// 96x96 portraits. Try to load /assets/portraits/{id}.png; if absent, generate
// a placeholder from the four palette colors. Either way the pixels are snapped
// to the palette so the four-color rule always holds. The game is fully playable
// with zero asset files present.

import { PAL, RGB, snap, px } from "./gfx";
import { glyph } from "./font";

export const PSIZE = 96;

// Palette index per pixel: 0 black, 1 gray, 2 light, 3 white.
type PortraitBuf = Uint8Array; // length PSIZE*PSIZE

const IDX_COLORS: RGB[] = [PAL.BLACK, PAL.GRAY, PAL.LIGHT, PAL.WHITE];

function colorToIdx(c: RGB): number {
  if (c === PAL.BLACK) return 0;
  if (c === PAL.GRAY) return 1;
  if (c === PAL.LIGHT) return 2;
  return 3;
}

const cache = new Map<string, PortraitBuf>();

function set(buf: PortraitBuf, x: number, y: number, idx: number) {
  if (x < 0 || x >= PSIZE || y < 0 || y >= PSIZE) return;
  buf[y * PSIZE + x] = idx;
}

function fillRect(buf: PortraitBuf, x: number, y: number, w: number, h: number, idx: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(buf, x + i, y + j, idx);
}

// Draw a big letter (scaled 5x7 glyph) into the placeholder buffer.
function bigChar(buf: PortraitBuf, ch: string, x: number, y: number, scale: number, idx: number) {
  const g = glyph(ch);
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if (g[r][col] === "#") fillRect(buf, x + col * scale, y + r * scale, scale, scale, idx);
    }
  }
}

function makePlaceholder(initials: string): PortraitBuf {
  const buf = new Uint8Array(PSIZE * PSIZE); // all black
  // Border: 2px white frame + gray inner bevel.
  for (let i = 0; i < PSIZE; i++) {
    set(buf, i, 0, 3); set(buf, i, 1, 3);
    set(buf, i, PSIZE - 1, 3); set(buf, i, PSIZE - 2, 3);
    set(buf, 0, i, 3); set(buf, 1, i, 3);
    set(buf, PSIZE - 1, i, 3); set(buf, PSIZE - 2, i, 3);
  }
  for (let i = 4; i < PSIZE - 4; i++) {
    set(buf, i, 4, 1); set(buf, i, PSIZE - 5, 1);
    set(buf, 4, i, 1); set(buf, PSIZE - 5, i, 1);
  }

  // Simple geometric snout silhouette (gray), pointing right — dino-ish wedge.
  const cy = 40;
  for (let i = 0; i < 40; i++) {
    const top = cy - Math.floor(i * 0.35);
    const bot = cy + 16 + Math.floor(i * 0.05);
    for (let y = top; y <= bot; y++) set(buf, 26 + i, y, 1);
  }
  // Snout tip nostril + jaw line in light.
  fillRect(buf, 62, 40, 4, 3, 2);
  for (let i = 0; i < 36; i++) set(buf, 26 + i, cy + 17, 2);
  // Eye: white with black pupil.
  fillRect(buf, 34, 30, 7, 7, 3);
  fillRect(buf, 37, 32, 3, 3, 0);

  // Initials, big, lower area, in light.
  const scale = 4;
  const totalW = initials.length * (5 * scale + scale) - scale;
  let sx = Math.floor((PSIZE - totalW) / 2);
  const sy = 64;
  for (const ch of initials) {
    bigChar(buf, ch, sx, sy, scale, 2);
    sx += 5 * scale + scale;
  }
  return buf;
}

// Snap loaded image data into a palette-index buffer.
function fromImageData(id: ImageData): PortraitBuf {
  const buf = new Uint8Array(PSIZE * PSIZE);
  for (let y = 0; y < PSIZE; y++) {
    for (let x = 0; x < PSIZE; x++) {
      const si = (y * id.width + x) * 4;
      const c = snap(id.data[si], id.data[si + 1], id.data[si + 2]);
      buf[y * PSIZE + x] = colorToIdx(c);
    }
  }
  return buf;
}

// Kick off an async load; falls back to placeholder immediately and upgrades
// in place if/when the PNG resolves.
export function loadPortrait(id: string, initials: string) {
  if (!cache.has(id)) cache.set(id, makePlaceholder(initials));
  const image = new Image();
  image.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = PSIZE; c.height = PSIZE;
      const cx = c.getContext("2d");
      if (!cx) return;
      cx.imageSmoothingEnabled = false;
      cx.drawImage(image, 0, 0, PSIZE, PSIZE);
      cache.set(id, fromImageData(cx.getImageData(0, 0, PSIZE, PSIZE)));
    } catch {
      /* keep placeholder */
    }
  };
  image.onerror = () => { /* keep placeholder */ };
  image.src = `/assets/portraits/${id}.png`;
}

// Blit a portrait into the framebuffer (camera-aware, so shakes apply).
export function drawPortrait(id: string, x: number, y: number) {
  const buf = cache.get(id);
  if (!buf) return;
  for (let j = 0; j < PSIZE; j++) {
    for (let i = 0; i < PSIZE; i++) {
      px(x + i, y + j, IDX_COLORS[buf[j * PSIZE + i]]);
    }
  }
}
