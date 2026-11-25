#!/usr/bin/env node
// monkeysee: record short feature demos of web and Tauri app frontends.
//
//   monkeysee record <script.yaml> [--app-dir DIR] [--headed]
//   monkeysee check  <script.yaml>           run every step fast, no video
//   monkeysee inspect --app hush [--content moby-dick/chapter-1]
//   monkeysee plan "<what to show>" --app hush [-o demos/x.yaml] [--record] [--no-check]
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
      await runSteps(page, script, { fast: true, onStep: (s) => log(`  ${s.index + 1}. ${s.op}`) });
    });
    log(`OK: all ${script.steps.length} steps ran.`);
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

  async plan(...words) {
    const request = words.join(" ");
    if (!request || !opt.app) usage('plan needs a request and --app, e.g. plan "show focus mode" --app hush');
    const { plan } = await import("./planner.mjs");
    const { yaml, script } = await plan({ request, appName: opt.app, contentRefs: opt.content || [], check: !opt["no-check"], appDir, log });
    const file = opt.output || `demos/${slug(request)}.yaml`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `# Planned by monkeysee from: ${request}\n${yaml}`);
    log(`Wrote ${file}`);
    if (opt.record) console.log((await record(loadScript(file))).join("\n"));
    else void script;
  },

  async "fetch-content"() { await fetchAll(); },
  async apps() { for (const n of appNames()) console.log(`${n}\t${getApp(n).title}\t${getApp(n).url}`); },
  async packs() { for (const p of listPacks()) console.log(`${p.name}\t${Object.keys(p.items || {}).join(", ")}\t${p.title}`); },
};

async function record(script) {
  const t0 = Date.now();
  log(`Recording ${script.file || script.app} (${script.steps.length} steps)…`);
  return withApp(script, { appDir, headless: !opt.headed }, async ({ page }) => {
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
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "demo"; }
function usage(msg) {
  if (msg) console.error(msg + "\n");
  console.error(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 9).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(msg ? 1 : 0);
}

if (opt.help || !cmd) usage();
if (!commands[cmd]) usage(`Unknown command "${cmd}"`);
commands[cmd](...rest).catch((err) => {
  console.error(`\n${err.message}`);
  if (process.env.MONKEYSEE_DEBUG) console.error(err.stack);
  process.exit(1);
});
