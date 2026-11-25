// Demo scripts: YAML (or JSON) files describing one clip. This module loads
// a script, fills in defaults and checks every step, so mistakes surface
// before a browser opens. The format is documented in docs/SCRIPT.md;
// keep the two in sync.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const STEP_OPS = {
  card: "full-screen title card: {title, subtitle?, duration?, background?}",
  caption: "caption text (string), null to clear, or {text, position: bottom|top, duration?}",
  wait: "pause in milliseconds",
  click: "Playwright selector, or {selector, double?, label?}; the cursor glides there first",
  move: "glide the cursor to a selector without clicking",
  type: "text typed at a human pace, or {text | content, paragraph?, words?, into?, wpm?}",
  paste: "text inserted at once (HUD shows ⌘V), or {text | content, paragraph?, words?, into?}",
  press: "key combo such as Meta+S, or {keys, label?, times?, silent?}; shown in the keystroke HUD unless silent",
  highlight: "selector, or {selector, duration?}: a ring around an element",
  scroll: "{by: pixels, selector?, duration?}: smooth scroll of the page or an element",
  waitFor: "selector, or {selector, state?, timeout?}: wait for an element (not shown)",
  eval: "JavaScript run in the page (hand-written scripts only)",
};

const DEFAULTS = {
  viewport: { width: 1280, height: 800 },
  scale: 2,
  fps: 30,
  lead: 600, // ms of still app before the first step
  tail: 1400, // ms held after the last step
  typing: { wpm: 80, jitter: 0.35, seed: 7 },
  overlay: { hudTheme: "dark", cursor: true, accent: "#5b6cf0" },
};

export function loadScript(file) {
  const raw = fs.readFileSync(file, "utf8");
  const data = file.endsWith(".json") ? JSON.parse(raw) : YAML.parse(raw);
  return normalize(data, { file });
}

export function parseScript(text) {
  return normalize(YAML.parse(text), {});
}

export function normalize(data, { file } = {}) {
  const errors = [];
  if (!data || typeof data !== "object") throw new ScriptError(["Script is empty or not a mapping"]);
  if (!data.app) errors.push("`app` is required (e.g. app: hush)");
  if (!Array.isArray(data.steps) || data.steps.length === 0) errors.push("`steps` must be a non-empty list");

  const base = file ? path.basename(file).replace(/\.(ya?ml|json)$/, "") : "demo";
  const outputs = [].concat(data.output || `out/${base}.mp4`);
  for (const o of outputs) if (!/\.(mp4|webm|gif)$/i.test(o)) errors.push(`output "${o}" must end in .mp4, .webm or .gif`);

  const content = [].concat(data.content || []).map((c, i) => {
    if (typeof c === "string") return { ref: c };
    if (c && typeof c === "object" && c.content) return { ref: c.content, title: c.title };
    errors.push(`content[${i}] should be "pack/item" or {content: "pack/item", title?}`);
    return null;
  }).filter(Boolean);

  const steps = (data.steps || []).map((s, i) => normalizeStep(s, i, errors));
  if (errors.length) throw new ScriptError(errors);

  return {
    ...DEFAULTS,
    ...data,
    viewport: { ...DEFAULTS.viewport, ...(data.viewport || {}) },
    typing: { ...DEFAULTS.typing, ...(data.typing || {}) },
    overlay: { ...DEFAULTS.overlay, ...(data.overlay || {}) },
    outputs,
    content,
    steps,
    file,
  };
}

function normalizeStep(step, i, errors) {
  const where = `steps[${i}]`;
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
  if (extra.length) errors.push(`${where}: unknown key(s) ${extra.join(", ")} (put options inside the action, e.g. {press: {keys: Meta+S, label: Focus}})`);
  const op = ops[0];
  const v = step[op];
  const s = { op, index: i, note: step.note };
  const need = (cond, msg) => { if (!cond) errors.push(`${where} (${op}): ${msg}`); };

  switch (op) {
    case "card":
      if (typeof v === "string") Object.assign(s, { title: v });
      else Object.assign(s, v);
      need(s.title, "needs a title");
      s.duration ??= 2200;
      break;
    case "caption":
      if (v == null || v === false) s.text = null;
      else if (typeof v === "string") s.text = v;
      else Object.assign(s, v);
      s.position ??= "bottom";
      break;
    case "wait":
      s.ms = Number(v);
      need(Number.isFinite(s.ms) && s.ms >= 0, "needs a number of milliseconds");
      break;
    case "click":
    case "move":
    case "highlight":
    case "waitFor":
      if (typeof v === "string") s.selector = v;
      else Object.assign(s, v);
      need(typeof s.selector === "string" && s.selector, "needs a selector");
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
      Object.assign(s, typeof v === "number" ? { by: v } : v);
      need(Number.isFinite(s.by), "needs by: <pixels>");
      s.duration ??= 900;
      break;
    case "eval":
      need(typeof v === "string", "needs JavaScript source as a string");
      s.code = v;
      break;
  }
  return s;
}

export class ScriptError extends Error {
  constructor(errors) {
    super("Script has problems:\n  - " + errors.join("\n  - "));
    this.errors = errors;
  }
}
