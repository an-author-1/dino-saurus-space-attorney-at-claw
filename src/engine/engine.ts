/*
 * The case engine: a pure state machine (schema v2). Construct it with one or
 * more compiled cases, feed it InputEvents and time (`tick`), read `state` to
 * render. No DOM / canvas / audio — it only mutates state and emits named Cues.
 */

import type {
  CompiledCase,
  DialogueLine,
  Effect,
  EvidenceItem,
  Lie,
  ObjectionCategory,
  SfxName,
  Statement,
  Witness,
} from "./types";
import {
  OBJECTION_CATEGORIES,
  INTERRUPTION_CATEGORY,
  RECESS_POWER_RESTORE,
  isInterruption,
} from "./types";
import type { Cue, EngineState, InputEvent, Phase, RunningDialogue } from "./state";
import type { ShakeLevel } from "./types";

const OBJ_ANIM_DUR = 0.75;
const CPS_NORMAL = 30;
const CPS_BREAKDOWN = 55;
// Seconds per `duration_boxes` unit an interruption line holds before it scrolls
// away. Kept generous so the "tap OBJECT!" window is comfortable on a phone.
const BASE_BOX_TIME = 4.5;

export interface EngineOpts {
  dev?: boolean;
}

export class Engine {
  private cases: CompiledCase[];
  private caseData: CompiledCase;
  private st: EngineState;
  private cues: Cue[] = [];

  private onDlgComplete: (() => void) | null = null;
  private revAcc = 0;

  private byId: Record<string, Statement> = {};
  private evById: Record<string, EvidenceItem> = {};
  private rebukeCounter = new Map<string, number>();
  private overlayReturn: Phase = "TESTIMONY";
  private wrapBroken = 0;
  judgeName = "JUDGE";

  private grantedEvidence = new Set<string>();

  constructor(caseOrCases: CompiledCase | CompiledCase[], opts: EngineOpts = {}) {
    this.cases = Array.isArray(caseOrCases) ? caseOrCases : [caseOrCases];
    this.caseData = this.cases[0];
    this.indexCase();
    this.st = this.blankState(opts.dev ?? false);
    this.loadWitness(0);
  }

  /** Evidence granted by some add_evidence effect starts ABSENT (to be handed
   * over, e.g. in the briefing); all other evidence starts in the record. */
  private computeGranted(): void {
    this.grantedEvidence = new Set();
    const scan = (effs?: Effect[]) => {
      for (const e of effs || []) if ("add_evidence" in e) this.grantedEvidence.add(e.add_evidence.evidence);
    };
    for (const d of Object.values(this.caseData.dialogue)) for (const ln of d) scan(ln.effects);
    for (const w of this.caseData.witnesses)
      for (const s of w.testimony.statements) {
        if (s.press) for (const pm of Object.values(s.press)) scan(pm.effects);
        if (s.lie) scan(s.lie.effects);
      }
    scan(this.caseData.failure.on_empty);
  }

  private initialEvidence(): string[] {
    return this.caseData.evidence.filter((e) => !this.grantedEvidence.has(e.id)).map((e) => e.id);
  }

  private blankState(dev: boolean): EngineState {
    return {
      phase: "TITLE",
      power: this.caseData.failure.power,
      witnessIdx: 0,
      order: [],
      idx: 0,
      flags: new Set(),
      pressed: new Set(),
      broken: new Set(),
      evidence: this.initialEvidence(),
      dialogue: null,
      menu: [],
      sel: 0,
      objTimer: 0,
      pendingCategory: null,
      endResult: null,
      guidanceShown: new Set(),
      hintsUsed: 0,
      missed: new Set(),
      autoTimer: 0,
      dev,
      expression: "neutral",
      banner: "",
    };
  }

  private indexCase(): void {
    this.evById = {};
    for (const e of this.caseData.evidence) this.evById[e.id] = e;
    const intro = this.caseData.dialogue[this.caseData.intro] ?? [];
    this.judgeName = intro[0]?.speaker ?? "JUDGE";
    this.computeGranted();
  }

