// One YAML file per video. The top half is written by a person and says
// what the video shows; the bottom half is the script that plays it,
// written by a model (monkeysee plan, or Claude Code) and editable by hand:
//
//   feature: panes                     # what the clip is about
//   app: hush                          # optional when the file is in <workspace>/<app>/ or demos/<app>/
//   state: left sidebar open, ten demo text and notebook files
//   description:                       # the beats, in order
//     - working on text document
//     - open notebook with flowchart and notes as a pane
//
//   content: [pequod/*]                # what the app is seeded with
//   setup:   [...]                     # steps run before recording starts
//   steps:   [...]                     # steps that are recorded
//
// A file with only the top half is a spec waiting to be scripted. The
// format is documented in docs/SCRIPT.md; keep the two in sync.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { workspace } from "./workspace.mjs";

export const STEP_OPS = {
  wait: "pause in milliseconds",
  click: "Playwright selector, [x, y] in viewport pixels, or {selector | at, double?, keys?, button?: right}; the cursor glides there first",
  move: "glide the cursor to a selector or [x, y] without clicking",
  drag: "{from, to, via?, keys?, duration?, nudge?}: press on `from`, glide (through the [x, y] points in `via`) to `to`, release; from/to are selectors or [x, y]; keys (e.g. Meta) are held through the drop and shown; nudge: false skips the small opening move (for pen strokes)",
  type: "text typed at a human pace, or {text | content, paragraph?, words?, into?, wpm?}",
  paste: "text inserted at once (the HUD shows ⌘V), or {text | content, paragraph?, words?, into?}",
  press: "key combo such as Meta+S, or {keys, times?, silent?}; shown in the keystroke HUD unless silent",
  scroll: "{by: pixels or [dx, dy], at?, selector?, duration?}: smooth wheel scroll with the cursor over `at` (or the page); `selector` scrolls that element's scrollTop instead",
  waitFor: "selector, or {selector, state?, timeout?}: wait for an element (not shown)",
  eval: "JavaScript run in the page (hand-written scripts only)",
};

const SPEC_KEYS = ["feature", "app", "state", "description"];

const DEFAULTS = {
  viewport: { width: 1280, height: 800 },
  scale: 2,
  fps: 30,
  lead: 600, // ms of still app before the first step
  tail: 1400, // ms held after the last step
  typing: { wpm: 80, jitter: 0.35, seed: 7 },
  overlay: { hudTheme: "dark", cursor: true },
};

export function loadScript(file, opts) {
  const raw = fs.readFileSync(file, "utf8");
  const data = file.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
  return normalize(data, { file, ...opts });
}

export function parseScript(text, opts) {
  return normalize(YAML.parse(text), opts);
}

/** The person-written half of a file, as the planner shows it to a model. */
export function specOf(script) {
  return Object.fromEntries(SPEC_KEYS.filter((k) => script[k] != null).map((k) => [k, script[k]]));
}

/**
 * Validates and fills defaults. With {spec: true} a file without steps is
 * accepted (scripted: false), for the planner to fill in.
 */
export function normalize(data, { file, spec = false } = {}) {
  const errors = [];
  if (!data || typeof data !== "object") throw new ScriptError(["File is empty or not a mapping"]);

  const app = data.app || appFromPath(file);
  if (!app) errors.push("`app` is required (or put the file in a folder named after the app, in the workspace)");
  const feature = data.feature || (file ? path.basename(file).replace(/\.(ya?ml|json)$/, "") : "demo");
  const scripted = Array.isArray(data.steps) && data.steps.length > 0;
  if (!scripted && !spec) {
    errors.push("`steps` is empty: this is a spec that hasn't been scripted yet. Run `monkeysee plan <file>`, or ask Claude Code to script it (see CLAUDE.md).");
  }
  for (const k of ["card", "caption", "highlight"]) {
    if ([...(data.setup || []), ...(data.steps || [])].some((s) => s && typeof s === "object" && k in s)) {
      errors.push(`\`${k}\` steps were removed: clips show only the keyboard shortcuts`);
    }
  }

  const outputs = [].concat(data.output || defaultOutput(app || "app", slug(feature)));
  for (const o of outputs) if (!/\.(mp4|webm|gif)$/i.test(o)) errors.push(`output "${o}" must end in .mp4, .webm or .gif`);

  const content = [].concat(data.content || []).map((c, i) => {
    if (typeof c === "string") return { ref: c };
    if (c && typeof c === "object" && c.content) return { ref: c.content, title: c.title };
    errors.push(`content[${i}] should be "pack/item", "pack/*" or {content: "pack/item", title?}`);
    return null;
  }).filter(Boolean);

  const setup = [].concat(data.setup || []).map((s, i) => normalizeStep(s, i, errors, "setup"));
  const steps = [].concat(data.steps || []).map((s, i) => normalizeStep(s, i, errors, "steps"));
  if (errors.length) throw new ScriptError(errors);

  return {
    ...DEFAULTS,
    ...data,
    app,
    feature,
    description: [].concat(data.description || []),
    viewport: { ...DEFAULTS.viewport, ...(data.viewport || {}) },
    typing: { ...DEFAULTS.typing, ...(data.typing || {}) },
    overlay: { ...DEFAULTS.overlay, ...(data.overlay || {}) },
    outputs,
    content,
    setup,
    steps,
    scripted,
    file,
  };
}

