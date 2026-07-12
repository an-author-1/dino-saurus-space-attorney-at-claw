/*
 * Headless regression harness (schema v2). Drives the PURE engine through the
 * golden path plus every M2 mechanic, asserting state / POWER / order / rank.
 * Bundled + run by scripts/run-tests.mjs (esbuild).
 */

import { readFileSync } from "node:fs";
import { Engine } from "../src/engine/engine";
import type { CompiledCase } from "../src/engine/types";
import type { InputEvent } from "../src/engine/state";

const case00 = JSON.parse(readFileSync("dist-cases/case-0-0.json", "utf8")) as CompiledCase;
const case01 = JSON.parse(readFileSync("dist-cases/case-0-1.json", "utf8")) as CompiledCase;

let failures = 0;
function assert(cond: boolean, msg: string): void {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures++;
}

class Driver {
  eng: Engine;
  constructor(c: CompiledCase | CompiledCase[]) {
    this.eng = new Engine(c);
  }
  key(e: InputEvent) { this.eng.input(e); return this; }
  settle() { this.eng.tick(10); return this; }
  adv() { this.settle(); this.eng.input("confirm"); return this; }
  tick(s: number) { this.eng.tick(s); return this; }
  objectionMenu() { this.settle(); this.eng.input("back"); this.eng.tick(1); return this; }
  get s() { return this.eng.state; }
  get id() { return this.s.order[this.s.idx]; }
  box() { return this.eng.currentBox()?.line.text ?? ""; }
  /** TITLE -> (briefing) -> intro -> first witness. */
  begin() {
    this.key("confirm");
    while (this.s.phase === "BRIEFING" || this.s.phase === "INTRO") this.adv();
    return this;
  }
  /** slam during interruption -> objection menu. */
  slamMenu() { this.eng.input("confirm"); this.eng.tick(1); return this; }
}

/* ===== case 0-0: golden path + core M1 behaviors (still identical) ====== */
console.log("\n[0-0 a] golden path -> NOT GUILTY");
{
  const d = new Driver(case00).begin();
  assert(d.s.phase === "TESTIMONY" && d.id === "t1" && d.s.power === 5, "intro -> testimony t1, power 5");
  d.objectionMenu();
  assert(d.s.menu.length === 4, "normal objection menu has 4 categories");
  d.key("confirm"); // CONTRADICTION
  assert(d.s.phase === "EVIDENCE_PICK", "CONTRADICTION -> evidence pick");
  d.key("confirm"); // present fridge_log
  assert(d.s.phase === "JUDGE_LINE" && d.box() === "SUSTAINED." && d.s.power === 5, "correct: SUSTAINED, no power lost");
  d.adv(); assert(d.s.phase === "BREAKDOWN", "-> breakdown");
  d.adv(); assert(d.s.phase === "TESTIMONY" && d.id === "t1b" && d.s.order.join() === "t1,t1b,t2", "reveals t1b");
  d.objectionMenu(); d.key("down"); d.key("confirm"); // HEARSAY
  assert(d.s.phase === "JUDGE_LINE", "HEARSAY correct on t1b");
  d.adv(); d.adv();
  assert(d.s.phase === "VERDICT" && d.s.endResult === "win" && d.eng.rank() === "S", "VERDICT win, rank S");
}
console.log("\n[0-0 b] wrong objection drains POWER; filler penalized");
{
  const d = new Driver(case00).begin();
  d.objectionMenu(); d.key("down"); d.key("down"); d.key("confirm"); // SPECULATION (wrong)
  assert(d.s.power === 4 && d.box() === "OVERRULED. WATCH YOURSELF, COUNSELOR.", "wrong -> power 4 + rebuke");
  d.adv();
  d.key("right"); assert(d.id === "t2", "nav to filler");
  d.objectionMenu(); d.key("down"); d.key("confirm"); // HEARSAY on filler
  assert(d.s.power === 3 && d.box() === "OVERRULED. DISTASTEFUL, BUT ADMISSIBLE.", "filler objection -> power 3");
}

