#!/usr/bin/env node
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
import yaml from "js-yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "cases");
const outDir = join(root, "dist-cases");

function compileAll() {
  if (!existsSync(srcDir)) {
    console.error(`No cases/ directory at ${srcDir}`);
    process.exit(1);
  }
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(srcDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (files.length === 0) {
    console.error("No .yaml case files found in cases/");
    process.exit(1);
  }

  let count = 0;
  for (const file of files) {
    // Skeletons are templates for authors, not compilable cases — skip them.
    if (file.includes("skeleton")) {
      console.log(`skip  ${file} (skeleton template)`);
      continue;
    }
    const text = readFileSync(join(srcDir, file), "utf8");
    let data;
    try {
      data = yaml.load(text);
    } catch (err) {
      console.error(`YAML parse error in ${file}: ${err.message}`);
      process.exit(1);
    }
    const outName = basename(file).replace(/\.ya?ml$/, ".json");
    writeFileSync(join(outDir, outName), JSON.stringify(data, null, 2) + "\n");
    console.log(`ok    ${file} -> dist-cases/${outName}`);
    count++;
  }
  console.log(`\ncompiled ${count} case(s).`);
}

compileAll();