  /* ------------------------------------------------------------ readonly -- */

  get state(): Readonly<EngineState> {
    return this.st;
  }
  get case(): CompiledCase {
    return this.caseData;
  }
  get caseList(): CompiledCase[] {
    return this.cases;
  }
  currentWitness(): Witness {
    return this.caseData.witnesses[this.st.witnessIdx];
  }
  currentStatement(): Statement | undefined {
    return this.byId[this.st.order[this.st.idx]];
  }
  isInterruptionNow(): boolean {
    const w = this.currentWitness();
    return !!w && isInterruption(w.testimony);
  }
  evidenceItems(): EvidenceItem[] {
    return this.st.evidence.map((id) => this.evById[id]).filter(Boolean);
  }
  currentBox(): { line: DialogueLine; shown: number; boxDone: boolean; moreBoxes: boolean } | null {
    const d = this.st.dialogue;
    if (!d) return null;
    const line = d.lines[d.lineIdx];
    return {
      line,
      shown: d.shown,
      boxDone: d.shown >= line.text.length,
      moreBoxes: d.lineIdx < d.lines.length - 1,
    };
  }

  /** Case rank: start S, -1 letter per hint, -1 per 2 POWER lost, floor D. */
  rank(): string {
    const lost = this.caseData.failure.power - this.st.power;
    const value = 5 - Math.floor(lost / 2) - this.st.hintsUsed;
    const clamped = Math.max(1, Math.min(5, value));
    return ["-", "D", "C", "B", "A", "S"][clamped];
  }

  /* ---------------------------------------------------------------- cues -- */

  private emit(name: SfxName, opts: { seed?: number; shake?: ShakeLevel } = {}): void {
    this.cues.push({ name, seed: opts.seed, shake: opts.shake });
  }

  /* --------------------------------------------------------------- setup -- */

  private loadCase(i: number): void {
    this.caseData = this.cases[i];
    this.indexCase();
    this.st.witnessIdx = 0;
    this.st.power = this.caseData.failure.power;
    this.st.flags.clear();
    this.st.pressed.clear();
    this.st.broken.clear();
    this.st.guidanceShown.clear();
    this.st.missed.clear();
    this.st.hintsUsed = 0;
    this.st.evidence = this.initialEvidence();
    this.st.endResult = null;
    this.rebukeCounter.clear();
    this.loadWitness(0);
  }

  private loadWitness(i: number): void {
    this.st.witnessIdx = i;
    const w = this.caseData.witnesses[i];
    this.byId = {};
    if (!w) return;
    for (const s of w.testimony.statements) this.byId[s.id] = s;
    if (isInterruption(w.testimony)) {
      this.st.order = w.testimony.statements.map((s) => s.id);
    } else {
      this.st.order = w.testimony.statements.filter((s) => !s.hidden).map((s) => s.id);
    }
    this.st.idx = 0;
  }

  private startCase(): void {
    if (this.caseData.briefing) {
      this.st.phase = "BRIEFING";
      this.st.banner = "BRIEFING";
      this.startById(this.caseData.briefing, CPS_NORMAL, () => this.afterBriefing());
    } else {
      this.afterBriefing();
    }
  }

  private afterBriefing(): void {
    this.st.phase = "INTRO";
    this.startById(this.caseData.intro, CPS_NORMAL, () => this.enterWitness(0));
  }

  /** Full reset of the current case (used by end_testimony: restart). */
  private restartCase(): void {
    this.st.power = this.caseData.failure.power;
    this.st.flags.clear();
    this.st.pressed.clear();
    this.st.broken.clear();
    this.st.missed.clear();
    this.st.evidence = this.initialEvidence();
    this.st.endResult = null;
    this.rebukeCounter.clear();
    this.enterWitness(0);
  }

  private enterWitness(i: number): void {
    this.loadWitness(i);
    if (this.isInterruptionNow()) this.startInterruption();
    else this.showStatement();
  }

  /* -------------------------------------------------------- testimony ----- */

