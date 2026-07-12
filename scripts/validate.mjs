#!/usr/bin/env node
/*
 * validate — fails loudly on broken case files.
 *
 *   node scripts/validate.mjs [file.yaml ...]
 *
 * With no args it validates every cases/*.yaml (skeletons excluded). Three
 * classes of check:
 *   1. STRUCTURAL   — unknown/missing fields, dangling references.
 *   2. TEXT BUDGET  — every line fits 30 chars x 4 lines (warn at 90%).
 *   3. REACHABILITY — a graph-walk proving the case is actually winnable and
 *                     that nothing is stranded (the important one).
 *
 * Exports validateCase / validateFile for the fixture tests.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const OBJECTION_CATEGORIES = ["CONTRADICTION", "HEARSAY", "SPECULATION", "RELEVANCE"];
const KNOWN_PORTRAITS = ["dino_saurus", "pterax", "judge"];
const END_RESULTS = ["win", "restart", "lose"];
const EFFECT_SHAPES = {
  reveal_statement: ["statement", "insert_after"],
  replace_statement: ["statement", "with"],
  set_flag: ["flag"],
  add_evidence: ["evidence"],
  end_testimony: ["result"],
  advance_witness: [],
};

const TEXT_COLS = 30;
const TEXT_ROWS = 4;

/* ------------------------------------------------------------- helpers --- */

/** Word-wrap by character cells, matching the runtime's fixed-cell wrap. */
function wrap(text, cols) {
  const words = String(text).toUpperCase().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const word of words) {
    let w = word;
    while (w.length > cols) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    if (cur === "") cur = w;
    else if (cur.length + 1 + w.length <= cols) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

class Ctx {
  constructor(name) {
    this.name = name;
    this.errors = [];
    this.warnings = [];
  }
  err(msg) {
    this.errors.push(msg);
  }
  warn(msg) {
    this.warnings.push(msg);
  }
  /** Report keys on `obj` that aren't in the allowed set. */
  checkKeys(obj, allowed, where) {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k)) this.err(`${where}: unknown field "${k}"`);
    }
  }
  require(obj, field, where) {
    if (obj == null || obj[field] === undefined) {
      this.err(`${where}: missing required field "${field}"`);
      return false;
    }
    return true;
  }
}

/* ----------------------------------------------------------- structural -- */

