/*
 * Engine state + I/O types. No DOM, no canvas, no audio here — the engine is a
 * pure state machine that the render / audio / input layers observe.
 */

import type { DialogueLine, ObjectionCategory } from "./types";

/** Player inputs. The only way the outside world drives the machine. */
export type InputEvent =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "evidence";

/** The finite states. Same shape as the M0 machine. */
export type Phase =
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

/**
 * Semantic output cues. The engine emits these; the audio layer turns them into
 * sound and the render layer turns some of them (objection/wrong) into shake.
 * Keeping them semantic is what keeps the engine free of audio/canvas.
 */
export type CueKind =
  | "blip"
  | "move"
  | "confirm"
  | "objection"
  | "wrong"
  | "sustain"
  | "fanfare";

export interface Cue {
  kind: CueKind;
  /** For "blip": jitters the pitch per character. */
  seed?: number;
}

export interface MenuItem {
  label: string;
  value: string;
}

/** The currently-running exchange (statement box, press response, judge line…). */
export interface RunningDialogue {
  lines: DialogueLine[];
  lineIdx: number;
  /** Revealed characters of the current line (typewriter). */
  shown: number;
  cps: number;
}

/**
 * The full observable state. The render layer reads this; nothing outside the
 * engine writes it.
 */
export interface EngineState {
  phase: Phase;
  power: number;

  witnessIdx: number;
  /** Visible statement ids for the current witness, in running order. */
  order: string[];
  idx: number;

  flags: Set<string>;
  pressed: Set<string>;
  broken: Set<string>;
  /** Evidence ids currently in the Court Record. */
  evidence: string[];

  dialogue: RunningDialogue | null;
  menu: MenuItem[];
  sel: number;

  /** OBJECTION! interrupt progress, seconds. */
  objTimer: number;

  /** Category chosen at the objection menu, awaiting an evidence pick. */
  pendingCategory: ObjectionCategory | null;

  /** Result recorded at end of testimony (drives the verdict card). */
  endResult: "win" | "lose" | null;
}
