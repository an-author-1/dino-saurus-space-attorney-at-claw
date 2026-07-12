/*
 * Portrait handling (M2 expression-loading convention).
 *
 * The game ships with ZERO asset files, so the procedural placeholders below
 * ARE the real deal and must read as recognizable dinosaurs at a glance. When
 * PNGs *are* present we frame-swap to them (no compositing).
 *
 * FALLBACK CHAIN, per (character, expression), evaluated every frame:
 *   /assets/portraits/{character}/{expression}.png
 *     -> /assets/portraits/{character}/neutral.png
 *       -> procedural placeholder for that character/expression
 *
 * TALK CYCLE: while opts.talking is true we alternate ~120ms between the base
 * frame and {expression}_talk.png (if it loads). With no PNG we nudge the
 * placeholder's jaw open on alternate frames instead.
 *
 * Everything is drawn in the four palette colors only (BLACK / GRAY / SILVER /
 * WHITE). Loads and rendered placeholders are cached to offscreen 96x96
 * canvases so per-frame drawing is a single cheap blit.
 */

import { BLACK, GRAY, SILVER, WHITE, panel } from "./gfx";

/** The three characters we ship hand-drawn art for. */
export type Who = "dino_saurus" | "pterax" | "judge";

const SIZE = 96;
const KNOWN: Who[] = ["dino_saurus", "pterax", "judge"];

/** How long each half of the 2-frame talk cycle is shown, in ms. */
const TALK_MS = 120;

/** Cache entry for an attempted PNG load. */
interface PngEntry {
  state: "loading" | "ok" | "fail";
  canvas?: HTMLCanvasElement; // present only when state === "ok"
}

class Portraits {
  /** Loaded PNGs, keyed "character/expression" (expression may end "_talk"). */
  private pngs = new Map<string, PngEntry>();
  /** Pre-rendered placeholders, keyed "character:expression:mouthOpen". */
  private placeholders = new Map<string, HTMLCanvasElement>();

  constructor() {
    // Pre-render the three known neutral placeholders so first draw is cheap,
    // and kick off their neutral PNG loads (harmless 404s when assets absent).
    for (const who of KNOWN) {
      this.getPlaceholder(who, "neutral", false);
      this.getPng(who, "neutral");
    }
  }

  /**
   * Blit a portrait at (x, y).
   * @param character  id ("dino_saurus" | "pterax" | "judge" | any witness id)
   * @param opts.expression  defaults to "neutral"; unknown -> neutral art
   * @param opts.talking     drives the 2-frame talk cycle
   */
  draw(
    ctx: CanvasRenderingContext2D,
    character: string,
    x: number,
    y: number,
    opts: { expression?: string; talking?: boolean } = {},
  ): void {
    const expression = opts.expression || "neutral";
    const talking = !!opts.talking;
    const phase = talking && this.talkPhase(); // true on the "open"/"_talk" half

    // 1) Preferred: the expression's own PNG.
    let frame = this.getPng(character, expression);

    // 2) Talk frame-swap: only when both base and _talk PNGs are loaded.
    if (talking && frame) {
      const talk = this.getPng(character, `${expression}_talk`);
      if (talk) frame = phase ? talk : frame;
    }

    // 3) PNG fallback: the character's neutral portrait.
    if (!frame && expression !== "neutral") {
      frame = this.getPng(character, "neutral");
    }

    // 4) Procedural placeholder. With no _talk asset we nudge the jaw open on
    //    the talk half so placeholder characters still look like they speak.
    if (!frame) {
      frame = this.getPlaceholder(character, expression, talking && phase);
    }

    ctx.drawImage(frame, x, y);
  }

  /** Which half of the talk cycle we're in right now. */
  private talkPhase(): boolean {
    return Math.floor(performance.now() / TALK_MS) % 2 === 1;
  }