  private showStatement(): void {
    // Guidance: teach a category the first time the player faces a solvable lie.
    const s = this.currentStatement();
    const cat = s?.lie && this.lieBreakable(s) ? s.lie.objection : null;
    if (cat && this.caseData.guidance?.[cat] && !this.st.guidanceShown.has(cat)) {
      this.st.guidanceShown.add(cat);
      this.st.phase = "GUIDANCE";
      this.st.banner = "CO-COUNSEL";
      this.startById(this.caseData.guidance[cat], CPS_NORMAL, () => this.showStatement());
      return;
    }
    this.st.phase = "TESTIMONY";
    this.startLines([{ speaker: this.currentWitness().name, text: s ? s.text : "" }], CPS_NORMAL, null);
  }

  private lieBreakable(s: Statement): boolean {
    const lie = s.lie;
    if (!lie || this.st.broken.has(s.id)) return false;
    const evOk = !lie.requires_evidence || this.st.evidence.includes(lie.requires_evidence);
    const prereqOk = (lie.prerequisites || []).every((f) => this.st.flags.has(f));
    return evOk && prereqOk;
  }

  /* ------------------------------------------------------------ dialogue -- */

  private startById(id: string, cps: number, onComplete: (() => void) | null): void {
    this.startLines(this.caseData.dialogue[id] ?? [{ speaker: "", text: "" }], cps, onComplete);
  }

  private startLines(lines: DialogueLine[], cps: number, onComplete: (() => void) | null): void {
    const safe = lines.length ? lines : [{ speaker: "", text: "" }];
    const d: RunningDialogue = { lines: safe, lineIdx: 0, shown: 0, cps, firedLine: -1 };
    if (this.st.dev) d.shown = safe[0].text.length; // instant text in dev mode
    this.st.dialogue = d;
    this.st.expression = safe[0].expression ?? "neutral";
    this.revAcc = 0;
    this.onDlgComplete = onComplete;
  }

  private dlgAdvance(): void {
    const d = this.st.dialogue;
    if (!d) return;
    const line = d.lines[d.lineIdx];
    if (d.shown < line.text.length) {
      d.shown = line.text.length; // skip reveal
      return;
    }
    // Fire this line's effects once (used by the briefing to grant evidence).
    if (d.firedLine < d.lineIdx) {
      d.firedLine = d.lineIdx;
      if (line.effects && line.effects.length) this.runEffects(line.effects);
    }
    if (d.lineIdx < d.lines.length - 1) {
      d.lineIdx++;
      d.shown = this.st.dev ? d.lines[d.lineIdx].text.length : 0;
      this.st.expression = d.lines[d.lineIdx].expression ?? "neutral";
      this.revAcc = 0;
      this.emit("confirm");
      return;
    }
    this.emit("confirm");
    const cb = this.onDlgComplete;
    this.onDlgComplete = null;
    this.st.dialogue = null;
    cb?.();
  }

  /* ---------------------------------------------------------------- tick -- */

  tick(dt: number): Cue[] {
    this.cues = [];
    const d = this.st.dialogue;
    if (d && !this.st.dev) {
      const line = d.lines[d.lineIdx];
      if (d.shown < line.text.length) {
        this.revAcc += dt;
        const step = 1 / d.cps;
        while (this.revAcc >= step && d.shown < line.text.length) {
          this.revAcc -= step;
          d.shown++;
          if (line.text[d.shown - 1] !== " ") this.emit("blip", { seed: d.shown });
        }
      }
    }
    if (this.st.phase === "OBJECTION_ANIM") {
      this.st.objTimer += dt;
      if (this.st.objTimer >= OBJ_ANIM_DUR) this.openObjectionMenu();
    }
    if (this.st.phase === "INTERRUPTION") {
      this.st.autoTimer += dt;
      const s = this.currentStatement();
      const window = (s?.duration_boxes ?? 1) * BASE_BOX_TIME;
      if (this.st.autoTimer >= window) this.interruptionAdvance();
    }
    return this.cues;
  }

  /* --------------------------------------------------------------- input -- */

