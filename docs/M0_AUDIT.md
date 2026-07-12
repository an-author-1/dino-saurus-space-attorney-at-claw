# M0 AUDIT — what the micro-prototype actually needed

This is the pre-M1 audit required before any schema was written. It records
exactly what the M0 `MICRO_CASE` const carried and exactly what the M0 state
machine did with it, so the M1 schema is derived from real needs — not
speculation. Source of truth: `src/case.ts` (const) and `src/game.ts` (machine)
at the M0 commit.

## 1. Every field the `MICRO_CASE` const used

### Case level
| M0 field | Type | Used for |
| --- | --- | --- |
| `title.game` | string | Title-screen game name (chrome). |
| `title.subtitle` | string | Title-screen case line ("MICRO-CASE 0-0: THE MISSING LUNCH"). |
| `title.prompt` | string | "PRESS Z" (chrome). |
| `title.footer` | string | "(C) 3087 CLAW ENTERPRISES" (chrome). |
| `witness` | string | Witness name shown on the status nameplate. |
| `evidence[]` | list | The Court Record. Each: `id`, `name`, `desc`. |
| `intro.speaker` + `intro.line` | strings | One judge dialogue box before testimony. |
| `statements[]` | list | The testimony (see below). |
| `initialOrder` | string[] | Statement ids visible at testimony start (`[t1, t2]`). |
| `judgeSustained` | string | "SUSTAINED." shown before a breakdown. |
| `wrongObjectionRebukes` | string[] | Judge rebuke **pool** for a wrong objection on an objectionable statement (alternated). |

### Statement level
| M0 field | Type | Used for |
| --- | --- | --- |
| `id` | string | Identity + reference target. |
| `speaker` | string | Nameplate ("WITNESS PTERAX"). Always the witness in M0. |
| `text` | string | The statement box. |
| `hidden` | bool | Not in the initial running order; inserted later. |
| `presses[]` | list | Each: `mode`, `response`, `repeat`. Free; flavor. |
| `lie` | object\|null | `category`, `requiresEvidence`, `breakdown`, `reveals`. null ⇒ not objectionable. |
| `objectionPenalty` | string | Judge line when objecting to a **non**-objectionable statement. |

## 2. Every effect the state machine performed

State graph: `TITLE → INTRO → TESTIMONY → (PRESS_MENU→PRESS_RESPONSE | OBJECTION_ANIM→OBJECTION_MENU→[EVIDENCE_PICK] | EVIDENCE_OVERLAY) → JUDGE_LINE → BREAKDOWN → VERDICT`, with `POWER_EMPTY` reachable from any wrong objection.

Concrete mutations the machine made to game state:

1. **Start testimony** — `power = 5`; `order = initialOrder`; `idx = 0`; clear `pressed` + `broken`; show first statement. (Also the reset used by RESTART.)
2. **Navigate** — `◀ ▶` move `idx` within `order` (wrapping); re-show statement.
3. **Press** — look up the statement's press by mode; if already in the `pressed` set show `repeat`, else show `response` and add to `pressed`. **Never touches power.**
4. **Objection interrupt** — timed OBJECTION! animation, then the four-category menu. Choosing CONTRADICTION opens the one-item evidence picker; other categories evaluate immediately.
5. **Evaluate objection** against the current statement's `lie`:
   - **Correct** (`category === lie.category` && (evidence matches if required) && not already broken): play `judgeSustained`, then the `breakdown`, then apply the lie's outcome.
   - **Wrong**: `power = max(0, power-1)`; play a rebuke — the alternating `wrongObjectionRebukes` pool if the statement was objectionable, else the statement's `objectionPenalty`; on `power == 0` go to `POWER_EMPTY`, else back to testimony.
6. **Break a lie** (`broken.add(id)`) then the lie's outcome:
   - `reveals` set ⇒ `order.splice(idx+1, 0, revealId)`; `idx += 1`; show the revealed statement (the `< 1/2 >` counter becomes `< 1/3 >`).
   - `reveals` null ⇒ go to `VERDICT`.
7. **Power empty** — offer a single `RESTART TESTIMONY` menu item → full testimony reset.
8. **Verdict** — compute rank from `power` (5⇒S, else A/B/C/D by pips remaining) and show NOT GUILTY. `[Z] PLAY AGAIN` → title.
9. **Evidence overlay** (`C`) — modal Court Record over any state; returns to the state it was opened from.

Win condition (implicit): both lies broken in order. Enforced only by `hidden` +
`reveals`: `t1b` doesn't exist to be objected to until `t1`'s lie is broken.

## 3. Hacky bits in M0 the schema should clean up

- **Inline strings, no dialogue layer.** Press responses, breakdowns, the intro,
  and rebukes were bare strings with an implicit single speaker. There was no way
  to give a line an expression or a sound cue, and multi-box exchanges were
  impossible. → M1 introduces a referenced `dialogue:` map of `{speaker, text,
  expression?, sfx?}` line lists.
- **Two parallel "wrong objection" fields.** `wrongObjectionRebukes` (case-level
  pool for objectionable statements) and `objectionPenalty` (per-statement, for
  filler) did the same job through two mechanisms. → M1 unifies both into one
  per-statement `wrong_objection_dialogue`.
- **`reveals` was a bespoke one-off.** Only "insert this hidden statement after
  me" was expressible; "go to verdict" was encoded as `reveals: null`. → M1
  replaces it with a general `effects[]` list (`reveal_statement`,
  `end_testimony`, …) so a lie's outcome is data, not a special case.
- **Ordering was implicit.** "t1 before t1b" worked only because t1b was
  `hidden`. There was no explicit dependency you could validate. → M1 adds
  `set_flag` + lie `prerequisites[]` so gating is explicit and machine-checkable
  (and the validator can prove obtainability).
- **`SUSTAINED.` / rebuke variety / restart prompt** were case data or RNG. In
  M1 the sustained interjection and the power-empty restart prompt become engine
  **chrome** (like "OBJECTION!" and "CHOOSE YOUR OBJECTION!"), and the rebuke
  pool collapses to a single authored line — the schema vocabulary intentionally
  can't express an RNG pool.
- **`speaker` lived on every statement** but was always the witness. → M1 hangs
  the name off the `witness` and off each dialogue line's `speaker`; a statement
  no longer restates who's talking.
- **Portrait choice was hardcoded per state** (judge for judge lines, dino for
  the objection, witness otherwise). → M1 keeps portrait selection as engine
  context, and makes only the **witness** portrait data-driven (`portrait`), so
  the vocabulary stays small and validatable.
