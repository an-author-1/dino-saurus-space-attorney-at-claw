# CASE FORMAT — the writer's guide to authoring a case

A case is a single YAML file. You write the YAML; `npm run compile-cases`
turns it into the JSON the engine actually reads; `npm run validate` proves
the file is playable before anyone loads it. Every case file MUST begin with
`schema: 2` — that is the version of this language, and the compiler rejects a
file without it. Everything you can express lives in this document; there is no
hidden vocabulary. If you can't say it here, the game can't do it.

The running example throughout is `cases/case-0-0.yaml` — **THE MISSING LUNCH**,
the tiny ported micro-case. Read it alongside this doc; most snippets below are
lifted straight from it. The interruption-phase snippets come from
`cases/case-0-1.yaml` — **THE INTERRUPTION DRILL**.

---

## The shape of a case, top to bottom

A case file has these top-level keys, in roughly this order:

| Key | What it is |
| --- | --- |
| `schema` | Always `2`. The language version. Required. |
| `case` | The case's short id, e.g. `"0-0"`. A string. |
| `title` | The case title shown to the player. |
| `defendant` | Who is on trial. |
| `briefing` | Optional. A **dialogue id** — the pre-testimony prologue. Its lines may hand over starting evidence. |
| `intro` | A **dialogue id** — the judge's opening, played once before testimony. |
| `evidence` | The Court Record: the list of evidence items the player holds. |
| `failure` | The POWER economy (how many wrong objections you can afford). |
| `witnesses` | The witnesses, each with a testimony to cross-examine. |
| `guidance` | Optional. A map of objection category -> dialogue id: co-counsel walkthrough. |
| `dialogue` | The map of every line of speech, referenced by id from above. |

### `case`, `title`, `defendant`

Plain identifying text. From case-0-0:

```yaml
schema: 2

case: "0-0"
title: THE MISSING LUNCH
defendant: SAL AMANDER
```

Quote `case` so `0-0` is read as a string, not a date or a subtraction.

### `briefing` — the pre-testimony prologue

Optional, and new in schema 2. Like `intro`, it is an **id that points into the
`dialogue:` map**. It plays before `intro` — the quiet scene where co-counsel
sets the stakes and, crucially, **hands over the evidence you'll start with**.

Briefing lines are ordinary dialogue lines, but they may carry an `effects:`
list (see Dialogue lines with effects, below). The usual job of the briefing is
to `add_evidence` the exhibits the player begins the case holding:

```yaml
briefing: briefing

dialogue:
  briefing:
    - speaker: DINO SAURUS
      text: "THEY HANDED ME THE FRIDGE LOG. LET'S SEE WHO TRIPPED BADGE 77."
      effects:
        - add_evidence: { evidence: fridge_log }
```

**IMPORTANT RULE — what starts in the Court Record.** Evidence that is the
target of *any* `add_evidence` effect (anywhere in the case — briefing, press,
or lie) starts **ABSENT** from the Court Record and must be granted before it
can be used. All other declared evidence starts **present**. So: to give the
player a starting exhibit *and* keep it out of the record until the briefing,
grant it with an `add_evidence` on a briefing line. If an exhibit is never the
target of an `add_evidence`, it is simply in the record from turn one.

### `intro`

Not text — an **id that points into the `dialogue:` map** at the bottom of the
file. It is the judge's opening, played once before the first witness (and after
the `briefing`, if any).

```yaml
intro: intro
```

That `intro` resolves to:

```yaml
dialogue:
  intro:
    - speaker: JUDGE TRICERA
      text: "COURT IS IN SESSION. SAL AMANDER STANDS ACCUSED OF EATING THE CAPTAIN'S LUNCH. COUNSELOR — YOUR WITNESS."
```

### `evidence[]` — the Court Record

The evidence the player can present. Each item:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Internal id you reference from a lie's `requires_evidence` and from `add_evidence`. |
| `name` | yes | The name shown in the Court Record. |
| `desc` | yes | The description text the player reads when inspecting it. |
| `icon` | no | An optional icon hint (art lands later; safe to omit). |

