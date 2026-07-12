import { defineConfig, type PluginOption } from "vite";
import { readdirSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs scripts, no types
import { compileAll } from "./scripts/compile-cases.mjs";
// @ts-expect-error — plain .mjs scripts, no types
import { validateFile } from "./scripts/validate.mjs";

/**
 * Dev watch loop: recompile cases/*.yaml on save, validate, and either push the
 * schema errors to the page (shown in-game in ?dev=1) or full-reload with the
 * fresh case. Author sees a line change in-game within ~1-2s of saving.
 */
function casesWatch(): PluginOption {
  return {
    name: "dino-cases-watch",
    configureServer(server) {
      const dir = join(process.cwd(), "cases");
      const recompile = () => {
        let errors: string[] = [];
        try {
          compileAll({ exitOnError: false, quiet: true });
          const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && !f.includes("skeleton"));
          for (const f of files) {
            const res = validateFile(join(dir, f));
            for (const e of res.errors) errors.push(`${f}: ${e}`);
          }
        } catch (e) {
          errors = [String((e as Error).message ?? e)];
        }
        if (errors.length) {
          server.ws.send({ type: "custom", event: "dino:errors", data: errors });
        } else {
          server.ws.send({ type: "custom", event: "dino:ok" });
          server.ws.send({ type: "full-reload" });
        }
      };
      const onFs = (f: string) => {
        if (/cases[/\\][^/\\]*\.ya?ml$/.test(f)) recompile();
      };
      server.watcher.add(join(dir, "**", "*.yaml"));
      server.watcher.on("change", onFs);
      server.watcher.on("add", onFs);
    },
  };
}

export default defineConfig({
  plugins: [casesWatch()],
});
