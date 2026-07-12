/*
 * The case schema — the ENTIRE language a case may use. Frozen at version 2.
 *
 * Author writes YAML; `npm run compile-cases` produces the JSON these types
 * model; the engine reads ONLY these shapes. Adding to the language means
 * bumping `schema`, updating the validator, and updating docs — deliberately.
 *
 * See docs/CASE_FORMAT.md for the author-facing guide.
 */

export const SCHEMA_VERSION = 2;

/**
 * Objection categories. The first four appear in normal cross-examination;
 * LEADING_QUESTION is only offered during an `interruption` phase.
 */
export type ObjectionCategory =
  | "CONTRADICTION"
  | "HEARSAY"
  | "SPECULATION"
  | "RELEVANCE"
  | "LEADING_QUESTION";

export const OBJECTION_CATEGORIES: ObjectionCategory[] = [
  "CONTRADICTION",
  "HEARSAY",
  "SPECULATION",
  "RELEVANCE",
];

/** The extra category, offered only during interruption phases. */
export const INTERRUPTION_CATEGORY: ObjectionCategory = "LEADING_QUESTION";

/** Named, synthesized sound cues. Data (`sfx`, `breakdown_sfx`) references these. */
export const SFX_REGISTRY = [
  "blip",
  "confirm",
  "move",
  "objection_sting",
  "rebuke_buzz",
  "breakdown_a",
  "breakdown_b",
  "sustained",
  "recess",
  "fanfare",
] as const;
export type SfxName = (typeof SFX_REGISTRY)[number];

export type ShakeLevel = "light" | "heavy";

/* ---- Effects: the only state changes a case may request ----------------- */

export type Effect =
  | { reveal_statement: { statement: string; insert_after: string } }
  | { replace_statement: { statement: string; with: string } }
  | { set_flag: { flag: string } }
  | { add_evidence: { evidence: string } }
  | { end_testimony: { result: EndResult } }
  | { advance_witness: Record<string, never> };

export type EndResult = "win" | "restart" | "lose";

export const EFFECT_KEYS = [
  "reveal_statement",
  "replace_statement",
  "set_flag",
  "add_evidence",
  "end_testimony",
  "advance_witness",
] as const;

/* ---- Dialogue ----------------------------------------------------------- */

/** One box of speech. Lines may carry effects (used by the briefing). */
export interface DialogueLine {
  speaker: string;
  text: string;
  expression?: string;
  sfx?: SfxName;
  effects?: Effect[];
}

export type Dialogue = DialogueLine[];

/* ---- Evidence ----------------------------------------------------------- */

export interface EvidenceItem {
  id: string;
  name: string;
  desc: string;
  icon?: string;
}

/* ---- Statements --------------------------------------------------------- */

export interface PressMode {
  dialogue: string;
  once?: boolean;
  repeat_dialogue?: string;
  effects?: Effect[];
}

export interface Lie {
  objection: ObjectionCategory;
  requires_evidence?: string;
  prerequisites?: string[];
  breakdown: string;
  effects?: Effect[];
  /** Shown when the category is right (CONTRADICTION) but the exhibit is wrong. */
  wrong_evidence_dialogue?: string;
  /** Registry sound played on the breakdown. */
  breakdown_sfx?: SfxName;
  /** Screen shake on the breakdown. */
  shake?: ShakeLevel;
}

export interface Statement {
  id: string;
  text: string;
  hidden?: boolean;
  press?: Record<string, PressMode>;
  lie?: Lie;
  /** A string OR a list the engine cycles (deterministic round-robin). */
  wrong_objection_dialogue?: string | string[];
  /** Dialogue shown if the player asks for a hint (costs one rank letter). */
  hint?: string;
  /** Interruption only: boxes-worth of time this line holds before auto-advancing. */
  duration_boxes?: number;
}

export interface Testimony {
  /** A display label, OR the literal "interruption" to switch scene modes. */
  phase: string;
  statements: Statement[];
}

export interface Witness {
  id: string;
  name: string;
  portrait: string;
  testimony: Testimony;
}

export interface Failure {
  power: number;
  on_empty: Effect[];
}

export interface CompiledCase {
  schema: number;
  case: string;
  title: string;
  defendant: string;
  /** Optional 2-minute prologue (dialogue id); briefing lines may grant evidence. */
  briefing?: string;
  intro: string;
  evidence: EvidenceItem[];
  witnesses: Witness[];
  failure: Failure;
  /** Category -> dialogue id: co-counsel walkthrough the first time each is solvable. */
  guidance?: Record<string, string>;
  dialogue: Record<string, Dialogue>;
}

/** Between-witness POWER restore. */
export const RECESS_POWER_RESTORE = 2;

/** Portrait ids the engine can render (built-in placeholders; art lands via PNGs). */
export const KNOWN_PORTRAITS = ["dino_saurus", "pterax", "judge"] as const;
export type PortraitId = (typeof KNOWN_PORTRAITS)[number];

/** Is this testimony an interruption (prosecutor-driven) scene? */
export function isInterruption(t: Testimony): boolean {
  return String(t.phase).trim().toUpperCase() === "INTERRUPTION";
}
