/*
 * ============================================================================
 *  MICRO_CASE  —  THE SINGLE SOURCE OF ALL CASE CONTENT.
 * ============================================================================
 *
 *  Everything the player reads or reacts to lives in this one const. The state
 *  machine (see game.ts) reads ONLY from here — it contains no hardcoded lines
 *  of its own. A later milestone will extract a schema from exactly this shape,
 *  so keep it declarative: data, not behaviour.
 *
 *  Objection categories that exist in the world (the menu always shows all four):
 *    CONTRADICTION | HEARSAY | SPECULATION | RELEVANCE
 *
 *  A statement is objectionable iff it has a `lie`. `lie.category` is the ONE
 *  correct category; `lie.requiresEvidence` (if set) is the evidence id that
 *  must be presented for CONTRADICTION to land.
 * ============================================================================
 */

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

export interface EvidenceItem {
  id: string;
  name: string;
  desc: string;
}

export interface PressOption {
  /** Shown in the press menu as "PRESS <mode>". */
  mode: string;
  /** Witness line on first press. */
  response: string;
  /** Collapsed line on every repeat press. */
  repeat: string;
}

export interface Lie {
  category: ObjectionCategory;
  /** Evidence id required to break a CONTRADICTION, or null if none. */
  requiresEvidence: string | null;
  /** Witness breakdown text (types out fast). */
  breakdown: string;
  /** Statement id revealed after this lie breaks, or null → go to verdict. */
  reveals: string | null;
}

export interface Statement {
  id: string;
  speaker: string;
  text: string;
  /** Hidden statements are not in the initial running order. */
  hidden?: boolean;
  presses: PressOption[];
  /** null → statement is not objectionable (objecting costs POWER). */
  lie: Lie | null;
  /** Judge line when someone objects to a non-objectionable statement. */
  objectionPenalty?: string;
}

export interface MicroCase {
  title: { game: string; subtitle: string; prompt: string; footer: string };
  witness: string;
  evidence: EvidenceItem[];
  intro: { speaker: string; line: string };
  statements: Statement[];
  /** Ids visible at the start of testimony, in order. */
  initialOrder: string[];
  /** Judge line played on a correct objection, before the breakdown. */
  judgeSustained: string;
  /** Judge rebuke pool for a wrong objection on an objectionable statement. */
  wrongObjectionRebukes: string[];
}

export const MICRO_CASE: MicroCase = {
  title: {
    game: "DINO SAURUS — SPACE ATTORNEY AT CLAW",
    subtitle: "MICRO-CASE 0-0: THE MISSING LUNCH",
    prompt: "PRESS Z",
    footer: "(C) 3087 CLAW ENTERPRISES",
  },

  witness: "PTERAX",

  evidence: [
    {
      id: "fridge_log",
      name: "FRIDGE ACCESS LOG",
      desc: "GALLEY FRIDGE LOG. ONE ACCESS AT 0300 — BADGE 77. BADGE 77: PTERAX.",
    },
  ],

  intro: {
    speaker: "JUDGE TRICERA",
    line: "COURT IS IN SESSION. SAL AMANDER STANDS ACCUSED OF EATING THE CAPTAIN'S LUNCH. COUNSELOR — YOUR WITNESS.",
  },

  statements: [
    {
      id: "t1",
      speaker: "PTERAX",
      text: "I WAS ASLEEP IN MY QUARTERS ALL NIGHT. NEVER LEFT. NOT ONCE.",
      presses: [
        {
          mode: "STATEMENT",
          response:
            "ASLEEP? I SLEEP STANDING UP. WITH ONE EYE OPEN. IT'S A PTERANODON THING.",
          repeat: "I TOLD YOU. STANDING. ONE EYE.",
        },
      ],
      lie: {
        category: "CONTRADICTION",
        requiresEvidence: "fridge_log",
        breakdown:
          "THE LOG? BADGE 77?! FINE — I WENT TO THE GALLEY. BUT ONLY BECAUSE—",
        reveals: "t1b",
      },
    },

    {
      id: "t1b",
      speaker: "PTERAX",
      hidden: true,
      text: "MY BUNKMATE TOLD ME THE GALLEY WAS LOCKED ALL NIGHT ANYWAY. SO IT COULDN'T HAVE BEEN ME.",
      presses: [
        {
          mode: "LOGIC",
          response:
            "IF IT WAS LOCKED, HOW DID BADGE 77 GET IN? ...I WANT A LAWYER. WAIT. YOU'RE A LAWYER.",
          repeat: "NO FURTHER COMMENT.",
        },
      ],
      lie: {
        category: "HEARSAY",
        requiresEvidence: null,
        breakdown:
          "OBJECTION SUSTAINED?! BUT HE REALLY DID TELL ME— OH. OH NO. THAT'S THE PROBLEM, ISN'T IT.",
        reveals: null,
      },
    },

    {
      id: "t2",
      speaker: "PTERAX",
      text: "SAL ALWAYS EYES THE CAPTAIN'S LUNCH. EVERYONE KNOWS IT.",
      presses: [
        {
          mode: "MOTIVE",
          response:
            "LOOK, WE ALL EYE THE LUNCH. IT'S A GOOD LUNCH. THAT'S NOT A CRIME.",
          repeat: "GOOD. LUNCH.",
        },
      ],
      lie: null,
      objectionPenalty: "OVERRULED. DISTASTEFUL, BUT ADMISSIBLE.",
    },
  ],

  initialOrder: ["t1", "t2"],

  judgeSustained: "SUSTAINED.",

  wrongObjectionRebukes: [
    "OVERRULED. WATCH YOURSELF, COUNSELOR.",
    "OVERRULED. THE STAR COURT'S PATIENCE IS NOT INFINITE.",
  ],
};
