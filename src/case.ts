// =============================================================================
//  MICRO_CASE — the COMPLETE, hardcoded content for Dino Saurus M0.
//
//  EVERYTHING the state machine says or reacts to lives in this one const.
//  A later milestone will extract a schema from exactly this shape, so keep all
//  case content here and read only from it — no case text anywhere else.
// =============================================================================

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

export interface Evidence {
  id: string;
  name: string;
  text: string;
}

export interface Press {
  mode: string; // e.g. "STATEMENT", "LOGIC", "MOTIVE" -> menu row "PRESS <mode>"
  response: string; // first-time reply
  repeat: string; // collapsed one-line reply on repeat presses
}

export interface Objection {
  category: ObjectionCategory;
  requiresEvidence: string | null; // evidence id required (CONTRADICTION only)
  breakdown: string; // witness breakdown lines on a correct objection
  reveals?: string; // statement id unlocked after this breakdown
  endsCase?: boolean; // breaking this lie ends the testimony -> verdict
}

export interface Statement {
  id: string;
  text: string;
  presses: Press[];
  objection: Objection | null; // null = not objectionable
  // Rebuke used when the player objects to a NOT-objectionable statement.
  notObjectionableRebuke?: string;
  hidden?: boolean; // not shown until revealed by another breakdown
}

export interface MicroCase {
  title: {
    line1: string;
    line2: string;
    prompt: string;
  };
  copyright: string;
  intro: { speaker: string; text: string };
  judge: {
    sustained: string;
    rebukePool: string[];
  };
  witness: string;
  evidence: Evidence[];
  statements: Statement[];
  initialOrder: string[]; // statement ids shown at the start
}

export const MICRO_CASE: MicroCase = {
  title: {
    line1: "DINO SAURUS — SPACE ATTORNEY AT CLAW",
    line2: "MICRO-CASE 0-0: THE MISSING LUNCH",
    prompt: "PRESS Z",
  },
  copyright: "© 3087 CLAW ENTERPRISES",

  intro: {
    speaker: "JUDGE TRICERA",
    text:
      "COURT IS IN SESSION. SAL AMANDER STANDS ACCUSED OF EATING THE CAPTAIN'S LUNCH. COUNSELOR — YOUR WITNESS.",
  },

  judge: {
    sustained: "SUSTAINED.",
    rebukePool: [
      "OVERRULED. WATCH YOURSELF, COUNSELOR.",
      "OVERRULED. THE STAR COURT'S PATIENCE IS NOT INFINITE.",
    ],
  },

  witness: "PTERAX",

  evidence: [
    {
      id: "FRIDGE_LOG",
      name: "FRIDGE ACCESS LOG",
      text: "GALLEY FRIDGE LOG. ONE ACCESS AT 0300 — BADGE 77. BADGE 77: PTERAX.",
    },
  ],

  statements: [
    {
      id: "t1",
      text: "I WAS ASLEEP IN MY QUARTERS ALL NIGHT. NEVER LEFT. NOT ONCE.",
      presses: [
        {
          mode: "STATEMENT",
          response:
            "ASLEEP? I SLEEP STANDING UP. WITH ONE EYE OPEN. IT'S A PTERANODON THING.",
          repeat: "I TOLD YOU. STANDING. ONE EYE.",
        },
      ],
      objection: {
        category: "CONTRADICTION",
        requiresEvidence: "FRIDGE_LOG",
        breakdown:
          "THE LOG? BADGE 77?! FINE — I WENT TO THE GALLEY. BUT ONLY BECAUSE—",
        reveals: "t1b",
      },
    },
    {
      id: "t1b",
      hidden: true,
      text:
        "MY BUNKMATE TOLD ME THE GALLEY WAS LOCKED ALL NIGHT ANYWAY. SO IT COULDN'T HAVE BEEN ME.",
      presses: [
        {
          mode: "LOGIC",
          response:
            "IF IT WAS LOCKED, HOW DID BADGE 77 GET IN? …I WANT A LAWYER. WAIT. YOU'RE A LAWYER.",
          repeat: "NO FURTHER COMMENT.",
        },
      ],
      objection: {
        category: "HEARSAY",
        requiresEvidence: null,
        breakdown:
          "OBJECTION SUSTAINED?! BUT HE REALLY DID TELL ME— OH. OH NO. THAT'S THE PROBLEM, ISN'T IT.",
        endsCase: true,
      },
    },
    {
      id: "t2",
      text: "SAL ALWAYS EYES THE CAPTAIN'S LUNCH. EVERYONE KNOWS IT.",
      presses: [
        {
          mode: "MOTIVE",
          response:
            "LOOK, WE ALL EYE THE LUNCH. IT'S A GOOD LUNCH. THAT'S NOT A CRIME.",
          repeat: "GOOD. LUNCH.",
        },
      ],
      objection: null,
      notObjectionableRebuke: "OVERRULED. DISTASTEFUL, BUT ADMISSIBLE.",
    },
  ],

  initialOrder: ["t1", "t2"],
};
