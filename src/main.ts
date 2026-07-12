// Dino Saurus: Space Attorney at Claw — M0 micro-prototype.
// A hardcoded courtroom state machine. All case content lives in ./case.ts.

import {
  W, H, PAL, RGB, initGfx, present, clear, rect, frame, line, uiBox, px,
  drawText, drawTextCentered, textWidth, wrap, setCam, drawChar, ADV,
  paletteCensus,
} from "./gfx";
import { glyph, normalize } from "./font";
import {
  blip, thud, tick, sting, buzz, chime, initAudio,
} from "./audio";
import { loadPortrait, drawPortrait } from "./portrait";
import {
  MICRO_CASE, OBJECTION_CATEGORIES, ObjectionCategory, Statement,
} from "./case";

// ---------------------------------------------------------------------------
// Canvas + integer scaling
// ---------------------------------------------------------------------------
const canvas = document.getElementById("screen") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;
initGfx(ctx);

function fit() {
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)));
  canvas.style.width = W * scale + "px";
  canvas.style.height = H * scale + "px";
}
window.addEventListener("resize", fit);
fit();

// Portraits (placeholder until/if PNGs load).
loadPortrait("dino_saurus", "DS");
loadPortrait("pterax", "PX");
loadPortrait("judge", "JT");

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const BOX = { x: 6, y: 116, w: 244, h: 62 };
const PORTRAIT_X = 6;
const PORTRAIT_Y = 17;
const DLG_COLS = 36;
const POWER_X = 150;
const POWER_Y = 22;

// ---------------------------------------------------------------------------
// Dialogue / typewriter
// ---------------------------------------------------------------------------
interface Dialogue {
  speaker: string | null;
  lines: string[];
  flat: string;
  reveal: number;
  cps: number;
  done: boolean;
  onDone: (() => void) | null;
}

function say(speaker: string | null, text: string, onDone: (() => void) | null, cps = 30) {
  const lines = wrap(text, DLG_COLS);
  state.dlg = {
    speaker: speaker ? normalize(speaker) : null,
    lines,
    flat: lines.join("\n"),
    reveal: 0,
    cps,
    done: false,
    onDone,
  };
}

function updateDialogue(dt: number) {
  const d = state.dlg;
  if (!d || d.done) return;
  const before = Math.floor(d.reveal);
  d.reveal += d.cps * dt;
  const after = Math.min(d.flat.length, Math.floor(d.reveal));
  for (let i = before; i < after; i++) {
    const ch = d.flat[i];
    if (ch !== " " && ch !== "\n") blip();
  }
  if (d.reveal >= d.flat.length) {
    d.reveal = d.flat.length;
    d.done = true;
  }
}

