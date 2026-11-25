// Launches Chromium, starts (or reuses) the app's dev server, and opens the
// app with its demo content seeded and the overlay installed.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tauriMockScript } from "./tauri-mock.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = fs.readFileSync(path.join(here, "overlay.js"), "utf8");

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function launch({ headless = true, viewport, scale = 1 } = {}) {
  // MONKEYSEE_CHROME lets you point at any Chrome/Chromium; otherwise
  // Playwright's own browser (npx playwright install chromium).
  const executablePath = process.env.MONKEYSEE_CHROME || undefined;
  // Chrome's screencast captures the window at the window's own pixel ratio,
  // not the emulated viewport, so the window has to match both.
  const size = viewport ? [`--window-size=${viewport.width},${viewport.height}`] : [];
  if (scale !== 1) size.push(`--force-device-scale-factor=${scale}`);
  return chromium.launch({ executablePath, headless, args: ["--no-sandbox", "--hide-scrollbars", "--font-render-hinting=none", ...size] });
}

/** Opens the app in a fresh context: overlay, platform spoof, Tauri mock and seeded content. */
export async function openApp(browser, app, script, { content = [] } = {}) {
  const { width, height } = script.viewport;
  const mac = (script.platform || app.platform || "mac") === "mac";
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: script.scale,
    colorScheme: script.colorScheme || app.colorScheme || "light",
    userAgent: mac ? MAC_UA : undefined,
    reducedMotion: "no-preference",
  });
  // Order matters: platform spoof and Tauri mock before any app code runs.
  if (mac) await context.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }));
  if (app.tauri) await context.addInitScript({ content: tauriMockScript(app.tauri) });
  if (app.seed) {
    const seed = app.seed(content, script.appOptions || {});
    if (seed) await context.addInitScript(seed.fn, seed.arg);
  }
  await context.addInitScript((o) => { window.__monkeyseeOptions = o; }, script.overlay);
  await context.addInitScript({ content: OVERLAY });

  const page = await context.newPage();
  page.on("pageerror", (e) => process.env.MONKEYSEE_DEBUG && console.warn("[page error]", e.message));
  await page.goto(app.url, { waitUntil: "load" });
  if (app.ready) await app.ready(page);
  await page.waitForTimeout(script.settle ?? 600);
  return { context, page };
}

/** Starts the app's dev server unless something already answers at its URL. */
export async function ensureServer(app, { appDir } = {}) {
  if (!app.server) return null;
  if (await reachable(app.url)) return null;
  const cwd = appDir || process.env[`MONKEYSEE_${app.name.toUpperCase().replace(/\W/g, "_")}_DIR`] || app.server.cwd;
  if (!cwd || !fs.existsSync(cwd)) {
    throw new Error(`${app.name}: nothing is answering at ${app.url} and no checkout was found. ` +
      `Start its dev server yourself, or pass --app-dir /path/to/${app.name}.`);
  }
  const [cmd, ...args] = app.server.command;
  const child = spawn(cmd, args, { cwd, stdio: process.env.MONKEYSEE_DEBUG ? "inherit" : "ignore", detached: true });
  const deadline = Date.now() + (app.server.timeoutMs || 60_000);
  while (Date.now() < deadline) {
    if (await reachable(app.url)) return child;
    await new Promise((r) => setTimeout(r, 400));
  }
  stopServer(child);
  throw new Error(`${app.name}: dev server did not come up at ${app.url}`);
}

export function stopServer(child) {
  if (!child) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
}

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}
