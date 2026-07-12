/*
 * Engine state + I/O types. No DOM, canvas, or audio here — the engine is a
 * pure state machine the render / audio / input layers observe.
 */

import type { DialogueLine, ObjectionCategory, SfxName, ShakeLevel } from "./types";

export type InputEvent =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "evidence"
  | "hint"
  | "slam";

export type Phase =
  | "TITLE"
  | "CASE_PICK"
  | "BRIEFING"
  | "INTRO"
  | "TESTIMONY"
  | "INTERRUPTION"
  | "PRESS_MENU"
  | "PRESS_RESPONSE"
  | "OBJECTION_ANIM"
  | "OBJECTION_MENU"
  | "EVIDENCE_PICK"
  | "EVIDENCE_OVERLAY"
  | "GUIDANCE"
  | "HINT_CONFIRM"
  | "HINT"
  | "JUDGE_LINE"
  | "BREAKDOWN"
  | "RECESS"
  | "VERDICT"
  | "POWER_EMPTY"
  | "DEV_JUMP";

/**
 * A cue names a synthesized sound (SFX_REGISTRY) and may carry a shake level;
 * the audio layer plays the sound, the render layer applies the shake.
 */
export interface Cue {
  name: SfxName;
  seed?: number;
  shake?: ShakeLevel;
}

export interface MenuItem {
  label: string;
  value: string;
}

export interface RunningDialogue {
  lines: DialogueLine[];
  lineIdx: number;
  shown: number;
  cps: number;
  /** Whether the current line's effects have already fired. */
  firedLine: number;
}

export interface EngineState {
  phase: Phase;
  power: number;

  witnessIdx: number;
  order: string[];
  idx: number;

  flags: Set<string>;
  pressed: Set<string>;
  broken: Set<string>;
  evidence: string[];

  dialogue: RunningDialogue | null;
  menu: MenuItem[];
  sel: number;

  objTimer: number;

  pendingCategory: ObjectionCategory | null;
  endResult: "win" | "lose" | null;

  /** Objection categories whose co-counsel guidance has already played. */
  guidanceShown: Set<string>;
  /** Hint requests made this testimony (each drops the rank one letter). */
  hintsUsed: number;

  /** Interruption: statements whose window closed unchallenged. */
  missed: Set<string>;
  /** Interruption: seconds the current auto-advancing line has been on screen. */
  autoTimer: number;

  /** Dev mode: instant text, jump menu, on-screen validator errors. */
  dev: boolean;

  /** The current dialogue line's expression (for the render layer). */
  expression: string;
  /** Header/label for the current scene, when data-driven (e.g. RECESS to phase). */
  banner: string;
}
