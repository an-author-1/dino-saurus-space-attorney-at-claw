# CASE FORMAT — the writer's guide to authoring a case

A case is a single YAML file. You write the YAML; `npm run compile-cases`
turns it into the JSON the engine actually reads; `npm run validate` proves
the file is playable before anyone loads it. Every case file MUST begin with
`schema: 1` — that is the version of this language, and the compiler rejects a
file without it. Everything you can express lives in this document; there is no
hidden vocabulary. If you can't say it here, the game can't do it.

The running example throughout is `cases/case-0-0.yaml` — **THE MISSING LUNCH**,
the tiny ported micro-case. Read it alongside this doc; every snippet below is
lifted straight from it.

---

## The shape of a case, top to bottom

A case file has these top-level keys, in roughly this order:

| Key | What it is |
| --- | --- |
| `schema` | Always `1`. The language version. Required. |
| `case` | The case's short id, e.g. `"0-0"`. A string. |
| `title` | The case title shown to the player. |
| `defendant` | Who is on trial. |
| `intro` | A **dialogue id** — the judge's opening, played once before testimony. |
| `evidence` | The Court Record: the list of evidence items the player holds. |
| `failure` | The POWER economy (how many wrong objections you can afford). |
| `witnesses` | The witnesses, each with a testimony to cross-examine. |
| `dialogue` | The map of every line of speech, referenced by id from above. |

### `case`, `title`, `defendant`

Plain identifying text. From case-0-0:

```yaml
schema: 1

case: "0-0"
title: THE MISSING LUNCH
defendant: SAL AMANDER
```

Quote `case` so `0-0` is read as a string, not a date or a subtraction.

### `intro`

Not text — an **id that points into the `dialogue:` map** at the bottom of the
file. It is the judge's opening, played once before the first witness.

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

Evidence listed here is in the Court Record from the start of the case. You can
also hand the player a NEW piece mid-testimony with the `add_evidence` effect
(see Effects) — but that evidence item must still be declared in this list.

### `failure` — the POWER economy

POWER is the player's margin for error. Every wrong objection drains one pip.
When POWER hits zero, the effects in `on_empty` fire.

| Field | Meaning |
| --- | --- |
| `power` | Starting POWER (number of pips). |
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

`phase` is just the label for this stretch of testimony (e.g. `THE ALIBI`).

---

## Statements

A statement is one box of the witness's testimony. The player can **press** it
for more detail, or **object** to it if it's a lie.

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Identity, and the target for `reveal_statement` / `replace_statement`. |
| `text` | yes | The statement box the player reads. |
| `hidden` | no | If `true`, NOT in the opening running order — it must be revealed by an effect before it appears. |
| `press` | no | Press responses, keyed by mode (see below). |
| `lie` | no | Present only if the statement is objectionable. Absent ⇒ it's admissible filler. |
| `wrong_objection_dialogue` | no | Dialogue id played (and 1 POWER drained) when the player objects wrongly here. |

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
| `objection` | yes | The correct category: `CONTRADICTION`, `HEARSAY`, `SPECULATION`, or `RELEVANCE`. |
| `requires_evidence` | for CONTRADICTION | The evidence id that must be presented to break it. |
| `prerequisites` | no | Flag ids that must be set before this lie can be broken (see Flags). |
| `breakdown` | yes | Dialogue id: the witness's breakdown when the lie is broken. |
| `effects` | no | Effects applied after the breakdown (reveal the next statement, end the testimony, etc.). |

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

### `wrong_objection_dialogue`

Played when the player objects but gets it wrong. It costs 1 POWER. Use it on
BOTH objectionable statements (the judge's rebuke for a bad call) and on filler
statements (the judge explaining that the statement is admissible).

```yaml
# On the objectionable t1: a rebuke.
wrong_objection_dialogue: rebuke

# On the filler t2: an "it's admissible" line.
wrong_objection_dialogue: t2_admissible
```

```yaml
dialogue:
  rebuke:
    - speaker: JUDGE TRICERA
      text: "OVERRULED. WATCH YOURSELF, COUNSELOR."
  t2_admissible:
    - speaker: JUDGE TRICERA
      text: "OVERRULED. DISTASTEFUL, BUT ADMISSIBLE."
```

---

## Dialogue

The `dialogue:` map holds every line of speech in the case, keyed by id.
Everything above that names a "dialogue id" — `intro`, a press's `dialogue`, a
lie's `breakdown`, a `wrong_objection_dialogue` — resolves here.

Each entry is a LIST of lines (a multi-box exchange advances box by box). Each
line:

| Field | Required | Meaning |
| --- | --- | --- |
| `speaker` | yes | Who's talking (shown on the nameplate). |
| `text` | yes | The line itself. |
| `expression` | no | An expression hint, e.g. `sweating` (used later; safe to include). |
| `sfx` | no | A sound-cue hint (used later; safe to include). |

```yaml
t1_breakdown:
  - speaker: PTERAX
    expression: sweating
    text: "THE LOG? BADGE 77?! FINE — I WENT TO THE GALLEY. BUT ONLY BECAUSE—"
```

Every id referenced from above must exist here, and every entry here should be
referenced by something — an orphaned dialogue block is flagged by the validator.

---

## Effects — the only state changes a case may request

Effects appear inside a press's `effects`, a lie's `effects`, and `failure.on_empty`.
There are exactly six. Each is a one-key map.

### `reveal_statement { statement, insert_after }`

Insert a `hidden` statement into the running order, right after another
statement. This is how a broken lie exposes the next lie.

```yaml
- reveal_statement: { statement: t1b, insert_after: t1 }
```

### `replace_statement { statement, with }`

Swap a statement in the running order for a different one (same slot). Use it
when breaking a lie should REWRITE what the witness is saying rather than add a
new line.

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

Add a declared evidence item to the Court Record mid-testimony. The item must
still appear in the top-level `evidence[]` list.

```yaml
# (invented example) a press hands the player a new exhibit:
- add_evidence: { evidence: torn_star_chart }
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
it as an empty map.

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

## The four objection categories — when each applies

Choosing the right category is the core puzzle, so design objectionable
statements deliberately. Each `lie.objection` is exactly one of these:

### CONTRADICTION

The statement conflicts with a specific piece of evidence in the Court Record.
This is the only category that needs `requires_evidence` — the player must
present the exact exhibit that disproves the claim.

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

- **Dangling ids.** A `dialogue` id (`intro`, `breakdown`, press `dialogue`,
  `wrong_objection_dialogue`) that has no entry in the `dialogue:` map.
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
- **Missing `schema: 1`.** Every case file must declare the schema version.
