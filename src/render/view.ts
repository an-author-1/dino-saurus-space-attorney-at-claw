/*
 * Render layer (schema v2). Draws the current engine state into the 256x224
 * framebuffer. Reads the engine; never mutates it. All M0/M1 presentation rules
 * hold, plus: expression-aware portraits with a talk cycle, cue-driven shake,
 * the Court Record browser, RECESS, guidance/hints, and the interruption HUD.
 */

import {
  W,
  H,
  BLACK,
  GRAY,
  SILVER,
  WHITE,
  CELL,
  LINE_H,
  panel,
  outline,
  headerTab,
  drawText,
  drawTextCentered,
  wrap,
} from "./gfx";
import { Portraits } from "./portraits";
import type { Engine } from "../engine/engine";
import type { Cue, Phase } from "../engine/state";
import type { Hotspot } from "../input/input";

const PORTRAIT_X = 8;
const PORTRAIT_Y = 22;
const STATUS = { x: 112, y: 22, w: 138, h: 96 };
const DBOX = { x: 6, y: 124, w: 244, h: 62 };
const DBOX_TX = DBOX.x + 8;
const DBOX_TY = DBOX.y + 8;
const DCOLS = Math.floor((DBOX.w - 16) / CELL);
const OBJ_ANIM_DUR = 0.75;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tw: number;
}

export class View {
  private t = 0;
  private shakeT = 0;
  private shakeDur = 0.0001;
  private shakeAmp = 0;

  private stars: Particle[] = [];
  private confetti: Particle[] = [];
  private sweat: Particle[] = [];
  private prevPhase: Phase | null = null;
  private hotspots: Hotspot[] = [];

  constructor(private portraits: Portraits) {
    for (let i = 0; i < 64; i++) {
      this.stars.push({ x: (i * 71) % W, y: (i * 37 + 13) % (H - 40), vx: 0, vy: 0, tw: (i * 7) % 30 });
    }
  }

  onCue(cue: Cue): void {
    if (cue.shake === "heavy") this.shake(5, 0.5);
    else if (cue.shake === "light") this.shake(3, 0.28);
  }

  private shake(amp: number, dur: number): void {
    this.shakeAmp = amp;
    this.shakeDur = dur;
    this.shakeT = dur;
  }

