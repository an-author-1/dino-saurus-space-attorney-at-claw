/*
 * The case engine: a pure state machine. Construct it with a compiled case,
 * feed it InputEvents and time (`tick`), and read `state` to render. It never
 * touches the DOM, canvas, or audio — it only mutates state and emits semantic
 * Cues. This purity is what makes the headless regression harness possible.
 *
 * The logic is a faithful port of the M0 machine (see docs/M0_AUDIT.md), with
 * M0's bespoke `reveals`/rebuke-pool/`objectionPenalty` replaced by the schema's
 * effects vocabulary and per-statement `wrong_objection_dialogue`.
 */

import type {
  CompiledCase,
  DialogueLine,
  Effect,
  EvidenceItem,
  Lie,
  ObjectionCategory,
  Statement,
  Witness,
} from "./types";
import { OBJECTION_CATEGORIES } from "./types";
import type { Cue, CueKind, EngineState, InputEvent } from "./state";

const OBJ_ANIM_DUR = 0.75;
const CPS_NORMAL = 30;
const CPS_BREAKDOWN = 55;

export class Engine {
  private st: EngineState;
  private cues: Cue[] = [];

  /** Continuation to run when the active dialogue finishes advancing. */
  private onDlgComplete: (() => void) | null = null;
  /** Typewriter accumulator for the active dialogue. */
  private revAcc = 0;

  private byId: Record<string, Statement> = {};
  private evById: Record<string, EvidenceItem> = {};
  readonly judgeName: string;

  constructor(private readonly caseData: CompiledCase) {
    for (const e of caseData.evidence) this.evById[e.id] = e;
    const introLines = caseData.dialogue[caseData.intro] ?? [];
    this.judgeName = introLines[0]?.speaker ?? "JUDGE";

    this.st = {
      phase: "TITLE",
      power: caseData.failure.power,
      witnessIdx: 0,
      order: [],
      idx: 0,
      flags: new Set(),
      pressed: new Set(),
      broken: new Set(),
      evidence: caseData.evidence.map((e) => e.id),
      dialogue: null,
      menu: [],
      sel: 0,
      objTimer: 0,
      pendingCategory: null,
      endResult: null,
    };
    this.loadWitness(0);
  }

  /* ------------------------------------------------------------ readonly -- */

  get state(): Readonly<EngineState> {
    return this.st;
  }

  get case(): CompiledCase {
    return this.caseData;
  }

  currentWitness(): Witness {
    return this.caseData.witnesses[this.st.witnessIdx];
  }

  currentStatement(): Statement | undefined {
    return this.byId[this.st.order[this.st.idx]];
  }

  /** Resolved evidence records currently in the Court Record. */
  evidenceItems(): EvidenceItem[] {
    return this.st.evidence.map((id) => this.evById[id]).filter(Boolean);
  }

  /** The dialogue box on screen right now (or null). */
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

  /** Case rank from POWER remaining (S if none lost). */
  rank(): string {
    if (this.st.power >= this.caseData.failure.power) return "S";
    return (["-", "D", "C", "B", "A"][this.st.power] ?? "D");
  }

  /* ---------------------------------------------------------------- cues -- */

  private emit(kind: CueKind, seed?: number): void {
    this.cues.push({ kind, seed });
  }

  /* --------------------------------------------------------------- setup -- */

  private loadWitness(i: number): void {
    this.st.witnessIdx = i;
    const w = this.caseData.witnesses[i];
    this.byId = {};
    for (const s of w.testimony.statements) this.byId[s.id] = s;
    this.st.order = w.testimony.statements.filter((s) => !s.hidden).map((s) => s.id);
    this.st.idx = 0;
  }

  private startTestimony(): void {
    this.st.power = this.caseData.failure.power;
    this.st.flags.clear();
    this.st.pressed.clear();
    this.st.broken.clear();
    this.st.evidence = this.caseData.evidence.map((e) => e.id);
    this.st.endResult = null;
    this.loadWitness(0);
    this.showStatement();
  }

  private showStatement(): void {
    this.st.phase = "TESTIMONY";
    const s = this.currentStatement();
    this.startLines([{ speaker: this.currentWitness().name, text: s ? s.text : "" }], CPS_NORMAL, null);
  }

  /* ------------------------------------------------------------ dialogue -- */

  private startById(id: string, cps: number, onComplete: (() => void) | null): void {
    this.startLines(this.caseData.dialogue[id] ?? [{ speaker: "", text: "" }], cps, onComplete);
  }