/* ===== briefing grants starting evidence ================================ */
console.log("\n[briefing] a briefing line grants evidence");
{
  const c: CompiledCase = {
    schema: 2, case: "T", title: "T", defendant: "X", briefing: "brief", intro: "intro",
    evidence: [{ id: "key", name: "KEY", desc: "A KEY." }],
    failure: { power: 5, on_empty: [{ end_testimony: { result: "restart" } }] },
    witnesses: [{ id: "w", name: "W", portrait: "pterax", testimony: { phase: "P", statements: [
      { id: "s1", text: "LIE.", lie: { objection: "CONTRADICTION", requires_evidence: "key", breakdown: "bd", effects: [{ end_testimony: { result: "win" } }] }, wrong_objection_dialogue: "reb" },
    ] } }],
    dialogue: {
      intro: [{ speaker: "J", text: "HI." }],
      brief: [{ speaker: "CLIENT", text: "TAKE THIS KEY.", effects: [{ add_evidence: { evidence: "key" } }] }],
      bd: [{ speaker: "W", text: "OK." }], reb: [{ speaker: "J", text: "NO." }],
    },
  };
  const d = new Driver(c);
  d.key("confirm"); // TITLE -> BRIEFING
  assert(d.s.phase === "BRIEFING" && !d.s.evidence.includes("key"), "record starts without the granted key");
  d.adv(); // advance briefing line -> fires add_evidence -> INTRO
  assert(d.s.evidence.includes("key"), "briefing line granted the key");
}

/* ===== recess restores +2 POWER (cap 5) between witnesses =============== */
console.log("\n[recess] advancing witness restores +2 POWER");
{
  const c: CompiledCase = {
    schema: 2, case: "T", title: "T", defendant: "X", intro: "intro",
    evidence: [{ id: "e", name: "E", desc: "E." }],
    failure: { power: 5, on_empty: [{ end_testimony: { result: "restart" } }] },
    witnesses: [
      { id: "w1", name: "W1", portrait: "pterax", testimony: { phase: "P1", statements: [
        { id: "a1", text: "LIE ONE.", lie: { objection: "HEARSAY", breakdown: "bd1", effects: [{ advance_witness: {} }] }, wrong_objection_dialogue: "reb" }] } },
      { id: "w2", name: "W2", portrait: "pterax", testimony: { phase: "P2", statements: [
        { id: "b1", text: "LIE TWO.", lie: { objection: "HEARSAY", breakdown: "bd2", effects: [{ end_testimony: { result: "win" } }] }, wrong_objection_dialogue: "reb" }] } },
    ],
    dialogue: { intro: [{ speaker: "J", text: "HI." }], bd1: [{ speaker: "W1", text: "OK." }], bd2: [{ speaker: "W2", text: "OK." }], reb: [{ speaker: "J", text: "NO." }] },
  };
  const d = new Driver(c).begin();
  // Drain to 2 with three wrong objections.
  for (let i = 0; i < 3; i++) { d.objectionMenu(); d.key("down"); d.key("down"); d.key("confirm"); d.adv(); }
  assert(d.s.power === 2, "power drained to 2");
  d.objectionMenu(); d.key("down"); d.key("confirm"); // HEARSAY correct -> SUSTAINED
  d.adv(); // -> BREAKDOWN
  d.adv(); // breakdown -> advance_witness -> RECESS
  assert(d.s.phase === "RECESS" && d.s.power === 4, "RECESS restores +2 (2 -> 4)");
  d.key("confirm");
  assert(d.s.phase === "TESTIMONY" && d.id === "b1", "resume on witness 2");
}

/* ===== round-robin rebukes cycle deterministically ===================== */
console.log("\n[round-robin] list rebukes cycle in order");
{
  const c: CompiledCase = {
    schema: 2, case: "T", title: "T", defendant: "X", intro: "intro",
    evidence: [{ id: "e", name: "E", desc: "E." }],
    failure: { power: 9, on_empty: [{ end_testimony: { result: "restart" } }] },
    witnesses: [{ id: "w", name: "W", portrait: "pterax", testimony: { phase: "P", statements: [
      { id: "s1", text: "LIE.", lie: { objection: "HEARSAY", breakdown: "bd", effects: [{ end_testimony: { result: "win" } }] }, wrong_objection_dialogue: ["r0", "r1"] }] } }],
    dialogue: { intro: [{ speaker: "J", text: "HI." }], bd: [{ speaker: "W", text: "OK." }], r0: [{ speaker: "J", text: "REBUKE ZERO." }], r1: [{ speaker: "J", text: "REBUKE ONE." }] },
  };
  const d = new Driver(c).begin();
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) { d.objectionMenu(); d.key("down"); d.key("down"); d.key("confirm"); seen.push(d.box()); d.adv(); }
  assert(seen.join("|") === "REBUKE ZERO.|REBUKE ONE.|REBUKE ZERO.", `rebukes cycle 0,1,0 (got ${seen.join(",")})`);
}

