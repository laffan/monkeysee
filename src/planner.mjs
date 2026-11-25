// Turns a plain-language request ("show focus mode in hush with Moby Dick")
// into a demo script, using Claude through the Anthropic API.
//
// The model gets: the script format (docs/SCRIPT.md), the app adapter's
// guide (selectors and shortcuts), the content packs, and what the app
// actually looks like right now (a screenshot plus an accessibility
// snapshot and a list of clickable elements with selectors). It answers
// with YAML. Then we validate it and, with --check, dry-run it in the real
// app; any error goes back to the model for a fix, at most twice.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import YAML from "yaml";
import { getApp } from "./apps/index.mjs";
import { listPacks } from "./content.mjs";
import { normalize, ScriptError } from "./script.mjs";
import { withApp, describePage } from "./session.mjs";
import { runSteps } from "./runner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.MONKEYSEE_MODEL || "claude-opus-5-5";
const MAX_REPAIRS = 2;

const SYSTEM = `You write demo scripts for monkeysee, a tool that records short promotional
videos of app features. A script is YAML that drives a real browser running the app:
a visible cursor glides and clicks, text is typed at a human pace, and every shortcut
appears on screen in a keystroke HUD with an optional label.

Write for a viewer who has never seen the app: one feature per clip, 8 to 25 seconds,
a clear before and after, short captions in plain words (or none), and labels on
shortcuts that name the feature ("Focus Mode"). Let effects breathe with waits of
800 to 2000 ms after something changes. Prefer showing a feature through its keyboard
shortcut when it has one. Use the themed content packs for anything typed or shown.

Only use selectors you can see in the page description or the app guide. Do not use
eval steps. Reply with the complete script in one \`\`\`yaml block and nothing after it.`;

export async function plan({ request, appName, contentRefs = [], check = true, appDir, log = console.error }) {
  const app = getApp(appName);
  const formatDoc = fs.readFileSync(path.resolve(here, "..", "docs", "SCRIPT.md"), "utf8");
  const packs = listPacks().map((p) => ({
    pack: p.name,
    title: p.title,
    items: Object.entries(p.items || {}).map(([k, v]) => `${p.name}/${k} (${v.title || k})`),
  }));

  const probe = normalize({ app: appName, content: contentRefs, viewport: { width: 1280, height: 800 }, scale: 1, steps: [{ wait: 0 }] });
  log(`Opening ${app.title} to see what's on screen…`);
  const start = await withApp(probe, { appDir }, async ({ page }) => ({
    shot: (await page.screenshot({ type: "jpeg", quality: 80 })).toString("base64"),
    ...(await describePage(page)),
  }));

  const client = new Anthropic();
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: `# Script format\n\n${formatDoc}` },
      { type: "text", text: `# App: ${app.title} (app: ${app.name})\n${app.guide}` },
      { type: "text", text: `# Content packs\n${YAML.stringify(packs)}\nContent seeded at start: ${JSON.stringify(contentRefs.length ? contentRefs : app.defaultContent || [])}` },
      { type: "text", text: "# The app as it looks at the start of the clip (1280x800):" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: start.shot } },
      { type: "text", text: `Accessibility snapshot:\n${start.aria}\n\nVisible interactive elements:\n${YAML.stringify(start.elements)}` },
      { type: "text", text: `# Request\n${request}` },
    ],
  }];

  for (let attempt = 0; ; attempt++) {
    log(attempt === 0 ? `Asking ${MODEL} for a script…` : `Asking for a fix (attempt ${attempt} of ${MAX_REPAIRS})…`);
    const response = await ask(client, messages);
    messages.push({ role: "assistant", content: response.content });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const yaml = (text.match(/```ya?ml\s*\n([\s\S]*?)```/) || [])[1];

    let problem = null;
    let script = null;
    if (!yaml) problem = "I couldn't find a ```yaml block in your reply.";
    else {
      try {
        script = normalize({ ...YAML.parse(yaml), app: appName });
      } catch (err) {
        problem = err instanceof ScriptError ? err.message : `The YAML doesn't parse: ${err.message}`;
      }
    }
    if (!problem && check) {
      log("Dry-running the script in the app…");
      problem = await dryRun(script, appDir);
    }
    if (!problem) return { yaml: yaml.trim() + "\n", script };
    if (attempt >= MAX_REPAIRS) throw new Error(`The planned script still fails after ${MAX_REPAIRS} fixes:\n${problem.text || problem}`);
    log(`Problem: ${(problem.text || problem).split("\n")[0]}`);
    const feedback = [{ type: "text", text: `That script has a problem. Fix it and reply with the whole script again.\n\n${problem.text || problem}` }];
    if (problem.shot) feedback.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: problem.shot } });
    messages.push({ role: "user", content: feedback });
  }
}

async function ask(client, messages) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "high" },
    // If a safety classifier declines the request, the API retries it on a
    // fallback model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages,
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") {
    throw new Error(`The model declined to write this script${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("The model ran out of room before finishing the script.");
  return response;
}

// Runs the script fast against the real app. On failure returns the error,
// what the page looked like at that moment, and its selectors.
async function dryRun(script, appDir) {
  const fast = { ...script, scale: 1 };
  return withApp(fast, { appDir }, async ({ page }) => {
    try {
      await runSteps(page, fast, { fast: true });
      return null;
    } catch (err) {
      const shot = (await page.screenshot({ type: "jpeg", quality: 70 })).toString("base64");
      const now = await describePage(page);
      return {
        text: `${err.message}\n\nThe screenshot shows the page when it failed. Elements visible then:\n${YAML.stringify(now.elements)}`,
        shot,
      };
    }
  });
}