  update(dt: number, eng: Engine): void {
    this.t += dt;
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
    const phase = eng.state.phase;
    if (phase !== this.prevPhase) {
      if (phase === "BREAKDOWN") this.spawnSweat();
      if (phase === "VERDICT") this.spawnConfetti();
      this.prevPhase = phase;
    }
    if (phase === "BREAKDOWN") {
      for (const p of this.sweat) {
        p.y += p.vy * dt;
        if (p.y > PORTRAIT_Y + 96) p.y = PORTRAIT_Y + 6;
      }
    }
    if (phase === "VERDICT") {
      for (const p of this.confetti) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > H) {
          p.y = -2;
          p.x = (p.x + 97) % W;
        }
      }
    }
  }

  private spawnSweat(): void {
    this.sweat = [];
    for (let i = 0; i < 6; i++) {
      this.sweat.push({ x: PORTRAIT_X + 20 + i * 9, y: PORTRAIT_Y + 8 + (i % 2) * 6, vx: 0, vy: 20 + (i % 3) * 8, tw: i * 5 });
    }
  }
  private spawnConfetti(): void {
    this.confetti = [];
    for (let i = 0; i < 70; i++) {
      this.confetti.push({ x: (i * 53) % W, y: -((i * 29) % H), vx: ((i % 5) - 2) * 6, vy: 30 + (i % 7) * 10, tw: i });
    }
  }

  /* --------------------------------------------------------------- render - */

  render(ctx: CanvasRenderingContext2D, eng: Engine): Hotspot[] {
    this.hotspots = [];
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, W, H);

    let sx = 0;
    let sy = 0;
    if (this.shakeT > 0) {
      const amp = this.shakeAmp * (this.shakeT / this.shakeDur);
      sx = Math.round(Math.sin(this.t * 97) * amp);
      sy = Math.round(Math.cos(this.t * 83) * amp);
    }
    ctx.save();
    ctx.translate(sx, sy);

    const phase = eng.state.phase;
    switch (phase) {
      case "TITLE": this.renderTitle(ctx, eng); break;
      case "CASE_PICK": this.renderCasePick(ctx, eng, "SELECT CASE"); break;
      case "DEV_JUMP": this.renderCasePick(ctx, eng, "DEV: JUMP TO"); break;
      case "BRIEFING":
      case "INTRO":
      case "GUIDANCE":
      case "HINT": this.renderTalking(ctx, eng); break;
      case "TESTIMONY":
      case "PRESS_MENU":
      case "PRESS_RESPONSE":
      case "EVIDENCE_PICK":
      case "HINT_CONFIRM":
      case "JUDGE_LINE":
      case "BREAKDOWN": this.renderCourt(ctx, eng); break;
      case "INTERRUPTION": this.renderInterruption(ctx, eng); break;
      case "OBJECTION_ANIM": this.renderObjectionSlam(ctx, eng); break;
      case "OBJECTION_MENU": this.renderObjectionMenu(ctx, eng); break;
      case "RECESS": this.renderRecess(ctx, eng); break;
      case "VERDICT": this.renderVerdict(ctx, eng); break;
      case "POWER_EMPTY": this.renderPowerEmpty(ctx, eng); break;
      case "EVIDENCE_OVERLAY":
        this.renderCourt(ctx, eng);
        this.renderRecord(ctx, eng, false);
        break;
    }

    if (phase === "EVIDENCE_PICK") this.renderRecord(ctx, eng, true);

    ctx.restore();

    if (
      phase === "TITLE" || phase === "BRIEFING" || phase === "INTRO" || phase === "GUIDANCE" ||
      phase === "HINT" || phase === "PRESS_RESPONSE" || phase === "JUDGE_LINE" || phase === "BREAKDOWN" ||
      phase === "VERDICT" || phase === "OBJECTION_ANIM" || phase === "RECESS" || phase === "INTERRUPTION"
    ) {
      this.hotspots.push({ x: 0, y: 0, w: W, h: H, action: "confirm" });
    }
    return this.hotspots;
  }

  /* --------- portraits ------------------------------------------------ */

  private portraitFor(phase: Phase, eng: Engine): string {
    switch (phase) {
      case "INTRO":
      case "JUDGE_LINE": return "judge";
      case "OBJECTION_MENU":
      case "BRIEFING":
      case "GUIDANCE":
      case "HINT": return "dino_saurus";
      default: return eng.currentWitness()?.portrait ?? "pterax";
    }
  }

  private drawPortrait(ctx: CanvasRenderingContext2D, eng: Engine, character: string, x: number, y: number, shake = false): void {
    let px = x;
    let py = y;
    if (shake) {
      px += Math.round(Math.sin(this.t * 120) * 3);
      py += Math.round(Math.cos(this.t * 90) * 2);
    }
    const box = eng.currentBox();
    const talking = !!box && !box.boxDone;
    this.portraits.draw(ctx, character, px, py, { expression: eng.state.expression, talking });
  }

  /* --------- shared bits ---------------------------------------------- */

  private nameplate(speaker: string, witnessName: string): string {
    if (!speaker) return "";
    return speaker === witnessName ? `WITNESS ${speaker}` : speaker;
  }

  private drawRevealed(ctx: CanvasRenderingContext2D, lines: string[], shown: number, x: number, y: number): void {
    let budget = shown;
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li];
      const vis = Math.max(0, Math.min(l.length, budget));
      drawText(ctx, l.slice(0, vis), x, y + li * LINE_H);
      budget -= vis;
      if (li < lines.length - 1) budget -= 1;
      if (budget < 0) budget = 0;
    }
  }

  private drawPips(ctx: CanvasRenderingContext2D, x: number, y: number, power: number): void {
    for (let i = 0; i < 5; i++) {
      const px = x + i * 11;
      if (i < power) {
        ctx.fillStyle = WHITE;
        ctx.fillRect(px, y, 8, 8);
      } else outline(ctx, px, y, 8, 8, GRAY);
    }
  }

  private drawStatusPanel(ctx: CanvasRenderingContext2D, eng: Engine): void {
    const { x, y, w, h } = STATUS;
    panel(ctx, x, y, w, h);
    drawText(ctx, "WITNESS", x + 8, y + 8, GRAY);
    drawText(ctx, eng.currentWitness()?.name ?? "", x + 8, y + 20, WHITE, CELL, 8);
    ctx.fillStyle = GRAY;
    ctx.fillRect(x + 6, y + 36, w - 12, 1);
    drawText(ctx, "POWER", x + 8, y + 44, SILVER);
    this.drawPips(ctx, x + 8, y + 56, eng.state.power);
    drawText(ctx, `< ${eng.state.idx + 1}/${eng.state.order.length} >`, x + 8, y + 72, WHITE);
    drawText(ctx, "[C] REC  [H] HINT", x + 8, y + 84, GRAY, 6);
  }

  private drawDialogueBox(ctx: CanvasRenderingContext2D, eng: Engine, nameOverride?: string): void {
    panel(ctx, DBOX.x, DBOX.y, DBOX.w, DBOX.h);
    const box = eng.currentBox();
    if (!box) return;
    const name = nameOverride ?? this.nameplate(box.line.speaker, eng.currentWitness()?.name ?? "");
    if (name) {
      const tagW = name.length * CELL + 8;
      panel(ctx, DBOX.x + 6, DBOX.y - 7, tagW, 12);
      drawText(ctx, name, DBOX.x + 10, DBOX.y - 4, SILVER);
    }
    this.drawRevealed(ctx, wrap(box.line.text, DCOLS), box.shown, DBOX_TX, DBOX_TY + 4);
    if (box.boxDone && Math.floor(this.t * 2) % 2 === 0) drawText(ctx, "▼", DBOX.x + DBOX.w - 16, DBOX.y + DBOX.h - 14, WHITE);
  }

  private drawMenuBox(ctx: CanvasRenderingContext2D, eng: Engine, prompt: string): void {
    panel(ctx, DBOX.x, DBOX.y, DBOX.w, DBOX.h);
    drawText(ctx, prompt, DBOX_TX, DBOX.y + 6, SILVER);
    const menu = eng.state.menu;
    const startY = DBOX.y + 20;
    for (let i = 0; i < menu.length; i++) {
      const iy = startY + i * 12;
      const isSel = i === eng.state.sel;
      if (isSel) drawText(ctx, ">", DBOX_TX, iy, WHITE);
      drawText(ctx, menu[i].label, DBOX_TX + 14, iy, isSel ? WHITE : SILVER);
      this.hotspots.push({ x: DBOX.x, y: iy - 2, w: DBOX.w, h: 12, action: `menu:${i}` });
    }
  }

  /* --------- TITLE / CASE PICK ---------------------------------------- */

  private renderTitle(ctx: CanvasRenderingContext2D, eng: Engine): void {
    for (const s of this.stars) {
      const phase = (this.t * 6 + s.tw) % 3;
      ctx.fillStyle = phase < 1 ? WHITE : phase < 2 ? SILVER : GRAY;
      ctx.fillRect(s.x, s.y, 1, 1);
    }
    this.drawPlanet(ctx, 208, 150, 18);
    drawTextCentered(ctx, "DINO SAURUS", 0, W, 30, WHITE, 12, 16);
    drawTextCentered(ctx, "SPACE ATTORNEY AT CLAW", 0, W, 52, SILVER, CELL, 8);
    this.portraits.draw(ctx, "dino_saurus", 18, 96, { expression: "confident" });
    const bx = 104, bw = 144, by = 118;
    panel(ctx, bx, by, bw, 50);
    if (eng.caseList.length > 1) {
      drawTextCentered(ctx, `${eng.caseList.length} CASES`, bx, bw, by + 8, WHITE, 6);
      drawTextCentered(ctx, "ON THE DOCKET", bx, bw, by + 20, SILVER, 6);
    } else {
      drawTextCentered(ctx, `MICRO-CASE ${eng.case.case}`, bx, bw, by + 8, WHITE, 6);
      drawTextCentered(ctx, eng.case.title, bx, bw, by + 20, SILVER, 6);
    }
    if (Math.floor(this.t * 2) % 2 === 0) drawTextCentered(ctx, "PRESS Z", bx, bw, by + 34, WHITE);
    drawTextCentered(ctx, "(C) 3087 CLAW ENTERPRISES", 0, W, H - 14, GRAY);
  }

  private renderCasePick(ctx: CanvasRenderingContext2D, eng: Engine, title: string): void {
    headerTab(ctx, title);
    const menu = eng.state.menu;
    const bx = 20, by = 34, bw = W - 40, bh = 172;
    panel(ctx, bx, by, bw, bh);
    const rows = Math.min(menu.length, 10);
    const top = Math.max(0, Math.min(eng.state.sel - 4, menu.length - rows));
    for (let r = 0; r < rows; r++) {
      const i = top + r;
      const iy = by + 12 + r * 15;
      const isSel = i === eng.state.sel;
      if (isSel) drawText(ctx, ">", bx + 8, iy, WHITE);
      drawText(ctx, menu[i].label, bx + 20, iy, isSel ? WHITE : SILVER, 6);
      this.hotspots.push({ x: bx, y: iy - 3, w: bw, h: 15, action: `menu:${i}` });
    }
  }

  private drawPlanet(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++)
        if (x * x + y * y <= r * r) {
          ctx.fillStyle = (x + y) % 2 === 0 ? SILVER : GRAY;
          ctx.fillRect(cx + x, cy + y, 1, 1);
        }
    ctx.fillStyle = WHITE;
    for (let x = -r - 8; x <= r + 8; x++) ctx.fillRect(cx + x, cy + Math.round(x * 0.28), 1, 1);
  }

  /* --------- talking scenes (briefing/intro/guidance/hint) ------------ */

  private renderTalking(ctx: CanvasRenderingContext2D, eng: Engine): void {
    const banner = eng.state.banner || "CROSS EXAMINATION";
    headerTab(ctx, banner);
    const character = this.portraitFor(eng.state.phase, eng);
    this.drawPortrait(ctx, eng, character, PORTRAIT_X, PORTRAIT_Y);
    const box = eng.currentBox();
    panel(ctx, STATUS.x, STATUS.y, STATUS.w, 20);
    drawText(ctx, box?.line.speaker ?? "", STATUS.x + 8, STATUS.y + 6, SILVER);
    this.drawDialogueBox(ctx, eng);
  }

  /* --------- COURT ---------------------------------------------------- */

  private renderCourt(ctx: CanvasRenderingContext2D, eng: Engine): void {
    const phase = eng.state.phase;
    const isBreakdown = phase === "BREAKDOWN";
    headerTab(ctx, isBreakdown ? "TESTIMONY" : "CROSS EXAMINATION");
    const character = this.portraitFor(phase, eng);
    this.drawPortrait(ctx, eng, character, PORTRAIT_X, PORTRAIT_Y, isBreakdown);
    this.drawStatusPanel(ctx, eng);

    if (isBreakdown) {
      for (const p of this.sweat) {
        ctx.fillStyle = WHITE;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 3);
      }
    }

    if (phase === "PRESS_MENU") this.drawMenuBox(ctx, eng, "WHAT WILL YOU PRESS?");
    else if (phase === "HINT_CONFIRM") this.drawMenuBox(ctx, eng, "A HINT LOWERS YOUR RANK. SURE?");
    else if (phase === "EVIDENCE_PICK") this.drawDialogueBox(ctx, eng); // record grid drawn on top
    else this.drawDialogueBox(ctx, eng);

    if (phase === "TESTIMONY") this.drawTestimonyFooter(ctx);
  }

  private drawTestimonyFooter(ctx: CanvasRenderingContext2D): void {
    const ay = DBOX.y + Math.floor(DBOX.h / 2) - 8;
    panel(ctx, DBOX.x - 2, ay, 12, 16);
    drawText(ctx, "◀", DBOX.x, ay + 4, WHITE, 6);
    this.hotspots.push({ x: DBOX.x - 6, y: ay - 4, w: 22, h: 24, action: "left" });
    panel(ctx, DBOX.x + DBOX.w - 10, ay, 12, 16);
    drawText(ctx, "▶", DBOX.x + DBOX.w - 8, ay + 4, WHITE, 6);
    this.hotspots.push({ x: DBOX.x + DBOX.w - 14, y: ay - 4, w: 22, h: 24, action: "right" });

    const btns: { label: string; action: Hotspot["action"] }[] = [
      { label: "[Z]PRESS", action: "confirm" },
      { label: "[X]OBJ", action: "back" },
      { label: "[C]REC", action: "evidence" },
      { label: "[H]HINT", action: "hint" },
    ];
    const bw = Math.floor((W - 12 - 3 * 3) / 4);
    const by = 194;
    btns.forEach((b, i) => {
      const bx = 6 + i * (bw + 3);
      panel(ctx, bx, by, bw, 24);
      drawTextCentered(ctx, b.label, bx, bw, by + 8, WHITE, 6);
      this.hotspots.push({ x: bx, y: by, w: bw, h: 24, action: b.action });
    });
  }

  /* --------- INTERRUPTION --------------------------------------------- */

  private renderInterruption(ctx: CanvasRenderingContext2D, eng: Engine): void {
    headerTab(ctx, eng.state.banner || "INTERRUPTION");
    this.drawPortrait(ctx, eng, eng.currentWitness()?.portrait ?? "pterax", PORTRAIT_X, PORTRAIT_Y);

    // Status: PROSECUTION label + POWER + a countdown bar.
    panel(ctx, STATUS.x, STATUS.y, STATUS.w, STATUS.h);
    drawText(ctx, "PROSECUTION", STATUS.x + 8, STATUS.y + 8, SILVER);
    ctx.fillStyle = GRAY;
    ctx.fillRect(STATUS.x + 6, STATUS.y + 24, STATUS.w - 12, 1);
    drawText(ctx, "POWER", STATUS.x + 8, STATUS.y + 30, SILVER);
    this.drawPips(ctx, STATUS.x + 8, STATUS.y + 42, eng.state.power);
    // Countdown bar: time left before the line scrolls away.
    const p = 1 - eng.interruptionProgress();
    const barW = STATUS.w - 16;
    outline(ctx, STATUS.x + 8, STATUS.y + 58, barW, 8, GRAY);
    ctx.fillStyle = WHITE;
    ctx.fillRect(STATUS.x + 9, STATUS.y + 59, Math.round((barW - 2) * p), 6);
    if (Math.floor(this.t * 3) % 2 === 0) drawText(ctx, "SLAM [Z] TO OBJECT", STATUS.x + 8, STATUS.y + 76, WHITE, 6);

    this.drawDialogueBox(ctx, eng, "PROSECUTOR");
  }

  /* --------- OBJECTION! ----------------------------------------------- */

  private renderObjectionSlam(ctx: CanvasRenderingContext2D, eng: Engine): void {
    const p = Math.min(1, eng.state.objTimer / OBJ_ANIM_DUR);
    const cx = W / 2, cy = H / 2;
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = WHITE;
    for (let k = 0; k < 28; k++) {
      const ang = (k / 28) * Math.PI * 2 + p * 0.4;
      for (let r = 40 + p * 30; r < 200; r += 3)
        if (Math.floor(r / 3) % 2 === 0) ctx.fillRect(Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r), 1, 1);
    }
    this.drawStarBurst(ctx, cx, cy, 24 + Math.min(1, p / 0.35) * 82, 14);
    if (p > 0.15) {
      const grow = Math.min(1, (p - 0.15) / 0.2);
      drawTextCentered(ctx, "OBJECTION!", 0, W, cy - (13 + grow * 2) / 2, BLACK, Math.round(10 + grow * 2), Math.round(13 + grow * 2));
    }
  }

  private drawStarBurst(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, points: number): void {
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    const total = points * 2;
    for (let i = 0; i < total; i++) {
      const ang = (i / total) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.72;
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  private renderObjectionMenu(ctx: CanvasRenderingContext2D, eng: Engine): void {
    headerTab(ctx, "OBJECTION!");
    this.portraits.draw(ctx, "dino_saurus", PORTRAIT_X, PORTRAIT_Y, { expression: "pointing" });
    panel(ctx, STATUS.x, STATUS.y, STATUS.w, STATUS.h);
    drawText(ctx, "DINO SAURUS", STATUS.x + 8, STATUS.y + 8, SILVER);
    wrap("THE TRUTH IS ONE OF THESE.", 16).forEach((l, i) => drawText(ctx, l, STATUS.x + 8, STATUS.y + 22 + i * LINE_H, WHITE));
    ctx.fillStyle = GRAY;
    ctx.fillRect(STATUS.x + 6, STATUS.y + 58, STATUS.w - 12, 1);
    drawText(ctx, "POWER", STATUS.x + 8, STATUS.y + 64, SILVER);
    this.drawPips(ctx, STATUS.x + 8, STATUS.y + 76, eng.state.power);
    this.drawMenuBox(ctx, eng, "CHOOSE YOUR OBJECTION!");
  }

  /* --------- COURT RECORD browser (overlay + picker) ------------------ */

  private renderRecord(ctx: CanvasRenderingContext2D, eng: Engine, picking: boolean): void {
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, W, H);
    headerTab(ctx, picking ? "PRESENT EVIDENCE" : "COURT RECORD");
    const items = eng.evidenceItems();
    const sel = eng.state.sel;

    // Icon grid (6 per row, 24x24 cells).
    const cols = 6;
    const cell = 34;
    const gx0 = Math.round((W - cols * cell) / 2) + 5;
    const gy0 = 26;
    items.forEach((e, i) => {
      const gx = gx0 + (i % cols) * cell;
      const gy = gy0 + Math.floor(i / cols) * cell;
      this.drawEvidenceIcon(ctx, e.icon ?? "", e.name, gx, gy, i === sel);
      this.hotspots.push({ x: gx - 2, y: gy - 2, w: 28, h: 28, action: picking ? `menu:${i}` : `sel:${i}` });
    });

    // Detail panel for the selected item.
    const bx = 14, by = 92, bw = W - 28, bh = 96;
    panel(ctx, bx, by, bw, bh);
    const e = items[sel];
    if (e) {
      drawText(ctx, e.name, bx + 10, by + 10, WHITE);
      ctx.fillStyle = GRAY;
      ctx.fillRect(bx + 10, by + 26, bw - 20, 1);
      wrap(e.desc, Math.floor((bw - 20) / CELL)).forEach((l, i) => drawText(ctx, l, bx + 10, by + 34 + i * LINE_H, SILVER));
    } else {
      drawTextCentered(ctx, "COURT RECORD EMPTY", bx, bw, by + 40, GRAY);
    }
    drawTextCentered(ctx, picking ? "[Z] PRESENT   [X] BACK" : "[X] CLOSE", bx, bw, by + bh - 14, WHITE, 6);
  }

  private drawEvidenceIcon(ctx: CanvasRenderingContext2D, icon: string, name: string, x: number, y: number, selected: boolean): void {
    panel(ctx, x, y, 24, 24);
    if (selected) outline(ctx, x - 2, y - 2, 28, 28, WHITE);
    // A little document-ish glyph; lines for "log", else a folded page.
    ctx.fillStyle = SILVER;
    if (icon === "log") {
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 5, y + 6 + i * 4, 14, 1);
      ctx.fillStyle = WHITE;
      ctx.fillRect(x + 5, y + 5, 14, 1);
    } else {
      ctx.fillRect(x + 6, y + 5, 12, 14);
      ctx.fillStyle = GRAY;
      ctx.fillRect(x + 14, y + 5, 4, 4); // corner fold
      ctx.fillStyle = BLACK;
      for (let i = 0; i < 3; i++) ctx.fillRect(x + 8, y + 9 + i * 3, 8, 1);
    }
    // First letter for identification.
    drawText(ctx, (name[0] ?? "?"), x + 2, y + 25, GRAY, 6, 6);
  }

  /* --------- RECESS --------------------------------------------------- */

  private renderRecess(ctx: CanvasRenderingContext2D, eng: Engine): void {
    for (const s of this.stars) {
      ctx.fillStyle = ((this.t * 4 + s.tw) | 0) % 2 === 0 ? GRAY : SILVER;
      ctx.fillRect(s.x, s.y, 1, 1);
    }
    const bw = 180, bh = 96, bx = Math.round((W - bw) / 2), by = 56;
    panel(ctx, bx, by, bw, bh);
    drawTextCentered(ctx, "RECESS", bx, bw, by + 14, WHITE, 11, 14);
    drawTextCentered(ctx, "THE COURT TAKES A BREAK.", bx, bw, by + 40, SILVER, 6);
    drawTextCentered(ctx, `POWER RESTORED  (${eng.state.power}/${eng.case.failure.power})`, bx, bw, by + 54, WHITE, 6);
    if (Math.floor(this.t * 2) % 2 === 0) drawTextCentered(ctx, "[Z] RESUME", bx, bw, by + bh - 16, WHITE);
  }

  /* --------- VERDICT / POWER EMPTY ------------------------------------ */

  private renderVerdict(ctx: CanvasRenderingContext2D, eng: Engine): void {
    for (const p of this.confetti) {
      ctx.fillStyle = (Math.floor(p.tw) + Math.floor(this.t * 4)) % 2 === 0 ? WHITE : SILVER;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    const bw = 190, bh = 116, bx = Math.round((W - bw) / 2), by = 36;
    panel(ctx, bx, by, bw, bh);
    drawTextCentered(ctx, "VERDICT", bx, bw, by + 12, SILVER);
    const win = eng.state.endResult !== "lose";
    drawTextCentered(ctx, win ? "NOT GUILTY" : "GUILTY", bx, bw, by + 30, WHITE, 11, 14);
    drawTextCentered(ctx, `CASE RANK: ${eng.rank()}`, bx, bw, by + 58, WHITE);
    const lost = eng.case.failure.power - eng.state.power;
    drawTextCentered(ctx, `POWER LOST ${lost}   HINTS ${eng.state.hintsUsed}`, bx, bw, by + 74, GRAY, 6);
    if (Math.floor(this.t * 2) % 2 === 0) drawTextCentered(ctx, "[Z] PLAY AGAIN", bx, bw, by + bh - 16, WHITE);
  }

  private renderPowerEmpty(ctx: CanvasRenderingContext2D, eng: Engine): void {
    headerTab(ctx, "OUT OF POWER");
    this.drawPortrait(ctx, eng, eng.currentWitness()?.portrait ?? "pterax", PORTRAIT_X, PORTRAIT_Y);
    this.drawStatusPanel(ctx, eng);
    panel(ctx, DBOX.x, DBOX.y, DBOX.w, DBOX.h);
    wrap("YOUR CREDIBILITY IS SPENT. STEADY YOURSELF AND TRY AGAIN.", DCOLS).forEach((l, i) =>
      drawText(ctx, l, DBOX_TX, DBOX_TY + i * LINE_H, SILVER),
    );
    const iy = 196;
    panel(ctx, 40, iy - 2, W - 80, 22);
    if (eng.state.sel === 0) drawText(ctx, ">", 50, iy + 4, WHITE);
    drawTextCentered(ctx, "RESTART TESTIMONY", 40, W - 80, iy + 4, WHITE);
    this.hotspots.push({ x: 40, y: iy - 2, w: W - 80, h: 22, action: "menu:0" });
  }
}