  /**
   * Return a loaded PNG canvas, or null while loading / on failure. The first
   * request for a key kicks off the async load; results (including failures)
   * are cached so we never refetch every frame.
   */
  private getPng(character: string, expression: string): HTMLCanvasElement | null {
    const key = `${character}/${expression}`;
    let entry = this.pngs.get(key);
    if (!entry) {
      entry = { state: "loading" };
      this.pngs.set(key, entry);
      const e = entry;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const cc = canvas.getContext("2d")!;
        cc.imageSmoothingEnabled = false;
        cc.drawImage(img, 0, 0, SIZE, SIZE);
        e.canvas = canvas;
        e.state = "ok";
      };
      img.onerror = () => {
        e.state = "fail"; // expected when the game ships with no assets
      };
      img.src = `/assets/portraits/${key}.png`;
    }
    return entry.state === "ok" ? entry.canvas! : null;
  }

  /** Return (rendering + caching once) a procedural placeholder canvas. */
  private getPlaceholder(
    character: string,
    expression: string,
    mouthOpen: boolean,
  ): HTMLCanvasElement {
    const key = `${character}:${expression}:${mouthOpen ? 1 : 0}`;
    let canvas = this.placeholders.get(key);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const cc = canvas.getContext("2d")!;
      cc.imageSmoothingEnabled = false;
      drawPlaceholder(cc, character, expression, mouthOpen);
      this.placeholders.set(key, canvas);
    }
    return canvas;
  }
}

export { Portraits };

/* ===================================================== drawing helpers === */

function px(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}

/** Cheap 2px ordered-dither fill so silhouettes read as shaded, not flat. */
function dither(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  a: string,
  b: string,
): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      c.fillStyle = (i + j) % 2 === 0 ? a : b;
      c.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/* ======================================================== placeholders === */

/**
 * Render one 96x96 placeholder. Frame first (house panel style), then the
 * character silhouette, then per-expression touch-ups.
 */
function drawPlaceholder(
  c: CanvasRenderingContext2D,
  character: string,
  expression: string,
  mouthOpen: boolean,
): void {
  panel(c, 0, 0, SIZE, SIZE); // 2px white border, 1px gray bevel, black interior

  switch (character) {
    case "dino_saurus":
      drawTrex(c, mouthOpen);
      applyExpression(c, expression, 46, 18); // temple above the eye/brow
      break;
    case "pterax":
      drawPterax(c, mouthOpen);
      applyExpression(c, expression, 40, 28);
      break;
    case "judge":
      drawJudge(c, mouthOpen);
      applyExpression(c, expression, 66, 34);
      break;
    default:
      drawGeneric(c, character, mouthOpen);
      applyExpression(c, expression, 68, 22);
      break;
  }
}

/* -------------------------------------------------- dino_saurus (T. rex) --- */
/* Tyrannosaurus attorney: big boxy head, strong toothy jaw, snout to the
 * right, small glinting eye, suit collar + tie. Confident. */
function drawTrex(c: CanvasRenderingContext2D, mouthOpen: boolean): void {
  // --- Suit shoulders (behind the head) ---
  dither(c, 12, 74, 72, 18, GRAY, BLACK); // jacket
  px(c, 12, 73, 72, 1, SILVER); // shoulder seam highlight
  // Shirt collar wedge + tie
  px(c, 40, 73, 16, 19, WHITE); // white shirt
  px(c, 37, 74, 4, 18, SILVER); // left lapel
  px(c, 55, 74, 4, 18, SILVER); // right lapel
  px(c, 45, 76, 6, 16, GRAY); // tie
  px(c, 46, 76, 4, 3, SILVER); // tie knot glint

  // --- Neck ---
  dither(c, 34, 56, 22, 20, SILVER, GRAY);

  // --- Skull (boxy) + snout jutting right ---
  dither(c, 20, 16, 44, 38, SILVER, GRAY);
  px(c, 22, 16, 40, 2, WHITE); // crown highlight
  dither(c, 60, 30, 28, 22, SILVER, GRAY); // snout
  px(c, 60, 30, 26, 2, WHITE); // snout top highlight
  px(c, 83, 34, 3, 3, BLACK); // nostril

  // --- Mouth + teeth (jaw drops 2px when talking) ---
  const jaw = mouthOpen ? 2 : 0;
  px(c, 40, 48, 48, 2, BLACK); // upper mouth line
  if (jaw) px(c, 40, 50, 48, jaw, BLACK); // open gap
  dither(c, 40, 50 + jaw, 48, 8, GRAY, SILVER); // lower jaw
  for (let i = 0; i < 8; i++) px(c, 44 + i * 6, 44, 3, 4, WHITE); // upper fangs
  for (let i = 0; i < 6; i++) px(c, 47 + i * 6, 52 + jaw, 2, 3, WHITE); // lower fangs

  // --- Confident brow + eye with glint ---
  px(c, 28, 22, 22, 4, GRAY); // heavy brow ridge
  px(c, 28, 21, 22, 1, WHITE); // brow top edge
  px(c, 34, 27, 8, 7, WHITE); // eye white
  px(c, 38, 28, 3, 4, BLACK); // pupil
  px(c, 40, 28, 1, 1, WHITE); // glint
}

