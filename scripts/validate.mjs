/*
 * validate — fails loudly on broken case files (schema v2).
 *
 *   node scripts/validate.mjs [file.yaml ...]
 *
 * Three classes of check: STRUCTURAL (unknown/missing fields, dangling refs,
 * sfx-registry names, LEADING_QUESTION context, interruption durations),
 * TEXT BUDGET (30x4, warn at 90%), and REACHABILITY (graph-walk incl.
 * replace_statement retirement). Exports validateCase / validateFile.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import yaml from "js-yaml";

const SCHEMA_VERSION = 2;
const FOUR = ["CONTRADICTION", "HEARSAY", "SPECULATION", "RELEVANCE"];
const LEADING = "LEADING_QUESTION";
const ALL_CATEGORIES = [...FOUR, LEADING];
const KNOWN_PORTRAITS = ["dino_saurus", "pterax", "judge"];
const END_RESULTS = ["win", "restart", "lose"];
const SHAKES = ["light", "heavy"];
const SFX = ["blip", "confirm", "move", "objection_sting", "rebuke_buzz", "breakdown_a", "breakdown_b", "sustained", "recess", "fanfare"];
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

const isInterruption = (t) => String(t?.phase ?? "").trim().toUpperCase() === "INTERRUPTION";

function wrap(text, cols) {
  const words = String(text).toUpperCase().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const word of words) {
    let w = word;
    while (w.length > cols) {
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    if (cur === "") cur = w;
    else if (cur.length + 1 + w.length <= cols) cur += " " + w;
    else { lines.push(cur); cur = w; }
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
  err(m) { this.errors.push(m); }
  warn(m) { this.warnings.push(m); }
  checkKeys(obj, allowed, where) {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) this.err(`${where}: unknown field "${k}"`);
  }
  require(obj, field, where) {
    if (obj == null || obj[field] === undefined) { this.err(`${where}: missing required field "${field}"`); return false; }
    return true;
  }
}

/* ----------------------------------------------------------- structural -- */