  input(event: InputEvent): Cue[] {
    this.cues = [];
    switch (this.st.phase) {
      case "TITLE":
        if (event === "confirm") {
          this.emit("confirm");
          if (this.cases.length > 1) this.openCasePicker();
          else this.startCase();
        }
        break;
      case "CASE_PICK":
        this.inputMenu(event, (v) => this.pickCase(parseInt(v, 10)), () => {});
        break;
      case "BRIEFING":
      case "INTRO":
      case "PRESS_RESPONSE":
      case "GUIDANCE":
      case "HINT":
      case "JUDGE_LINE":
      case "BREAKDOWN":
        this.advanceReading(event);
        break;
      case "TESTIMONY":
        this.inputTestimony(event);
        break;
      case "INTERRUPTION":
        if (event === "confirm") this.startObjection(); // slam Z
        else if (event === "evidence") this.openEvidenceOverlay("INTERRUPTION");
        break;
      case "PRESS_MENU":
        this.inputMenu(event, (v) => this.doPress(v), () => this.showStatement());
        break;
      case "OBJECTION_ANIM":
        if (event === "confirm" || event === "back") this.st.objTimer = OBJ_ANIM_DUR;
        break;
      case "OBJECTION_MENU":
        this.inputMenu(event, (v) => this.chooseCategory(v as ObjectionCategory), () => this.cancelObjection());
        break;
      case "EVIDENCE_PICK":
        this.inputMenu(event, (v) => this.evaluate(this.st.pendingCategory ?? "CONTRADICTION", v), () => this.openObjectionMenu());
        break;
      case "EVIDENCE_OVERLAY":
        if (event === "confirm" || event === "back" || event === "evidence") {
          this.emit("move");
          this.st.phase = this.overlayReturn;
        } else {
          this.inputMenu(event, () => {}, () => {}); // arrows browse the grid
        }
        break;
      case "HINT_CONFIRM":
        this.inputMenu(event, (v) => this.resolveHint(v === "yes"), () => this.showStatement());
        break;
      case "RECESS":
        if (event === "confirm") {
          this.emit("confirm");
          this.enterWitness(this.st.witnessIdx + 1);
        }
        break;
      case "VERDICT":
        if (event === "confirm") {
          this.emit("confirm");
          this.st.phase = "TITLE";
          this.loadWitness(0);
        }
        break;
      case "POWER_EMPTY":
        this.inputMenu(event, () => this.applyOnEmpty(), () => {});
        break;
      case "DEV_JUMP":
        this.inputMenu(event, (v) => this.doJump(v), () => this.showStatement());
        break;
    }
    return this.cues;
  }

  private advanceReading(event: InputEvent): void {
    if (event === "confirm" || event === "back") this.dlgAdvance();
  }

  private inputTestimony(event: InputEvent): void {
    const box = this.currentBox();
    if (box && !box.boxDone && (event === "confirm" || event === "back")) {
      this.st.dialogue!.shown = box.line.text.length;
      return;
    }
    switch (event) {
      case "left":
        this.st.idx = (this.st.idx - 1 + this.st.order.length) % this.st.order.length;
        this.emit("move");
        this.showStatement();
        break;
      case "right":
        this.st.idx = (this.st.idx + 1) % this.st.order.length;
        this.emit("move");
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
      case "hint":
        this.openHintConfirm();
        break;
      default:
        break;
    }
  }

  private inputMenu(event: InputEvent, onConfirm: (v: string) => void, onBack: () => void): void {
    switch (event) {
      case "up":
      case "left":
        this.st.sel = (this.st.sel - 1 + this.st.menu.length) % this.st.menu.length;
        this.emit("move");
        break;
      case "down":
      case "right":
        this.st.sel = (this.st.sel + 1) % this.st.menu.length;
        this.emit("move");
        break;
      case "confirm":
        this.emit("confirm");
        if (this.st.menu[this.st.sel]) onConfirm(this.st.menu[this.st.sel].value);
        break;
      case "back":
        this.emit("move");
        onBack();
        break;
      default:
        break;
    }
  }