  private startLines(lines: DialogueLine[], cps: number, onComplete: (() => void) | null): void {
    this.st.dialogue = {
      lines: lines.length ? lines : [{ speaker: "", text: "" }],
      lineIdx: 0,
      shown: 0,
      cps,
    };
    this.revAcc = 0;
    this.onDlgComplete = onComplete;
  }

  /** Skip the current box's typewriter, else advance to the next box / finish. */
  private dlgAdvance(): void {
    const d = this.st.dialogue;
    if (!d) return;
    const line = d.lines[d.lineIdx];
    if (d.shown < line.text.length) {
      d.shown = line.text.length; // skip reveal (silent, like M0)
      return;
    }
    if (d.lineIdx < d.lines.length - 1) {
      d.lineIdx++;
      d.shown = 0;
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

  /** Advance time-based state (typewriter reveal, OBJECTION! interrupt). */
  tick(dt: number): Cue[] {
    this.cues = [];
    const d = this.st.dialogue;
    if (d) {
      const line = d.lines[d.lineIdx];
      if (d.shown < line.text.length) {
        this.revAcc += dt;
        const step = 1 / d.cps;
        while (this.revAcc >= step && d.shown < line.text.length) {
          this.revAcc -= step;
          d.shown++;
          if (line.text[d.shown - 1] !== " ") this.emit("blip", d.shown);
        }
      }
    }
    if (this.st.phase === "OBJECTION_ANIM") {
      this.st.objTimer += dt;
      if (this.st.objTimer >= OBJ_ANIM_DUR) this.openObjectionMenu();
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
          this.st.phase = "INTRO";
          this.startById(this.caseData.intro, CPS_NORMAL, () => this.startTestimony());
        }
        break;

      case "INTRO":
        this.advanceReading(event);
        break;

      case "TESTIMONY":
        this.inputTestimony(event);
        break;

      case "PRESS_MENU":
        this.inputMenu(event, (v) => this.doPress(v), () => this.showStatement());
        break;

      case "PRESS_RESPONSE":
        this.advanceReading(event);
        break;

      case "OBJECTION_ANIM":
        if (event === "confirm" || event === "back") this.st.objTimer = OBJ_ANIM_DUR;
        break;

      case "OBJECTION_MENU":
        this.inputMenu(event, (v) => this.chooseCategory(v as ObjectionCategory), () => this.showStatement());
        break;

      case "EVIDENCE_PICK":
        this.inputMenu(event, (v) => this.evaluate("CONTRADICTION", v), () => this.openObjectionMenu());
        break;

      case "EVIDENCE_OVERLAY":
        if (event === "confirm" || event === "back" || event === "evidence") {
          this.emit("move");
          this.st.phase = this.overlayReturn;
        }
        break;

      case "JUDGE_LINE":
      case "BREAKDOWN":
        this.advanceReading(event);
        break;

      case "VERDICT":
        if (event === "confirm") {
          this.emit("confirm");
          this.st.phase = "TITLE";
        }
        break;

      case "POWER_EMPTY":
        this.inputMenu(event, () => this.applyOnEmpty(), () => {});
        break;
    }
    return this.cues;
  }

  /** Reading states: confirm/back skips typing, else runs the continuation. */
  private advanceReading(event: InputEvent): void {
    if (event === "confirm" || event === "back") this.dlgAdvance();
  }

  private inputTestimony(event: InputEvent): void {
    const box = this.currentBox();
    if (box && !box.boxDone && (event === "confirm" || event === "back")) {
      this.st.dialogue!.shown = box.line.text.length; // skip reveal
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
      default:
        break;
    }
  }

  private inputMenu(event: InputEvent, onConfirm: (v: string) => void, onBack: () => void): void {
    switch (event) {
      case "up":
        this.st.sel = (this.st.sel - 1 + this.st.menu.length) % this.st.menu.length;
        this.emit("move");
        break;
      case "down":
        this.st.sel = (this.st.sel + 1) % this.st.menu.length;
        this.emit("move");
        break;
      case "confirm":
        this.emit("confirm");
        onConfirm(this.st.menu[this.st.sel].value);
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
      const phase = this.st.phase;
      this.emit("confirm");
      if (phase === "PRESS_MENU") this.doPress(this.st.menu[i].value);
      else if (phase === "OBJECTION_MENU") this.chooseCategory(this.st.menu[i].value as ObjectionCategory);
      else if (phase === "EVIDENCE_PICK") this.evaluate("CONTRADICTION", this.st.menu[i].value);
      else if (phase === "POWER_EMPTY") this.applyOnEmpty();
    }
    return this.cues;
  }

  /* ---------------------------------------------------------- transitions - */

  private openPressMenu(): void {
    const s = this.currentStatement();
    const modes = s?.press ? Object.keys(s.press) : [];
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
      // Press effects fire on the first press (or every press when once !== true).
      if (p.effects && (firstTime || p.once !== true)) {
        const ended = this.runEffects(p.effects);
        if (!ended) this.showStatement();
      } else {
        this.showStatement();
      }
    });
  }

  private startObjection(): void {
    this.st.objTimer = 0;
    this.st.phase = "OBJECTION_ANIM";
    this.emit("objection");
  }

  private openObjectionMenu(): void {
    this.st.menu = OBJECTION_CATEGORIES.map((c) => ({ label: c, value: c }));
    this.st.sel = 0;
    this.st.pendingCategory = null;
    this.st.phase = "OBJECTION_MENU";
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
    const alreadyBroken = s ? this.st.broken.has(s.id) : true;
    const prereqsMet = !lie?.prerequisites || lie.prerequisites.every((f) => this.st.flags.has(f));
    const correct =
      !!lie &&
      !alreadyBroken &&
      cat === lie.objection &&
      prereqsMet &&
      (lie.requires_evidence ? evidenceId === lie.requires_evidence : true);

    if (correct) {
      this.emit("sustain");
      this.st.phase = "JUDGE_LINE";
      this.startLines([{ speaker: this.judgeName, text: "SUSTAINED." }], CPS_NORMAL, () =>
        this.startBreakdown(s!, lie!),
      );
      return;
    }

    // Wrong objection: drain 1 POWER and play the statement's rebuke dialogue.
    this.st.power = Math.max(0, this.st.power - 1);
    this.emit("wrong");
    const dlgId = s?.wrong_objection_dialogue;
    this.st.phase = "JUDGE_LINE";
    this.startById(dlgId ?? this.caseData.intro, CPS_NORMAL, () => {
      if (this.st.power <= 0) {
        this.st.menu = [{ label: "RESTART TESTIMONY", value: "restart" }];
        this.st.sel = 0;
        this.st.phase = "POWER_EMPTY";
      } else {
        this.showStatement();
      }
    });
  }

  private startBreakdown(s: Statement, lie: Lie): void {
    this.st.broken.add(s.id);
    this.st.phase = "BREAKDOWN";
    this.startById(lie.breakdown, CPS_BREAKDOWN, () => {
      const ended = this.runEffects(lie.effects ?? []);
      if (!ended) this.showStatement();
    });
  }

  /* -------------------------------------------------------------- effects - */

  /** Apply a list of effects. Returns true if testimony ended (verdict/restart/advance). */
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
        moveTo = withId;
      } else if ("set_flag" in eff) {
        this.st.flags.add(eff.set_flag.flag);
      } else if ("add_evidence" in eff) {
        if (!this.st.evidence.includes(eff.add_evidence.evidence)) {
          this.st.evidence.push(eff.add_evidence.evidence);
        }
      } else if ("end_testimony" in eff) {
        ended = true;
        this.endTestimony(eff.end_testimony.result);
      } else if ("advance_witness" in eff) {
        ended = true;
        this.advanceWitness();
      }
    }
    if (!ended && moveTo) {
      const p = this.st.order.indexOf(moveTo);
      if (p >= 0) this.st.idx = p;
    }
    return ended;
  }

  private endTestimony(result: "win" | "restart" | "lose"): void {
    if (result === "restart") {
      this.startTestimony();
      return;
    }
    this.st.endResult = result === "lose" ? "lose" : "win";
    this.st.phase = "VERDICT";
    if (result === "win") this.emit("fanfare");
  }

  private advanceWitness(): void {
    const next = this.st.witnessIdx + 1;
    if (next < this.caseData.witnesses.length) {
      this.loadWitness(next);
      this.showStatement();
    } else {
      // No more witnesses: the case is won.
      this.endTestimony("win");
    }
  }

  private applyOnEmpty(): void {
    const ended = this.runEffects(this.caseData.failure.on_empty);
    if (!ended) this.showStatement();
  }

  /* -------------------------------------------------------- evidence overlay */

  private overlayReturn: EngineState["phase"] = "TESTIMONY";
  private openEvidenceOverlay(from: EngineState["phase"]): void {
    this.overlayReturn = from;
    this.st.phase = "EVIDENCE_OVERLAY";
    this.emit("move");
  }
}