function checkStructural(ctx, c) {
  ctx.checkKeys(c, ["schema", "case", "title", "defendant", "briefing", "intro", "evidence", "witnesses", "failure", "guidance", "dialogue"], "case");
  if (c.schema !== SCHEMA_VERSION) ctx.err(`case: "schema" must be ${SCHEMA_VERSION} (got ${JSON.stringify(c.schema)})`);
  for (const f of ["case", "title", "defendant", "intro", "evidence", "witnesses", "failure", "dialogue"]) ctx.require(c, f, "case");

  const evidenceIds = new Set();
  if (Array.isArray(c.evidence)) {
    c.evidence.forEach((e, i) => {
      const w = `evidence[${i}]`;
      ctx.checkKeys(e, ["id", "name", "desc", "icon"], w);
      ctx.require(e, "id", w); ctx.require(e, "name", w); ctx.require(e, "desc", w);
      if (e?.id) { if (evidenceIds.has(e.id)) ctx.err(`${w}: duplicate evidence id "${e.id}"`); evidenceIds.add(e.id); }
    });
  }

  const dialogueIds = new Set();
  const dialogueRefs = [];
  const evidenceRefs = [];
  const statementRefs = [];

  const checkEffect = (eff, where) => {
    if (!eff || typeof eff !== "object") { ctx.err(`${where}: effect must be an object`); return; }
    const keys = Object.keys(eff);
    if (keys.length !== 1 || !(keys[0] in EFFECT_SHAPES)) {
      ctx.err(`${where}: effect must be exactly one of ${Object.keys(EFFECT_SHAPES).join(", ")} (got ${keys.join(", ") || "nothing"})`);
      return;
    }
    const key = keys[0];
    const body = eff[key] ?? {};
    ctx.checkKeys(body, EFFECT_SHAPES[key], `${where}.${key}`);
    for (const req of EFFECT_SHAPES[key]) if (body[req] === undefined) ctx.err(`${where}.${key}: missing "${req}"`);
    if (key === "reveal_statement") { statementRefs.push([body.statement, `${where}.reveal_statement.statement`]); statementRefs.push([body.insert_after, `${where}.reveal_statement.insert_after`]); }
    else if (key === "replace_statement") { statementRefs.push([body.statement, `${where}.replace_statement.statement`]); statementRefs.push([body.with, `${where}.replace_statement.with`]); }
    else if (key === "add_evidence") evidenceRefs.push([body.evidence, `${where}.add_evidence.evidence`]);
    else if (key === "end_testimony" && !END_RESULTS.includes(body.result)) ctx.err(`${where}.end_testimony: result must be one of ${END_RESULTS.join(", ")}`);
  };

  // Dialogue map (lines may carry effects + sfx).
  if (c.dialogue && typeof c.dialogue === "object") {
    for (const [id, lines] of Object.entries(c.dialogue)) {
      dialogueIds.add(id);
      if (!Array.isArray(lines)) { ctx.err(`dialogue.${id}: must be a list of lines`); continue; }
      lines.forEach((ln, i) => {
        const w = `dialogue.${id}[${i}]`;
        ctx.checkKeys(ln, ["speaker", "text", "expression", "sfx", "effects"], w);
        ctx.require(ln, "speaker", w); ctx.require(ln, "text", w);
        if (ln?.sfx && !SFX.includes(ln.sfx)) ctx.err(`${w}.sfx "${ln.sfx}" is not a registry sound (${SFX.join(", ")})`);
        if (ln?.effects) { if (!Array.isArray(ln.effects)) ctx.err(`${w}.effects must be a list`); else ln.effects.forEach((e, k) => checkEffect(e, `${w}.effects[${k}]`)); }
      });
    }
  }

  // Statement ids (global uniqueness).
  const statementIds = new Set();
  if (Array.isArray(c.witnesses)) {
    c.witnesses.forEach((wit, wi) => {
      const w = `witnesses[${wi}]`;
      ctx.checkKeys(wit, ["id", "name", "portrait", "testimony"], w);
      ctx.require(wit, "id", w); ctx.require(wit, "name", w);
      if (ctx.require(wit, "portrait", w) && !KNOWN_PORTRAITS.includes(wit.portrait)) ctx.err(`${w}: unknown portrait "${wit.portrait}" (known: ${KNOWN_PORTRAITS.join(", ")})`);
      if (ctx.require(wit, "testimony", w)) {
        ctx.checkKeys(wit.testimony, ["phase", "statements"], `${w}.testimony`);
        ctx.require(wit.testimony, "phase", `${w}.testimony`);
        const stmts = wit.testimony.statements;
        if (Array.isArray(stmts)) for (const s of stmts) if (s?.id) { if (statementIds.has(s.id)) ctx.err(`statement id "${s.id}" is defined more than once`); statementIds.add(s.id); }
      }
    });
  }

  const pushWod = (wod, where) => {
    if (wod == null) return;
    if (typeof wod === "string") dialogueRefs.push([wod, where]);
    else if (Array.isArray(wod)) wod.forEach((d, i) => dialogueRefs.push([d, `${where}[${i}]`]));
    else ctx.err(`${where}: must be a dialogue id or a list of them`);
  };

  // Failure
  if (c.failure) {
    ctx.checkKeys(c.failure, ["power", "on_empty"], "failure");
    if (typeof c.failure.power !== "number") ctx.err("failure.power must be a number");
    if (!Array.isArray(c.failure.on_empty)) ctx.err("failure.on_empty must be a list of effects");
    else c.failure.on_empty.forEach((e, i) => checkEffect(e, `failure.on_empty[${i}]`));
  }

  // Guidance map
  if (c.guidance !== undefined) {
    if (typeof c.guidance !== "object" || Array.isArray(c.guidance)) ctx.err("guidance: must be a map of category -> dialogue id");
    else for (const [cat, id] of Object.entries(c.guidance)) {
      if (!ALL_CATEGORIES.includes(cat)) ctx.err(`guidance: "${cat}" is not an objection category`);
      dialogueRefs.push([id, `guidance.${cat}`]);
    }
  }

  // Deep statement checks
  if (Array.isArray(c.witnesses)) {
    c.witnesses.forEach((wit, wi) => {
      const stmts = wit?.testimony?.statements;
      if (!Array.isArray(stmts)) return;
      const interruption = isInterruption(wit.testimony);
      stmts.forEach((s, si) => {
        const w = `witnesses[${wi}].statements[${si}]${s?.id ? `(${s.id})` : ""}`;
        ctx.checkKeys(s, ["id", "text", "hidden", "press", "lie", "wrong_objection_dialogue", "hint", "duration_boxes"], w);
        ctx.require(s, "id", w); ctx.require(s, "text", w);
        if (s.hidden !== undefined && typeof s.hidden !== "boolean") ctx.err(`${w}.hidden must be a boolean`);

        if (interruption) {
          if (s.duration_boxes === undefined) ctx.err(`${w}: interruption statement is missing "duration_boxes"`);
          else if (typeof s.duration_boxes !== "number" || s.duration_boxes <= 0) ctx.err(`${w}.duration_boxes must be a positive number`);
        }

        if (s.press) for (const [mode, pm] of Object.entries(s.press)) {
          const pw = `${w}.press.${mode}`;
          ctx.checkKeys(pm, ["dialogue", "once", "repeat_dialogue", "effects"], pw);
          if (ctx.require(pm, "dialogue", pw)) dialogueRefs.push([pm.dialogue, `${pw}.dialogue`]);
          if (pm.repeat_dialogue) dialogueRefs.push([pm.repeat_dialogue, `${pw}.repeat_dialogue`]);
          if (pm.once !== undefined && typeof pm.once !== "boolean") ctx.err(`${pw}.once must be a boolean`);
          if (pm.effects) { if (!Array.isArray(pm.effects)) ctx.err(`${pw}.effects must be a list`); else pm.effects.forEach((e, i) => checkEffect(e, `${pw}.effects[${i}]`)); }
        }

        if (s.lie) {
          const lw = `${w}.lie`;
          ctx.checkKeys(s.lie, ["objection", "requires_evidence", "prerequisites", "breakdown", "effects", "wrong_evidence_dialogue", "breakdown_sfx", "shake"], lw);
          if (ctx.require(s.lie, "objection", lw)) {
            if (!ALL_CATEGORIES.includes(s.lie.objection)) ctx.err(`${lw}.objection must be one of ${ALL_CATEGORIES.join(", ")}`);
            else if (interruption && s.lie.objection !== LEADING) ctx.err(`${lw}.objection: interruption lies must be ${LEADING}`);
            else if (!interruption && s.lie.objection === LEADING) ctx.err(`${lw}.objection: ${LEADING} is only valid in an interruption phase`);
          }
          if (ctx.require(s.lie, "breakdown", lw)) dialogueRefs.push([s.lie.breakdown, `${lw}.breakdown`]);
          if (s.lie.requires_evidence) evidenceRefs.push([s.lie.requires_evidence, `${lw}.requires_evidence`]);
          if (s.lie.wrong_evidence_dialogue) dialogueRefs.push([s.lie.wrong_evidence_dialogue, `${lw}.wrong_evidence_dialogue`]);
          if (s.lie.breakdown_sfx && !SFX.includes(s.lie.breakdown_sfx)) ctx.err(`${lw}.breakdown_sfx "${s.lie.breakdown_sfx}" is not a registry sound`);
          if (s.lie.shake !== undefined && !SHAKES.includes(s.lie.shake)) ctx.err(`${lw}.shake must be ${SHAKES.join(" or ")}`);
          if (s.lie.prerequisites !== undefined && !Array.isArray(s.lie.prerequisites)) ctx.err(`${lw}.prerequisites must be a list`);
          if (s.lie.effects) { if (!Array.isArray(s.lie.effects)) ctx.err(`${lw}.effects must be a list`); else s.lie.effects.forEach((e, i) => checkEffect(e, `${lw}.effects[${i}]`)); }
        }

        pushWod(s.wrong_objection_dialogue, `${w}.wrong_objection_dialogue`);
        if (s.hint) dialogueRefs.push([s.hint, `${w}.hint`]);
      });
    });
  }

  if (c.intro) dialogueRefs.push([c.intro, "case.intro"]);
  if (c.briefing) dialogueRefs.push([c.briefing, "case.briefing"]);

  for (const [id, where] of dialogueRefs) if (id != null && !dialogueIds.has(id)) ctx.err(`${where}: dangling dialogue id "${id}"`);
  for (const [id, where] of evidenceRefs) if (id != null && !evidenceIds.has(id)) ctx.err(`${where}: dangling evidence id "${id}"`);
  for (const [id, where] of statementRefs) if (id != null && !statementIds.has(id)) ctx.err(`${where}: dangling statement id "${id}"`);
}

