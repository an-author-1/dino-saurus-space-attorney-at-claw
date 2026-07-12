#!/usr/bin/env node
/*
 * Test runner. The regression harness imports the TypeScript engine, so we
 * bundle it with esbuild (already present via Vite) and run the bundle — robust
 * regardless of Node's TS-loader quirks. Then the validator fixture tests run.
 */

import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

async function runBundled(entry) {
  const out = resolve("tests/.build", entry.replace(/[/\\]/g, "_").replace(/\.ts$/, ".mjs"));
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "warning",
  });
  await import(pathToFileURL(out).href);
}

let failed = false;
const origExit = process.exitCode;

// (1) Engine regression
await runBundled("tests/regression.ts");
if (process.exitCode && process.exitCode !== origExit) failed = true;

// (2) Validator fixture tests (plain Node; only if the validator exists yet)
if (existsSync(resolve("tests/validator.test.mjs"))) {
  process.exitCode = 0;
  await import(pathToFileURL(resolve("tests/validator.test.mjs")).href);
  if (process.exitCode) failed = true;
}

process.exitCode = failed ? 1 : 0;
