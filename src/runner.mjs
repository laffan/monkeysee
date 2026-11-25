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

  async locate(selector) {
    const loc = this.page.locator(selector).first();
    await loc.waitFor({ state: "visible", timeout: this.timeout });
    return loc;
  }

  // Ease-in-out glide from the current cursor position to (x, y).
  async glide(x, y, duration) {
    const from = { ...this.mouse };
    const dist = Math.hypot(x - from.x, y - from.y);
    const ms = this.fast ? 0 : duration ?? Math.min(900, 260 + dist * 0.9);
    const frames = Math.max(1, Math.round(ms / 16));
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      await this.page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      if (!this.fast) await this.page.waitForTimeout(16);
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
        await this.glideTo(s.selector);
        break;
      case "click": {
        await this.glideTo(s.selector);
        await this.wait(120);
        if (s.double) {
          await page.mouse.dblclick(this.mouse.x, this.mouse.y, { delay: this.fast ? 0 : 60 });
        } else {
          await page.mouse.down();
          await page.waitForTimeout(this.fast ? 0 : 70);
          await page.mouse.up();
        }
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
        await this.glide(to.x, to.y, s.duration);
        await this.wait(250);
        await page.mouse.up();
        for (const m of mods.reverse()) await page.keyboard.up(m);
        await this.wait(400);
        break;
      }
      case "waitFor":
        await page.locator(s.selector).first().waitFor({ state: s.state || "visible", timeout: s.timeout || 15_000 });
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
        if (s.silent) { // setup keys the viewer needn't see
          for (let i = 0; i < s.times; i++) await page.keyboard.press(s.keys);
          await this.wait(120);
          break;
        }
        for (let i = 0; i < s.times; i++) {
          await this.overlay("showKeys", s.keys, "", s.hold || 1500);
          await this.wait(s.times > 1 ? 120 : 220); // let the viewer see the keys land first
          await page.keyboard.press(s.keys);
          await this.wait(s.times > 1 ? 220 : 500);
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
          if (s.selector) await page.locator(s.selector).first().evaluate((el, d) => { el.scrollTop += d; }, dy / frames);
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