function checkStructural(ctx, c) {
  ctx.checkKeys(c, ["schema", "case", "title", "defendant", "intro", "evidence", "witnesses", "failure", "dialogue"], "case");
  if (c.schema !== 1) ctx.err(`case: "schema" must be 1 (got ${JSON.stringify(c.schema)})`);
  for (const f of ["case", "title", "defendant", "intro", "evidence", "witnesses", "failure", "dialogue"]) {
    ctx.require(c, f, "case");
  }

  // Evidence
  const evidenceIds = new Set();
  if (Array.isArray(c.evidence)) {
    c.evidence.forEach((e, i) => {
      const w = `evidence[${i}]`;
      ctx.checkKeys(e, ["id", "name", "desc", "icon"], w);
      ctx.require(e, "id", w);
      ctx.require(e, "name", w);
      ctx.require(e, "desc", w);
      if (e && e.id) {
        if (evidenceIds.has(e.id)) ctx.err(`${w}: duplicate evidence id "${e.id}"`);
        evidenceIds.add(e.id);
      }
    });
  }

  // Dialogue map
  const dialogueIds = new Set();
  if (c.dialogue && typeof c.dialogue === "object") {
    for (const [id, lines] of Object.entries(c.dialogue)) {
      dialogueIds.add(id);
      if (!Array.isArray(lines)) {
        ctx.err(`dialogue.${id}: must be a list of lines`);
        continue;
      }
      lines.forEach((ln, i) => {
        const w = `dialogue.${id}[${i}]`;
        ctx.checkKeys(ln, ["speaker", "text", "expression", "sfx"], w);
        ctx.require(ln, "speaker", w);
        ctx.require(ln, "text", w);
      });
    }
  }

  // Statements (collect ids across all witnesses)
  const statementIds = new Set();
  const seenStatementIds = new Set();
  if (Array.isArray(c.witnesses)) {
    c.witnesses.forEach((wit, wi) => {
      const w = `witnesses[${wi}]`;
      ctx.checkKeys(wit, ["id", "name", "portrait", "testimony"], w);
      ctx.require(wit, "id", w);
      ctx.require(wit, "name", w);
      if (ctx.require(wit, "portrait", w) && !KNOWN_PORTRAITS.includes(wit.portrait)) {
        ctx.err(`${w}: unknown portrait "${wit.portrait}" (known: ${KNOWN_PORTRAITS.join(", ")})`);
      }
      if (ctx.require(wit, "testimony", w)) {
        ctx.checkKeys(wit.testimony, ["phase", "statements"], `${w}.testimony`);
        ctx.require(wit.testimony, "phase", `${w}.testimony`);
        const stmts = wit.testimony.statements;
        if (Array.isArray(stmts)) {
          stmts.forEach((s) => {
            if (s && s.id) {
              if (seenStatementIds.has(s.id)) ctx.err(`statement id "${s.id}" is defined more than once`);
              seenStatementIds.add(s.id);
              statementIds.add(s.id);
            }
          });
        }
      }
    });
  }

  const dialogueRefs = [];
  const evidenceRefs = [];
  const statementRefs = [];

  const checkEffect = (eff, where) => {
    if (!eff || typeof eff !== "object") {
      ctx.err(`${where}: effect must be an object`);
      return;
    }
    const keys = Object.keys(eff);
    if (keys.length !== 1 || !(keys[0] in EFFECT_SHAPES)) {
      ctx.err(`${where}: effect must be exactly one of ${Object.keys(EFFECT_SHAPES).join(", ")} (got ${keys.join(", ") || "nothing"})`);
      return;
    }
    const key = keys[0];
    const body = eff[key] ?? {};
    ctx.checkKeys(body, EFFECT_SHAPES[key], `${where}.${key}`);
    for (const req of EFFECT_SHAPES[key]) {
      if (body[req] === undefined) ctx.err(`${where}.${key}: missing "${req}"`);
    }
    if (key === "reveal_statement") {
      statementRefs.push([body.statement, `${where}.reveal_statement.statement`]);
      statementRefs.push([body.insert_after, `${where}.reveal_statement.insert_after`]);
    } else if (key === "replace_statement") {
      statementRefs.push([body.statement, `${where}.replace_statement.statement`]);
      statementRefs.push([body.with, `${where}.replace_statement.with`]);
    } else if (key === "add_evidence") {
      evidenceRefs.push([body.evidence, `${where}.add_evidence.evidence`]);
    } else if (key === "end_testimony") {
      if (!END_RESULTS.includes(body.result)) ctx.err(`${where}.end_testimony: result must be one of ${END_RESULTS.join(", ")}`);
    }
  };

  // Failure
  if (c.failure) {
    ctx.checkKeys(c.failure, ["power", "on_empty"], "failure");
    if (typeof c.failure.power !== "number") ctx.err(`failure.power must be a number`);
    if (!Array.isArray(c.failure.on_empty)) ctx.err(`failure.on_empty must be a list of effects`);
    else c.failure.on_empty.forEach((e, i) => checkEffect(e, `failure.on_empty[${i}]`));
  }

  // Deep statement checks
  if (Array.isArray(c.witnesses)) {
    c.witnesses.forEach((wit, wi) => {
      const stmts = wit?.testimony?.statements;
      if (!Array.isArray(stmts)) return;
      stmts.forEach((s, si) => {
        const w = `witnesses[${wi}].statements[${si}]${s?.id ? `(${s.id})` : ""}`;
        ctx.checkKeys(s, ["id", "text", "hidden", "press", "lie", "wrong_objection_dialogue"], w);
        ctx.require(s, "id", w);
        ctx.require(s, "text", w);
        if (s.hidden !== undefined && typeof s.hidden !== "boolean") ctx.err(`${w}.hidden must be a boolean`);

        if (s.press) {
          for (const [mode, pm] of Object.entries(s.press)) {
            const pw = `${w}.press.${mode}`;
            ctx.checkKeys(pm, ["dialogue", "once", "repeat_dialogue", "effects"], pw);
            if (ctx.require(pm, "dialogue", pw)) dialogueRefs.push([pm.dialogue, `${pw}.dialogue`]);
            if (pm.repeat_dialogue) dialogueRefs.push([pm.repeat_dialogue, `${pw}.repeat_dialogue`]);
            if (pm.once !== undefined && typeof pm.once !== "boolean") ctx.err(`${pw}.once must be a boolean`);
            if (pm.effects) {
              if (!Array.isArray(pm.effects)) ctx.err(`${pw}.effects must be a list`);
              else pm.effects.forEach((e, i) => checkEffect(e, `${pw}.effects[${i}]`));
            }
          }
        }

        if (s.lie) {
          const lw = `${w}.lie`;
          ctx.checkKeys(s.lie, ["objection", "requires_evidence", "prerequisites", "breakdown", "effects"], lw);
          if (ctx.require(s.lie, "objection", lw) && !OBJECTION_CATEGORIES.includes(s.lie.objection)) {
            ctx.err(`${lw}.objection must be one of ${OBJECTION_CATEGORIES.join(", ")}`);
          }
          if (ctx.require(s.lie, "breakdown", lw)) dialogueRefs.push([s.lie.breakdown, `${lw}.breakdown`]);
          if (s.lie.requires_evidence) evidenceRefs.push([s.lie.requires_evidence, `${lw}.requires_evidence`]);
          if (s.lie.prerequisites !== undefined && !Array.isArray(s.lie.prerequisites)) ctx.err(`${lw}.prerequisites must be a list`);
          if (s.lie.effects) {
            if (!Array.isArray(s.lie.effects)) ctx.err(`${lw}.effects must be a list`);
            else s.lie.effects.forEach((e, i) => checkEffect(e, `${lw}.effects[${i}]`));
          }
        }

        if (s.wrong_objection_dialogue) dialogueRefs.push([s.wrong_objection_dialogue, `${w}.wrong_objection_dialogue`]);
      });
    });
  }

  if (c.intro) dialogueRefs.push([c.intro, "case.intro"]);

  // Resolve references
  for (const [id, where] of dialogueRefs) {
    if (id != null && !dialogueIds.has(id)) ctx.err(`${where}: dangling dialogue id "${id}"`);
  }
  for (const [id, where] of evidenceRefs) {
    if (id != null && !evidenceIds.has(id)) ctx.err(`${where}: dangling evidence id "${id}"`);
  }
  for (const [id, where] of statementRefs) {
    if (id != null && !statementIds.has(id)) ctx.err(`${where}: dangling statement id "${id}"`);
  }

  return { dialogueIds, evidenceIds, statementIds };
}