```yaml
evidence:
  - id: fridge_log
    name: FRIDGE ACCESS LOG
    icon: log
    desc: "GALLEY FRIDGE LOG. ONE ACCESS AT 0300 — BADGE 77. BADGE 77: PTERAX."
```

Whether an item starts in the record depends on the `add_evidence` rule above.
Any item you hand over mid-case with `add_evidence` — from a briefing line, a
press, or a lie — must still be declared here in `evidence[]`.

### `failure` — the POWER economy

POWER is the player's margin for error. Every wrong objection drains one pip.
When POWER hits zero, the effects in `on_empty` fire.

| Field | Meaning |
| --- | --- |
| `power` | Starting POWER (number of pips). This is also the RECESS cap — see Multiple witnesses. |
| `on_empty` | Effects applied the moment POWER reaches 0 — usually `end_testimony: { result: restart }`. |

```yaml
failure:
  power: 5
  on_empty:
    - end_testimony: { result: restart }
```

---

## Witnesses

`witnesses` is an ordered list. The player cross-examines them in order; an
`advance_witness` effect moves from one to the next.

| Field | Meaning |
| --- | --- |
| `id` | Internal id for the witness. |
| `name` | Name shown on the nameplate. |
| `portrait` | One of the known portraits (see below). |
| `testimony` | The testimony: a `phase` label and a list of `statements`. |

`portrait` must be one of exactly these three built-in portraits:

| Portrait | Who |
| --- | --- |
| `dino_saurus` | The attorney / protagonist. |
| `pterax` | The pteranodon witness. |
| `judge` | Judge Tricera. |

Anything else is rejected by the validator.

```yaml
witnesses:
  - id: pterax
    name: PTERAX
    portrait: pterax
    testimony:
      phase: THE ALIBI
      statements:
        - id: t1
          ...
```

`phase` is just the label for this stretch of testimony (e.g. `THE ALIBI`) —
UNLESS it is the literal `interruption`, which switches the scene into the
prosecutor-driven drill mode (see Interruption phases, below).

### Multiple witnesses and the RECESS

A case may list several witnesses. The player works through them in order, and
each is handed off with an `advance_witness` effect (usually on the last lie of
the current witness).

Between witnesses the court takes a **RECESS**. The recess restores **+2 POWER**
— capped at the case's starting `failure.power`, so it can top you back up but
never above where you began. This is the game's built-in second wind between
witnesses; you don't author it, it happens automatically on `advance_witness`.

```yaml
# On the last lie of witness 1: hand off to witness 2. The court recesses,
# and the player gets +2 POWER back (capped at the starting max).
lie:
  objection: HEARSAY
  breakdown: s1b_breakdown
  effects:
    - advance_witness: {}
```

---

## Statements

A statement is one box of the witness's testimony. The player can **press** it
for more detail, **object** to it if it's a lie, or **ask co-counsel for a hint**.

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Identity, and the target for `reveal_statement` / `replace_statement`. |
| `text` | yes | The statement box the player reads. |
| `hidden` | no | If `true`, NOT in the opening running order — it must be revealed by an effect before it appears. |
| `press` | no | Press responses, keyed by mode (see below). |
| `lie` | no | Present only if the statement is objectionable. Absent ⇒ it's admissible filler. |
| `wrong_objection_dialogue` | no | Dialogue id(s) played (and 1 POWER drained) when the player objects wrongly here. String OR list. |
| `hint` | no | Dialogue id played when the player asks co-counsel for a hint. Costs one rank letter. |
| `duration_boxes` | interruption only | How long this line holds before the prosecutor auto-advances. |

### `press` — pressing a statement

`press` is a map keyed by **mode name** — a short label like `STATEMENT`,
`LOGIC`, or `MOTIVE` describing the angle the player presses from. Pressing
never costs POWER; it's free flavor and clue-delivery.

Each mode has:

| Field | Meaning |
| --- | --- |
| `dialogue` | Dialogue id played on the first press. |
| `once` | If `true`, this mode's `effects` fire only on the first press. |
| `repeat_dialogue` | Dialogue id played on later presses (else the first is replayed). |
| `effects` | Effects applied when the press dialogue completes (see Effects). |