function drawDialogueIn(box: { x: number; y: number; w: number; h: number }, color: RGB = PAL.LIGHT) {
  const d = state.dlg;
  if (!d) return;
  let top = box.y + 8;
  if (d.speaker) {
    drawText(d.speaker + ":", box.x + 8, top, PAL.WHITE);
    top += 11;
  }
  const shown = Math.floor(d.reveal);
  let idxc = 0;
  let ly = top;
  outer: for (const lineStr of d.lines) {
    let lx = box.x + 8;
    for (const ch of lineStr) {
      if (idxc >= shown) break outer;
      drawChar(ch, lx, ly, color);
      lx += ADV;
      idxc++;
    }
    idxc++; // newline
    ly += 10;
  }
  // Blinking "continue" chevron once fully revealed.
  if (d.done && Math.floor(state.time * 2) % 2 === 0) {
    drawText(">", box.x + box.w - 14, box.y + box.h - 12, PAL.WHITE);
  }
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
type Mode =
  | "TITLE" | "INTRO" | "TESTIMONY" | "PRESS_MENU" | "PRESS_RESULT"
  | "OBJ_ANIM" | "OBJ_MENU" | "EVID_PICKER" | "EVID_OVERLAY"
  | "REBUKE" | "SUSTAIN" | "BREAKDOWN" | "POWER_EMPTY" | "VERDICT";

interface Particle { x: number; y: number; vx: number; vy: number; }

const state = {
  mode: "TITLE" as Mode,
  time: 0,
  power: 5,
  order: [...MICRO_CASE.initialOrder],
  idx: 0,
  broken: new Set<string>(),
  pressed: {} as Record<string, Set<string>>,
  sel: 0,
  dlg: null as Dialogue | null,
  animT: 0,
  shake: 0,
  stars: [] as Particle[],
  confetti: [] as Particle[],
  sweat: [] as Particle[],
  rank: "S",
};

// Seeded-ish starfield (Math.random is fine at runtime in the browser).
for (let i = 0; i < 70; i++) {
  state.stars.push({ x: Math.floor(Math.random() * W), y: Math.floor(Math.random() * H), vx: 0, vy: 0 });
}

function stmtById(id: string): Statement {
  return MICRO_CASE.statements.find((s) => s.id === id)!;
}
function cur(): Statement {
  return stmtById(state.order[state.idx]);
}

// ---------------------------------------------------------------------------
// Click hotspots (rebuilt every frame)
// ---------------------------------------------------------------------------
interface Hotspot { x: number; y: number; w: number; h: number; fn: () => void; }
let hotspots: Hotspot[] = [];
function addHot(x: number, y: number, w: number, h: number, fn: () => void) {
  hotspots.push({ x, y, w, h, fn });
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  initAudio();
  const r = canvas.getBoundingClientRect();
  const lx = ((e.clientX - r.left) / r.width) * W;
  const ly = ((e.clientY - r.top) / r.height) * H;
  for (let i = hotspots.length - 1; i >= 0; i--) {
    const hs = hotspots[i];
    if (lx >= hs.x && lx < hs.x + hs.w && ly >= hs.y && ly < hs.y + hs.h) {
      hs.fn();
      return;
    }
  }
});

// ---------------------------------------------------------------------------
// UI drawing helpers
// ---------------------------------------------------------------------------
function headerTab(label: string) {
  const label2 = normalize(label);
  const w = textWidth(label2) + 16;
  const x = (W - w) >> 1;
  uiBox(x, 0, w, 15);
  drawText(label2, x + 8, 4, PAL.WHITE);
}

function drawPower() {
  drawText("POWER", POWER_X, POWER_Y, PAL.LIGHT);
  for (let i = 0; i < 5; i++) {
    const sx = POWER_X + i * 10;
    const sy = POWER_Y + 10;
    frame(sx, sy, 9, 11, PAL.WHITE, 1);
    if (i < state.power) rect(sx + 2, sy + 2, 5, 7, PAL.LIGHT);
  }
}

function drawCounter() {
  const txt = `< ${state.idx + 1} / ${state.order.length} >`;
  drawText(txt, POWER_X, POWER_Y + 30, PAL.LIGHT);
  // clickable prev/next thirds
  addHot(POWER_X, POWER_Y + 28, textWidth("< ") + ADV, 12, () => cycle(-1));
  const rw = textWidth("< " + (state.idx + 1) + " / " + state.order.length + " ");
  addHot(POWER_X + rw, POWER_Y + 28, ADV * 3, 12, () => cycle(1));
  drawText("ARROWS: CYCLE", POWER_X, POWER_Y + 44, PAL.GRAY);
}

function drawFooter(txt: string) {
  drawTextCentered(txt, W >> 1, 200, PAL.LIGHT);
}

function drawMenuIn(
  box: { x: number; y: number; w: number; h: number },
  title: string,
  items: string[],
  onPick: (i: number) => void,
) {
  drawText(normalize(title), box.x + 8, box.y + 6, PAL.WHITE);
  for (let i = 0; i < items.length; i++) {
    const ly = box.y + 19 + i * 10;
    const selected = i === state.sel;
    if (selected) drawText(">", box.x + 8, ly, PAL.WHITE);
    drawText(items[i], box.x + 18, ly, selected ? PAL.WHITE : PAL.LIGHT);
    addHot(box.x + 4, ly - 2, box.w - 8, 11, () => {
      state.sel = i;
      onPick(i);
    });
  }
}

// Bigger text for banners (integer-scaled glyphs).
function drawBig(s: string, cx: number, y: number, scale: number, color: RGB) {
  const t = normalize(s);
  const w = t.length * (5 * scale + scale) - scale;
  let x = cx - (w >> 1);
  for (const ch of t) {
    const g = glyph(ch);
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++)
        if (g[r][c] === "#") rect(x + c * scale, y + r * scale, scale, scale, color);
    x += 5 * scale + scale;
  }
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------
function startCase() {
  state.power = 5;
  state.order = [...MICRO_CASE.initialOrder];
  state.idx = 0;
  state.broken = new Set();
  state.pressed = {};
  showStatement();
}

