/*
 * The whole game: a hardcoded state machine that reads ONLY from MICRO_CASE.
 *
 *   TITLE -> INTRO -> TESTIMONY
 *          -> (PRESS_MENU | OBJECTION_* | EVIDENCE_OVERLAY)
 *          -> BREAKDOWN -> VERDICT
 *
 * No content strings live here — every line the player reads comes from case.ts.
 */

import {
  MICRO_CASE,
  OBJECTION_CATEGORIES,
  type ObjectionCategory,
  type Statement,
} from "./case";
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
import { Sfx } from "./audio";
import { Portraits, type Who } from "./portraits";

export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "evidence";

type State =
  | "TITLE"
  | "INTRO"
  | "TESTIMONY"
  | "PRESS_MENU"
  | "PRESS_RESPONSE"
  | "OBJECTION_ANIM"
  | "OBJECTION_MENU"
  | "EVIDENCE_PICK"
  | "EVIDENCE_OVERLAY"
  | "JUDGE_LINE"
  | "BREAKDOWN"
  | "VERDICT"
  | "POWER_EMPTY";

interface Hotspot {
  x: number;
  y: number;
  w: number;
  h: number;
  action: Action | string;
}

interface MenuItem {
  label: string;
  value: string;
  dim?: boolean;
}

/* Layout constants (256x224 logical space). */
const PORTRAIT_X = 8;
const PORTRAIT_Y = 22;
const STATUS = { x: 112, y: 22, w: 138, h: 96 };
const DBOX = { x: 6, y: 124, w: 244, h: 62 };
const DBOX_TX = DBOX.x + 8;
const DBOX_TY = DBOX.y + 8;
const DCOLS = Math.floor((DBOX.w - 16) / CELL); // ~32 chars per line

const OBJ_ANIM_DUR = 0.75;

/* ------------------------------------------------------------- Dialogue --- */

class Dialogue {
  lines: string[] = [];
  total = 0;
  shown = 0;
  private timer = 0;
  private cps = 30;
  speaker = "";

  start(text: string, cols: number, cps = 30, speaker = ""): void {
    this.lines = wrap(text, cols);
    this.total = this.lines.reduce((a, l) => a + l.length, 0);
    this.shown = 0;
    this.timer = 0;
    this.cps = cps;
    this.speaker = speaker;
  }

  update(dt: number, sfx: Sfx): void {
    if (this.shown >= this.total) return;
    this.timer += dt;
    const step = 1 / this.cps;
    while (this.timer >= step && this.shown < this.total) {
      this.timer -= step;
      this.shown++;
      if (this.charAt(this.shown - 1) !== " ") sfx.blip(this.shown);
    }
  }

  private charAt(idx: number): string {
    let i = idx;
    for (const l of this.lines) {
      if (i < l.length) return l[i];
      i -= l.length;
    }
    return " ";
  }

  get done(): boolean {
    return this.shown >= this.total;
  }

  skip(): void {
    this.shown = this.total;
  }

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, color = WHITE): void {
    let count = this.shown;
    for (let li = 0; li < this.lines.length; li++) {
      const l = this.lines[li];
      const vis = Math.max(0, Math.min(l.length, count));
      drawText(ctx, l.slice(0, vis), x, y + li * LINE_H, color);
      count -= l.length;
      if (count < 0) count = 0;
    }
  }
}

/* ------------------------------------------------------------- particles -- */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tw: number;
}

/* ----------------------------------------------------------------- Game --- */

export class Game {
  private state: State = "TITLE";
  private power = 5;
  private order: string[] = [];
  private idx = 0;
  private pressed = new Set<string>();
  private broken = new Set<string>();

  private dlg = new Dialogue();
  private menu: MenuItem[] = [];
  private sel = 0;

  private judgeNext: (() => void) | null = null;
  private breakdownNext: (() => void) | null = null;
  private overlayReturn: State = "TESTIMONY";
  private rebukeToggle = 0;

  private objTimer = 0;
  private stingPlayed = false;

