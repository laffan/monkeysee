// Shared plumbing for the CLI commands: resolve content, start the app,
// open it in a browser, and tidy up afterwards.
import { loadApp } from "./apps/index.mjs";
import { loadItem, packRefs } from "./content.mjs";
import { launch, openApp, ensureServer, stopServer } from "./browser.mjs";

export function resolveContent(script, app) {
  const given = script.content.length ? script.content : (app.defaultContent || []).map((ref) => ({ ref }));
  // "pack/*" stands for every item in the pack.
  const refs = given.flatMap((c) => (c.ref.endsWith("/*") ? packRefs(c.ref.slice(0, -2)).map((ref) => ({ ref })) : [c]));
  return refs.map(({ ref, title }) => {
    const item = loadItem(ref);
    return { ...item, title: title || item.title };
  });
}

export async function withApp(script, { appDir, headless = true } = {}, fn) {
  const app = await loadApp(script.app);
  const content = resolveContent(script, app);
  const server = await ensureServer(app, { appDir });
  const browser = await launch({ headless, viewport: script.viewport, scale: script.scale });
  try {
    const { page } = await openApp(browser, app, script, { content, appDir });
    return await fn({ app, page, content });
  } finally {
    await browser.close().catch(() => {});
    stopServer(server);
  }
}

/** A compact map of what's on screen: visible interactive elements with a selector for each. */
export async function describePage(page) {
  const aria = await page.locator("body").ariaSnapshot().catch(() => "");
  const elements = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const q = "button, a[href], input, textarea, select, [role=button], [role=tab], [role=menuitem], [role=option], [contenteditable=true], [aria-label], [title]";
    for (const el of document.querySelectorAll(q)) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width < 4 || r.height < 4 || st.visibility === "hidden" || st.display === "none" || +st.opacity === 0) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const attr = (n) => el.getAttribute(n);
      const css = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
      const tag = el.tagName.toLowerCase();
      const text = (el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 50);
      let sel;
      if (el.id) sel = `#${css(el.id)}`;
      else if (attr("aria-label")) sel = `${tag}[aria-label="${attr("aria-label")}"]`;
      else if (attr("placeholder")) sel = `${tag}[placeholder="${attr("placeholder")}"]`;
      else if (attr("title")) sel = `${tag}[title="${attr("title")}"]`;
      else if (el.classList.length) sel = `${tag}.${[...el.classList].slice(0, 2).map(css).join(".")}`;
      else if (text) sel = `${tag}:has-text("${text.slice(0, 30)}")`;
      else continue;
      if (seen.has(sel)) continue;
      seen.add(sel);
      out.push({ selector: sel, text, box: [r.x, r.y, r.width, r.height].map(Math.round) });
      if (out.length >= 80) break;
    }
    return out;
  });
  return { aria, elements };
}