/* ------------------------------------------------ pterax (Pteranodon) --- */
/* Pteranodon witness: long pointed beak to the right, swept-back head crest,
 * big round eye, thin neck, suit. Nervous/sharp. */
function drawPterax(c: CanvasRenderingContext2D, mouthOpen: boolean): void {
  // --- Suit shoulders ---
  dither(c, 14, 78, 68, 14, GRAY, BLACK);
  px(c, 40, 76, 16, 16, WHITE); // shirt collar
  px(c, 46, 78, 4, 14, GRAY); // tie

  // --- Thin neck ---
  dither(c, 40, 56, 14, 24, SILVER, GRAY);

  // --- Swept-back crest (filled fin, tip up-left off the back of the skull) ---
  for (let k = 0; k <= 24; k++) {
    const y = 32 - k;
    const left = Math.round(40 - k * 1.1);
    const w = Math.max(2, 12 - Math.floor(k * 0.42));
    px(c, left, y, w, 1, k % 2 === 0 ? SILVER : GRAY);
    px(c, left, y, 2, 1, WHITE); // leading-edge highlight
  }

  // --- Rounded head ---
  dither(c, 34, 30, 30, 26, SILVER, GRAY);
  px(c, 36, 30, 26, 2, WHITE); // crown highlight

  // --- Long pointed beak to the right (droops slightly, opens when talking) ---
  const gap = mouthOpen ? 1 : 0;
  for (let i = 0; i <= 26; i++) {
    const x = 62 + i;
    const half = Math.max(1, Math.round(9 - i * 0.31)); // taper to a point
    const cy = 42 + Math.floor(i * 0.15); // slight downward droop
    px(c, x, cy - half, 1, half, i < 22 ? SILVER : WHITE); // upper beak
    px(c, x, cy + 1 + gap, 1, half + gap, GRAY); // lower beak (shadow)
    px(c, x, cy, 1, 1 + gap, BLACK); // mouth line / gape
  }

  // --- Big round nervous eye with glint ---
  px(c, 48, 34, 8, 8, WHITE);
  px(c, 50, 36, 4, 4, BLACK);
  px(c, 51, 36, 1, 1, WHITE);
}

/* ----------------------------------------------- judge (Triceratops) --- */
/* Triceratops judge: broad neck frill behind the head, two big brow horns and
 * a nose horn, stern brow, black robe with a white judicial collar. */
function drawJudge(c: CanvasRenderingContext2D, mouthOpen: boolean): void {
  // --- Broad frill fan behind the head ---
  dither(c, 16, 16, 64, 28, SILVER, GRAY);
  px(c, 16, 16, 64, 2, WHITE); // frill top highlight
  for (let i = 0; i < 7; i++) px(c, 17 + i * 9, 13, 6, 3, SILVER); // scalloped knobs
  px(c, 16, 16, 2, 28, GRAY); // frill side shadows
  px(c, 78, 16, 2, 28, GRAY);

  // --- Brow horns (two, large, angled outward-up) ---
  for (let i = 0; i < 15; i++) px(c, 33 - Math.floor(i * 0.5), 44 - i, 3, 2, WHITE);
  for (let i = 0; i < 15; i++) px(c, 60 + Math.floor(i * 0.5), 44 - i, 3, 2, WHITE);

  // --- Face (in front of the frill) ---
  dither(c, 30, 38, 36, 34, SILVER, GRAY);
  px(c, 32, 38, 32, 2, WHITE); // forehead highlight

  // --- Nose horn ---
  px(c, 46, 52, 4, 9, WHITE);
  px(c, 45, 53, 6, 2, SILVER);

  // --- Stern brow (angled down toward the center) ---
  for (let i = 0; i < 14; i++) px(c, 32 + i, 46 + Math.floor(i * 0.28), 2, 3, GRAY);
  for (let i = 0; i < 14; i++) px(c, 50 + i, 50 - Math.floor(i * 0.28), 2, 3, GRAY);

  // --- Narrow stern eyes with glint ---
  px(c, 36, 50, 7, 4, WHITE);
  px(c, 38, 51, 3, 2, BLACK);
  px(c, 39, 51, 1, 1, WHITE);
  px(c, 53, 50, 7, 4, WHITE);
  px(c, 55, 51, 3, 2, BLACK);
  px(c, 56, 51, 1, 1, WHITE);

  // --- Beak/snout + mouth (opens when talking) ---
  const jaw = mouthOpen ? 2 : 0;
  dither(c, 40, 60, 16, 12 + jaw, GRAY, SILVER);
  px(c, 42, 66, 12, 2 + jaw, BLACK); // beak line / gape

  // --- Robe (black) with white judicial collar ---
  dither(c, 12, 76, 72, 16, GRAY, BLACK);
  px(c, 28, 74, 40, 4, BLACK); // robe shoulders
  px(c, 40, 74, 16, 18, WHITE); // white collar / jabot
  px(c, 47, 76, 2, 16, GRAY); // jabot center seam
}