/* ===== wrong-evidence path (right category, wrong exhibit) ============== */
console.log("\n[wrong-evidence] right category, wrong exhibit");
{
  const c: CompiledCase = {
    schema: 2, case: "T", title: "T", defendant: "X", intro: "intro",
    evidence: [{ id: "right", name: "RIGHT", desc: "R." }, { id: "wrong", name: "WRONG", desc: "W." }],
    failure: { power: 5, on_empty: [{ end_testimony: { result: "restart" } }] },
    witnesses: [{ id: "w", name: "W", portrait: "pterax", testimony: { phase: "P", statements: [
      { id: "s1", text: "LIE.", lie: { objection: "CONTRADICTION", requires_evidence: "right", wrong_evidence_dialogue: "we", breakdown: "bd", effects: [{ end_testimony: { result: "win" } }] }, wrong_objection_dialogue: "reb" }] } }],
    dialogue: { intro: [{ speaker: "J", text: "HI." }], bd: [{ speaker: "W", text: "OK." }], we: [{ speaker: "J", text: "THAT PROVES NOTHING." }], reb: [{ speaker: "J", text: "NO." }] },
  };
  const d = new Driver(c).begin();
  d.objectionMenu(); d.key("confirm"); // CONTRADICTION -> evidence pick
  d.key("down"); d.key("confirm"); // present WRONG exhibit
  assert(d.box() === "THAT PROVES NOTHING." && d.s.power === 4, "wrong exhibit -> wrong_evidence_dialogue, power 4");
}

/* ===== guidance fires once per category ================================= */
console.log("\n[guidance] co-counsel walkthrough plays once");
{
  const c: CompiledCase = {
    schema: 2, case: "T", title: "T", defendant: "X", intro: "intro",
    evidence: [{ id: "e", name: "E", desc: "E." }],
    failure: { power: 5, on_empty: [{ end_testimony: { result: "restart" } }] },
    guidance: { HEARSAY: "g" },
    witnesses: [{ id: "w", name: "W", portrait: "pterax", testimony: { phase: "P", statements: [
      { id: "s1", text: "LIE.", lie: { objection: "HEARSAY", breakdown: "bd", effects: [{ end_testimony: { result: "win" } }] }, wrong_objection_dialogue: "reb" },
      { id: "s2", text: "FILLER.", wrong_objection_dialogue: "reb" }] } }],
    dialogue: { intro: [{ speaker: "J", text: "HI." }], g: [{ speaker: "CO", text: "HEARSAY IS SECONDHAND." }], bd: [{ speaker: "W", text: "OK." }], reb: [{ speaker: "J", text: "NO." }] },
  };
  const d = new Driver(c).begin();
  assert(d.s.phase === "GUIDANCE" && d.box() === "HEARSAY IS SECONDHAND.", "guidance plays before a solvable HEARSAY");
  d.adv(); assert(d.s.phase === "TESTIMONY" && d.id === "s1", "-> testimony s1");
  d.key("right"); d.key("left"); // s1 -> s2 -> s1
  assert(d.s.phase === "TESTIMONY" && d.id === "s1", "returning to s1 does NOT replay guidance");
}

/* ===== hint reduces the rank by a letter =============================== */
console.log("\n[hint] a hint drops the rank one letter");
{
  const c: CompiledCase = {
    schema: 2, case: "T", title: "T", defendant: "X", intro: "intro",
    evidence: [{ id: "e", name: "E", desc: "E." }],
    failure: { power: 5, on_empty: [{ end_testimony: { result: "restart" } }] },
    witnesses: [{ id: "w", name: "W", portrait: "pterax", testimony: { phase: "P", statements: [
      { id: "s1", text: "LIE.", hint: "h", lie: { objection: "HEARSAY", breakdown: "bd", effects: [{ end_testimony: { result: "win" } }] }, wrong_objection_dialogue: "reb" }] } }],
    dialogue: { intro: [{ speaker: "J", text: "HI." }], h: [{ speaker: "CO", text: "THINK SECONDHAND." }], bd: [{ speaker: "W", text: "OK." }], reb: [{ speaker: "J", text: "NO." }] },
  };
  const d = new Driver(c).begin();
  assert(d.eng.rank() === "S", "rank S before hint");
  d.key("hint"); assert(d.s.phase === "HINT_CONFIRM", "H -> hint confirm");
  d.key("confirm"); // YES (default sel is NO; confirm on sel=1 => value 'no')... ensure YES:
  // sel starts at 1 (NO); move up to YES then confirm
  const d2 = new Driver(c).begin();
  d2.key("hint"); d2.key("up"); d2.key("confirm"); // YES
  assert(d2.s.phase === "HINT" && d2.box() === "THINK SECONDHAND.", "YES plays the hint");
  assert(d2.eng.rank() === "A", "rank drops S -> A after one hint");
}