  private shakeT = 0;
  private shakeDur = 0.0001;
  private shakeAmp = 0;
  private portraitShakeT = 0;

  private t = 0; // global seconds, for twinkle/animation
  private stars: Particle[] = [];
  private confetti: Particle[] = [];
  private sweat: Particle[] = [];

  private hotspots: Hotspot[] = [];

  private byId: Record<string, Statement> = {};

  constructor(
    private sfx: Sfx,
    private portraits: Portraits,
  ) {
    for (const s of MICRO_CASE.statements) this.byId[s.id] = s;
    for (let i = 0; i < 64; i++) {
      this.stars.push({
        x: Math.floor((i * 71) % W),
        y: Math.floor((i * 37 + 13) % (H - 40)),
        vx: 0,
        vy: 0,
        tw: (i * 7) % 30,
      });
    }
    this.toTitle();
  }

  /* ------------------------------------------------------------ helpers -- */

  private cur(): Statement {
    return this.byId[this.order[this.idx]];
  }

  private toTitle(): void {
    this.state = "TITLE";
  }

  private startTestimony(): void {
    this.power = 5;
    this.order = [...MICRO_CASE.initialOrder];
    this.idx = 0;
    this.pressed.clear();
    this.broken.clear();
    this.showStatement();
  }

  private showStatement(): void {
    this.state = "TESTIMONY";
    const s = this.cur();
    this.dlg.start(s.text, DCOLS, 30, `WITNESS ${s.speaker}`);
  }

  private shake(amp: number, dur: number): void {
    this.shakeAmp = amp;
    this.shakeDur = dur;
    this.shakeT = dur;
  }

  /* -------------------------------------------------------------- input -- */

  input(action: Action): void {
    switch (this.state) {
      case "TITLE":
        if (action === "confirm") {
          this.sfx.thud();
          this.state = "INTRO";
          this.dlg.start(MICRO_CASE.intro.line, DCOLS, 30, MICRO_CASE.intro.speaker);
        }
        break;

      case "INTRO":
        this.advanceDialogue(action, () => this.startTestimony());
        break;

      case "TESTIMONY":
        this.inputTestimony(action);
        break;

      case "PRESS_MENU":
        this.inputMenu(action, {
          onConfirm: (v) => this.doPress(v),
          onBack: () => this.showStatement(),
        });
        break;

      case "PRESS_RESPONSE":
        this.advanceDialogue(action, () => this.showStatement());
        break;

      case "OBJECTION_ANIM":
        if (action === "confirm" || action === "back") this.objTimer = OBJ_ANIM_DUR;
        break;

      case "OBJECTION_MENU":
        this.inputMenu(action, {
          onConfirm: (v) => this.chooseCategory(v as ObjectionCategory),
          onBack: () => this.showStatement(),
        });
        break;

      case "EVIDENCE_PICK":
        this.inputMenu(action, {
          onConfirm: (v) => this.evaluate("CONTRADICTION", v),
          onBack: () => this.openObjectionMenu(),
        });
        break;

      case "EVIDENCE_OVERLAY":
        if (action === "confirm" || action === "back" || action === "evidence") {
          this.sfx.move();
          this.state = this.overlayReturn;
        }
        break;

      case "JUDGE_LINE":
        this.advanceDialogue(action, () => {
          const n = this.judgeNext;
          this.judgeNext = null;
          n?.();
        });
        break;

      case "BREAKDOWN":
        this.advanceDialogue(action, () => {
          const n = this.breakdownNext;
          this.breakdownNext = null;
          n?.();
        });
        break;

      case "VERDICT":
        if (action === "confirm") {
          this.sfx.thud();
          this.toTitle();
        }
        break;

      case "POWER_EMPTY":
        this.inputMenu(action, {
          onConfirm: () => {
            this.sfx.thud();
            this.startTestimony();
          },
          onBack: () => {},
        });
        break;
    }
  }

  /** Skip typewriter if still typing, else run the continuation. */
  private advanceDialogue(action: Action, next: () => void): void {
    if (action !== "confirm" && action !== "back") return;
    if (!this.dlg.done) {
      this.dlg.skip();
      return;
    }
    this.sfx.thud();
    next();
  }