function resetTestimony() {
  startCase();
  state.mode = "TESTIMONY";
}

function showStatement() {
  state.mode = "TESTIMONY";
  say(MICRO_CASE.witness, cur().text, null);
}

function cycle(dir: number) {
  const n = state.order.length;
  state.idx = (state.idx + dir + n) % n;
  tick();
  showStatement();
}

function openPressMenu() {
  if (cur().presses.length === 0) return;
  state.mode = "PRESS_MENU";
  state.sel = 0;
  thud();
}

function doPress(i: number) {
  const stmt = cur();
  const press = stmt.presses[i];
  if (!press) return;
  const set = (state.pressed[stmt.id] ??= new Set());
  const repeat = set.has(press.mode);
  set.add(press.mode);
  state.mode = "PRESS_RESULT";
  thud();
  say(MICRO_CASE.witness, repeat ? press.repeat : press.response, null);
}

function startObjection() {
  state.mode = "OBJ_ANIM";
  state.animT = 0;
  state.shake = 3.2;
  sting();
}

function chooseCategory(cat: ObjectionCategory) {
  if (cat === "CONTRADICTION") {
    state.mode = "EVID_PICKER";
    state.sel = 0;
    thud();
  } else {
    evaluateObjection(cat, null);
  }
}

function presentEvidence(evId: string) {
  evaluateObjection("CONTRADICTION", evId);
}

function evaluateObjection(cat: ObjectionCategory, evId: string | null) {
  const stmt = cur();

  // Already-broken lie: settled, no penalty.
  if (state.broken.has(stmt.id)) {
    state.mode = "REBUKE";
    buzz();
    say(MICRO_CASE.intro.speaker, "OVERRULED. THAT MATTER IS SETTLED.", () => backToTestimony());
    return;
  }

  let correct = false;
  if (stmt.objection && stmt.objection.category === cat) {
    correct = cat === "CONTRADICTION" ? evId === stmt.objection.requiresEvidence : true;
  }

  if (correct) {
    state.mode = "SUSTAIN";
    chime();
    say(MICRO_CASE.intro.speaker, MICRO_CASE.judge.sustained, () => startBreakdown());
  } else {
    state.power = Math.max(0, state.power - 1);
    const rebuke = stmt.objection
      ? MICRO_CASE.judge.rebukePool[Math.floor(Math.random() * MICRO_CASE.judge.rebukePool.length)]
      : stmt.notObjectionableRebuke!;
    state.mode = "REBUKE";
    buzz();
    say(MICRO_CASE.intro.speaker, rebuke, () => {
      if (state.power <= 0) state.mode = "POWER_EMPTY", (state.sel = 0);
      else backToTestimony();
    });
  }
}

function backToTestimony() {
  showStatement();
}

function startBreakdown() {
  state.mode = "BREAKDOWN";
  state.shake = 2.4;
  state.sweat = [];
  for (let i = 0; i < 5; i++) {
    state.sweat.push({
      x: PORTRAIT_X + 20 + Math.floor(Math.random() * 60),
      y: PORTRAIT_Y + 6 + Math.floor(Math.random() * 20),
      vx: 0,
      vy: 18 + Math.random() * 26,
    });
  }
  say(MICRO_CASE.witness, cur().objection!.breakdown, () => afterBreakdown(), 46);
}

function afterBreakdown() {
  const stmt = cur();
  state.broken.add(stmt.id);
  state.shake = 0;
  const obj = stmt.objection!;
  if (obj.endsCase) {
    gotoVerdict();
  } else if (obj.reveals) {
    // Insert the revealed statement right after the current one.
    state.order.splice(state.idx + 1, 0, obj.reveals);
    state.idx += 1;
    showStatement();
  } else {
    showStatement();
  }
}