```yaml
press:
  STATEMENT:
    dialogue: t1_press
    once: true
    repeat_dialogue: t1_press_repeat
```

A press can carry effects too — for example, pressing a statement might reveal
a new statement or set a flag. In case-0-0 the presses are pure flavor, but the
mechanism is the same as a lie's `effects`.

### `lie` — making a statement objectionable

Add a `lie` block and the statement becomes objectionable. The player wins the
exchange by choosing the RIGHT objection category (and, for a CONTRADICTION,
the right evidence).

| Field | Required | Meaning |
| --- | --- | --- |
| `objection` | yes | The correct category: `CONTRADICTION`, `HEARSAY`, `SPECULATION`, `RELEVANCE` (or `LEADING_QUESTION`, interruption only). |
| `requires_evidence` | for CONTRADICTION | The evidence id that must be presented to break it. |
| `prerequisites` | no | Flag ids that must be set before this lie can be broken (see Flags). |
| `breakdown` | yes | Dialogue id: the witness's breakdown when the lie is broken. |
| `effects` | no | Effects applied after the breakdown (reveal the next statement, end the testimony, etc.). |
| `wrong_evidence_dialogue` | no | Dialogue id shown when the CATEGORY is right but the wrong exhibit is presented. |
| `breakdown_sfx` | no | A registry sound played on the breakdown (see Sound registry). |
| `shake` | no | Screen shake on the breakdown: `light` or `heavy`. |

The two lies from case-0-0, one of each style:

```yaml
# A CONTRADICTION — the alibi conflicts with the fridge log.
lie:
  objection: CONTRADICTION
  requires_evidence: fridge_log
  breakdown: t1_breakdown
  effects:
    - reveal_statement: { statement: t1b, insert_after: t1 }
```

```yaml
# A HEARSAY — the witness relays their bunkmate, who isn't here.
lie:
  objection: HEARSAY
  breakdown: t1b_breakdown
  effects:
    - end_testimony: { result: win }
```

#### `wrong_evidence_dialogue` — right category, wrong exhibit

Only meaningful on a CONTRADICTION. When the player correctly picks
CONTRADICTION but presents the *wrong* exhibit, this dialogue plays instead of
the generic rebuke — "close, but that's not the exhibit that disproves it." If
you omit it, the lie falls back to `wrong_objection_dialogue`. Either way, a
wrong exhibit **still costs 1 POWER**.

```yaml
lie:
  objection: CONTRADICTION
  requires_evidence: fridge_log
  wrong_evidence_dialogue: wrong_exhibit
  breakdown: t1_breakdown
```

```yaml
dialogue:
  wrong_exhibit:
    - speaker: JUDGE TRICERA
      text: "OVERRULED. THE CATEGORY FITS — THE EXHIBIT DOES NOT."
```

#### `breakdown_sfx` and `shake` — punch on the breakdown

An optional sound cue and screen shake fired the moment the lie shatters. The
sound name must be one from the Sound registry. `shake` is `light` or `heavy`.
From case-0-1's decisive leading question:

```yaml
lie:
  objection: LEADING_QUESTION
  breakdown: bd4
  breakdown_sfx: breakdown_a
  shake: heavy
  effects:
    - end_testimony: { result: win }
```

### `wrong_objection_dialogue` — now a string OR a list