/* ---------------------------------------------------------- text budget -- */

function checkTextBudget(ctx, c) {
  const lines = [];
  if (c.dialogue && typeof c.dialogue === "object") for (const [id, ls] of Object.entries(c.dialogue)) if (Array.isArray(ls)) ls.forEach((ln, i) => ln?.text != null && lines.push([`dialogue.${id}[${i}]`, ln.text]));
  if (Array.isArray(c.witnesses)) for (const wit of c.witnesses) { const s = wit?.testimony?.statements; if (Array.isArray(s)) s.forEach((st) => st?.text != null && lines.push([`statement ${st.id}`, st.text])); }
  for (const [where, text] of lines) {
    const wrapped = wrap(text, TEXT_COLS);
    const longest = Math.max(0, ...wrapped.map((l) => l.length));
    if (longest > TEXT_COLS) ctx.err(`${where}: a word exceeds ${TEXT_COLS} chars and cannot wrap ("${text}")`);
    if (wrapped.length > TEXT_ROWS) ctx.err(`${where}: wraps to ${wrapped.length} lines, over the ${TEXT_ROWS}-line budget ("${text}")`);
    else if (wrapped.length === TEXT_ROWS || longest >= Math.floor(TEXT_COLS * 0.9)) ctx.warn(`${where}: at ${wrapped.length} line(s), longest ${longest}/${TEXT_COLS} chars — near budget`);
  }
}