function gotoVerdict() {
  state.mode = "VERDICT";
  state.confetti = [];
  for (let i = 0; i < 90; i++) {
    state.confetti.push({
      x: Math.floor(Math.random() * W),
      y: -Math.floor(Math.random() * H),
      vx: (Math.random() - 0.5) * 10,
      vy: 30 + Math.random() * 50,
    });
  }
  const lost = 5 - state.power;
  state.rank = lost === 0 ? "S" : (["", "D", "C", "B", "A"][state.power] ?? "D");
  chime();
}

// ---------------------------------------------------------------------------
// Per-mode input
// ---------------------------------------------------------------------------
function confirm() {
  initAudio();
  const d = state.dlg;
  const typing = d && !d.done;

  switch (state.mode) {
    case "TITLE":
      state.mode = "INTRO";
      thud();
      say(MICRO_CASE.intro.speaker, MICRO_CASE.intro.text, null);
      break;
    case "INTRO":
      if (typing) { d!.reveal = d!.flat.length; d!.done = true; }
      else { thud(); startCase(); }
      break;
    case "TESTIMONY":
      if (typing) { d!.reveal = d!.flat.length; d!.done = true; }
      else openPressMenu();
      break;
    case "PRESS_MENU":
      doPress(state.sel);
      break;
    case "PRESS_RESULT":
      if (typing) { d!.reveal = d!.flat.length; d!.done = true; }
      else showStatement();
      break;
    case "OBJ_MENU":
      thud();
      chooseCategory(OBJECTION_CATEGORIES[state.sel]);
      break;
    case "EVID_PICKER":
      presentEvidence(MICRO_CASE.evidence[state.sel].id);
      break;
    case "REBUKE":
    case "SUSTAIN":
      if (typing) { d!.reveal = d!.flat.length; d!.done = true; }
      else if (d!.onDone) d!.onDone();
      break;
    case "BREAKDOWN":
      if (typing) { d!.reveal = d!.flat.length; d!.done = true; }
      else if (d!.onDone) d!.onDone();
      break;
    case "POWER_EMPTY":
      thud();
      resetTestimony();
      break;
    case "EVID_OVERLAY":
      break; // Z does nothing special; X closes
    case "VERDICT":
      thud();
      state.mode = "TITLE";
      startCase();
      state.mode = "TITLE";
      break;
  }
}

function back() {
  initAudio();
  switch (state.mode) {
    case "TESTIMONY":
      startObjection();
      break;
    case "PRESS_MENU":
      tick();
      showStatement();
      break;
    case "OBJ_MENU":
      tick();
      showStatement();
      break;
    case "EVID_PICKER":
      tick();
      state.mode = "OBJ_MENU";
      state.sel = 0;
      break;
    case "EVID_OVERLAY":
      tick();
      state.mode = "TESTIMONY";
      break;
  }
}

function evidenceKey() {
  initAudio();
  if (state.mode === "TESTIMONY") {
    state.mode = "EVID_OVERLAY";
    tick();
  } else if (state.mode === "EVID_OVERLAY") {
    state.mode = "TESTIMONY";
    tick();
  }
}

function move(dir: number) {
  const menuModes: Mode[] = ["PRESS_MENU", "OBJ_MENU", "EVID_PICKER", "POWER_EMPTY"];
  if (menuModes.includes(state.mode)) {
    const count = menuItemCount();
    if (count > 0) {
      state.sel = (state.sel + dir + count) % count;
      tick();
    }
  }
}

function horizontal(dir: number) {
  if (state.mode === "TESTIMONY") {
    const d = state.dlg;
    if (d && !d.done) { d.reveal = d.flat.length; d.done = true; return; }
    cycle(dir);
  } else {
    move(dir);
  }
}

function menuItemCount(): number {
  switch (state.mode) {
    case "PRESS_MENU": return cur().presses.length;
    case "OBJ_MENU": return OBJECTION_CATEGORIES.length;
    case "EVID_PICKER": return MICRO_CASE.evidence.length;
    case "POWER_EMPTY": return 1;
    default: return 0;
  }
}

window.addEventListener("keydown", (e) => {
  switch (e.code) {
    case "ArrowUp": e.preventDefault(); move(-1); break;
    case "ArrowDown": e.preventDefault(); move(1); break;
    case "ArrowLeft": e.preventDefault(); horizontal(-1); break;
    case "ArrowRight": e.preventDefault(); horizontal(1); break;
    case "KeyZ": case "Enter": case "Space": e.preventDefault(); confirm(); break;
    case "KeyX": case "Backspace": e.preventDefault(); back(); break;
    case "KeyC": e.preventDefault(); evidenceKey(); break;
    case "KeyP": e.preventDefault(); dumpPalette(); break;
  }
});