Played when the player objects but gets it wrong. It costs 1 POWER. Use it on
BOTH objectionable statements (the judge's rebuke for a bad call) and on filler
statements (the judge explaining that the statement is admissible).

As a single string, it plays the same line every time:

```yaml
# On the objectionable t1: a rebuke.
wrong_objection_dialogue: rebuke

# On the filler t2: an "it's admissible" line.
wrong_objection_dialogue: t2_admissible
```

New in schema 2: it may instead be a **list**, which the engine cycles in
deterministic **round-robin** order (first wrong call plays the first line, the
next plays the second, wrapping around). This restores rebuke variety so a
player who fumbles repeatedly isn't hammered with the identical line:

```yaml
wrong_objection_dialogue:
  - rebuke_a
  - rebuke_b
  - rebuke_c
```

```yaml
dialogue:
  rebuke_a:
    - speaker: JUDGE TRICERA
      text: "OVERRULED. WATCH YOURSELF, COUNSELOR."
  rebuke_b:
    - speaker: JUDGE TRICERA
      text: "OVERRULED. AGAIN? FOCUS."
  rebuke_c:
    - speaker: JUDGE TRICERA
      text: "OVERRULED. ONE MORE AND I'LL WORRY."
```

### `hint` — asking co-counsel for a nudge

Optional, per-statement. A **dialogue id** shown when the player asks for a hint
on this statement. Each hint used **costs one rank letter** at scoring (see
Rank). A statement without a `hint` declines gracefully — asking simply gets a
"you're on your own here" beat, no crash and no cost.

```yaml
- id: t1
  text: "I WAS ASLEEP IN MY QUARTERS ALL NIGHT. NEVER LEFT. NOT ONCE."
  hint: t1_hint
  lie:
    objection: CONTRADICTION
    requires_evidence: fridge_log
    breakdown: t1_breakdown
```

```yaml
dialogue:
  t1_hint:
    - speaker: DINO SAURUS
      text: "CHECK THE COURT RECORD. WHO OPENED THAT FRIDGE?"
```

---

## `guidance` — the co-counsel walkthrough

Optional, case-level, new in schema 2. A map from **objection category** to a
**dialogue id**. The first time a given category becomes *solvable* — i.e. the
player reaches the first statement whose lie uses that category and has the means
to break it — that category's guidance dialogue auto-plays once, teaching the
mechanic in context.

The keys must be real objection categories (`CONTRADICTION`, `HEARSAY`,
`SPECULATION`, `RELEVANCE`, `LEADING_QUESTION`); anything else is rejected. Each
value must resolve to an entry in `dialogue:`.

```yaml
guidance:
  CONTRADICTION: guide_contradiction
  HEARSAY: guide_hearsay

dialogue:
  guide_contradiction:
    - speaker: DINO SAURUS
      text: "SEE A CLAIM THAT FIGHTS THE RECORD? CRY CONTRADICTION AND SHOW IT."
  guide_hearsay:
    - speaker: DINO SAURUS
      text: "'SOMEONE TOLD ME' ISN'T TESTIMONY. THAT'S HEARSAY."
```

---

## Interruption phases — the prosecutor's cross

A testimony whose `phase` is the literal string `interruption` is not a normal
cross-examination. Instead the **prosecutor drives**: statements auto-advance,
and the player must **slam [Z] to object** before the line scrolls past. This is
the Phase-B beat. The whole of `cases/case-0-1.yaml` is a standalone drill.

How it plays:

- The prosecutor's lines **auto-advance**. Each statement holds for its
  `duration_boxes` worth of time, then moves on by itself.
- To object you must **slam [Z]** while the line is still on screen.
- Exactly one extra category is offered here — **LEADING_QUESTION** — and it is
  offered *only* in interruption phases.
- **Miss** a leading question (let it auto-advance, or object to a fair one) and
  it's lost / costs POWER as usual.
- If **all** the catchable lines are missed, the phase **replays** from the top.

Rules the validator enforces:

- Every statement in an interruption phase MUST carry `duration_boxes`.
- A lie in an interruption phase MUST use `objection: LEADING_QUESTION`.
- Conversely, `LEADING_QUESTION` is valid ONLY in an interruption phase, and the
  four standard categories (`CONTRADICTION`, `HEARSAY`, `SPECULATION`,
  `RELEVANCE`) are NOT valid inside one.

A fair question (no `lie`) — objecting here is the mistake:

```yaml
- id: q1
  text: "YOU WERE AWAKE AT 0300, WERE YOU NOT?"
  duration_boxes: 2
  wrong_objection_dialogue: fair
```

A leading question — slam to catch it:

```yaml
- id: q2
  text: "AND YOU SAW THE DEFENDANT SNEAK OFF, DIDN'T YOU?"
  duration_boxes: 3
  lie:
    objection: LEADING_QUESTION
    breakdown: bd2
    breakdown_sfx: breakdown_b
    shake: light
  wrong_objection_dialogue: rebuke
```

The decisive leading question ends the drill:

```yaml
- id: q4
  text: "SO YOU'D AGREE THE DEFENDANT IS PLAINLY GUILTY, YES?"
  duration_boxes: 3
  lie:
    objection: LEADING_QUESTION
    breakdown: bd4
    breakdown_sfx: breakdown_a
    shake: heavy
    effects:
      - end_testimony: { result: win }
  wrong_objection_dialogue: rebuke
```

---

## Dialogue

The `dialogue:` map holds every line of speech in the case, keyed by id.
Everything above that names a "dialogue id" — `briefing`, `intro`, a press's
`dialogue`, a lie's `breakdown`, a `wrong_objection_dialogue`, a
`wrong_evidence_dialogue`, a `hint`, a `guidance` entry — resolves here.

Each entry is a LIST of lines (a multi-box exchange advances box by box). Each
line:

| Field | Required | Meaning |
| --- | --- | --- |
| `speaker` | yes | Who's talking (shown on the nameplate). |
| `text` | yes | The line itself. |
| `expression` | no | An expression hint, e.g. `sweating`. |
| `sfx` | no | A sound cue — must be a name from the Sound registry (see below). |
| `effects` | no | Effects applied when this line completes. Used mainly by the briefing. |

```yaml
t1_breakdown:
  - speaker: PTERAX
    expression: sweating
    text: "THE LOG? BADGE 77?! FINE — I WENT TO THE GALLEY. BUT ONLY BECAUSE—"
```

### Dialogue lines with `effects`

New in schema 2: a dialogue line may carry an `effects:` list, using the same
effects vocabulary as presses and lies. This is chiefly how the **briefing**
hands over starting evidence:

```yaml
briefing:
  - speaker: DINO SAURUS
    text: "THEY HANDED ME THE FRIDGE LOG. LET'S SEE WHO TRIPPED BADGE 77."
    sfx: confirm
    effects:
      - add_evidence: { evidence: fridge_log }
```

Every id referenced from above must exist here, and every entry here should be
referenced by something — an orphaned dialogue block is flagged by the validator.

---

## The Sound registry

`sfx:` on a dialogue line and `breakdown_sfx:` on a lie both name a **synthesized
sound cue** from the registry below. The validator checks the name — a sound not
in this list is rejected. The valid names are exactly:

| Name | Rough use |
| --- | --- |
| `blip` | Text advance / typing tick. |
| `confirm` | A selection or hand-off confirmed. |
| `move` | Cursor / menu movement. |
| `objection_sting` | The OBJECTION! slam. |
| `rebuke_buzz` | A wrong call, overruled. |
| `breakdown_a` | Witness breakdown (variant A). |
| `breakdown_b` | Witness breakdown (variant B). |
| `sustained` | Objection sustained. |
| `recess` | The between-witness recess. |
| `fanfare` | Victory. |

```yaml
- speaker: PTERAX
  expression: sweating
  text: "SUSTAINED?! FINE. I DIDN'T SEE ANYTHING."
  sfx: sustained
```

---

## Effects — the only state changes a case may request

Effects appear inside a press's `effects`, a lie's `effects`, a dialogue line's
`effects`, and `failure.on_empty`. There are exactly six. Each is a one-key map.

### `reveal_statement { statement, insert_after }`

Insert a `hidden` statement into the running order, right after another
statement. This is how a broken lie exposes the next lie.

```yaml
- reveal_statement: { statement: t1b, insert_after: t1 }
```

### `replace_statement { statement, with }`

Swap a statement in the running order for a different one (same slot). Use it
when breaking a lie should REWRITE what the witness is saying rather than add a
new line. The statement being retired must be one the player has actually
reached and broken — retiring a statement whose lie was never broken is rejected
(see Gotchas).

```yaml
# (invented example) breaking the alibi rewrites the claim in place:
- replace_statement: { statement: t1, with: t1_recanted }
```

### `set_flag { flag }`

Record that a beat has happened. Flags are the machine-checkable way to gate a
later lie behind an earlier one. See Flags below.

```yaml
# (invented example) pressing the map log marks that the player has seen it:
- set_flag: { flag: saw_map_log }
```

### `add_evidence { evidence }`

Add a declared evidence item to the Court Record. The item must still appear in
the top-level `evidence[]` list. Remember the starting-record rule: any evidence
named by an `add_evidence` starts ABSENT and must be granted this way — most
often on a briefing line.

```yaml
# On a briefing line, hand the player their starting exhibit:
- add_evidence: { evidence: fridge_log }
```

### `end_testimony { result }`

End the current testimony. `result` is one of:

| Result | Meaning |
| --- | --- |
| `win` | The testimony is beaten (all lies broken). |
| `restart` | Reset this testimony to the start (used by `failure.on_empty`). |
| `lose` | The case is lost. |

```yaml
- end_testimony: { result: win }
```

### `advance_witness`

Move on to the NEXT witness in the `witnesses` list. Takes no arguments — write
it as an empty map. Triggers the RECESS: +2 POWER restored, capped at the
starting max.

```yaml
# (invented example) breaking the last lie of witness 1 hands off to witness 2:
- advance_witness: {}
```

---

## The text budget — 30 × 4

Every `text` line must fit in a box **30 characters wide by 4 lines tall** after
word-wrapping. The validator WARNS at 90% of budget and ERRORS if a line
overflows. Keep lines punchy; break long speeches into multiple dialogue boxes
(remember, a dialogue entry is a list — add another `- speaker/text` line
instead of cramming).

**Don't** — one giant unbroken box that overflows:

```yaml
- speaker: PTERAX
  text: "WELL YOU SEE COUNSELOR IT WAS A LONG NIGHT AND I HAD BEEN AWAKE FOR HOURS THINKING ABOUT THE LUNCH AND ALSO ABOUT MY BUNKMATE AND THE GALLEY AND SO ON AND ON"
```

**Do** — split into boxes that each fit 30×4:

```yaml
- speaker: PTERAX
  text: "IT WAS A LONG NIGHT. I WAS AWAKE FOR HOURS."
- speaker: PTERAX
  text: "THINKING ABOUT THE LUNCH. AND MY BUNKMATE."
```

---

## The objection categories — when each applies

Choosing the right category is the core puzzle, so design objectionable
statements deliberately. Each `lie.objection` is exactly one of these. The first
four are the standard cross-examination categories; the fifth,
`LEADING_QUESTION`, is offered ONLY in interruption phases.

### CONTRADICTION

The statement conflicts with a specific piece of evidence in the Court Record.
This is the only category that needs `requires_evidence` — the player must
present the exact exhibit that disproves the claim. Present the wrong exhibit and
you'll get the lie's `wrong_evidence_dialogue` (and lose a pip).

> t1: "I WAS ASLEEP IN MY QUARTERS ALL NIGHT." The fridge log shows Badge 77
> (Pterax) opened the galley at 0300. `objection: CONTRADICTION`,
> `requires_evidence: fridge_log`.

Design rule: there must be a concrete exhibit whose content plainly clashes with
the statement. If you can't point at one line of evidence, it isn't a
CONTRADICTION.

### HEARSAY

The witness quotes or relays someone who isn't present to testify. **A hearsay
statement can be perfectly TRUE and still objectionable** — the problem is that
the person who actually knows it isn't here to be cross-examined.

> t1b: "MY BUNKMATE TOLD ME THE GALLEY WAS LOCKED ALL NIGHT." Even if the
> bunkmate really said it, the bunkmate isn't testifying. `objection: HEARSAY`.

Design rule: the statement's authority comes from an absent third party
("X told me", "I heard that", "the report said"). No evidence is required —
the objection is to the FORM, not the facts.

### SPECULATION

The witness asserts something they could not actually have perceived or known —
a guess dressed as fact.

> (example) "SAL WAS PLANNING THIS FOR WEEKS." The witness can't have seen
> inside Sal's plans. `objection: SPECULATION`.

Design rule: ask "could this witness truly have observed this?" If it's about
someone else's intentions, or events they weren't present for, it's SPECULATION.

### RELEVANCE

The statement, even if true, has no bearing on the matter before the court.

> (example) "SAL HAS TERRIBLE TASTE IN MUSIC." True, maybe — and utterly beside
> the point of who ate the lunch. `objection: RELEVANCE`.

Design rule: the statement is a distraction. It neither incriminates nor
exonerates; it just doesn't matter to the charge.

### LEADING_QUESTION — interruption phases only

The prosecutor puts words in the witness's mouth ("You saw him, didn't you?").
This category exists to catch that, and it is **only** valid inside an
`interruption` phase — never in a normal testimony. Conversely, the four
standard categories above are NOT valid inside an interruption phase.

> q2: "AND YOU SAW THE DEFENDANT SNEAK OFF, DIDN'T YOU?" The prosecutor is
> leading. Slam [Z]. `objection: LEADING_QUESTION`.

---

## Rank — how the player is scored

The player is graded with a letter rank at the end of the case. It starts at
**S** and slips down the letters based on how much help they leaned on:

- Start at **S**.
- **-1 letter** for each **hint** used.
- **-1 letter** for every **2 POWER** lost (across the whole case).
- The rank **floors at D** — it can't sink below that no matter what.

So a clean run with no hints and no wasted objections keeps its S; a couple of
hints or a handful of fumbled objections walk it down toward D.

---

## How flags work

Flags make ordering explicit and checkable.

- `set_flag { flag: X }` marks that a beat has happened (a press seen, a lie
  broken, an exhibit obtained).
- A lie's `prerequisites: [X, Y]` requires those flags to already be set before
  that lie can be broken. Objecting before the prerequisites are met simply
  won't land.
- The validator PROVES the flag economy is sound: every flag that is set is
  eventually consumed by some prerequisite, every flag consumed is set
  somewhere, and every prerequisite is obtainable BEFORE the lie that needs it
  must be answered. A flag that's never used, a prerequisite that can never be
  satisfied, or a lie you can reach before its prerequisite — all rejected.

Use flags when "beat B can't be broken until beat A happened" and A isn't
already enforced by `hidden` + `reveal_statement`. (In case-0-0, ordering is
enforced purely by hiding `t1b`, so no flags are needed.)

---

## Gotchas — what the validator will reject

Run `npm run validate` before you call a case done. It will reject:

- **Dangling ids.** A `dialogue` id (`briefing`, `intro`, `breakdown`, press
  `dialogue`, `wrong_objection_dialogue`, `wrong_evidence_dialogue`, `hint`,
  `guidance` value) that has no entry in the `dialogue:` map.
- **Dangling evidence.** A `requires_evidence` or `add_evidence` naming evidence
  not declared in `evidence[]`.
- **Dangling statement ids.** A `reveal_statement` / `replace_statement`
  pointing at a statement or `insert_after` target that doesn't exist.
- **Unknown portrait.** A witness `portrait` that isn't `dino_saurus`, `pterax`,
  or `judge`.
- **Unreachable hidden statements.** A `hidden: true` statement that nothing
  ever `reveal_statement`s — it can never appear.
- **Unwinnable lies.** A CONTRADICTION whose `requires_evidence` can't be
  obtained first, or a lie whose `prerequisites` can never all be satisfied
  before it must be answered.
- **No path to victory.** A testimony with no reachable `end_testimony: { result: win }`.
- **Orphaned dialogue.** A `dialogue:` entry nothing references.
- **Text over budget.** Any `text` line that overflows 30 × 4 after word-wrap.
- **`LEADING_QUESTION` out of place.** A `LEADING_QUESTION` lie outside an
  interruption phase — or any of the four standard categories used INSIDE one.
- **Interruption statement missing `duration_boxes`.** Every statement in an
  interruption phase must declare one.
- **Unknown sfx name.** An `sfx:` or `breakdown_sfx:` naming a sound not in the
  Sound registry.
- **Bad guidance.** A `guidance` key that isn't a real objection category, or a
  guidance value that points at a missing dialogue.
- **Bad replace.** A `replace_statement` that retires a statement whose lie was
  never broken.
- **Missing `schema: 2`.** Every case file must declare the schema version.
