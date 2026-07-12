/*
 * Headless regression harness. Drives the PURE engine through the four required
 * scripted playthroughs and asserts state / POWER / revealed-statement order at
 * each step. No DOM, no canvas — this is exactly why engine/ has no imports from
 * render/ or audio/.
 *
 * Bundled + run by scripts/run-tests.mjs (esbuild). Reads the compiled case that
 * `npm run compile-cases` produced.
 */

import { readFileSync } from "node:fs";
import { Engine } from "../src/engine/engine";
import type { CompiledCase } from "../src/engine/types";
import type { InputEvent } from "../src/engine/state";

const caseData = JSON.parse(readFileSync("dist-cases/case-0-0.json", "utf8")) as CompiledCase;

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    console.log(`  FAIL ${msg}`);
    failures++;
  }
}

/** A little driver mirroring how a player would tap through the game. */
class Driver {
  eng: Engine;
  constructor() {
    this.eng = new Engine(caseData);
  }
  key(e: InputEvent) {
    this.eng.input(e);
    return this;
  }
  /** Finish any active typewriter reveal instantly. */
  settle() {
    this.eng.tick(10);
    return this;
  }
  /** Finish the reveal, then advance the reading box to its continuation. */
  adv() {
    this.settle();
    this.eng.input("confirm");
    return this;
  }
  /** Play the OBJECTION! interrupt out to the category menu. */
  objectionMenu() {
    this.settle();
    this.eng.input("back"); // -> OBJECTION_ANIM
    this.eng.tick(1); // -> OBJECTION_MENU
    return this;
  }
  get s() {
    return this.eng.state;
  }
  get id() {
    return this.s.order[this.s.idx];
  }
  boxText() {
    return this.eng.currentBox()?.line.text ?? "";
  }
  /** Title -> intro -> testimony on t1. */
  toTestimony() {
    this.key("confirm"); // TITLE -> INTRO
    this.adv(); // INTRO dialogue -> startTestimony
    return this;
  }
}

/* ---- (a) golden path to NOT GUILTY ------------------------------------- */
console.log("\n[a] golden path -> NOT GUILTY (rank S)");
{
  const d = new Driver();
  assert(d.s.phase === "TITLE", "starts at TITLE");
  d.toTestimony();
  assert(d.s.phase === "TESTIMONY" && d.id === "t1", "intro -> testimony on t1");
  assert(d.s.power === 5, "power starts at 5");
  assert(JSON.stringify(d.s.order) === '["t1","t2"]', "order is [t1, t2]");

  // Object t1: CONTRADICTION + FRIDGE LOG
  d.objectionMenu();
  assert(d.s.phase === "OBJECTION_MENU" && d.s.menu.length === 4, "objection menu has 4 categories");
  d.key("confirm"); // CONTRADICTION (sel 0)
  assert(d.s.phase === "EVIDENCE_PICK" && d.s.menu[0].value === "fridge_log", "CONTRADICTION -> evidence pick");
  d.key("confirm"); // present fridge_log
  assert(d.s.phase === "JUDGE_LINE" && d.boxText() === "SUSTAINED.", "correct -> SUSTAINED");
  assert(d.s.power === 5, "correct objection costs no power");
  d.adv(); // SUSTAINED -> breakdown
  assert(d.s.phase === "BREAKDOWN", "-> breakdown 1");
  d.adv(); // breakdown -> effects (reveal t1b)
  assert(d.s.phase === "TESTIMONY" && d.id === "t1b", "breakdown reveals t1b and moves to it");
  assert(JSON.stringify(d.s.order) === '["t1","t1b","t2"]', "order now [t1, t1b, t2]");

  // Object t1b: HEARSAY (no evidence)
  d.objectionMenu();
  d.key("down"); // CONTRADICTION -> HEARSAY
  d.key("confirm");
  assert(d.s.phase === "JUDGE_LINE" && d.boxText() === "SUSTAINED.", "HEARSAY correct on t1b");
  d.adv(); // -> breakdown 2
  assert(d.s.phase === "BREAKDOWN", "-> breakdown 2");
  d.adv(); // breakdown -> end_testimony win
  assert(d.s.phase === "VERDICT" && d.s.endResult === "win", "-> VERDICT (win)");
  assert(d.eng.rank() === "S", "rank S (no power lost)");
}

/* ---- (b) wrong objection: POWER drain + rebuke ------------------------- */
console.log("\n[b] wrong objection drains POWER + plays rebuke");
{
  const d = new Driver().toTestimony();
  d.objectionMenu();
  d.key("down").key("down"); // CONTRADICTION -> HEARSAY -> SPECULATION (wrong)
  d.key("confirm");
  assert(d.s.phase === "JUDGE_LINE", "wrong objection -> judge line");
  assert(d.s.power === 4, "power 5 -> 4");
  assert(d.boxText() === "OVERRULED. WATCH YOURSELF, COUNSELOR.", "plays the rebuke line");
  d.adv();
  assert(d.s.phase === "TESTIMONY" && d.s.power === 4, "back to testimony, power still 4");
}

/* ---- (c) POWER empty -> restart testimony ------------------------------ */
console.log("\n[c] POWER empty offers restart, which resets to full");
{
  const d = new Driver().toTestimony();
  for (let i = 0; i < 5; i++) {
    d.objectionMenu();
    d.key("down").key("down"); // SPECULATION (wrong)
    d.key("confirm");
    assert(d.s.power === 4 - i, `wrong #${i + 1} -> power ${4 - i}`);
    d.adv(); // advance the rebuke line -> testimony, or -> POWER_EMPTY on the last
  }
  assert(d.s.phase === "POWER_EMPTY", "power 0 -> POWER_EMPTY");
  assert(d.s.menu.length === 1 && d.s.menu[0].value === "restart", "offers RESTART TESTIMONY");
  d.key("confirm"); // restart
  assert(d.s.phase === "TESTIMONY" && d.s.power === 5, "restart resets power to 5");
  assert(d.id === "t1" && JSON.stringify(d.s.order) === '["t1","t2"]', "restart resets order/position");
}

/* ---- (d) objecting to filler statement is penalized -------------------- */
console.log("\n[d] objecting to the non-objectionable filler costs POWER");
{
  const d = new Driver().toTestimony();
  d.key("right"); // -> t2 (filler)
  assert(d.id === "t2", "navigated to filler t2");
  d.objectionMenu();
  d.key("down"); // HEARSAY (any category is wrong here)
  d.key("confirm");
  assert(d.s.power === 4, "filler objection drains a pip");
  assert(d.boxText() === "OVERRULED. DISTASTEFUL, BUT ADMISSIBLE.", "plays the admissible line");
}

console.log(failures === 0 ? "\n=== REGRESSION PASSED ===" : `\n=== REGRESSION FAILED (${failures}) ===`);
if (failures > 0) process.exitCode = 1;