/* ---------------------------------------------------------- reachability - */

const effectKey = (eff) => (eff && typeof eff === "object" ? Object.keys(eff)[0] : null);

function checkReachability(ctx, c) {
  const witnesses = Array.isArray(c.witnesses) ? c.witnesses : [];
  const stmts = new Map();
  witnesses.forEach((wit, wi) => { const a = wit?.testimony?.statements; if (Array.isArray(a)) for (const s of a) if (s?.id) stmts.set(s.id, { s, wi }); });

  // Evidence granted by some add_evidence effect starts absent (to be handed over).
  const granted = new Set();
  const scanGrant = (effs) => { for (const e of effs || []) if (effectKey(e) === "add_evidence") granted.add(e.add_evidence.evidence); };
  if (c.dialogue) for (const ls of Object.values(c.dialogue)) if (Array.isArray(ls)) for (const ln of ls) scanGrant(ln.effects);
  for (const { s } of stmts.values()) { if (s.press) for (const pm of Object.values(s.press)) scanGrant(pm.effects); if (s.lie) scanGrant(s.lie.effects); }
  scanGrant(c.failure?.on_empty);

  const reachable = new Set();
  const flags = new Set();
  const evidence = new Set((c.evidence || []).map((e) => e?.id).filter(Boolean).filter((id) => !granted.has(id)));
  const broken = new Set();
  const retired = new Set();
  const replacedWithLie = []; // [replacedId]
  let winReached = false;

  const activate = new Set();
  const activateWitness = (wi) => {
    if (activate.has(wi)) return;
    const wit = witnesses[wi];
    if (!wit) return;
    activate.add(wi);
    const a = wit?.testimony?.statements;
    if (Array.isArray(a)) for (const s of a) if (s && !s.hidden && s.id) reachable.add(s.id);
  };

  const applyProductions = (effects, wi) => {
    for (const eff of effects || []) {
      const key = effectKey(eff);
      const v = eff[key] || {};
      if (key === "set_flag") flags.add(v.flag);
      else if (key === "add_evidence") evidence.add(v.evidence);
      else if (key === "reveal_statement") reachable.add(v.statement);
      else if (key === "replace_statement") { reachable.add(v.with); retired.add(v.statement); if (stmts.get(v.statement)?.s.lie) replacedWithLie.push(v.statement); }
      else if (key === "advance_witness") activateWitness(wi + 1);
      else if (key === "end_testimony" && v.result === "win") winReached = true;
    }
  };

  activateWitness(0);
  // Intro + briefing lines fire at case start; apply their effects as guaranteed.
  for (const did of [c.intro, c.briefing].filter(Boolean)) {
    const ls = c.dialogue?.[did];
    if (Array.isArray(ls)) for (const ln of ls) applyProductions(ln.effects, 0);
  }
  let guard = 0, changed = true;
  while (changed && guard++ < 1000) {
    changed = false;
    const sig = () => reachable.size + flags.size + evidence.size + broken.size + retired.size + (winReached ? 1 : 0);
    const before = sig();
    for (const id of [...reachable]) {
      const entry = stmts.get(id);
      if (!entry) continue;
      const { s, wi } = entry;
      if (s.press) for (const mode of Object.keys(s.press)) applyProductions(s.press[mode].effects, wi);
      if (s.lie && !broken.has(id) && !retired.has(id)) {
        const evOk = !s.lie.requires_evidence || evidence.has(s.lie.requires_evidence);
        const prereqOk = (s.lie.prerequisites || []).every((f) => flags.has(f));
        if (evOk && prereqOk) { broken.add(id); applyProductions(s.lie.effects, wi); }
      }
    }
    changed = sig() !== before;
  }

  for (const [id, { s }] of stmts) {
    if (!s.lie) continue;
    if (retired.has(id) && !broken.has(id)) continue; // reported by replace-retirement below
    if (!broken.has(id)) {
      if (!reachable.has(id)) ctx.err(`lie on "${id}" is unbreakable: the statement is never reachable`);
      else if (s.lie.requires_evidence && !evidence.has(s.lie.requires_evidence)) ctx.err(`lie on "${id}" requires evidence "${s.lie.requires_evidence}", which is never obtainable before it`);
      else {
        const missing = (s.lie.prerequisites || []).filter((f) => !flags.has(f));
        if (missing.length) ctx.err(`lie on "${id}" needs flag(s) [${missing.join(", ")}] that are never set before it`);
        else ctx.err(`lie on "${id}" is never breakable`);
      }
    }
  }

  for (const id of new Set(replacedWithLie)) {
    if (!broken.has(id)) ctx.err(`replace_statement retires "${id}" whose lie was never broken (still required)`);
  }

  for (const [id, { s }] of stmts) {
    if (retired.has(id)) continue;
    if (!reachable.has(id)) {
      if (s.hidden) ctx.err(`hidden statement "${id}" is never revealed by any effect`);
      else ctx.err(`statement "${id}" is orphaned (its witness is never reached)`);
    }
  }

  if (!winReached) ctx.err(`no path reaches "end_testimony: win" — the case is unwinnable`);
}