  private inputTestimony(action: Action): void {
    if (!this.dlg.done && (action === "confirm" || action === "back")) {
      this.dlg.skip();
      return;
    }
    switch (action) {
      case "left":
        this.idx = (this.idx - 1 + this.order.length) % this.order.length;
        this.sfx.move();
        this.showStatement();
        break;
      case "right":
        this.idx = (this.idx + 1) % this.order.length;
        this.sfx.move();
        this.showStatement();
        break;
      case "confirm":
        this.openPressMenu();
        break;
      case "back":
        this.startObjection();
        break;
      case "evidence":
        this.openEvidenceOverlay("TESTIMONY");
        break;
      default:
        break;
    }
  }

  private inputMenu(
    action: Action,
    h: { onConfirm: (v: string) => void; onBack: () => void },
  ): void {
    switch (action) {
      case "up":
        this.sel = (this.sel - 1 + this.menu.length) % this.menu.length;
        this.sfx.move();
        break;
      case "down":
        this.sel = (this.sel + 1) % this.menu.length;
        this.sfx.move();
        break;
      case "confirm":
        this.sfx.thud();
        h.onConfirm(this.menu[this.sel].value);
        break;
      case "back":
        this.sfx.move();
        h.onBack();
        break;
      default:
        break;
    }
  }

  /** Direct menu selection from a pointer tap. */
  private selectAndConfirm(i: number): void {
    if (i < 0 || i >= this.menu.length) return;
    this.sel = i;
    this.input("confirm");
  }

  /* --------------------------------------------------------- transitions - */

  private openPressMenu(): void {
    const s = this.cur();
    this.menu = s.presses.map((p) => ({ label: `PRESS ${p.mode}`, value: p.mode }));
    this.sel = 0;
    this.state = "PRESS_MENU";
    this.sfx.thud();
  }

  private doPress(mode: string): void {
    const s = this.cur();
    const p = s.presses.find((pp) => pp.mode === mode);
    if (!p) return;
    const key = `${s.id}:${mode}`;
    const isRepeat = this.pressed.has(key);
    this.pressed.add(key);
    this.state = "PRESS_RESPONSE";
    this.dlg.start(isRepeat ? p.repeat : p.response, DCOLS, 30, `WITNESS ${s.speaker}`);
  }

  private startObjection(): void {
    this.objTimer = 0;
    this.stingPlayed = false;
    this.state = "OBJECTION_ANIM";
  }

  private openObjectionMenu(): void {
    this.menu = OBJECTION_CATEGORIES.map((c) => ({ label: c, value: c }));
    this.sel = 0;
    this.state = "OBJECTION_MENU";
  }

  private chooseCategory(cat: ObjectionCategory): void {
    if (cat === "CONTRADICTION") {
      this.menu = MICRO_CASE.evidence.map((e) => ({ label: e.name, value: e.id }));
      this.sel = 0;
      this.state = "EVIDENCE_PICK";
    } else {
      this.evaluate(cat, null);
    }
  }

  private evaluate(cat: ObjectionCategory, evidenceId: string | null): void {
    const s = this.cur();
    const lie = s.lie;
    const alreadyBroken = this.broken.has(s.id);
    const correct =
      !!lie &&
      !alreadyBroken &&
      cat === lie.category &&
      (lie.requiresEvidence ? evidenceId === lie.requiresEvidence : true);

    if (correct) {
      this.sfx.sustainChime();
      this.state = "JUDGE_LINE";
      this.dlg.start(MICRO_CASE.judgeSustained, DCOLS, 34, MICRO_CASE.intro.speaker);
      this.judgeNext = () => this.startBreakdown(s);
      return;
    }

    // Wrong: drain 1 POWER, judge rebuke.
    this.power = Math.max(0, this.power - 1);
    this.sfx.buzz();
    this.shake(3, 0.28);

    let line: string;
    if (lie && !alreadyBroken) {
      line = MICRO_CASE.wrongObjectionRebukes[this.rebukeToggle % MICRO_CASE.wrongObjectionRebukes.length];
      this.rebukeToggle++;
    } else {
      line = s.objectionPenalty ?? MICRO_CASE.wrongObjectionRebukes[0];
    }

    this.state = "JUDGE_LINE";
    this.dlg.start(line, DCOLS, 30, MICRO_CASE.intro.speaker);
    this.judgeNext = () => {
      if (this.power <= 0) {
        this.menu = [{ label: "RESTART TESTIMONY", value: "restart" }];
        this.sel = 0;
        this.state = "POWER_EMPTY";
      } else {
        this.showStatement();
      }
    };
  }