/* ------------------------------------------------------- generic id --- */
/* Unknown ids: a framed box with the id's initials and a simple snout
 * silhouette so a missing witness still reads as "some dinosaur". */
function drawGeneric(
  c: CanvasRenderingContext2D,
  id: string,
  mouthOpen: boolean,
): void {
  // Generic head
  dither(c, 26, 24, 40, 34, SILVER, GRAY);
  px(c, 28, 24, 36, 2, WHITE); // crown highlight
  // Simple snout silhouette to the right
  dither(c, 60, 36, 22, 16, SILVER, GRAY);
  px(c, 79, 40, 3, 3, BLACK); // nostril
  // Mouth (opens when talking)
  const jaw = mouthOpen ? 2 : 0;
  px(c, 40, 50, 42, 2 + jaw, BLACK);
  // Eye with glint
  px(c, 38, 34, 7, 6, WHITE);
  px(c, 41, 35, 3, 4, BLACK);
  px(c, 43, 35, 1, 1, WHITE);
  // Suit shoulders
  dither(c, 16, 74, 64, 18, GRAY, BLACK);
  px(c, 40, 74, 14, 18, WHITE);
  px(c, 45, 76, 4, 16, GRAY);

  // Initials plate, bottom-left, so a missing asset is legible.
  const initials = initialsOf(id);
  panel(c, 4, SIZE - 16, 20, 12);
  c.fillStyle = WHITE;
  c.font = 'bold 8px "Courier New", monospace';
  c.textBaseline = "top";
  c.fillText(initials[0], 7, SIZE - 14);
  if (initials[1]) c.fillText(initials[1], 14, SIZE - 14);
}

/** Two uppercase initials from an id ("space_croc" -> "SC", "rex" -> "RE"). */
function initialsOf(id: string): string {
  const parts = id.split(/[_\-\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const s = (parts[0] || id || "?").toUpperCase();
  return (s[0] || "?") + (s[1] || "");
}

/* ------------------------------------------------------ expressions --- */
/*
 * Subtle, procedural per-expression touch-ups drawn over the neutral base.
 * (tx, ty) is the character's temple, used to place sweat drops.
 *   - "sweating": 2-3 white sweat-drop pixels near the temple
 *   - "confident" / "pointing": a brighter, cockier brow highlight
 *   - anything else (incl. "neutral" / unknown): no change
 */
function applyExpression(
  c: CanvasRenderingContext2D,
  expression: string,
  tx: number,
  ty: number,
): void {
  switch (expression) {
    case "sweating":
      px(c, tx, ty, 2, 3, WHITE); // main drop
      px(c, tx + 1, ty + 3, 1, 1, WHITE); // drip tail
      px(c, tx - 4, ty + 6, 2, 2, WHITE); // second smaller drop
      break;
    case "confident":
    case "pointing":
      px(c, tx - 12, ty + 2, 16, 1, WHITE); // cocky raised brow highlight
      break;
    default:
      break; // neutral / unknown -> base art unchanged
  }
}
