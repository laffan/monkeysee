// App adapters. Each one says how to start the app's frontend, how to seed
// demo content into it, when it is ready, and gives the planner a short
// guide to its selectors and shortcuts. See docs/DESIGN.md ("Adapters").
//
// monkeysee ships one adapter, the built-in notepad fixture. Real apps'
// adapters live in a workspace (see ../workspace.mjs), as <app>.mjs files
// whose default export is the adapter.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fixture from "./fixture.mjs";
import { workspace } from "../workspace.mjs";

const builtins = { fixture };

export async function loadApp(name) {
  const ws = workspace();
  const file = ws && path.join(ws.adapters, `${name}.mjs`);
  if (file && fs.existsSync(file)) {
    const app = (await import(pathToFileURL(file).href)).default;
    if (!app?.name) throw new Error(`${file} should export default an adapter object with a name`);
    return app;
  }
  if (builtins[name]) return builtins[name];
  throw new Error(`Unknown app "${name}". Known apps: ${appNames().join(", ")}` +
    (ws ? "" : ". No workspace was found: run from a folder with a monkeysee.json, or pass --workspace."));
}

export function appNames() {
  const ws = workspace();
  const local = ws && fs.existsSync(ws.adapters)
    ? fs.readdirSync(ws.adapters).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4))
    : [];
  return [...new Set([...local, ...Object.keys(builtins)])];
}