  /** Pointer tap on a menu row: select index i, then confirm. */
  selectMenu(i: number): Cue[] {
    this.cues = [];
    if (i >= 0 && i < this.st.menu.length) {
      this.st.sel = i;
      this.emit("confirm");
      const v = this.st.menu[i].value;
      switch (this.st.phase) {
        case "CASE_PICK": this.pickCase(parseInt(v, 10)); break;
        case "PRESS_MENU": this.doPress(v); break;
        case "OBJECTION_MENU": this.chooseCategory(v as ObjectionCategory); break;
        case "EVIDENCE_PICK": this.evaluate(this.st.pendingCategory ?? "CONTRADICTION", v); break;
        case "HINT_CONFIRM": this.resolveHint(v === "yes"); break;
        case "POWER_EMPTY": this.applyOnEmpty(); break;
        case "DEV_JUMP": this.doJump(v); break;
      }
    }
    return this.cues;
  }

  /* --------------------------------------------------------- case picker -- */

  private openCasePicker(): void {
    this.st.phase = "CASE_PICK";
    this.st.banner = "SELECT CASE";
    this.st.menu = this.cases.map((c, i) => ({ label: `${c.case}  ${c.title}`, value: String(i) }));
    this.st.sel = 0;
  }
  private pickCase(i: number): void {
    if (i < 0 || i >= this.cases.length) return;
    this.loadCase(i);
    this.startCase();
  }

  /* ---------------------------------------------------------- press ------- */

  private openPressMenu(): void {
    const s = this.currentStatement();
    const modes = s?.press ? Object.keys(s.press) : [];
    if (modes.length === 0) return; // nothing to press
    this.st.menu = modes.map((m) => ({ label: `PRESS ${m}`, value: m }));
    this.st.sel = 0;
    this.st.phase = "PRESS_MENU";
    this.emit("confirm");
  }

  private doPress(mode: string): void {
    const s = this.currentStatement();
    const p = s?.press?.[mode];
    if (!p) return;
    const key = `${s!.id}:${mode}`;
    const isRepeat = this.st.pressed.has(key);
    const firstTime = !isRepeat;
    this.st.pressed.add(key);
    const id = isRepeat && p.repeat_dialogue ? p.repeat_dialogue : p.dialogue;
    this.st.phase = "PRESS_RESPONSE";
    this.startById(id, CPS_NORMAL, () => {
      if (p.effects && (firstTime || p.once !== true)) {
        if (!this.runEffects(p.effects)) this.showStatement();
      } else {
        this.showStatement();
      }
    });
  }

  /* -------------------------------------------------------- objection ----- */

  private startObjection(): void {
    this.st.objTimer = 0;
    this.st.phase = "OBJECTION_ANIM";
    this.emit("objection_sting", { shake: "heavy" });
  }

  private openObjectionMenu(): void {
    const cats: ObjectionCategory[] = this.isInterruptionNow()
      ? [INTERRUPTION_CATEGORY, ...OBJECTION_CATEGORIES]
      : [...OBJECTION_CATEGORIES];
    this.st.menu = cats.map((c) => ({ label: c.replace("_", " "), value: c }));
    this.st.sel = 0;
    this.st.pendingCategory = null;
    this.st.phase = "OBJECTION_MENU";
  }

  private cancelObjection(): void {
    if (this.isInterruptionNow()) this.resumeInterruption();
    else this.showStatement();
  }

  private chooseCategory(cat: ObjectionCategory): void {
    if (cat === "CONTRADICTION") {
      this.st.pendingCategory = cat;
      this.st.menu = this.evidenceItems().map((e) => ({ label: e.name, value: e.id }));
      this.st.sel = 0;
      this.st.phase = "EVIDENCE_PICK";
    } else {
      this.evaluate(cat, null);
    }
  }