/* ===== replace_statement retires the replaced statement ================= */
console.log("\n[replace] replace_statement retires the old statement");
{
  const c: CompiledCase = {
    schema: 2, case: "T", title: "T", defendant: "X", intro: "intro",
    evidence: [{ id: "e", name: "E", desc: "E." }],
    failure: { power: 5, on_empty: [{ end_testimony: { result: "restart" } }] },
    witnesses: [{ id: "w", name: "W", portrait: "pterax", testimony: { phase: "P", statements: [
      { id: "s1", text: "FIRST.", lie: { objection: "HEARSAY", breakdown: "bd", effects: [{ replace_statement: { statement: "s2", with: "s2b" } }] }, wrong_objection_dialogue: "reb" },
      { id: "s2", text: "OLD SECOND.", wrong_objection_dialogue: "reb" },
      { id: "s2b", hidden: true, text: "NEW SECOND.", lie: { objection: "HEARSAY", breakdown: "bd", effects: [{ end_testimony: { result: "win" } }] }, wrong_objection_dialogue: "reb" }] } }],
    dialogue: { intro: [{ speaker: "J", text: "HI." }], bd: [{ speaker: "W", text: "OK." }], reb: [{ speaker: "J", text: "NO." }] },
  };
  const d = new Driver(c).begin();
  d.objectionMenu(); d.key("down"); d.key("confirm"); // HEARSAY on s1
  d.adv(); d.adv(); // sustained -> breakdown -> effects
  assert(d.s.order.includes("s2b") && !d.s.order.includes("s2"), "s2 replaced by s2b in the running order");
  assert(d.s.broken.has("s2"), "the replaced s2 is retired (marked broken)");
}

/* ===== case 0-1: interruption timing (hit / miss / false-slam) ========= */
console.log("\n[interruption] hit / miss / false-slam");
{
  const toDrill = () => { const d = new Driver(case01); d.key("confirm"); d.adv(); return d; }; // title->intro->interruption

  // false-slam on a fair question q1
  const fs = toDrill();
  assert(fs.s.phase === "INTERRUPTION" && fs.id === "q1", "drill starts on q1");
  fs.slamMenu();
  assert(fs.s.phase === "OBJECTION_MENU" && fs.s.menu[0].value === "LEADING_QUESTION" && fs.s.menu.length === 5, "interruption menu leads with LEADING QUESTION (5 options)");
  fs.key("down"); fs.key("down"); fs.key("confirm"); // HEARSAY (wrong)
  fs.adv();
  assert(fs.s.power === 4 && fs.s.phase === "INTERRUPTION", "false slam on fair question costs 1 POWER, resumes");

  // miss q2: let its window elapse
  const ms = toDrill();
  ms.tick(4); // q1 (dur 2) window closes
  assert(ms.id === "q2", "auto-advanced to q2");
  ms.tick(7); // q2 (dur 3 = 5.4s) window closes unobjected
  assert(ms.s.missed.has("q2"), "unchallenged leading question is marked missed");

  // hit q2 then q4 -> win
  const hs = toDrill();
  hs.tick(4); // -> q2
  hs.slamMenu(); hs.key("confirm"); // LEADING_QUESTION on q2 -> SUSTAINED
  hs.adv(); // -> BREAKDOWN
  hs.adv(); // breakdown -> resume interruption on q3
  assert(hs.s.broken.has("q2"), "caught leading question q2");
  hs.tick(4); // q3 window closes -> q4
  assert(hs.id === "q4", "advanced to decisive q4");
  hs.slamMenu(); hs.key("confirm"); // LEADING_QUESTION -> SUSTAINED
  hs.adv(); // -> BREAKDOWN
  hs.adv(); // breakdown -> end_testimony win -> VERDICT
  assert(hs.s.phase === "VERDICT" && hs.s.endResult === "win", "catching the decisive leading question wins");
}

console.log(failures === 0 ? "\n=== REGRESSION PASSED ===" : `\n=== REGRESSION FAILED (${failures}) ===`);
if (failures > 0) process.exitCode = 1;