/* ---------------------------------------------------------- text budget -- */

function checkTextBudget(ctx, c) {
  const lines = [];
  if (c.dialogue && typeof c.dialogue === "object") {
    for (const [id, ls] of Object.entries(c.dialogue)) {
      if (Array.isArray(ls)) ls.forEach((ln, i) => ln && ln.text != null && lines.push([`dialogue.${id}[${i}]`, ln.text]));
    }
  }
  if (Array.isArray(c.witnesses)) {
    for (const wit of c.witnesses) {
      const stmts = wit?.testimony?.statements;
      if (Array.isArray(stmts)) stmts.forEach((s) => s && s.text != null && lines.push([`statement ${s.id}`, s.text]));
    }
  }
  for (const [where, text] of lines) {
    const wrapped = wrap(text, TEXT_COLS);
    const longest = Math.max(0, ...wrapped.map((l) => l.length));
    if (longest > TEXT_COLS) {
      ctx.err(`${where}: a word exceeds ${TEXT_COLS} chars and cannot wrap ("${text}")`);
    }
    if (wrapped.length > TEXT_ROWS) {
      ctx.err(`${where}: wraps to ${wrapped.length} lines, over the ${TEXT_ROWS}-line budget ("${text}")`);
    } else if (wrapped.length === TEXT_ROWS || longest >= Math.floor(TEXT_COLS * 0.9)) {
      ctx.warn(`${where}: at ${wrapped.length} line(s), longest ${longest}/${TEXT_COLS} chars — near budget`);
    }
  }
}

