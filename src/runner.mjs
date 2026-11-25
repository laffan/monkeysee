// Plays a normalized script against an open page: glides the cursor,
// drags, types at a human pace, and presses shortcuts through the
// keystroke HUD. The HUD (keys only) and the cursor are the only things
// drawn over the app.
//
// In check mode (fast: true) it runs every step with waits and typing cut
// short, so a script can be validated in seconds before recording.
import { excerpt } from "./content.mjs";

export async function runSteps(page, script, { fast = false, onStep, steps = script.steps } = {}) {
  const ctx = new Ctx(page, script, fast);
  for (const step of steps) {
    onStep?.(step);
    try {
      await ctx.run(step);
    } catch (err) {
      const e = new Error(`${step.list || "steps"}[${step.index}] ${step.op} failed: ${err.message.split("\n")[0]}`);
      e.step = step;
      e.cause = err;
      throw e;
    }
  }
}

class Ctx {
  constructor(page, script, fast) {
    this.page = page;
    this.script = script;
    this.fast = fast;
    this.mouse = { x: script.viewport.width * 0.62, y: script.viewport.height * 0.7 };
    this.rand = mulberry32(script.typing.seed ?? 7);
    this.timeout = fast ? 4000 : 8000;
  }

  wait(ms) {
    return this.page.waitForTimeout(this.fast ? Math.min(ms, 60) : ms);
  }

  overlay(fn, ...args) {
    return this.page.evaluate(({ fn, args }) => window.__monkeysee?.[fn]?.(...args), { fn, args });
  }

  // A selector can reach into a frame: "frame(<frame css>) <selector>",
  // or "page: <selector>" for the page an app shows in its visible
  // content frame (see the app's guide).
  loc(selector) {
    const sel = String(selector);
    const pageFrame = this.script.pageFrame || "iframe:visible";
    let m = /^page:\s*(.+)$/s.exec(sel);
    if (m) return this.page.frameLocator(pageFrame).locator(m[1]).first();
    m = /^frame\((.+?)\)\s+(.+)$/s.exec(sel);
    if (m) return this.page.frameLocator(m[1]).locator(m[2]).first();
    return this.page.locator(sel).first();
  }

  async locate(selector) {
    const loc = this.loc(selector);
    await loc.waitFor({ state: "visible", timeout: this.timeout });
    return loc;
  }

  // Ease-in-out glide from the current cursor position to (x, y).
  // In fast runs (check, setup) a glide is one jump, except where `steps`
  // asks for a few moves: drags need them for the app to see a drag.
  async glide(x, y, duration, { steps = 0 } = {}) {
    const from = { ...this.mouse };
    if (this.fast && steps > 1) {
      for (let i = 1; i <= steps; i++) {
        await this.page.mouse.move(from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps);
        await this.page.waitForTimeout(16);
      }
      this.mouse = { x, y };
      return;
    }
    const dist = Math.hypot(x - from.x, y - from.y);
    const ms = this.fast ? 0 : duration ?? Math.min(900, 260 + dist * 0.9);
    // Paced by the clock, not by a frame count: when the page is slow to
    // answer each move (a sidebar re-rendering under a drag), the glide
    // skips positions instead of stretching out.
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const start = Date.now();
    for (;;) {
      const t = ms && !this.fast ? Math.min(1, (Date.now() - start) / ms) : 1;
      const e = ease(t);
      await this.page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      if (t >= 1) break;
      await this.page.waitForTimeout(16);
    }
    this.mouse = { x, y };
  }

  async glideTo(selector) {
    const loc = await this.locate(selector);
    await loc.scrollIntoViewIfNeeded({ timeout: this.timeout });
    const box = await loc.boundingBox();
    if (!box) throw new Error(`${selector} has no box on screen`);
    // Aim a little left of centre for wide elements (text areas, rows), as a person would.
    const x = box.x + Math.min(box.width / 2, 40 + box.width * 0.25);
    const y = box.y + Math.min(box.height / 2, 28);
    await this.glide(x, y);
    return { loc, box };
  }

  // A drag end: [x, y] in viewport pixels, or a selector (left of centre
  // like a click, or its centre for a drop target).
  async pointOf(p, { aim } = {}) {
    if (Array.isArray(p)) return { x: p[0], y: p[1] };
    const loc = await this.locate(p);
    await loc.scrollIntoViewIfNeeded({ timeout: this.timeout });
    const box = await loc.boundingBox();
    if (!box) throw new Error(`${p} has no box on screen`);
    if (aim === "centre") return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    return { x: box.x + Math.min(box.width / 2, 40 + box.width * 0.25), y: box.y + Math.min(box.height / 2, 28) };
  }

  resolveText(s) {
    if (s.text != null) return s.text;
    return excerpt(s.content, { paragraph: s.paragraph, paragraphs: s.paragraphs, words: s.words, chars: s.chars }).text;
  }

