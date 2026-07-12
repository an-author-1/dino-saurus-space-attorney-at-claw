/*
 * Low-level pixel graphics for the 256x224 logical framebuffer.
 *
 * THE FOUR-COLOR RULE
 * -------------------
 * Only these four grays may appear in the final frame. `snapToPalette` runs
 * once per frame after everything is drawn and forces every pixel onto the
 * nearest of the four — this cleans up any anti-aliasing the canvas text
 * renderer introduces, so text can be drawn with the normal font engine.
 */

export const W = 256;
export const H = 224;

export const BLACK = "#000000";
export const GRAY = "#707070"; // 112
export const SILVER = "#C8C8C8"; // 200
export const WHITE = "#FFFFFF";

/**
 * Snap a single 0-255 value to the nearest allowed level.
 * Allowed levels: 0, 112, 200, 255 (midpoints: 56 / 156 / 227).
 */
function snapValue(v: number): number {
  if (v < 56) return 0;
  if (v < 156) return 112;
  if (v < 227) return 200;
  return 255;
}

/**
 * Force every pixel of the framebuffer onto one of the four palette grays.
 * Also fully opaque — no alpha survives into the final frame.
 */
export function snapToPalette(ctx: CanvasRenderingContext2D): void {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // Everything we draw is gray already; use luma to be safe if not.
    const luma = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    const s = snapValue(luma);
    d[i] = s;
    d[i + 1] = s;
    d[i + 2] = s;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Count distinct colors in the current frame — used by the P debug key. */
export function paletteCensus(ctx: CanvasRenderingContext2D): void {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const counts = new Map<string, number>();
  for (let i = 0; i < d.length; i += 4) {
    const key = `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const allowed = new Set(["0,0,0,255", "112,112,112,255", "200,200,200,255", "255,255,255,255"]);
  const total = W * H;
  // eslint-disable-next-line no-console
  console.log("%c=== PALETTE CENSUS ===", "font-weight:bold");
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, n] of rows) {
    const ok = allowed.has(k) ? "OK  " : "BAD ";
    // eslint-disable-next-line no-console
    console.log(`${ok} rgba(${k})  ${n}px  ${((100 * n) / total).toFixed(2)}%`);
  }
  const bad = rows.filter(([k]) => !allowed.has(k)).length;
  // eslint-disable-next-line no-console
  console.log(
    bad === 0
      ? `%cFOUR-COLOR RULE: PASS (${rows.length} colors, all allowed)`
      : `%cFOUR-COLOR RULE: FAIL (${bad} illegal colors)`,
    `font-weight:bold;color:${bad === 0 ? "#0a0" : "#a00"}`,
  );
}

/* ---------------------------------------------------------------- text --- */

/** Cell width (letter-spaced monospace); glyphs are ~5px, cell adds air. */
export const CELL = 7;
export const FONT_SIZE = 8;
export const LINE_H = 11;

function setFont(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.font = `bold ${size}px "Courier New", "Courier", monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
}

/**
 * Draw all-caps letter-spaced text one glyph per fixed cell, so spacing is
 * identical across browsers regardless of monospace metrics.
 * Returns the pixel width consumed.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string = WHITE,
  cell: number = CELL,
  size: number = FONT_SIZE,
): number {
  setFont(ctx, size);
  ctx.fillStyle = color;
  const up = text.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    const ch = up[i];
    if (ch !== " ") ctx.fillText(ch, x + i * cell, y);
  }
  return up.length * cell;
}

/** Draw text horizontally centered within [x, x+width). */
export function drawTextCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  width: number,
  y: number,
  color: string = WHITE,
  cell: number = CELL,
  size: number = FONT_SIZE,
): void {
  const w = text.length * cell;
  drawText(ctx, text, Math.round(x + (width - w) / 2), y, color, cell, size);
}

/** Word-wrap to a maximum number of character cells per line. */
export function wrap(text: string, cols: number): string[] {
  const words = text.toUpperCase().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    let w = word;
    // Hard-split any single word longer than the column budget.
    while (w.length > cols) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    if (cur === "") cur = w;
    else if (cur.length + 1 + w.length <= cols) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

/* ---------------------------------------------------------------- boxes --- */

/** Black box, 2px white border, 1px #707070 inner bevel (the house UI style). */
export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = WHITE;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = GRAY;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = BLACK;
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
}

/** A file-folder header tab with centered label, flanked by ruled gray lines. */
export function headerTab(
  ctx: CanvasRenderingContext2D,
  label: string,
): void {
  const tabW = Math.max(label.length * CELL + 20, 90);
  const tabX = Math.round((W - tabW) / 2);
  const tabY = 3;
  const tabH = 14;

  // Decorative ruled lines behind the tab, like the reference art.
  ctx.fillStyle = GRAY;
  for (let ly = tabY + 2; ly < tabY + tabH - 1; ly += 3) {
    ctx.fillRect(6, ly, tabX - 10, 1);
    ctx.fillRect(tabX + tabW + 4, ly, W - (tabX + tabW) - 10, 1);
  }

  panel(ctx, tabX, tabY, tabW, tabH);
  drawTextCentered(ctx, label, tabX, tabW, tabY + 4, WHITE);
}

/** 1px-outlined rectangle in an arbitrary palette color (no fill). */
export function outline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}