function dumpPalette() {
  const counts = paletteCensus();
  const rows = [...counts.entries()].map(([k, v]) => ({ color: k, pixels: v }));
  // eslint-disable-next-line no-console
  console.log(`PALETTE CENSUS — ${counts.size} distinct colors (must be <= 4)`);
  // eslint-disable-next-line no-console
  console.table(rows);
  if (counts.size > 4) console.warn("FOUR-COLOR RULE VIOLATED!");
}

// ---------------------------------------------------------------------------
// Particle updates
// ---------------------------------------------------------------------------
function updateParticles(dt: number) {
  for (const s of state.stars) {
    // gentle twinkle handled at draw via time; no motion
    void s;
  }
  if (state.mode === "VERDICT") {
    for (const c of state.confetti) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.y > H) { c.y = -2; c.x = Math.floor(Math.random() * W); }
    }
  }
  if (state.mode === "BREAKDOWN") {
    for (const s of state.sweat) {
      s.y += s.vy * dt;
      if (s.y > PORTRAIT_Y + 110) { s.y = PORTRAIT_Y + 4; }
    }
  }
  if (state.shake > 0) {
    state.shake = Math.max(0, state.shake - dt * 6);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  hotspots = [];
  clear(PAL.BLACK);

  switch (state.mode) {
    case "TITLE": renderTitle(); break;
    case "INTRO": renderSpeech("judge", "SETTING THE SCENE", false, false); break;
    case "TESTIMONY": renderTestimony(); break;
    case "PRESS_MENU": renderPressMenu(); break;
    case "PRESS_RESULT": renderSpeech("pterax", "CROSS EXAMINATION", true, true); break;
    case "OBJ_ANIM": renderObjectionAnim(); break;
    case "OBJ_MENU": renderObjectionMenu(); break;
    case "EVID_PICKER": renderEvidencePicker(); break;
    case "EVID_OVERLAY": renderEvidenceOverlay(); break;
    case "REBUKE": renderSpeech("judge", "OVERRULED", true, false); break;
    case "SUSTAIN": renderSpeech("judge", "SUSTAINED", true, false); break;
    case "BREAKDOWN": renderBreakdown(); break;
    case "POWER_EMPTY": renderPowerEmpty(); break;
    case "VERDICT": renderVerdict(); break;
  }
}

function renderTitle() {
  for (let i = 0; i < state.stars.length; i++) {
    const s = state.stars[i];
    const tw = (Math.floor(state.time * 3) + i) % 7;
    px(s.x, s.y, tw === 0 ? PAL.GRAY : PAL.WHITE);
  }
  drawBig("DINO SAURUS", W >> 1, 34, 3, PAL.WHITE);
  drawTextCentered("SPACE ATTORNEY AT CLAW", W >> 1, 62, PAL.LIGHT);
  drawTextCentered(MICRO_CASE.title.line2, W >> 1, 108, PAL.LIGHT);
  if (Math.floor(state.time * 2) % 2 === 0) {
    drawTextCentered("PRESS  Z", W >> 1, 150, PAL.WHITE);
  }
  drawTextCentered(MICRO_CASE.copyright, W >> 1, 200, PAL.GRAY);
  addHot(0, 0, W, H, confirm);
}

// Portrait + dialogue box scene, reused by several modes.
function renderSpeech(portrait: string, header: string, showPower: boolean, showCounter: boolean) {
  headerTab(header);
  drawPortrait(portrait, PORTRAIT_X, PORTRAIT_Y);
  frame(PORTRAIT_X, PORTRAIT_Y, 96, 96, PAL.GRAY, 1);
  if (showPower) drawPower();
  if (showCounter) drawCounter();
  uiBox(BOX.x, BOX.y, BOX.w, BOX.h);
  drawDialogueIn(BOX);
  drawFooter("Z: CONTINUE");
  addHot(0, 0, W, H, confirm);
}

