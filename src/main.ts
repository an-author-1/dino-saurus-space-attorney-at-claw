/*
 * Bootstrap. Loads every COMPILED case (JSON — never YAML at runtime),
 * constructs the engine + render/audio/input layers, and runs the loop.
 * ?dev=1 enables writer mode (instant text, J jump menu, in-page case errors).
 */

import { W, H, snapToPalette, paletteCensus, panel, drawText, drawTextCentered, wrap, WHITE, BLACK, CELL } from "./render/gfx";
import { View } from "./render/view";
import { Portraits } from "./render/portraits";
import { Sfx } from "./audio/audio";
import { Engine } from "./engine/engine";
import type { CompiledCase } from "./engine/types";
import type { Cue, InputEvent } from "./engine/state";
import { KEY_EVENTS, type Hotspot } from "./input/input";

// Every compiled case, bundled by Vite (keeps the single-file build self-contained).
const modules = import.meta.glob<CompiledCase>("../dist-cases/*.json", { eager: true, import: "default" });
const cases: CompiledCase[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, m]) => m as CompiledCase);

const dev = new URLSearchParams(location.search).get("dev") === "1";

const screen = document.getElementById("screen") as HTMLCanvasElement;
const ctx = screen.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

const buffer = document.createElement("canvas");
buffer.width = W;
buffer.height = H;
const bctx = buffer.getContext("2d", { willReadFrequently: true })!;
bctx.imageSmoothingEnabled = false;

const sfx = new Sfx();
const portraits = new Portraits();
const engine = new Engine(cases, { dev });
const view = new View(portraits);

(window as unknown as { __engine: Engine }).__engine = engine;

let hotspots: Hotspot[] = [];
let caseErrors: string[] = [];

function handleCues(cues: Cue[]): void {
  for (const c of cues) {
    sfx.play(c);
    view.onCue(c);
  }
}

/* ----- dev: in-page case errors from the watch plugin ------------------- */
if (import.meta.hot) {
  import.meta.hot.on("dino:errors", (data: string[]) => {
    caseErrors = data;
  });
  import.meta.hot.on("dino:ok", () => {
    caseErrors = [];
  });
}

/* ----------------------------------------------------------- scaling ---- */

let scale = 1;
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const s = Math.max(1, Math.floor(Math.min((window.innerWidth * dpr) / W, (window.innerHeight * dpr) / H)));
  scale = s;
  screen.width = W * s;
  screen.height = H * s;
  screen.style.width = `${(W * s) / dpr}px`;
  screen.style.height = `${(H * s) / dpr}px`;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resize);
resize();

/* ------------------------------------------------------------- input ---- */

function dispatch(event: InputEvent): void {
  sfx.resume();
  handleCues(engine.input(event));
}

window.addEventListener(
  "keydown",
  (e) => {
    sfx.resume();
    if (e.code === "KeyP") {
      snapToPalette(bctx);
      paletteCensus(bctx);
      e.preventDefault();
      return;
    }
    if (dev && e.code === "KeyJ") {
      handleCues(engine.enterDevJump());
      e.preventDefault();
      return;
    }
    const a = KEY_EVENTS[e.code];
    if (a) {
      dispatch(a);
      e.preventDefault();
    }
  },
  { passive: false },
);

screen.addEventListener(
  "pointerdown",
  (e) => {
    sfx.resume();
    const rect = screen.getBoundingClientRect();
    const lx = ((e.clientX - rect.left) / rect.width) * W;
    const ly = ((e.clientY - rect.top) / rect.height) * H;
    for (const h of hotspots) {
      if (lx >= h.x && lx < h.x + h.w && ly >= h.y && ly < h.y + h.h) {
        if (typeof h.action === "string" && h.action.startsWith("menu:")) {
          handleCues(engine.selectMenu(parseInt(h.action.slice(5), 10)));
        } else if (typeof h.action === "string" && h.action.startsWith("sel:")) {
          engine.setSel(parseInt(h.action.slice(4), 10));
        } else {
          dispatch(h.action as InputEvent);
        }
        break;
      }
    }
    e.preventDefault();
  },
  { passive: false },
);

/* --------- dev error overlay ------------------------------------------- */

function drawErrorOverlay(): void {
  if (!dev || caseErrors.length === 0) return;
  bctx.fillStyle = BLACK;
  bctx.fillRect(4, 4, W - 8, H - 8);
  panel(bctx, 4, 4, W - 8, H - 8);
  drawTextCentered(bctx, "CASE HAS ERRORS", 4, W - 8, 10, WHITE);
  let y = 26;
  const cols = Math.floor((W - 24) / 6);
  for (const err of caseErrors.slice(0, 8)) {
    for (const line of wrap(err, cols)) {
      if (y > H - 20) break;
      drawText(bctx, line, 10, y, WHITE, 6, 6);
      y += 9;
    }
    y += 3;
  }
  drawTextCentered(bctx, "FIX THE YAML — RELOADS ON SAVE", 4, W - 8, H - 16, WHITE, 6);
  void CELL;
}

/* -------------------------------------------------------------- loop ---- */

let last = performance.now();
function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;

  handleCues(engine.tick(dt));
  view.update(dt, engine);
  hotspots = view.render(bctx, engine);
  drawErrorOverlay();
  snapToPalette(bctx);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, screen.width, screen.height);
  ctx.drawImage(buffer, 0, 0, W, H, 0, 0, W * scale, H * scale);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
