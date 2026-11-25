#!/usr/bin/env node
// monkeysee: record short feature demos of web and Tauri app frontends.
//
//   monkeysee record <demos/app/x.yml> [--app-dir DIR] [--headed]
//   monkeysee check  <demos/app/x.yml>       run setup and steps fast, no video
//   monkeysee plan   <demos/app/x.yml> [--record] [--no-check]
//                                            script a spec with the Claude API
//   monkeysee inspect --app hush [--content pequod/*]
//   monkeysee fetch-content                  download full public-domain texts
//   monkeysee apps | packs
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadScript, normalize } from "./script.mjs";
import { runSteps } from "./runner.mjs";
import { startRecording, finish } from "./recorder.mjs";
import { withApp, describePage } from "./session.mjs";
import { appNames, getApp } from "./apps/index.mjs";
import { listPacks, fetchAll } from "./content.mjs";
import YAML from "yaml";

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    app: { type: "string" },
    "app-dir": { type: "string" },
    content: { type: "string", multiple: true },
    output: { type: "string", short: "o" },
    record: { type: "boolean" },
    "no-check": { type: "boolean" },
    headed: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const [cmd, ...rest] = positionals;
const appDir = opt["app-dir"];

const commands = {
  async record(file) {
    if (!file) usage("record needs a script file");
    const script = loadScript(file);
    const out = await record(script);
    console.log(out.join("\n"));
  },

  async check(file) {
    if (!file) usage("check needs a script file");
    const script = { ...loadScript(file), scale: 1 };
    await withApp(script, { appDir, headless: !opt.headed }, async ({ page }) => {
      const onStep = (s) => log(`  ${s.list} ${s.index + 1}. ${s.op}`);
      await runSteps(page, script, { fast: true, steps: script.setup, onStep });
      await runSteps(page, script, { fast: true, onStep });
    });
    log(`OK: ${script.setup.length} setup and ${script.steps.length} recorded steps ran.`);
  },

  async inspect() {
    if (!opt.app) usage("inspect needs --app");
    const script = normalize({ app: opt.app, content: opt.content || [], scale: 1, steps: [{ wait: 0 }] });
    const shotPath = path.resolve(`out/inspect-${opt.app}.png`);
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    await withApp(script, { appDir, headless: !opt.headed }, async ({ page, app }) => {
      await page.screenshot({ path: shotPath });
      const { aria, elements } = await describePage(page);
      console.log(`# ${app.title}: starting state\n\nScreenshot: ${shotPath}\n\n## Guide\n${app.guide}\n## Accessibility snapshot\n${aria}\n\n## Visible interactive elements\n${YAML.stringify(elements)}`);
    });
  },

  async plan(file) {
    if (!file) usage("plan needs a spec file, e.g. plan demos/hush/panes.yml");
    const spec = loadScript(file, { spec: true });
    if (!spec.description.length) usage(`${file} has no description: list the clip's beats under description:`);
    const { plan } = await import("./planner.mjs");
    const { yaml } = await plan({ spec, check: !opt["no-check"], appDir, log });
    fs.writeFileSync(file, `${specPart(fs.readFileSync(file, "utf8"))}\n${SCRIPT_MARK}\n${yaml}`);
    log(`Wrote the script into ${file}`);
    if (opt.record) console.log((await record(loadScript(file))).join("\n"));
  },

  async "fetch-content"() { await fetchAll(); },
  async apps() { for (const n of appNames()) console.log(`${n}\t${getApp(n).title}\t${getApp(n).url}`); },
  async packs() { for (const p of listPacks()) console.log(`${p.name}\t${Object.keys(p.items || {}).join(", ")}\t${p.title}`); },
};

const SCRIPT_MARK = "# Script (written from the spec above; edit freely) ------------------------";

// The person-written top of a file: everything before the script marker,
// or, in a file without one, before the first content/setup/steps key.
function specPart(text) {
  const i = text.indexOf(SCRIPT_MARK);
  if (i >= 0) return text.slice(0, i).trimEnd() + "\n";
  const m = text.match(/^(content|setup|steps|typing):/m);
  return (m ? text.slice(0, m.index) : text).trimEnd() + "\n";
}

async function record(script) {
  const t0 = Date.now();
  log(`Recording ${script.file || script.app} (${script.steps.length} steps)…`);
  return withApp(script, { appDir, headless: !opt.headed }, async ({ page }) => {
    if (script.setup.length) {
      log("  setup…");
      await runSteps(page, script, { fast: true, steps: script.setup });
      await page.mouse.move(script.viewport.width * 0.62, script.viewport.height * 0.7);
      await page.waitForTimeout(600);
    }
    const rec = await startRecording(page, {
      output: script.outputs[0], fps: script.fps,
      width: script.viewport.width, height: script.viewport.height, scale: script.scale,
    });
    try {
      await page.waitForTimeout(script.lead);
      await runSteps(page, script, { onStep: (s) => log(`  ${s.index + 1}. ${s.op}${s.note ? `  (${s.note})` : ""}`) });
      await page.waitForTimeout(script.tail);
    } catch (err) {
      await rec.stop().catch(() => {});
      throw err;
    }
    const seconds = (rec.elapsed() / 1000).toFixed(1);
    const raw = await rec.stop();
    const outs = await finish(raw, script.outputs);
    log(`Done: ${seconds}s clip, rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
    return outs;
  });
}

function log(...a) { console.error(...a); }
function usage(msg) {
  if (msg) console.error(msg + "\n");
  console.error(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(msg ? 1 : 0);
}

if (opt.help || !cmd) usage();
if (!commands[cmd]) usage(`Unknown command "${cmd}"`);
commands[cmd](...rest).catch((err) => {
  console.error(`\n${err.message}`);
  if (process.env.MONKEYSEE_DEBUG) console.error(err.stack);
  process.exit(1);
});
