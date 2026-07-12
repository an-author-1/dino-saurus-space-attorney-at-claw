/*
 * Bootstrap: create the 256x224 framebuffer, integer-scale it to the largest
 * multiple that fits the window, wire up keyboard + pointer input, and run the
 * fixed logical-resolution render loop. The final frame is snapped to the four
 * palette colors before it hits the screen.
 */

import { W, H, snapToPalette, paletteCensus } from "./gfx";
import { Sfx } from "./audio";
import { Portraits } from "./portraits";
import { Game, type Action } from "./game";

const screen = document.getElementById("screen") as HTMLCanvasElement;
const ctx = screen.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

// Offscreen framebuffer at logical resolution.
const buffer = document.createElement("canvas");
buffer.width = W;
buffer.height = H;
const bctx = buffer.getContext("2d", { willReadFrequently: true })!;
bctx.imageSmoothingEnabled = false;

const sfx = new Sfx();
const portraits = new Portraits();
const game = new Game(sfx, portraits);

// Expose for automated verification / debugging.
(window as unknown as { __game: Game }).__game = game;

/* ----------------------------------------------------------- scaling ---- */

let scale = 1;
function resize(): void {
  const s = Math.max(1, Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)));
  scale = s;
  screen.width = W * s;
  screen.height = H * s;
  screen.style.width = `${W * s}px`;
  screen.style.height = `${H * s}px`;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resize);
resize();

/* ------------------------------------------------------------- input ---- */

function unlockAudio(): void {
  sfx.resume();
}

const KEY_ACTIONS: Record<string, Action> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyZ: "confirm",
  Enter: "confirm",
  Space: "confirm",
  KeyX: "back",
  Escape: "back",
  KeyC: "evidence",
};

window.addEventListener(
  "keydown",
  (e) => {
    unlockAudio();
    if (e.code === "KeyP") {
      snapToPalette(bctx);
      paletteCensus(bctx);
      // eslint-disable-next-line no-console
      console.log("state:", game.paletteCensusState());
      e.preventDefault();
      return;
    }
    const a = KEY_ACTIONS[e.code];
    if (a) {
      game.input(a);
      e.preventDefault();
    }
  },
  { passive: false },
);

function toLogical(clientX: number, clientY: number): { x: number; y: number } {
  const rect = screen.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * W,
    y: ((clientY - rect.top) / rect.height) * H,
  };
}

screen.addEventListener(
  "pointerdown",
  (e) => {
    unlockAudio();
    const p = toLogical(e.clientX, e.clientY);
    game.pointer(p.x, p.y);
    e.preventDefault();
  },
  { passive: false },
);

/* -------------------------------------------------------------- loop ---- */

let last = performance.now();
function frame(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1; // clamp after tab-switch stalls

  game.update(dt);
  game.render(bctx);
  snapToPalette(bctx); // enforce the four-color rule on the finished frame

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, screen.width, screen.height);
  ctx.drawImage(buffer, 0, 0, W, H, 0, 0, W * scale, H * scale);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
