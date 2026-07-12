/*
 * Render layer. Draws the current engine state into the 256x224 framebuffer.
 * Reads the engine; never mutates it. All M0 presentation rules live here:
 * the house UI style, typewriter reveal, the OBJECTION! slam, screen shake,
 * particles, portraits. The four-color post-pass runs in main.
 *
 * This is a straight adaptation of the M0 renderer, re-pointed from the old
 * `this.*` game fields to the engine's observable state.
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
import { Portraits, type Who } from "./portraits";
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
      this.stars.push({
        x: Math.floor((i * 71) % W),
        y: Math.floor((i * 37 + 13) % (H - 40)),
        vx: 0,
        vy: 0,
        tw: (i * 7) % 30,
      });
    }
  }

  /** React to engine cues that have a visual component (screen shake). */
  onCue(cue: Cue): void {
    if (cue.kind === "objection") this.shake(5, 0.5);
    else if (cue.kind === "wrong") this.shake(3, 0.28);
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
      this.sweat.push({
        x: PORTRAIT_X + 20 + i * 9,
        y: PORTRAIT_Y + 8 + (i % 2) * 6,
        vx: 0,
        vy: 20 + (i % 3) * 8,
        tw: i * 5,
      });
    }
  }

  private spawnConfetti(): void {
    this.confetti = [];
    for (let i = 0; i < 70; i++) {
      this.confetti.push({
        x: (i * 53) % W,
        y: -((i * 29) % H),
        vx: ((i % 5) - 2) * 6,
        vy: 30 + (i % 7) * 10,
        tw: i,
      });
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
      case "TITLE":
        this.renderTitle(ctx, eng);
        break;
      case "INTRO":
        this.renderIntro(ctx, eng);
        break;
      case "TESTIMONY":
      case "PRESS_MENU":
      case "PRESS_RESPONSE":
      case "EVIDENCE_PICK":
      case "JUDGE_LINE":
      case "BREAKDOWN":
        this.renderCourt(ctx, eng);
        break;
      case "OBJECTION_ANIM":
        this.renderObjectionSlam(ctx, eng);
        break;
      case "OBJECTION_MENU":
        this.renderObjectionMenu(ctx, eng);
        break;
      case "VERDICT":
        this.renderVerdict(ctx, eng);
        break;
      case "POWER_EMPTY":
        this.renderPowerEmpty(ctx, eng);
        break;
      case "EVIDENCE_OVERLAY":
        this.renderCourt(ctx, eng);
        this.renderEvidenceOverlay(ctx, eng);
        break;
    }

    ctx.restore();

    // Whole-screen tap-to-advance for reading / interrupt states.
    if (
      phase === "TITLE" ||
      phase === "INTRO" ||
      phase === "PRESS_RESPONSE" ||
      phase === "JUDGE_LINE" ||
      phase === "BREAKDOWN" ||
      phase === "VERDICT" ||
      phase === "OBJECTION_ANIM"
    ) {
      this.hotspots.push({ x: 0, y: 0, w: W, h: H, action: "confirm" });
    }
    return this.hotspots;
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
      if (li < lines.length - 1) budget -= 1; // the wrap space
      if (budget < 0) budget = 0;
    }
  }

  private drawPips(ctx: CanvasRenderingContext2D, x: number, y: number, power: number): void {
    const size = 8;
    const gap = 3;
    for (let i = 0; i < 5; i++) {
      const px = x + i * (size + gap);
      if (i < power) {
        ctx.fillStyle = WHITE;
        ctx.fillRect(px, y, size, size);
      } else {
        outline(ctx, px, y, size, size, GRAY);
      }
    }
  }

  private drawStatusPanel(ctx: CanvasRenderingContext2D, eng: Engine): void {
    const { x, y, w, h } = STATUS;
    panel(ctx, x, y, w, h);
    drawText(ctx, "WITNESS", x + 8, y + 8, GRAY);
    drawText(ctx, eng.currentWitness().name, x + 8, y + 20, WHITE, CELL, 8);
    ctx.fillStyle = GRAY;
    ctx.fillRect(x + 6, y + 36, w - 12, 1);
    drawText(ctx, "POWER", x + 8, y + 44, SILVER);
    this.drawPips(ctx, x + 8, y + 56, eng.state.power);
    const counter = `< ${eng.state.idx + 1}/${eng.state.order.length} >`;
    drawText(ctx, counter, x + 8, y + 72, WHITE);
    drawText(ctx, "[C] EVIDENCE", x + 8, y + 84, GRAY);
  }

  private drawDialogueBox(ctx: CanvasRenderingContext2D, eng: Engine): void {
    panel(ctx, DBOX.x, DBOX.y, DBOX.w, DBOX.h);
    const box = eng.currentBox();
    if (!box) return;
    const name = this.nameplate(box.line.speaker, eng.currentWitness().name);
    if (name) {
      const tagW = name.length * CELL + 8;
      panel(ctx, DBOX.x + 6, DBOX.y - 7, tagW, 12);
      drawText(ctx, name, DBOX.x + 10, DBOX.y - 4, SILVER);
    }
    const lines = wrap(box.line.text, DCOLS);
    this.drawRevealed(ctx, lines, box.shown, DBOX_TX, DBOX_TY + 4);
    if (box.boxDone && Math.floor(this.t * 2) % 2 === 0) {
      drawText(ctx, "▼", DBOX.x + DBOX.w - 16, DBOX.y + DBOX.h - 14, WHITE);
    }
  }

  private drawMenuBox(ctx: CanvasRenderingContext2D, eng: Engine, prompt: string): void {
    panel(ctx, DBOX.x, DBOX.y, DBOX.w, DBOX.h);
    drawText(ctx, prompt, DBOX_TX, DBOX.y + 6, SILVER);
    const startY = DBOX.y + 20;
    const menu = eng.state.menu;
    for (let i = 0; i < menu.length; i++) {
      const iy = startY + i * 13;
      const isSel = i === eng.state.sel;
      if (isSel) drawText(ctx, ">", DBOX_TX, iy, WHITE);
      drawText(ctx, menu[i].label, DBOX_TX + 14, iy, isSel ? WHITE : SILVER);
      this.hotspots.push({ x: DBOX.x, y: iy - 2, w: DBOX.w, h: 13, action: `menu:${i}` });
    }
  }

  /* --------- TITLE ---------------------------------------------------- */

  private renderTitle(ctx: CanvasRenderingContext2D, eng: Engine): void {
    for (const s of this.stars) {
      const phase = (this.t * 6 + s.tw) % 3;
      ctx.fillStyle = phase < 1 ? WHITE : phase < 2 ? SILVER : GRAY;
      ctx.fillRect(s.x, s.y, 1, 1);
    }
    this.drawPlanet(ctx, 208, 150, 18);
    drawTextCentered(ctx, "DINO SAURUS", 0, W, 30, WHITE, 12, 16);
    drawTextCentered(ctx, "SPACE ATTORNEY AT CLAW", 0, W, 52, SILVER, CELL, 8);
    this.portraits.draw(ctx, "dino_saurus", 18, 96);

    const bx = 104;
    const bw = 144;
    const by = 118;
    panel(ctx, bx, by, bw, 50);
    drawTextCentered(ctx, `MICRO-CASE ${eng.case.case}`, bx, bw, by + 8, WHITE, 6);
    drawTextCentered(ctx, eng.case.title, bx, bw, by + 20, SILVER, 6);
    if (Math.floor(this.t * 2) % 2 === 0) {
      drawTextCentered(ctx, "PRESS Z", bx, bw, by + 34, WHITE);
    }
    drawTextCentered(ctx, "(C) 3087 CLAW ENTERPRISES", 0, W, H - 14, GRAY);
  }

  private drawPlanet(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r) {
          ctx.fillStyle = (x + y) % 2 === 0 ? SILVER : GRAY;
          ctx.fillRect(cx + x, cy + y, 1, 1);
        }
      }
    }
    ctx.fillStyle = WHITE;
    for (let x = -r - 8; x <= r + 8; x++) {
      const y = Math.round(x * 0.28);
      ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  }

  /* --------- INTRO ---------------------------------------------------- */

  private renderIntro(ctx: CanvasRenderingContext2D, eng: Engine): void {
    headerTab(ctx, "CROSS EXAMINATION");
    this.portraits.draw(ctx, "judge", PORTRAIT_X, PORTRAIT_Y);
    const box = eng.currentBox();
    panel(ctx, STATUS.x, STATUS.y, STATUS.w, 20);
    drawText(ctx, box?.line.speaker ?? "", STATUS.x + 8, STATUS.y + 6, SILVER);
    this.drawDialogueBox(ctx, eng);
  }

  /* --------- COURT ---------------------------------------------------- */

  private renderCourt(ctx: CanvasRenderingContext2D, eng: Engine): void {
    const phase = eng.state.phase;
    const isBreakdown = phase === "BREAKDOWN";
    const isJudge = phase === "JUDGE_LINE";

    headerTab(ctx, isBreakdown ? "TESTIMONY" : "CROSS EXAMINATION");

    const who: Who = isJudge ? "judge" : (eng.currentWitness().portrait as Who);
    let px = PORTRAIT_X;
    let py = PORTRAIT_Y;
    if (isBreakdown) {
      px += Math.round(Math.sin(this.t * 120) * 3);
      py += Math.round(Math.cos(this.t * 90) * 2);
    }
    this.portraits.draw(ctx, who, px, py);
    this.drawStatusPanel(ctx, eng);

    if (isBreakdown) {
      for (const p of this.sweat) {
        ctx.fillStyle = WHITE;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 3);
      }
    }

    if (phase === "PRESS_MENU") this.drawMenuBox(ctx, eng, "WHAT WILL YOU PRESS?");
    else if (phase === "EVIDENCE_PICK") this.drawMenuBox(ctx, eng, "PRESENT WHICH EVIDENCE?");
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
      { label: "[Z] PRESS", action: "confirm" },
      { label: "[X] OBJECT", action: "back" },
      { label: "[C] EVID", action: "evidence" },
    ];
    const bw = Math.floor((W - 12 - 2 * 4) / 3);
    const by = 194;
    const bh = 24;
    btns.forEach((b, i) => {
      const bx = 6 + i * (bw + 4);
      panel(ctx, bx, by, bw, bh);
      drawTextCentered(ctx, b.label, bx, bw, by + 8, WHITE, 6);
      this.hotspots.push({ x: bx, y: by, w: bw, h: bh, action: b.action });
    });
  }

  /* --------- OBJECTION! ----------------------------------------------- */

  private renderObjectionSlam(ctx: CanvasRenderingContext2D, eng: Engine): void {
    const p = Math.min(1, eng.state.objTimer / OBJ_ANIM_DUR);
    const cx = W / 2;
    const cy = H / 2;
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, W, H);

    const N = 28;
    ctx.fillStyle = WHITE;
    for (let k = 0; k < N; k++) {
      const ang = (k / N) * Math.PI * 2 + p * 0.4;
      const inner = 40 + p * 30;
      for (let r = inner; r < 200; r += 3) {
        if (Math.floor(r / 3) % 2 === 0) {
          ctx.fillRect(Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r), 1, 1);
        }
      }
    }
    const burstR = 24 + Math.min(1, p / 0.35) * 82;
    this.drawStarBurst(ctx, cx, cy, burstR, 14, WHITE);
    if (p > 0.15) {
      const grow = Math.min(1, (p - 0.15) / 0.2);
      const cell = Math.round(10 + grow * 2);
      const size = Math.round(13 + grow * 2);
      drawTextCentered(ctx, "OBJECTION!", 0, W, cy - size / 2, BLACK, cell, size);
    }
  }

  private drawStarBurst(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    points: number,
    color: string,
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    const total = points * 2;
    for (let i = 0; i < total; i++) {
      const ang = (i / total) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.72;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  private renderObjectionMenu(ctx: CanvasRenderingContext2D, eng: Engine): void {
    headerTab(ctx, "OBJECTION!");
    this.portraits.draw(ctx, "dino_saurus", PORTRAIT_X, PORTRAIT_Y);
    panel(ctx, STATUS.x, STATUS.y, STATUS.w, STATUS.h);
    drawText(ctx, "DINO SAURUS", STATUS.x + 8, STATUS.y + 8, SILVER);
    wrap("THE TRUTH IS ONE OF THESE.", 16).forEach((l, i) =>
      drawText(ctx, l, STATUS.x + 8, STATUS.y + 22 + i * LINE_H, WHITE),
    );
    ctx.fillStyle = GRAY;
    ctx.fillRect(STATUS.x + 6, STATUS.y + 58, STATUS.w - 12, 1);
    drawText(ctx, "POWER", STATUS.x + 8, STATUS.y + 64, SILVER);
    this.drawPips(ctx, STATUS.x + 8, STATUS.y + 76, eng.state.power);
    this.drawMenuBox(ctx, eng, "CHOOSE YOUR OBJECTION!");
  }

  /* --------- EVIDENCE overlay ----------------------------------------- */

  private renderEvidenceOverlay(ctx: CanvasRenderingContext2D, eng: Engine): void {
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, W, H);
    headerTab(ctx, "COURT RECORD");
    const e = eng.evidenceItems()[0];
    const bx = 20;
    const by = 30;
    const bw = W - 40;
    const bh = 150;
    panel(ctx, bx, by, bw, bh);
    this.drawEvidenceIcon(ctx, bx + 10, by + 12);
    drawText(ctx, e?.name ?? "", bx + 46, by + 14, WHITE);
    ctx.fillStyle = GRAY;
    ctx.fillRect(bx + 10, by + 44, bw - 20, 1);
    wrap(e?.desc ?? "", Math.floor((bw - 24) / CELL)).forEach((l, i) =>
      drawText(ctx, l, bx + 12, by + 54 + i * LINE_H, SILVER),
    );
    drawTextCentered(ctx, "[X] CLOSE", bx, bw, by + bh - 16, WHITE);
    this.hotspots.push({ x: bx, y: by, w: bw, h: bh, action: "back" });
  }

  private drawEvidenceIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    panel(ctx, x, y, 26, 24);
    ctx.fillStyle = SILVER;
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 5, y + 6 + i * 4, 16, 1);
    ctx.fillStyle = WHITE;
    ctx.fillRect(x + 5, y + 5, 16, 1);
  }

  /* --------- VERDICT -------------------------------------------------- */

  private renderVerdict(ctx: CanvasRenderingContext2D, eng: Engine): void {
    for (const p of this.confetti) {
      ctx.fillStyle = (Math.floor(p.tw) + Math.floor(this.t * 4)) % 2 === 0 ? WHITE : SILVER;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    const bw = 180;
    const bh = 110;
    const bx = Math.round((W - bw) / 2);
    const by = 40;
    panel(ctx, bx, by, bw, bh);
    drawTextCentered(ctx, "VERDICT", bx, bw, by + 12, SILVER);
    const win = eng.state.endResult !== "lose";
    drawTextCentered(ctx, win ? "NOT GUILTY" : "GUILTY", bx, bw, by + 30, WHITE, 11, 14);
    drawTextCentered(ctx, `CASE RANK: ${eng.rank()}`, bx, bw, by + 58, WHITE);
    const lost = eng.case.failure.power - eng.state.power;
    drawTextCentered(ctx, lost === 0 ? "FLAWLESS — NO POWER LOST" : `POWER LOST: ${lost}`, bx, bw, by + 74, GRAY);
    if (Math.floor(this.t * 2) % 2 === 0) {
      drawTextCentered(ctx, "[Z] PLAY AGAIN", bx, bw, by + bh - 16, WHITE);
    }
  }

  /* --------- POWER EMPTY ---------------------------------------------- */

  private renderPowerEmpty(ctx: CanvasRenderingContext2D, eng: Engine): void {
    headerTab(ctx, "OUT OF POWER");
    this.portraits.draw(ctx, eng.currentWitness().portrait as Who, PORTRAIT_X, PORTRAIT_Y);
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
