/*
 * The M1 case schema — the ENTIRE language a case may use.
 *
 * These types describe the compiled JSON a case becomes (author writes YAML;
 * `npm run compile-cases` produces the JSON these types model). The engine
 * reads ONLY these shapes. If something isn't expressible here, it isn't in the
 * game — adding to the language means bumping `schema` and updating the
 * validator + docs, deliberately.
 *
 * Vocabulary is frozen at schema version 1. See docs/CASE_FORMAT.md.
 */

export const SCHEMA_VERSION = 1;

export type ObjectionCategory =
  | "CONTRADICTION"
  | "HEARSAY"
  | "SPECULATION"
  | "RELEVANCE";

export const OBJECTION_CATEGORIES: ObjectionCategory[] = [
  "CONTRADICTION",
  "HEARSAY",
  "SPECULATION",
  "RELEVANCE",
];

/** One box of speech. `expression`/`sfx` are optional hints (M2 will use them). */
export interface DialogueLine {
  speaker: string;
  text: string;
  expression?: string;
  sfx?: string;
}

/** A named exchange: a sequence of boxes advanced with confirm. */
export type Dialogue = DialogueLine[];

export interface EvidenceItem {
  id: string;
  name: string;
  desc: string;
  icon?: string;
}

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

/* ---- Statements --------------------------------------------------------- */

export interface PressMode {
  /** Dialogue id played on the first press. */
  dialogue: string;
  /** If true, this press's `effects` fire only on the first press. */
  once?: boolean;
  /** Dialogue id played on subsequent presses (else the first is replayed). */
  repeat_dialogue?: string;
  /** Effects applied when the press dialogue completes. */
  effects?: Effect[];
}

export interface Lie {
  objection: ObjectionCategory;
  /** Evidence id that must be presented for a CONTRADICTION. */
  requires_evidence?: string;
  /** Flag ids that must be set before this lie can be broken. */
  prerequisites?: string[];
  /** Dialogue id: the witness breakdown. */
  breakdown: string;
  /** Effects applied after the breakdown completes. */
  effects?: Effect[];
}

export interface Statement {
  id: string;
  text: string;
  /** Not in the initial running order; must be revealed by an effect. */
  hidden?: boolean;
  /** Press modes keyed by mode name (STATEMENT / LOGIC / MOTIVE / …). */
  press?: Record<string, PressMode>;
  lie?: Lie;
  /** Dialogue id played (and 1 POWER drained) on any wrong objection here. */
  wrong_objection_dialogue?: string;
}

export interface Testimony {
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
  /** Starting POWER. */
  power: number;
  /** Effects applied when POWER reaches 0. */
  on_empty: Effect[];
}

export interface CompiledCase {
  schema: number;
  case: string;
  title: string;
  defendant: string;
  /** Dialogue id: the judge's opening. */
  intro: string;
  evidence: EvidenceItem[];
  witnesses: Witness[];
  failure: Failure;
  dialogue: Record<string, Dialogue>;
}

/** Portrait ids the engine can render (built-in placeholders; art lands in M2). */
export const KNOWN_PORTRAITS = ["dino_saurus", "pterax", "judge"] as const;
export type PortraitId = (typeof KNOWN_PORTRAITS)[number];