/* --------------------------------------------------------------- flags --- */

function checkFlags(ctx, c) {
  const set = new Set(), consumed = new Set();
  const scan = (effs) => { for (const e of effs || []) if (effectKey(e) === "set_flag") set.add(e.set_flag.flag); };
  if (Array.isArray(c.witnesses)) for (const wit of c.witnesses) {
    const a = wit?.testimony?.statements;
    if (!Array.isArray(a)) continue;
    for (const s of a) {
      if (s.press) for (const pm of Object.values(s.press)) scan(pm.effects);
      if (s.lie) { scan(s.lie.effects); for (const f of s.lie.prerequisites || []) consumed.add(f); }
    }
  }
  if (c.dialogue) for (const ls of Object.values(c.dialogue)) if (Array.isArray(ls)) for (const ln of ls) scan(ln.effects);
  scan(c.failure?.on_empty);
  for (const f of set) if (!consumed.has(f)) ctx.err(`flag "${f}" is set but never consumed by any lie's prerequisites`);
  for (const f of consumed) if (!set.has(f)) ctx.err(`flag "${f}" is required as a prerequisite but never set`);
}

/* ------------------------------------------------------- dialogue orphans */

function checkDialogueOrphans(ctx, c) {
  const ref = new Set();
  const add = (x) => { if (x == null) return; if (Array.isArray(x)) x.forEach((v) => ref.add(v)); else ref.add(x); };
  add(c.intro); add(c.briefing);
  if (c.guidance) for (const v of Object.values(c.guidance)) add(v);
  if (Array.isArray(c.witnesses)) for (const wit of c.witnesses) {
    const a = wit?.testimony?.statements;
    if (!Array.isArray(a)) continue;
    for (const s of a) {
      if (s.press) for (const pm of Object.values(s.press)) { add(pm.dialogue); add(pm.repeat_dialogue); }
      if (s.lie) { add(s.lie.breakdown); add(s.lie.wrong_evidence_dialogue); }
      add(s.wrong_objection_dialogue);
      add(s.hint);
    }
  }
  if (c.dialogue && typeof c.dialogue === "object") for (const id of Object.keys(c.dialogue)) if (!ref.has(id)) ctx.err(`dialogue "${id}" is orphaned (never referenced)`);
}