function renderTestimony() {
  headerTab("CROSS EXAMINATION");
  drawPortrait("pterax", PORTRAIT_X, PORTRAIT_Y);
  frame(PORTRAIT_X, PORTRAIT_Y, 96, 96, PAL.GRAY, 1);
  drawPower();
  drawCounter();
  uiBox(BOX.x, BOX.y, BOX.w, BOX.h);
  drawDialogueIn(BOX);
  drawFooter("Z:PRESS   X:OBJECT   C:EVID");
  // action hotspots along the footer
  const y = 196, h = 14;
  addHot(0, y - 2, 90, h, confirm);
  addHot(90, y - 2, 90, h, back);
  addHot(180, y - 2, 76, h, evidenceKey);
  // tapping the statement also advances typing
  const d = state.dlg;
  if (d && !d.done) addHot(BOX.x, BOX.y, BOX.w, BOX.h, confirm);
}

function renderPressMenu() {
  headerTab("CROSS EXAMINATION");
  drawPortrait("pterax", PORTRAIT_X, PORTRAIT_Y);
  frame(PORTRAIT_X, PORTRAIT_Y, 96, 96, PAL.GRAY, 1);
  drawPower();
  drawCounter();
  uiBox(BOX.x, BOX.y, BOX.w, BOX.h);
  const items = cur().presses.map((p) => "PRESS " + p.mode);
  drawMenuIn(BOX, "WHAT WILL YOU PRESS?", items, (i) => doPress(i));
  drawFooter("Z:SELECT   X:BACK");
}

function renderObjectionAnim() {
  const cx = W >> 1, cy = 104;
  const p = Math.min(1, state.animT / 0.9);

  // Radial white speed lines rushing inward.
  const inner = 30 + (1 - p) * 90;
  for (let a = 0; a < 28; a++) {
    const ang = (a / 28) * Math.PI * 2 + state.animT * 2;
    const x0 = cx + Math.cos(ang) * inner;
    const y0 = cy + Math.sin(ang) * inner;
    const x1 = cx + Math.cos(ang) * 240;
    const y1 = cy + Math.sin(ang) * 240;
    if (a % 2 === 0) line(x0, y0, x1, y1, PAL.WHITE);
    else line(x0, y0, x1, y1, PAL.LIGHT);
  }

  // Jagged white burst star.
  const R = 20 + p * 78;
  const pts: [number, number][] = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const r = i % 2 === 0 ? R : R * 0.6;
    pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
  }
  fillPoly(pts, PAL.WHITE);

  // "OBJECTION!" in black on the burst.
  if (p > 0.35) drawBig("OBJECTION!", cx, cy - 8, 3, PAL.BLACK);
}

function fillPoly(pts: [number, number][], color: RGB) {
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  minX = Math.max(0, Math.floor(minX)); maxX = Math.min(W - 1, Math.ceil(maxX));
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(H - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (pointInPoly(x + 0.5, y + 0.5, pts)) px(x, y, color);
    }
  }
}