  async run(s) {
    const { page } = this;
    switch (s.op) {
      case "wait":
        await this.wait(s.ms);
        break;
      case "move":
        if (s.at) await this.glide(...s.at);
        else await this.glideTo(s.selector);
        break;
      case "click": {
        if (s.at) await this.glide(...s.at);
        else await this.glideTo(s.selector);
        await this.wait(120);
        // Modifier keys held through the click (e.g. ⌘-double-click) show
        // in the HUD like a key press.
        const mods = s.keys ? String(s.keys).split("+").filter(Boolean) : [];
        if (mods.length) {
          await this.overlay("showKeys", s.keys, "", 1600);
          await this.wait(220);
        }
        for (const m of mods) await page.keyboard.down(m);
        if (mods.length) {
          // A small move with the keys held, for pages that react to a
          // modifier under the pointer (outlines shown while ⌥ is held).
          await page.mouse.move(this.mouse.x + 1, this.mouse.y);
          await page.mouse.move(this.mouse.x, this.mouse.y);
          await this.wait(450);
        }
        if (s.double) {
          await page.mouse.dblclick(this.mouse.x, this.mouse.y, { delay: this.fast ? 0 : 60 });
        } else {
          const button = s.button || "left";
          await page.mouse.down({ button });
          await page.waitForTimeout(this.fast ? 0 : 70);
          await page.mouse.up({ button });
        }
        for (const m of mods.reverse()) await page.keyboard.up(m);
        await this.wait(250);
        break;
      }
      case "drag": {
        // Press on `from`, glide to `to` with the button held, release.
        // Held keys (e.g. Meta for Hush's "drop as text") show in the HUD
        // for the whole drag.
        const from = await this.pointOf(s.from);
        const to = await this.pointOf(s.to, { aim: "centre" });
        await this.glide(from.x, from.y);
        await this.wait(150);
        await page.mouse.down();
        await this.wait(180);
        const mods = s.keys ? String(s.keys).split("+").filter(Boolean) : [];
        // Nudge first so drag thresholds trip before the long move.
        await this.glide(from.x + 12, from.y + 6, 120);
        if (mods.length) await this.overlay("showKeys", s.keys, "", s.duration + 1200);
        for (const m of mods) await page.keyboard.down(m);
        await this.glide(to.x, to.y, s.duration, { steps: 10 });
        await this.wait(250);
        await page.mouse.up();
        for (const m of mods.reverse()) await page.keyboard.up(m);
        await this.wait(400);
        break;
      }
      case "waitFor":
        await this.loc(s.selector).waitFor({ state: s.state || "visible", timeout: s.timeout || 15_000 });
        break;
      case "type": {
        if (s.into) await this.run({ op: "click", selector: s.into });
        await this.typeHuman(this.resolveText(s), s.wpm);
        break;
      }
      case "paste": {
        if (s.into) await this.run({ op: "click", selector: s.into });
        await this.overlay("showKeys", "Meta+V");
        await this.wait(250);
        await page.keyboard.insertText(this.resolveText(s));
        await this.wait(400);
        break;
      }
      case "press": {
        if (s.silent || s.list === "setup") { // keys the viewer needn't see
          for (let i = 0; i < s.times; i++) await page.keyboard.press(s.keys);
          await this.wait(120);
          break;
        }
        for (let i = 0; i < s.times; i++) {
          await this.overlay("showKeys", s.keys, s.times > 1 ? i + 1 : 0, s.hold || 1500);
          // Repeats are quick, so that tapping a key twice or three times
          // (Hush's ⌘⌘ and ⇧⇧⇧ gestures) lands inside an app's tap window.
          await this.wait(s.times > 1 ? 60 : 220); // let the viewer see the keys land first
          await page.keyboard.press(s.keys);
          await this.wait(s.times > 1 ? 140 : 500);
        }
        break;
      }
      case "scroll": {
        if (s.at) {
          const p = await this.pointOf(s.at, { aim: "centre" });
          await this.glide(p.x, p.y);
          await this.wait(150);
        }
        const frames = this.fast ? 1 : Math.max(1, Math.round(s.duration / 16));
        const [dx, dy] = s.by;
        for (let i = 0; i < frames; i++) {
          if (s.selector) await this.loc(s.selector).evaluate((el, d) => { (el.scrollingElement || el).scrollTop += d; }, dy / frames);
          else await page.mouse.wheel(dx / frames, dy / frames);
          if (!this.fast) await page.waitForTimeout(16);
        }
        break;
      }
      case "eval":
        await page.evaluate(s.code);
        break;
      default:
        throw new Error(`unknown step ${s.op}`);
    }
  }

  // Types like a person: a base rate from wpm, random jitter, short holds
  // after spaces and longer ones after punctuation and line breaks.
  async typeHuman(text, wpm = this.script.typing.wpm) {
    const { page } = this;
    if (this.fast) { await page.keyboard.insertText(text); return; }
    const base = 60000 / (wpm * 5);
    const jitter = this.script.typing.jitter;
    for (const ch of text) {
      if (ch === "\n") await page.keyboard.press("Enter");
      else await page.keyboard.type(ch);
      let d = base * (1 - jitter + this.rand() * jitter * 2);
      if (ch === " ") d *= 1.15;
      if (/[,;:]/.test(ch)) d += base * 2.5;
      if (/[.!?—]/.test(ch)) d += base * 4;
      if (ch === "\n") d += base * 6;
      await page.waitForTimeout(d);
    }
  }
}

// Small seeded PRNG so typing rhythm is identical between renders.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