/* ---------------------------------------------------------- reachability - */

function effectKey(eff) {
  return eff && typeof eff === "object" ? Object.keys(eff)[0] : null;
}

function checkReachability(ctx, c) {
  const witnesses = Array.isArray(c.witnesses) ? c.witnesses : [];
  const stmts = new Map(); // id -> {s, wi}
  witnesses.forEach((wit, wi) => {
    const arr = wit?.testimony?.statements;
    if (Array.isArray(arr)) for (const s of arr) if (s && s.id) stmts.set(s.id, { s, wi });
  });

  const reachable = new Set();
  const flags = new Set();
  const evidence = new Set((c.evidence || []).map((e) => e && e.id).filter(Boolean));
  const broken = new Set();
  const activatedWitness = new Set();
  let winReached = false;

  const activateWitness = (wi) => {
    if (activatedWitness.has(wi)) return;
    const wit = witnesses[wi];
    if (!wit) return;
    activatedWitness.add(wi);
    const arr = wit?.testimony?.statements;
    if (Array.isArray(arr)) for (const s of arr) if (s && !s.hidden && s.id) reachable.add(s.id);
  };

  const applyProductions = (effects, wi) => {
    for (const eff of effects || []) {
      const key = effectKey(eff);
      const v = eff[key] || {};
      if (key === "set_flag") flags.add(v.flag);
      else if (key === "add_evidence") evidence.add(v.evidence);
      else if (key === "reveal_statement") reachable.add(v.statement);
      else if (key === "replace_statement") reachable.add(v.with);
      else if (key === "advance_witness") activateWitness(wi + 1);
      else if (key === "end_testimony" && v.result === "win") winReached = true;
    }
  };

  activateWitness(0);

  let guard = 0;
  let changed = true;
  while (changed && guard++ < 1000) {
    changed = false;
    const sig = () => reachable.size + flags.size + evidence.size + broken.size + (winReached ? 1 : 0);
    const before = sig();
    for (const id of [...reachable]) {
      const entry = stmts.get(id);
      if (!entry) continue;
      const { s, wi } = entry;
      // Presses are free and always available once the statement is reachable.
      if (s.press) for (const mode of Object.keys(s.press)) applyProductions(s.press[mode].effects, wi);
      // A lie can be broken once its evidence + prerequisites are obtainable.
      if (s.lie && !broken.has(id)) {
        const evOk = !s.lie.requires_evidence || evidence.has(s.lie.requires_evidence);
        const prereqOk = (s.lie.prerequisites || []).every((f) => flags.has(f));
        if (evOk && prereqOk) {
          broken.add(id);
          applyProductions(s.lie.effects, wi);
        }
      }
    }
    changed = sig() !== before;
  }

  // 1. Every lie must actually be breakable (evidence/prereqs obtainable before it).
  for (const [id, { s }] of stmts) {
    if (!s.lie) continue;
    if (!broken.has(id)) {
      if (!reachable.has(id)) {
        ctx.err(`lie on "${id}" is unbreakable: the statement is never reachable`);
      } else if (s.lie.requires_evidence && !evidence.has(s.lie.requires_evidence)) {
        ctx.err(`lie on "${id}" requires evidence "${s.lie.requires_evidence}", which is never obtainable before it`);
      } else {
        const missing = (s.lie.prerequisites || []).filter((f) => !flags.has(f));
        if (missing.length) ctx.err(`lie on "${id}" needs flag(s) [${missing.join(", ")}] that are never set before it`);
        else ctx.err(`lie on "${id}" is never breakable`);
      }
    }
  }

  // 2 & 5a. Every statement must be reachable (hidden reached via effect; witnesses activated).
  for (const [id, { s }] of stmts) {
    if (!reachable.has(id)) {
      if (s.hidden) ctx.err(`hidden statement "${id}" is never revealed by any effect`);
      else ctx.err(`statement "${id}" is orphaned (its witness is never reached)`);
    }
  }

  // 4. A win must be reachable.
  if (!winReached) ctx.err(`no path reaches "end_testimony: win" — the case is unwinnable`);

  return { reachable, broken };
}