/* ------------------------------------------------------------- entry ----- */

export function validateCase(c, name = "case") {
  const ctx = new Ctx(name);
  if (!c || typeof c !== "object") { ctx.err("file is empty or not a YAML mapping"); return { errors: ctx.errors, warnings: ctx.warnings }; }
  checkStructural(ctx, c);
  checkTextBudget(ctx, c);
  checkReachability(ctx, c);
  checkFlags(ctx, c);
  checkDialogueOrphans(ctx, c);
  return { errors: ctx.errors, warnings: ctx.warnings };
}

export function validateFile(path) {
  let c;
  try { c = yaml.load(readFileSync(path, "utf8")); } catch (err) { return { errors: [`YAML parse error: ${err.message}`], warnings: [] }; }
  return validateCase(c, path);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  let files = process.argv.slice(2);
  if (files.length === 0) {
    const dir = join(root, "cases");
    files = existsSync(dir) ? readdirSync(dir).filter((f) => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.includes("skeleton")).map((f) => join(dir, f)) : [];
  }
  let total = 0;
  for (const f of files) {
    const { errors, warnings } = validateFile(f);
    if (errors.length === 0 && warnings.length === 0) console.log(`✓ ${f} — OK`);
    else {
      console.log(`\n${f}`);
      for (const w of warnings) console.log(`  warn  ${w}`);
      for (const e of errors) console.log(`  ERROR ${e}`);
    }
    total += errors.length;
  }
  console.log(`\n${total === 0 ? "VALIDATION PASSED" : `VALIDATION FAILED (${total} error(s))`}`);
  process.exit(total === 0 ? 0 : 1);
}
