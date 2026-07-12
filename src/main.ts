/*
 * Bootstrap. Loads the COMPILED case (JSON — never YAML at runtime), constructs
 * the engine and the render/audio/input layers, and runs the fixed-resolution
 * loop. The engine is pure; this file is the only place the four layers meet.
 */

import { W, H, snapToPalette, paletteCensus } from "./render/gfx";
import { View } from "./render/view";
import { Portraits } from "./render/portraits";
import { Sfx } from "./audio/audio";
import { Engine } from "./engine/engine";
import type { CompiledCase } from "./engine/types";
import type { Cue, InputEvent } from "./engine/state";
import { KEY_EVENTS, type Hotspot } from "./input/input";

// Compiled by `npm run compile-cases`; Vite inlines the JSON into the bundle,
// so the single-file build stays self-contained and dependency-free.
import caseJson from "../dist-cases/case-0-0.json";

const caseData = caseJson as unknown as CompiledCase;

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
const engine = new Engine(caseData);
const view = new View(portraits);

// Expose for automated verification / debugging.
(window as unknown as { __engine: Engine }).__engine = engine;

let hotspots: Hotspot[] = [];

function handleCues(cues: Cue[]): void {
  for (const c of cues) {
    sfx.play(c);
    view.onCue(c);
  }
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
      // eslint-disable-next-line no-console
      console.log("state:", engine.state.phase);
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

/* -------------------------------------------------------------- loop ---- */

let last = performance.now();
function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;

  handleCues(engine.tick(dt));
  view.update(dt, engine);
  hotspots = view.render(bctx, engine);
  snapToPalette(bctx);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, screen.width, screen.height);
  ctx.drawImage(buffer, 0, 0, W, H, 0, 0, W * scale, H * scale);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