function pointInPoly(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function renderObjectionMenu() {
  headerTab("OBJECTION!");
  drawPortrait("dino_saurus", PORTRAIT_X, PORTRAIT_Y);
  frame(PORTRAIT_X, PORTRAIT_Y, 96, 96, PAL.GRAY, 1);
  drawPower();
  // Small dino line box.
  uiBox(POWER_X, POWER_Y + 30, 100, 30);
  drawText("DINO SAURUS:", POWER_X + 6, POWER_Y + 37, PAL.WHITE);
  drawText("HOLD IT!", POWER_X + 6, POWER_Y + 48, PAL.LIGHT);
  uiBox(BOX.x, BOX.y, BOX.w, BOX.h);
  drawMenuIn(BOX, "CHOOSE YOUR OBJECTION!", [...OBJECTION_CATEGORIES], (i) => {
    thud();
    chooseCategory(OBJECTION_CATEGORIES[i]);
  });
  drawFooter("Z:SELECT   X:BACK");
}

function renderEvidencePicker() {
  headerTab("PRESENT EVIDENCE");
  drawPortrait("dino_saurus", PORTRAIT_X, PORTRAIT_Y);
  frame(PORTRAIT_X, PORTRAIT_Y, 96, 96, PAL.GRAY, 1);
  drawPower();
  // Show selected evidence detail top-right.
  const ev = MICRO_CASE.evidence[state.sel];
  uiBox(POWER_X, POWER_Y + 30, 100, 60);
  const lines = wrap(ev.text, 15);
  for (let i = 0; i < lines.length && i < 5; i++) {
    drawText(lines[i], POWER_X + 5, POWER_Y + 36 + i * 10, PAL.LIGHT);
  }
  uiBox(BOX.x, BOX.y, BOX.w, BOX.h);
  const items = MICRO_CASE.evidence.map((e) => e.name);
  drawMenuIn(BOX, "PRESENT WHICH EVIDENCE?", items, (i) => presentEvidence(MICRO_CASE.evidence[i].id));
  drawFooter("Z:PRESENT   X:BACK");
}

function renderEvidenceOverlay() {
  renderTestimony(); // dim background context
  // overlay panel
  const bx = 24, by = 40, bw = 208, bh = 120;
  uiBox(bx, by, bw, bh);
  drawText("COURT RECORD — EVIDENCE", bx + 8, by + 8, PAL.WHITE);
  const ev = MICRO_CASE.evidence[0];
  drawText(ev.name, bx + 8, by + 24, PAL.WHITE);
  const lines = wrap(ev.text, 30);
  for (let i = 0; i < lines.length; i++) {
    drawText(lines[i], bx + 8, by + 40 + i * 10, PAL.LIGHT);
  }
  drawFooter("X: CLOSE");
  addHot(0, 0, W, H, () => { state.mode = "TESTIMONY"; tick(); });
}

function renderBreakdown() {
  headerTab("BREAKDOWN!");
  drawPortrait("pterax", PORTRAIT_X, PORTRAIT_Y);
  frame(PORTRAIT_X, PORTRAIT_Y, 96, 96, PAL.GRAY, 1);
  // sweat drops
  for (const s of state.sweat) px(Math.floor(s.x), Math.floor(s.y), PAL.WHITE);
  drawPower();
  uiBox(BOX.x, BOX.y, BOX.w, BOX.h);
  drawDialogueIn(BOX);
  drawFooter("Z: CONTINUE");
  addHot(0, 0, W, H, confirm);
}

function renderPowerEmpty() {
  headerTab("OUT OF POWER");
  const bx = 28, by = 60, bw = 200, bh = 90;
  uiBox(bx, by, bw, bh);
  drawTextCentered("POWER DEPLETED.", W >> 1, by + 14, PAL.WHITE);
  drawTextCentered("THE JUDGE CALLS A RECESS.", W >> 1, by + 30, PAL.LIGHT);
  const rowY = by + 58;
  drawText(">", bx + 30, rowY, PAL.WHITE);
  drawText("RESTART TESTIMONY", bx + 42, rowY, PAL.WHITE);
  addHot(bx + 20, rowY - 3, bw - 40, 12, () => { thud(); resetTestimony(); });
  drawFooter("Z: RESTART");
}

function renderVerdict() {
  for (const c of state.confetti) px(Math.floor(c.x), Math.floor(c.y), PAL.WHITE);
  drawBig("NOT GUILTY", W >> 1, 40, 3, PAL.WHITE);
  uiBox(48, 90, 160, 44);
  drawTextCentered("CASE RANK", W >> 1, 100, PAL.LIGHT);
  drawBig(state.rank, W >> 1, 112, 2, PAL.WHITE);
  if (Math.floor(state.time * 2) % 2 === 0) {
    drawTextCentered("PRESS  Z  TO  PLAY  AGAIN", W >> 1, 170, PAL.WHITE);
  }
  addHot(0, 0, W, H, confirm);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  state.time += dt;

  if (state.mode === "OBJ_ANIM") {
    state.animT += dt;
    if (state.animT >= 0.9) {
      state.mode = "OBJ_MENU";
      state.sel = 0;
    }
  }

  updateDialogue(dt);
  updateParticles(dt);

  // Screen shake
  if (state.shake > 0) {
    setCam((Math.random() - 0.5) * 2 * state.shake, (Math.random() - 0.5) * 2 * state.shake);
  } else {
    setCam(0, 0);
  }

  render();
  setCam(0, 0);
  present(ctx);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Debug handle for automated testing / palette inspection.
(window as any).DINO = state;