  private evaluate(cat: ObjectionCategory, evidenceId: string | null): void {
    const s = this.currentStatement();
    const lie: Lie | undefined = s?.lie;
    const already = s ? this.st.broken.has(s.id) : true;
    const prereqOk = !lie?.prerequisites || lie.prerequisites.every((f) => this.st.flags.has(f));

    // Right category on a CONTRADICTION but wrong exhibit: a distinct branch.
    if (lie && !already && cat === "CONTRADICTION" && lie.objection === "CONTRADICTION" && lie.requires_evidence && evidenceId !== lie.requires_evidence) {
      this.wrongObjection(s!, lie.wrong_evidence_dialogue ?? this.pickWrongDialogue(s!));
      return;
    }

    const correct =
      !!lie && !already && cat === lie.objection && prereqOk &&
      (lie.requires_evidence ? evidenceId === lie.requires_evidence : true);

    if (correct) {
      this.emit("sustained");
      this.st.phase = "JUDGE_LINE";
      this.st.banner = "";
      this.startLines([{ speaker: this.judgeName, text: "SUSTAINED." }], CPS_NORMAL, () => this.startBreakdown(s!, lie!));
      return;
    }
    this.wrongObjection(s, s ? this.pickWrongDialogue(s) : null);
  }

  /** Round-robin over a statement's rebuke dialogue (deterministic). */
  private pickWrongDialogue(s: Statement): string | null {
    const wod = s.wrong_objection_dialogue;
    if (!wod) return null;
    if (typeof wod === "string") return wod;
    if (wod.length === 0) return null;
    const n = this.rebukeCounter.get(s.id) ?? 0;
    this.rebukeCounter.set(s.id, n + 1);
    return wod[n % wod.length];
  }

  private wrongObjection(s: Statement | undefined, dialogueId: string | null): void {
    this.st.power = Math.max(0, this.st.power - 1);
    this.emit("rebuke_buzz", { shake: "light" });
    const interruption = this.isInterruptionNow();
    this.st.phase = "JUDGE_LINE";
    this.startById(dialogueId ?? this.caseData.intro, CPS_NORMAL, () => {
      if (this.st.power <= 0) {
        this.st.menu = [{ label: "RESTART TESTIMONY", value: "restart" }];
        this.st.sel = 0;
        this.st.phase = "POWER_EMPTY";
      } else if (interruption) {
        this.resumeInterruption();
      } else {
        this.showStatement();
      }
    });
    void s;
  }

  private startBreakdown(s: Statement, lie: Lie): void {
    this.st.broken.add(s.id);
    this.st.missed.delete(s.id);
    this.st.phase = "BREAKDOWN";
    this.emit(lie.breakdown_sfx ?? "breakdown_a", { shake: lie.shake ?? "light" });
    this.startById(lie.breakdown, CPS_BREAKDOWN, () => {
      const ended = this.runEffects(lie.effects ?? []);
      if (!ended) {
        if (this.isInterruptionNow()) this.resumeInterruption();
        else this.showStatement();
      }
    });
  }

  /* --------------------------------------------------------- interruption - */

  private startInterruption(): void {
    this.st.phase = "INTERRUPTION";
    this.st.banner = this.currentWitness().testimony.phase;
    this.st.idx = 0;
    this.st.autoTimer = 0;
    this.wrapBroken = this.brokenLqCount();
    this.showInterruptionLine();
  }

  private showInterruptionLine(): void {
    const s = this.currentStatement();
    this.st.autoTimer = 0;
    this.startLines([{ speaker: "PROSECUTOR", text: s ? s.text : "" }], CPS_NORMAL, null);
  }

  private resumeInterruption(): void {
    this.st.phase = "INTERRUPTION";
    // Skip a just-broken line at the cursor; a still-standing line resumes fresh.
    const n = this.st.order.length;
    let guard = 0;
    while (n > 0 && this.st.broken.has(this.st.order[this.st.idx]) && guard++ < n) {
      this.st.idx = (this.st.idx + 1) % n;
    }
    this.showInterruptionLine();
  }

  private brokenLqCount(): number {
    let n = 0;
    for (const id of this.st.broken) if (this.byId[id]?.lie) n++;
    return n;
  }

