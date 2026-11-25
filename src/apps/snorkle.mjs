// Snorkle (laffan/snorkle): a macOS browser with a notebook, view modes,
// Save for Later and research sessions. Its chrome (ui/) is plain HTML
// and JavaScript served from the checkout; the native side, which
// natively draws web pages in WKWebViews beside the chrome, is played by
// snorkle-sim.js: tabs show content-pack pages in frames, and the
// notebook's page code and the view modes' CSS are read verbatim from the
// checkout's Rust sources, so they behave as they do in the app.
//
// Content items are pages (kind "page", with a url and a site), e.g. the
// shoreline pack. appOptions set the starting browser:
//   tabs:      [url, ...]                 everyday tabs, in order
//   active:    index into tabs
//   research:  [{name, tabs: [url]}]      research sessions
//   space:     1-based research session to start in
//   later:     [{url, pages: [url], minutesAgo}]   Save for Later items
//   history:   [{url, minutesAgo}]
//   pins:      [url]     bookmarks: [url]
//   modes:     {desaturate, hide_media}
//   notebookOpen: true   (the everyday notebook pane)
//   notebooks: {"": json, r1: json}       saved notebooks per session
//   prefs:     {key: value}               the chrome's localStorage
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPack } from "../content.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SIM = fs.readFileSync(path.join(here, "snorkle-sim.js"), "utf8");

// ---- Snorkle's own page code, from the checkout ------------------------------
function rustSource(dir, rel) {
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) throw new Error(`snorkle: ${file} not found (pass --app-dir /path/to/snorkle)`);
  return fs.readFileSync(file, "utf8");
}
/** The value of `const NAME: &str = r#"..."#;` */
function rawConst(src, name) {
  const m = new RegExp(`const ${name}: &str = r(#+)"([\\s\\S]*?)"\\1;`).exec(src);
  if (!m) throw new Error(`snorkle: ${name} not found`);
  return m[2];
}
/** The value of `const NAME: &str = "...";` or `= concat!("...", "...");` (comments skipped). */
function strConst(src, name) {
  const start = new RegExp(`const ${name}: &str = `).exec(src);
  if (!start) throw new Error(`snorkle: ${name} not found`);
  let i = start.index + start[0].length;
  const concat = src.startsWith("concat!(", i);
  if (concat) i += "concat!(".length;
  let out = "";
  for (;;) {
    // skip whitespace, commas and comments
    while (i < src.length) {
      if (/[\s,]/.test(src[i])) i++;
      else if (src.startsWith("//", i)) i = src.indexOf("\n", i) + 1;
      else if (src.startsWith("/*", i)) i = src.indexOf("*/", i) + 2;
      else break;
    }
    if (src[i] !== '"') break;
    i++;
    while (src[i] !== '"') {
      if (src[i] === "\\") {
        const c = src[i + 1];
        if (c === "\n") { i += 2; while (/\s/.test(src[i])) i++; continue; }
        out += { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", '"': '"', "'": "'" }[c] ?? c;
        i += 2;
      } else out += src[i++];
    }
    i++;
    if (!concat) break;
  }
  return out;
}
function snorkleCode(dir) {
  const nb = rustSource(dir, "crates/snorkle-core/src/notebook/mod.rs");
  const vm = rustSource(dir, "crates/snorkle-core/src/viewmodes/mod.rs");
  return {
    watch: rawConst(nb, "WATCH_JS").replaceAll("__HANDLER__", "snorkle"),
    css: { grayscale: strConst(vm, "GRAYSCALE_CSS"), noMedia: strConst(vm, "NO_MEDIA_CSS") },
  };
}

// ---- pages ------------------------------------------------------------------------
const MIME = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
function inlineImages(html, dir) {
  return html.replace(/(src|poster)="(?!https?:|data:)([^"]+)"/g, (all, attr, rel) => {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) return all;
    const mime = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    return `${attr}="data:${mime};base64,${fs.readFileSync(file).toString("base64")}"`;
  });
}
function buildPages(content) {
  const pages = {};
  const sites = {};
  for (const item of content) {
    if (!item.url) continue;
    const pack = readPack(item.pack);
    const site = (pack.sites || {})[item.site] || {};
    sites[item.site] = { icon: site.icon || null };
    const css = site.css ? fs.readFileSync(path.join(pack.dir, site.css), "utf8") : "";
    const body = inlineImages(item.text || "", pack.dir);
    const title = item.title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    pages[item.url] = {
      title: item.title,
      site: item.site,
      doc: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
        `<meta name="viewport" content="width=device-width"><style>${css}</style></head><body>${body}</body></html>`,
    };
  }
  return { pages, sites };
}

export default {
  name: "snorkle",
  title: "Snorkle",
  url: "http://localhost:5175/index.html",
  platform: "mac",
  server: {
    // The chrome is static files: serve ui/ from a snorkle checkout
    // (--app-dir, MONKEYSEE_SNORKLE_DIR, or ../snorkle).
    command: ["python3", "-m", "http.server", "5175", "--bind", "127.0.0.1", "--directory", "ui"],
    cwd: path.resolve(process.cwd(), "..", "snorkle"),
  },
  defaultContent: ["shoreline/*"],

  init(content, options, { appDir }) {
    const code = snorkleCode(appDir);
    const { pages, sites } = buildPages(content);
    const demo = { pages, sites, options, ...code };
    return `window.__snorkleDemo = ${JSON.stringify(demo)};\n${SIM}`;
  },

  async ready(page) {
    await page.waitForSelector("#tabs .tab, #start", { state: "attached", timeout: 20_000 });
    // Let the first page load and the chrome settle.
    await page.waitForTimeout(1200);
  },

  guide: `
Snorkle is a macOS web browser. The sidebar on the left holds pins (icons at the
top), then the tab list (same-site tabs grouped under a site heading), and buttons
at the bottom. The page shows to the right of the sidebar. Pages are demo pages
from the shoreline pack (whaleatlas.org, tidepoolguide.net, harborgazette.com,
seaforecast.net); their links work.

Selectors:
- Inside the page: prefix with "page: ", e.g. "page: a:has-text(\\"Why humpbacks sing\\")",
  "page: figure img >> nth=0". Points inside the page are window pixels as usual.
- Tab rows: "#tabs .tab:has-text(\\"humpback\\")"; its Save for Later button
  ".tab:has-text(\\"...\\") .row-actions button.later" shows on hover.
- View mode buttons: "#color" (no colour), "#images" (no images), "#dark".
- Notebook: "#notebook-btn" opens the notebook pane on the right.
- Research: "#research-btn" starts a session; ".rs-field" names it; ".rs-back"
  goes back to everyday tabs; ".rs-row .open" opens a session.
- History (Meta+Shift+H): "#later-section .later-card" are Save for Later items.

Shortcuts: Meta+I images on/off, Meta+Shift+H history, Meta+Shift+D send page to
notebook, Meta+T new tab, Meta+W close tab, Meta+Backslash sidebar.
Hold Alt over the page to outline what can be clipped; Alt+click clips it to the notebook.
`,
};