  private startBreakdown(s: Statement): void {
    this.broken.add(s.id);
    this.state = "BREAKDOWN";
    this.portraitShakeT = 999; // shakes until dialogue advances
    this.shake(2, 0.4);
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
    this.dlg.start(s.lie!.breakdown, DCOLS, 55, `WITNESS ${s.speaker}`);
    this.breakdownNext = () => {
      this.portraitShakeT = 0;
      const reveals = s.lie!.reveals;
      if (reveals) {
        // Insert the revealed statement right after the current one and move to it.
        this.order.splice(this.idx + 1, 0, reveals);
        this.idx += 1;
        this.showStatement();
      } else {
        this.toVerdict();
      }
    };
  }

  private toVerdict(): void {
    this.state = "VERDICT";
    this.sfx.fanfare();
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

  private openEvidenceOverlay(from: State): void {
    this.overlayReturn = from;
    this.state = "EVIDENCE_OVERLAY";
    this.sfx.move();
  }

  /* ------------------------------------------------------------- pointer - */

  pointer(lx: number, ly: number): void {
    for (const h of this.hotspots) {
      if (lx >= h.x && lx < h.x + h.w && ly >= h.y && ly < h.y + h.h) {
        if (typeof h.action === "string" && h.action.startsWith("menu:")) {
          this.selectAndConfirm(parseInt(h.action.slice(5), 10));
        } else {
          this.input(h.action as Action);
        }
        return;
      }
    }
  }

  /* -------------------------------------------------------------- update - */

  update(dt: number): void {
    this.t += dt;
    this.dlg.update(dt, this.sfx);

    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);

    if (this.state === "OBJECTION_ANIM") {
      if (!this.stingPlayed) {
        this.sfx.sting();
        this.shake(5, 0.5);
        this.stingPlayed = true;
      }
      this.objTimer += dt;
      if (this.objTimer >= OBJ_ANIM_DUR) this.openObjectionMenu();
    }

    if (this.state === "BREAKDOWN") {
      for (const p of this.sweat) {
        p.y += p.vy * dt;
        if (p.y > PORTRAIT_Y + 96) {
          p.y = PORTRAIT_Y + 6;
        }
      }
    }

    if (this.state === "VERDICT") {
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

  paletteCensusState(): State {
    return this.state;
  }

  /** Read-only snapshot for debugging / automated verification. */
  debug(): { state: State; idx: number; id: string; power: number; order: string[]; typing: boolean } {
    return {
      state: this.state,
      idx: this.idx,
      id: this.order[this.idx] ?? "",
      power: this.power,
      order: [...this.order],
      typing: !this.dlg.done,
    };
  }

  /* -------------------------------------------------------------- render - */

  render(ctx: CanvasRenderingContext2D): void {
    this.hotspots = [];

    // Clear to black, then apply screen shake as a whole-frame offset.
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

    switch (this.state) {
      case "TITLE":
        this.renderTitle(ctx);
        break;
      case "INTRO":
        this.renderIntro(ctx);
        break;
      case "TESTIMONY":
      case "PRESS_MENU":
      case "PRESS_RESPONSE":
      case "EVIDENCE_PICK":
      case "JUDGE_LINE":
      case "BREAKDOWN":
        this.renderCourt(ctx);
        break;
      case "OBJECTION_ANIM":
        this.renderObjectionSlam(ctx);
        break;
      case "OBJECTION_MENU":
        this.renderObjectionMenu(ctx);
        break;
      case "VERDICT":
        this.renderVerdict(ctx);
        break;
      case "POWER_EMPTY":
        this.renderPowerEmpty(ctx);
        break;
      case "EVIDENCE_OVERLAY":
        // Draw the court behind, then the overlay on top.
        this.renderCourt(ctx);
        this.renderEvidenceOverlay(ctx);
        break;
    }

    ctx.restore();

    // Whole-screen tap-to-advance for reading states (added last = lowest priority).
    if (
      this.state === "TITLE" ||
      this.state === "INTRO" ||
      this.state === "PRESS_RESPONSE" ||
      this.state === "JUDGE_LINE" ||
      this.state === "BREAKDOWN" ||
      this.state === "VERDICT"
    ) {
      this.hotspots.push({ x: 0, y: 0, w: W, h: H, action: "confirm" });
    }
    if (this.state === "OBJECTION_ANIM") {
      this.hotspots.push({ x: 0, y: 0, w: W, h: H, action: "confirm" });
    }
  }

  /* --------- TITLE ---------------------------------------------------- */

  private renderTitle(ctx: CanvasRenderingContext2D): void {
    // Starfield
    for (const s of this.stars) {
      const phase = (this.t * 6 + s.tw) % 3;
      ctx.fillStyle = phase < 1 ? WHITE : phase < 2 ? SILVER : GRAY;
      ctx.fillRect(s.x, s.y, 1, 1);
    }
    // A ringed planet, lower right, in palette grays.
    this.drawPlanet(ctx, 208, 150, 18);

    // Big title. "DINO SAURUS" on line 1, subtitle beneath.
    drawTextCentered(ctx, "DINO SAURUS", 0, W, 30, WHITE, 12, 16);
    drawTextCentered(ctx, "SPACE ATTORNEY AT CLAW", 0, W, 52, SILVER, CELL, 8);

    // Attorney portrait, lower-left, evoking the key art.
    this.portraits.draw(ctx, "dino_saurus", 18, 96);

    // Menu-style prompt box, lower-right (matches reference framing).
    const bx = 104;
    const bw = 144;
    const by = 118;
    panel(ctx, bx, by, bw, 50);
    const [caseNo, caseName] = MICRO_CASE.title.subtitle.split(": ");
    drawTextCentered(ctx, caseNo, bx, bw, by + 8, WHITE, 6);
    drawTextCentered(ctx, caseName, bx, bw, by + 20, SILVER, 6);
    // Blinking PRESS Z
    if (Math.floor(this.t * 2) % 2 === 0) {
      drawTextCentered(ctx, MICRO_CASE.title.prompt, bx, bw, by + 34, WHITE);
    }

    drawTextCentered(ctx, MICRO_CASE.title.footer, 0, W, H - 14, GRAY);
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
    // Ring
    ctx.fillStyle = WHITE;
    for (let x = -r - 8; x <= r + 8; x++) {
      const y = Math.round(x * 0.28);
      ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  }

  /* --------- INTRO ---------------------------------------------------- */

  private renderIntro(ctx: CanvasRenderingContext2D): void {
    headerTab(ctx, "CROSS EXAMINATION");
    this.portraits.draw(ctx, "judge", PORTRAIT_X, PORTRAIT_Y);
    this.drawNamePlate(ctx, MICRO_CASE.intro.speaker);
    this.drawDialogueBox(ctx);
  }

  /* --------- COURT (testimony + press + judge + breakdown) ------------- */

  private renderCourt(ctx: CanvasRenderingContext2D): void {
    const isBreakdown = this.state === "BREAKDOWN";
    const isJudge = this.state === "JUDGE_LINE";

    headerTab(ctx, isBreakdown ? "TESTIMONY" : "CROSS EXAMINATION");

    // Portrait (judge speaks during JUDGE_LINE; witness otherwise).
    const who: Who = isJudge ? "judge" : "pterax";
    let px = PORTRAIT_X;
    let py = PORTRAIT_Y;
    if (isBreakdown && this.portraitShakeT > 0) {
      px += Math.round(Math.sin(this.t * 120) * 3);
      py += Math.round(Math.cos(this.t * 90) * 2);
    }
    this.portraits.draw(ctx, who, px, py);

    // Status panel beside the portrait.
    this.drawStatusPanel(ctx);

    if (isBreakdown) {
      for (const p of this.sweat) {
        ctx.fillStyle = WHITE;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 3);
      }
    }

    // Bottom region: either a menu or a dialogue box.
    if (this.state === "PRESS_MENU") {
      this.drawMenuBox(ctx, "WHAT WILL YOU PRESS?");
    } else if (this.state === "EVIDENCE_PICK") {
      this.drawMenuBox(ctx, "PRESENT WHICH EVIDENCE?");
    } else {
      this.drawDialogueBox(ctx);
    }

    // Footer controls only in plain testimony.
    if (this.state === "TESTIMONY") this.drawTestimonyFooter(ctx);
  }

  private drawNamePlate(ctx: CanvasRenderingContext2D, name: string): void {
    panel(ctx, STATUS.x, STATUS.y, STATUS.w, 20);
    drawText(ctx, name, STATUS.x + 8, STATUS.y + 6, SILVER);
  }

  private drawStatusPanel(ctx: CanvasRenderingContext2D): void {
    const { x, y, w, h } = STATUS;
    panel(ctx, x, y, w, h);
    const s = this.cur();
    drawText(ctx, "WITNESS", x + 8, y + 8, GRAY);
    drawText(ctx, s.speaker, x + 8, y + 20, WHITE, CELL, 8);

    // Divider
    ctx.fillStyle = GRAY;
    ctx.fillRect(x + 6, y + 36, w - 12, 1);

    // POWER label + pips (top-right, always visible)
    drawText(ctx, "POWER", x + 8, y + 44, SILVER);
    this.drawPips(ctx, x + 8, y + 56);

    // Statement counter
    const counter = `< ${this.idx + 1}/${this.order.length} >`;
    drawText(ctx, counter, x + 8, y + 72, WHITE);

    // Evidence hint
    drawText(ctx, "[C] EVIDENCE", x + 8, y + 84, GRAY);
  }

  private drawPips(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const size = 8;
    const gap = 3;
    for (let i = 0; i < 5; i++) {
      const px = x + i * (size + gap);
      if (i < this.power) {
        // Filled pip: solid white block (separated from neighbours by the gap).
        ctx.fillStyle = WHITE;
        ctx.fillRect(px, y, size, size);
      } else {
        // Empty pip: gray outline over black.
        outline(ctx, px, y, size, size, GRAY);
      }
    }
  }

  private drawDialogueBox(ctx: CanvasRenderingContext2D): void {
    panel(ctx, DBOX.x, DBOX.y, DBOX.w, DBOX.h);
    if (this.dlg.speaker) {
      // Small speaker tag notch on top-left of the box.
      const tagW = this.dlg.speaker.length * CELL + 8;
      panel(ctx, DBOX.x + 6, DBOX.y - 7, tagW, 12);
      drawText(ctx, this.dlg.speaker, DBOX.x + 10, DBOX.y - 4, SILVER);
    }
    this.dlg.draw(ctx, DBOX_TX, DBOX_TY + 4);

    // Little "▼" advance blinker when a reading line is fully shown.
    if (this.dlg.done && Math.floor(this.t * 2) % 2 === 0) {
      drawText(ctx, "▼", DBOX.x + DBOX.w - 16, DBOX.y + DBOX.h - 14, WHITE);
    }
  }

  private drawMenuBox(ctx: CanvasRenderingContext2D, prompt: string): void {
    panel(ctx, DBOX.x, DBOX.y, DBOX.w, DBOX.h);
    drawText(ctx, prompt, DBOX_TX, DBOX.y + 6, SILVER);
    const startY = DBOX.y + 20;
    for (let i = 0; i < this.menu.length; i++) {
      const iy = startY + i * 13;
      const item = this.menu[i];
      const isSel = i === this.sel;
      if (isSel) drawText(ctx, ">", DBOX_TX, iy, WHITE);
      drawText(ctx, item.label, DBOX_TX + 14, iy, isSel ? WHITE : SILVER);
      this.hotspots.push({ x: DBOX.x, y: iy - 2, w: DBOX.w, h: 13, action: `menu:${i}` });
    }
  }

  private drawTestimonyFooter(ctx: CanvasRenderingContext2D): void {
    // ◀ ▶ arrows on the dialogue box edges.
    const ay = DBOX.y + Math.floor(DBOX.h / 2) - 8;
    panel(ctx, DBOX.x - 2, ay, 12, 16);
    drawText(ctx, "◀", DBOX.x, ay + 4, WHITE, 6);
    this.hotspots.push({ x: DBOX.x - 6, y: ay - 4, w: 22, h: 24, action: "left" });

    panel(ctx, DBOX.x + DBOX.w - 10, ay, 12, 16);
    drawText(ctx, "▶", DBOX.x + DBOX.w - 8, ay + 4, WHITE, 6);
    this.hotspots.push({ x: DBOX.x + DBOX.w - 14, y: ay - 4, w: 22, h: 24, action: "right" });

    // Three action buttons along the bottom.
    const btns: { label: string; action: Action }[] = [
      { label: "[Z] PRESS", action: "confirm" },
      { label: "[X] OBJECT", action: "back" },
      { label: "[C] EVID", action: "evidence" },
    ];
    const total = W - 12;
    const bw = Math.floor((total - 2 * 4) / 3);
    const by = 194;
    const bh = 24;
    btns.forEach((b, i) => {
      const bx = 6 + i * (bw + 4);
      panel(ctx, bx, by, bw, bh);
      drawTextCentered(ctx, b.label, bx, bw, by + 8, WHITE, 6);
      this.hotspots.push({ x: bx, y: by, w: bw, h: bh, action: b.action });
    });
  }

  /* --------- OBJECTION! slam ------------------------------------------ */

  private renderObjectionSlam(ctx: CanvasRenderingContext2D): void {
    const p = Math.min(1, this.objTimer / OBJ_ANIM_DUR);
    const cx = W / 2;
    const cy = H / 2;

    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, W, H);

    // Radial white speed lines converging on center.
    const N = 28;
    ctx.fillStyle = WHITE;
    for (let k = 0; k < N; k++) {
      const ang = (k / N) * Math.PI * 2 + p * 0.4;
      const inner = 40 + p * 30;
      const outer = 200;
      for (let r = inner; r < outer; r += 3) {
        const x = Math.round(cx + Math.cos(ang) * r);
        const y = Math.round(cy + Math.sin(ang) * r);
        // Alternate on/off along the ray to read as motion streaks.
        if (Math.floor(r / 3) % 2 === 0) ctx.fillRect(x, y, 1, 1);
      }
    }

    // Jagged white burst that pops in. A fat inner radius (0.72) guarantees a
    // solid white core wide enough to hold the black text with no clipping.
    const burstR = 24 + Math.min(1, p / 0.35) * 82;
    this.drawStarBurst(ctx, cx, cy, burstR, 14, WHITE);

    // Black "OBJECTION!" text centered in the white core, with a slight overshoot.
    if (p > 0.15) {
      const label = "OBJECTION!"; // 10 chars
      const grow = Math.min(1, (p - 0.15) / 0.2);
      const cell = Math.round(10 + grow * 2); // <= 12 -> 120px, fits the ~140px white core
      const size = Math.round(13 + grow * 2);
      drawTextCentered(ctx, label, 0, W, cy - size / 2, BLACK, cell, size);
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

  private renderObjectionMenu(ctx: CanvasRenderingContext2D): void {
    headerTab(ctx, "OBJECTION!");

    // Dino saurus pointing, left.
    this.portraits.draw(ctx, "dino_saurus", PORTRAIT_X, PORTRAIT_Y);

    // POWER panel on the right (mirrors the reference OBJECTION screen).
    panel(ctx, STATUS.x, STATUS.y, STATUS.w, STATUS.h);
    drawText(ctx, "DINO SAURUS", STATUS.x + 8, STATUS.y + 8, SILVER);
    const lines = wrap("THE TRUTH IS ONE OF THESE.", 16);
    lines.forEach((l, i) => drawText(ctx, l, STATUS.x + 8, STATUS.y + 22 + i * LINE_H, WHITE));
    ctx.fillStyle = GRAY;
    ctx.fillRect(STATUS.x + 6, STATUS.y + 58, STATUS.w - 12, 1);
    drawText(ctx, "POWER", STATUS.x + 8, STATUS.y + 64, SILVER);
    this.drawPips(ctx, STATUS.x + 8, STATUS.y + 76);

    this.drawMenuBox(ctx, "CHOOSE YOUR OBJECTION!");
  }

  /* --------- EVIDENCE overlay ----------------------------------------- */

  private renderEvidenceOverlay(ctx: CanvasRenderingContext2D): void {
    // Dim the court to solid black behind the overlay card.
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, W, H);
    headerTab(ctx, "COURT RECORD");

    const e = MICRO_CASE.evidence[0];
    const bx = 20;
    const by = 30;
    const bw = W - 40;
    const bh = 150;
    panel(ctx, bx, by, bw, bh);

    // Evidence icon (a little "log/tablet" glyph) top-left.
    this.drawEvidenceIcon(ctx, bx + 10, by + 12);

    drawText(ctx, e.name, bx + 46, by + 14, WHITE);
    ctx.fillStyle = GRAY;
    ctx.fillRect(bx + 10, by + 44, bw - 20, 1);

    const lines = wrap(e.desc, Math.floor((bw - 24) / CELL));
    lines.forEach((l, i) => drawText(ctx, l, bx + 12, by + 54 + i * LINE_H, SILVER));

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

  private renderVerdict(ctx: CanvasRenderingContext2D): void {
    // Confetti behind the card.
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
    drawTextCentered(ctx, "NOT GUILTY", bx, bw, by + 30, WHITE, 11, 14);

    const rank = this.rankLetter();
    drawTextCentered(ctx, `CASE RANK: ${rank}`, bx, bw, by + 58, WHITE);
    const lost = 5 - this.power;
    drawTextCentered(
      ctx,
      lost === 0 ? "FLAWLESS — NO POWER LOST" : `POWER LOST: ${lost}`,
      bx,
      bw,
      by + 74,
      GRAY,
    );

    if (Math.floor(this.t * 2) % 2 === 0) {
      drawTextCentered(ctx, "[Z] PLAY AGAIN", bx, bw, by + bh - 16, WHITE);
    }
  }

  private rankLetter(): string {
    if (this.power >= 5) return "S";
    return ["-", "D", "C", "B", "A"][this.power] ?? "D";
  }

  /* --------- POWER EMPTY ---------------------------------------------- */

  private renderPowerEmpty(ctx: CanvasRenderingContext2D): void {
    headerTab(ctx, "OUT OF POWER");
    this.portraits.draw(ctx, "pterax", PORTRAIT_X, PORTRAIT_Y);
    this.drawStatusPanel(ctx);

    panel(ctx, DBOX.x, DBOX.y, DBOX.w, DBOX.h);
    const lines = wrap("YOUR CREDIBILITY IS SPENT. STEADY YOURSELF AND TRY AGAIN.", DCOLS);
    lines.forEach((l, i) => drawText(ctx, l, DBOX_TX, DBOX_TY + i * LINE_H, SILVER));

    const iy = 196;
    panel(ctx, 40, iy - 2, W - 80, 22);
    const sel = this.sel === 0;
    if (sel) drawText(ctx, ">", 50, iy + 4, WHITE);
    drawTextCentered(ctx, "RESTART TESTIMONY", 40, W - 80, iy + 4, WHITE);
    this.hotspots.push({ x: 40, y: iy - 2, w: W - 80, h: 22, action: "menu:0" });
  }
}