/* --------------------------------------------------------------- flags --- */

function checkFlags(ctx, c) {
  const set = new Set();
  const consumed = new Set();
  const scanEffects = (effects) => {
    for (const eff of effects || []) {
      if (effectKey(eff) === "set_flag") set.add(eff.set_flag.flag);
    }
  };
  if (Array.isArray(c.witnesses)) {
    for (const wit of c.witnesses) {
      const arr = wit?.testimony?.statements;
      if (!Array.isArray(arr)) continue;
      for (const s of arr) {
        if (s.press) for (const pm of Object.values(s.press)) scanEffects(pm.effects);
        if (s.lie) {
          scanEffects(s.lie.effects);
          for (const f of s.lie.prerequisites || []) consumed.add(f);
        }
      }
    }
  }
  scanEffects(c.failure?.on_empty);
  for (const f of set) if (!consumed.has(f)) ctx.err(`flag "${f}" is set but never consumed by any lie's prerequisites`);
  for (const f of consumed) if (!set.has(f)) ctx.err(`flag "${f}" is required as a prerequisite but never set`);
}

/* ------------------------------------------------------- dialogue orphans */

function checkDialogueOrphans(ctx, c) {
  const referenced = new Set();
  if (c.intro) referenced.add(c.intro);
  if (Array.isArray(c.witnesses)) {
    for (const wit of c.witnesses) {
      const arr = wit?.testimony?.statements;
      if (!Array.isArray(arr)) continue;
      for (const s of arr) {
        if (s.press) for (const pm of Object.values(s.press)) {
          if (pm.dialogue) referenced.add(pm.dialogue);
          if (pm.repeat_dialogue) referenced.add(pm.repeat_dialogue);
        }
        if (s.lie?.breakdown) referenced.add(s.lie.breakdown);
        if (s.wrong_objection_dialogue) referenced.add(s.wrong_objection_dialogue);
      }
    }
  }
  if (c.dialogue && typeof c.dialogue === "object") {
    for (const id of Object.keys(c.dialogue)) {
      if (!referenced.has(id)) ctx.err(`dialogue "${id}" is orphaned (never referenced)`);
    }
  }
}

/* ------------------------------------------------------------- entry ----- */

export function validateCase(c, name = "case") {
  const ctx = new Ctx(name);
  if (!c || typeof c !== "object") {
    ctx.err("file is empty or not a YAML mapping");
    return { errors: ctx.errors, warnings: ctx.warnings };
  }
  checkStructural(ctx, c);
  checkTextBudget(ctx, c);
  checkReachability(ctx, c);
  checkFlags(ctx, c);
  checkDialogueOrphans(ctx, c);
  return { errors: ctx.errors, warnings: ctx.warnings };
}

export function validateFile(path) {
  let c;
  try {
    c = yaml.load(readFileSync(path, "utf8"));
  } catch (err) {
    return { errors: [`YAML parse error: ${err.message}`], warnings: [] };
  }
  return validateCase(c, path);
}

/* --------------------------------------------------------------- CLI ----- */

function isMain() {
  return fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  let files = process.argv.slice(2);
  if (files.length === 0) {
    const dir = join(root, "cases");
    files = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.includes("skeleton"))
          .map((f) => join(dir, f))
      : [];
  }
  let totalErrors = 0;
  for (const f of files) {
    const { errors, warnings } = validateFile(f);
    if (errors.length === 0 && warnings.length === 0) {
      console.log(`✓ ${f} — OK`);
    } else {
      console.log(`\n${f}`);
      for (const w of warnings) console.log(`  warn  ${w}`);
      for (const e of errors) console.log(`  ERROR ${e}`);
    }
    totalErrors += errors.length;
  }
  console.log(`\n${totalErrors === 0 ? "VALIDATION PASSED" : `VALIDATION FAILED (${totalErrors} error(s))`}`);
  process.exit(totalErrors === 0 ? 0 : 1);
}
