/*
 * Portrait handling. We TRY to load /assets/portraits/{id}.png (96x96). If the
 * file is missing (the default — the game ships with zero assets), we draw a
 * procedural placeholder: a framed box with the character's initials and a
 * simple geometric snout silhouette, in the four palette colors only.
 *
 * Each placeholder is pre-rendered once to an offscreen 96x96 canvas so it can
 * be blitted (and shaken) cheaply every frame.
 */

import { BLACK, GRAY, SILVER, WHITE, panel } from "./gfx";

export type Who = "dino_saurus" | "pterax" | "judge";

const SIZE = 96;

interface Portrait {
  canvas: HTMLCanvasElement;
  loaded: boolean; // true once a real PNG replaced the placeholder
}

const META: Record<Who, { initials: string }> = {
  dino_saurus: { initials: "DS" },
  pterax: { initials: "PX" },
  judge: { initials: "JT" },
};

export class Portraits {
  private map = new Map<Who, Portrait>();

  constructor() {
    (Object.keys(META) as Who[]).forEach((who) => {
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const c = canvas.getContext("2d")!;
      c.imageSmoothingEnabled = false;
      drawPlaceholder(c, who);
      this.map.set(who, { canvas, loaded: false });
      this.tryLoad(who);
    });
  }

  private tryLoad(who: Who): void {
    const img = new Image();
    img.onload = () => {
      const p = this.map.get(who)!;
      const c = p.canvas.getContext("2d")!;
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, SIZE, SIZE);
      c.drawImage(img, 0, 0, SIZE, SIZE);
      p.loaded = true;
    };
    img.onerror = () => {
      /* keep the placeholder — expected when no asset files are present */
    };
    img.src = `/assets/portraits/${who}.png`;
  }

  /** Blit a portrait into the framebuffer at (x, y). */
  draw(ctx: CanvasRenderingContext2D, who: Who, x: number, y: number): void {
    const p = this.map.get(who);
    if (p) ctx.drawImage(p.canvas, x, y);
  }
}

/* --------------------------------------------------------- placeholders --- */

function px(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}

/** A cheap ordered-dither fill so the silhouettes read as shaded, not flat. */
function dither(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  a: string,
  b: string,
) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      c.fillStyle = (i + j) % 2 === 0 ? a : b;
      c.fillRect(x + i, y + j, 1, 1);
    }
  }
}

function drawPlaceholder(c: CanvasRenderingContext2D, who: Who): void {
  // Frame: reuse the house panel style so placeholders match the UI.
  panel(c, 0, 0, SIZE, SIZE);
  const cx = SIZE / 2;

  if (who === "pterax") {
    // Pteranodon: swept-back crest + long triangular beak.
    // Head
    dither(c, 30, 26, 34, 26, SILVER, GRAY);
    // Crest (points up-back)
    px(c, 34, 18, 4, 10, SILVER);
    for (let i = 0; i < 10; i++) px(c, 36 + i, 16 - i + 6, 3, 3, SILVER);
    // Eye
    px(c, 52, 32, 5, 5, WHITE);
    px(c, 54, 34, 2, 2, BLACK);
    // Long beak jutting forward-down
    for (let i = 0; i < 22; i++) px(c, 62 + i, 40 + Math.floor(i / 2), 4 - (i % 2), 4, SILVER);
    // Neck / suit shoulders
    dither(c, 24, 60, 48, 30, GRAY, BLACK);
    px(c, 44, 58, 8, 20, SILVER); // collar/tie hint
  } else if (who === "judge") {
    // Triceratops: broad frill + two big horns.
    // Frill
    dither(c, 22, 22, 52, 22, SILVER, GRAY);
    px(c, 20, 24, 3, 18, WHITE);
    px(c, 73, 24, 3, 18, WHITE);
    // Face
    dither(c, 34, 40, 28, 26, SILVER, GRAY);
    // Horns
    for (let i = 0; i < 10; i++) px(c, 38 - Math.floor(i / 3), 40 - i, 3, 2, WHITE);
    for (let i = 0; i < 10; i++) px(c, 58 + Math.floor(i / 3), 40 - i, 3, 2, WHITE);
    // Nose horn
    px(c, 46, 58, 4, 6, WHITE);
    // Eyes (stern)
    px(c, 40, 48, 5, 3, BLACK);
    px(c, 52, 48, 5, 3, BLACK);
    // Robes
    dither(c, 26, 66, 44, 24, GRAY, BLACK);
  } else {
    // dino_saurus (T-rex attorney): boxy jaw + big teeth + suit.
    dither(c, 28, 24, 40, 30, SILVER, GRAY);
    // Snout jutting right
    dither(c, 60, 34, 22, 16, SILVER, GRAY);
    // Teeth
    for (let i = 0; i < 6; i++) px(c, 62 + i * 3, 48, 2, 4, WHITE);
    // Eye
    px(c, 40, 30, 6, 6, WHITE);
    px(c, 42, 32, 3, 3, BLACK);
    // Suit shoulders + tie
    dither(c, 22, 62, 52, 28, GRAY, BLACK);
    px(c, 44, 60, 8, 24, SILVER);
    px(c, 46, 64, 4, 16, WHITE);
  }

  // Initials plate, bottom-left, so a missing asset is legible.
  const initials = META[who].initials;
  panel(c, 4, SIZE - 16, 20, 12);
  c.fillStyle = WHITE;
  c.font = 'bold 8px "Courier New", monospace';
  c.textBaseline = "top";
  c.fillText(initials[0], 7, SIZE - 14);
  c.fillText(initials[1], 14, SIZE - 14);
  void cx;
}