  /** A prosecutor line's window closed: mark a missed leading question, advance. */
  private interruptionAdvance(): void {
    const s = this.currentStatement();
    if (s?.lie && !this.st.broken.has(s.id)) this.st.missed.add(s.id);

    // find next non-broken statement, wrapping
    const n = this.st.order.length;
    let next = this.st.idx;
    for (let step = 1; step <= n; step++) {
      const cand = (this.st.idx + step) % n;
      if (!this.st.broken.has(this.st.order[cand])) {
        next = cand;
        // wrapped past the end?
        if ((this.st.idx + step) >= n) this.onInterruptionWrap();
        this.st.idx = next;
        this.showInterruptionLine();
        return;
      }
    }
    // everything broken (shouldn't happen without a terminal effect) -> win
    this.endTestimony("win");
  }

  private onInterruptionWrap(): void {
    const now = this.brokenLqCount();
    if (now === this.wrapBroken) {
      // A full pass with nothing new caught: judge nudges, then resume.
      this.st.phase = "JUDGE_LINE";
      this.startLines(
        [{ speaker: this.judgeName, text: "THE WITNESS IS BEING LED. STAY SHARP, COUNSELOR." }],
        CPS_NORMAL,
        () => this.resumeInterruption(),
      );
    }
    this.wrapBroken = now;
  }

  /* -------------------------------------------------------------- effects - */

  private runEffects(effects: Effect[]): boolean {
    let ended = false;
    let moveTo: string | null = null;
    for (const eff of effects) {
      if ("reveal_statement" in eff) {
        const { statement, insert_after } = eff.reveal_statement;
        const at = this.st.order.indexOf(insert_after);
        const pos = at >= 0 ? at + 1 : this.st.idx + 1;
        if (!this.st.order.includes(statement)) this.st.order.splice(pos, 0, statement);
        moveTo = statement;
      } else if ("replace_statement" in eff) {
        const { statement, with: withId } = eff.replace_statement;
        const at = this.st.order.indexOf(statement);
        if (at >= 0) this.st.order[at] = withId;
        this.st.broken.add(statement); // the replaced statement is retired
        moveTo = withId;
      } else if ("set_flag" in eff) {
        this.st.flags.add(eff.set_flag.flag);
      } else if ("add_evidence" in eff) {
        if (!this.st.evidence.includes(eff.add_evidence.evidence)) this.st.evidence.push(eff.add_evidence.evidence);
      } else if ("end_testimony" in eff) {
        ended = true;
        this.endTestimony(eff.end_testimony.result);
      } else if ("advance_witness" in eff) {
        ended = true;
        this.advanceWitness();
      }
    }
    if (!ended && moveTo && !this.isInterruptionNow()) {
      const p = this.st.order.indexOf(moveTo);
      if (p >= 0) this.st.idx = p;
    }
    return ended;
  }

  private endTestimony(result: "win" | "restart" | "lose"): void {
    if (result === "restart") {
      this.restartCase();
      return;
    }
    this.st.endResult = result === "lose" ? "lose" : "win";
    this.st.phase = "VERDICT";
    if (result === "win") this.emit("fanfare");
  }

  private advanceWitness(): void {
    const next = this.st.witnessIdx + 1;
    if (next < this.caseData.witnesses.length) {
      // RECESS interstitial: restore +2 POWER (cap the starting max).
      this.st.power = Math.min(this.caseData.failure.power, this.st.power + RECESS_POWER_RESTORE);
      this.st.phase = "RECESS";
      this.st.banner = "RECESS";
      this.emit("recess");
    } else {
      this.endTestimony("win");
    }
  }

  private applyOnEmpty(): void {
    this.emit("confirm");
    if (!this.runEffects(this.caseData.failure.on_empty)) this.showStatement();
  }

  /* ----------------------------------------------------------- hints ------ */

  private openHintConfirm(): void {
    this.st.phase = "HINT_CONFIRM";
    this.st.menu = [
      { label: "YES (RANK -1)", value: "yes" },
      { label: "NO", value: "no" },
    ];
    this.st.sel = 1;
    this.emit("move");
  }

