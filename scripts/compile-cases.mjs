/*
 * compile-cases — author format (YAML) -> runtime format (JSON).
 *
 * The browser runtime never sees YAML and never imports js-yaml; it consumes
 * the compiled JSON only. This step is the single place js-yaml is used.
 *
 *   cases/*.yaml  ->  dist-cases/*.json
 *
 * This is a straight parse-and-serialize: no transformation, no validation.
 * Correctness is the validator's job (`npm run validate`).
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import yaml from "js-yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "cases");
const outDir = join(root, "dist-cases");

/**
 * Compile all case YAML -> JSON. Pass { exitOnError:false } (used by the dev
 * watch plugin) to throw instead of process.exit, so a bad save doesn't kill
 * the dev server.
 */
export function compileAll({ exitOnError = true, quiet = false } = {}) {
  const log = quiet ? () => {} : (m) => console.log(m);
  const fail = (msg) => {
    if (exitOnError) {
      console.error(msg);
      process.exit(1);
    }
    throw new Error(msg);
  };

  if (!existsSync(srcDir)) return fail(`No cases/ directory at ${srcDir}`);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(srcDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (files.length === 0) return fail("No .yaml case files found in cases/");

  let count = 0;
  for (const file of files) {
    if (file.includes("skeleton")) {
      log(`skip  ${file} (skeleton template)`);
      continue;
    }
    const text = readFileSync(join(srcDir, file), "utf8");
    let data;
    try {
      data = yaml.load(text);
    } catch (err) {
      return fail(`YAML parse error in ${file}: ${err.message}`);
    }
    const outName = basename(file).replace(/\.ya?ml$/, ".json");
    writeFileSync(join(outDir, outName), JSON.stringify(data, null, 2) + "\n");
    log(`ok    ${file} -> dist-cases/${outName}`);
    count++;
  }
  log(`\ncompiled ${count} case(s).`);
  return count;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) compileAll();