// The workspace's "output" pattern ({app}, {feature}), else out/<app>-<feature>.mp4.
function defaultOutput(app, feature) {
  const pattern = workspace()?.output;
  return pattern ? pattern.replaceAll("{app}", app).replaceAll("{feature}", feature) : `out/${app}-${feature}.mp4`;
}

function appFromPath(file) {
  if (!file) return null;
  const ws = workspace();
  if (ws) {
    const rel = path.relative(ws.root, path.resolve(file)).split(path.sep);
    if (rel.length >= 2 && rel[0] !== "..") return rel[0];
  }
  const parts = path.resolve(file).split(path.sep);
  const i = parts.lastIndexOf("demos");
  return i >= 0 && i < parts.length - 2 ? parts[i + 1] : null;
}

function normalizeStep(step, i, errors, list) {
  const where = `${list}[${i}]`;
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    errors.push(`${where}: each step is a mapping with one action, e.g. {press: Meta+S}`);
    return null;
  }
  const ops = Object.keys(step).filter((k) => k in STEP_OPS);
  const extra = Object.keys(step).filter((k) => !(k in STEP_OPS) && k !== "note");
  if (ops.length !== 1) {
    errors.push(`${where}: expected exactly one action (${Object.keys(STEP_OPS).join(", ")}), got ${JSON.stringify(Object.keys(step))}`);
    return null;
  }
  if (extra.length) errors.push(`${where}: unknown key(s) ${extra.join(", ")} (put options inside the action, e.g. {press: {keys: Meta+S, times: 2}})`);
  const op = ops[0];
  const v = step[op];
  const s = { op, index: i, list, note: step.note };
  const need = (cond, msg) => { if (!cond) errors.push(`${where} (${op}): ${msg}`); };
  const point = (p) => typeof p === "string" || (Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));

  switch (op) {
    case "wait":
      s.ms = Number(v);
      need(Number.isFinite(s.ms) && s.ms >= 0, "needs a number of milliseconds");
      break;
    case "click":
    case "move":
    case "waitFor":
      if (typeof v === "string") s.selector = v;
      else if (Array.isArray(v)) s.at = v;
      else Object.assign(s, v);
      if (op === "waitFor" || !point(s.at)) need(typeof s.selector === "string" && s.selector, op === "waitFor" ? "needs a selector" : "needs a selector or [x, y]");
      break;
    case "drag":
      Object.assign(s, v);
      need(point(s.from), "needs from: a selector or [x, y]");
      need(point(s.to), "needs to: a selector or [x, y]");
      need(s.via == null || (Array.isArray(s.via) && s.via.every((p) => Array.isArray(p) && p.length === 2)), "via should be a list of [x, y] points");
      s.duration ??= 900;
      break;
    case "type":
    case "paste":
      if (typeof v === "string") s.text = v;
      else Object.assign(s, v);
      need(typeof s.text === "string" || typeof s.content === "string", "needs text or content: pack/item");
      break;
    case "press":
      if (typeof v === "string") s.keys = v;
      else Object.assign(s, v);
      need(typeof s.keys === "string" && s.keys, "needs keys, e.g. Meta+S");
      s.times ??= 1;
      break;
    case "scroll":
      Object.assign(s, typeof v === "number" || Array.isArray(v) ? { by: v } : v);
      if (Number.isFinite(s.by)) s.by = [0, s.by];
      need(Array.isArray(s.by) && s.by.length === 2 && s.by.every(Number.isFinite), "needs by: <pixels> or [dx, dy]");
      s.duration ??= 900;
      break;
    case "eval":
      need(typeof v === "string", "needs JavaScript source as a string");
      s.code = v;
      break;
  }
  return s;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "demo";
}

export class ScriptError extends Error {
  constructor(errors) {
    super("Script has problems:\n  - " + errors.join("\n  - "));
    this.errors = errors;
  }
}