  private resolveHint(yes: boolean): void {
    if (!yes) {
      this.showStatement();
      return;
    }
    const s = this.currentStatement();
    if (s?.hint) {
      this.st.hintsUsed++;
      this.st.phase = "HINT";
      this.st.banner = "CO-COUNSEL";
      this.startById(s.hint, CPS_NORMAL, () => this.showStatement());
    } else {
      // Graceful: no hint on record; no rank charge.
      this.st.phase = "HINT";
      this.st.banner = "CO-COUNSEL";
      this.startLines([{ speaker: "CO-COUNSEL", text: "NO HINT ON RECORD FOR THIS ONE." }], CPS_NORMAL, () => this.showStatement());
    }
  }

  /* -------------------------------------------------------- evidence overlay */

  private openEvidenceOverlay(from: Phase): void {
    this.overlayReturn = from;
    this.st.phase = "EVIDENCE_OVERLAY";
    this.st.menu = this.evidenceItems().map((e) => ({ label: e.name, value: e.id }));
    this.st.sel = 0;
    this.emit("move");
  }

  /* ------------------------------------------------------------ dev/jump --- */

  /** Dev jump targets: every statement across every witness. */
  jumpTargets(): { label: string; witnessIdx: number; statementId: string }[] {
    const out: { label: string; witnessIdx: number; statementId: string }[] = [];
    this.caseData.witnesses.forEach((w, wi) => {
      for (const s of w.testimony.statements) {
        out.push({ label: `${w.name}/${s.id}`, witnessIdx: wi, statementId: s.id });
      }
    });
    return out;
  }

  /**
   * Dev teleport. Grants everything obtainable (all flags + all evidence),
   * reveals hidden statements, then lands on the target with coherent state.
   */
  jumpTo(witnessIdx: number, statementId: string): void {
    this.loadWitness(witnessIdx);
    // Grant all flags and evidence the case can produce (golden-path superset).
    for (const w of this.caseData.witnesses) {
      for (const s of w.testimony.statements) {
        const scan = (effs?: Effect[]) => {
          for (const e of effs || []) {
            if ("set_flag" in e) this.st.flags.add(e.set_flag.flag);
            if ("add_evidence" in e) {
              if (!this.st.evidence.includes(e.add_evidence.evidence)) this.st.evidence.push(e.add_evidence.evidence);
            }
          }
        };
        if (s.press) for (const pm of Object.values(s.press)) scan(pm.effects);
        if (s.lie) scan(s.lie.effects);
      }
    }
    // Reveal every hidden statement of this witness so the target is present.
    const w = this.caseData.witnesses[witnessIdx];
    for (const s of w.testimony.statements) if (!this.st.order.includes(s.id)) this.st.order.push(s.id);
    const p = this.st.order.indexOf(statementId);
    this.st.idx = p >= 0 ? p : 0;
    if (this.isInterruptionNow()) this.startInterruption();
    else this.showStatement();
  }

  /** Dev-only: open the teleport menu (press J). */
  enterDevJump(): Cue[] {
    this.cues = [];
    if (!this.st.dev) return this.cues;
    this.st.menu = this.jumpTargets().map((t) => ({ label: t.label, value: `${t.witnessIdx}:${t.statementId}` }));
    this.st.sel = 0;
    this.st.phase = "DEV_JUMP";
    this.emit("move");
    return this.cues;
  }

  private doJump(v: string): void {
    const [wi, id] = v.split(":");
    this.jumpTo(parseInt(wi, 10), id);
  }

  /** Tap-select a grid cell (Court Record / evidence picker) without confirming. */
  setSel(i: number): void {
    if (i >= 0 && i < this.st.menu.length) this.st.sel = i;
  }

  /** 0..1 progress of the current interruption line's window (for the timer bar). */
  interruptionProgress(): number {
    const s = this.currentStatement();
    const window = (s?.duration_boxes ?? 1) * BASE_BOX_TIME;
    return Math.max(0, Math.min(1, this.st.autoTimer / window));
  }
}
