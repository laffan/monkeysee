// Injected into every page before the app's own scripts run (via
// context.addInitScript). Draws the parts of the video that are not the
// app: a keystroke HUD, a visible cursor with click ripples, captions,
// title cards and highlight rings. Everything lives in a closed shadow
// root on a custom element, with pointer-events off, so it cannot catch
// input or be styled by the app.
//
// The runner drives it through window.__monkeysee (showKeys, caption,
// card, highlight). The cursor follows real mousemove events, so it is
// exactly where Playwright's mouse is.
(() => {
  if (window.__monkeysee) return;
  const opts = Object.assign(
    { hudTheme: "dark", cursor: true, accent: "#5b6cf0", font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif" },
    window.__monkeyseeOptions || {}
  );

  const css = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: ${opts.font}; }
    .hud { position: absolute; left: 50%; bottom: 48px; transform: translate(-50%, 12px); opacity: 0;
      display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-radius: 16px;
      background: rgba(22,22,28,.86); color: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.28);
      backdrop-filter: blur(10px); transition: opacity .18s ease, transform .18s ease; }
    .hud.light { background: rgba(255,255,255,.92); color: #16161c; box-shadow: 0 12px 40px rgba(0,0,0,.16); }
    .hud.show { opacity: 1; transform: translate(-50%, 0); }
    .keys { display: flex; gap: 6px; }
    .cap { min-width: 34px; height: 38px; padding: 0 10px; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
      border-radius: 9px; font-size: 20px; font-weight: 600; background: rgba(255,255,255,.12);
      box-shadow: inset 0 -2px 0 rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.14); }
    .hud.light .cap { background: #f1f1f4; box-shadow: inset 0 -2px 0 rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.08); }
    .cap.pop { animation: pop .22s ease; }
    @keyframes pop { 0% { transform: scale(.82); } 60% { transform: scale(1.08); } 100% { transform: scale(1); } }
    .label { font-size: 17px; font-weight: 500; opacity: .85; white-space: nowrap; }
    .caption { position: absolute; left: 50%; transform: translateX(-50%); max-width: 72%; text-align: center;
      padding: 12px 22px; border-radius: 14px; font-size: 22px; line-height: 1.35; font-weight: 500;
      background: rgba(22,22,28,.82); color: #fff; opacity: 0; transition: opacity .3s ease; }
    .caption.top { top: 36px; } .caption.bottom { bottom: 130px; }
    .caption.show { opacity: 1; }
    .card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 14px; background: var(--card-bg, #101014); color: #fff; opacity: 0; transition: opacity .45s ease; }
    .card.show { opacity: 1; }
    .card h1 { margin: 0; font-size: 54px; font-weight: 700; letter-spacing: -.02em; }
    .card p { margin: 0; font-size: 24px; opacity: .7; }
    .cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; transform: translate(-100px,-100px);
      transition: opacity .3s ease; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    .cursor.hidden { opacity: 0; }
    .ripple { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      border: 3px solid ${opts.accent}; animation: ripple .5s ease-out forwards; }
    @keyframes ripple { from { transform: scale(.4); opacity: .9; } to { transform: scale(3.2); opacity: 0; } }
    .ring { position: absolute; border-radius: 10px; border: 3px solid ${opts.accent};
      box-shadow: 0 0 0 9999px rgba(0,0,0,.18); opacity: 0; transition: opacity .3s ease; }
    .ring.show { opacity: 1; }
  `;

  const SYMBOLS = {
    Meta: "⌘", Command: "⌘", Cmd: "⌘", Control: "⌃", Ctrl: "⌃", Alt: "⌥", Option: "⌥", Shift: "⇧",
    Enter: "↩", Return: "↩", Escape: "esc", Backspace: "⌫", Delete: "⌦", Tab: "⇥", Space: "space", " ": "space",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", PageUp: "⇞", PageDown: "⇟", Home: "↖", End: "↘",
    Backslash: "\\", Slash: "/", Period: ".", Comma: ",", Semicolon: ";", Minus: "-", Equal: "=",
  };
  // macOS order: ⌃ ⌥ ⇧ ⌘ then the key.
  const MOD_ORDER = ["Control", "Ctrl", "Alt", "Option", "Shift", "Meta", "Command", "Cmd"];

  function keyCaps(combo) {
    // "Meta++" means Meta and the plus key.
    const parts = String(combo).replace(/\+\+$/, "+Plus").split("+").filter(Boolean).map((p) => (p === "Plus" ? "+" : p));
    const mods = parts.filter((p) => MOD_ORDER.includes(p)).sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
    const keys = parts.filter((p) => !MOD_ORDER.includes(p)).map((k) => (k.startsWith("Key") && k.length === 4 ? k.slice(3) : k));
    return [...mods, ...keys].map((k) => SYMBOLS[k] || (k.length === 1 ? k.toUpperCase() : k));
  }

  let host, root, layer, hud, caption, card, cursor, ring;
  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement("monkeysee-overlay");
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${css}</style><div class="layer">
      <div class="ring"></div><div class="caption bottom"></div>
      <div class="hud ${opts.hudTheme === "light" ? "light" : ""}"><div class="keys"></div><div class="label"></div></div>
      <svg class="cursor hidden" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8.2 16.3 L11.6 24 L15 22.5 L11.7 15 L19 15 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
      <div class="card"><h1></h1><p></p></div></div>`;
    layer = root.querySelector(".layer");
    hud = root.querySelector(".hud");
    caption = root.querySelector(".caption");
    card = root.querySelector(".card");
    cursor = root.querySelector(".cursor");
    ring = root.querySelector(".ring");
    document.documentElement.appendChild(host);
  }
  // Apps sometimes rebuild <body> or the whole document; keep the overlay attached.
  const ensure = () => { if (document.documentElement) mount(); };
  if (document.documentElement) ensure();
  document.addEventListener("DOMContentLoaded", ensure);
  setInterval(ensure, 500);

  let hudTimer;
  function showKeys(combo, label, holdMs = 1400) {
    ensure();
    const keys = hud.querySelector(".keys");
    keys.innerHTML = "";
    for (const k of keyCaps(combo)) {
      const el = document.createElement("div");
      el.className = "cap pop";
      el.textContent = k;
      keys.appendChild(el);
    }
    const lab = hud.querySelector(".label");
    lab.textContent = label || "";
    lab.style.display = label ? "" : "none";
    hud.classList.add("show");
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hud.classList.remove("show"), holdMs);
  }

  function setCaption(text, position = "bottom") {
    ensure();
    if (!text) { caption.classList.remove("show"); return; }
    caption.textContent = text;
    caption.className = `caption ${position} show`;
  }

  function showCard(title, subtitle, background) {
    ensure();
    card.querySelector("h1").textContent = title || "";
    const p = card.querySelector("p");
    p.textContent = subtitle || "";
    p.style.display = subtitle ? "" : "none";
    if (background) card.style.setProperty("--card-bg", background);
    card.classList.add("show");
  }
  function hideCard() { ensure(); card.classList.remove("show"); }

  function highlight(rect, ms = 1500) {
    ensure();
    const pad = 6;
    Object.assign(ring.style, { left: rect.x - pad + "px", top: rect.y - pad + "px", width: rect.width + pad * 2 + "px", height: rect.height + pad * 2 + "px" });
    ring.classList.add("show");
    setTimeout(() => ring.classList.remove("show"), ms);
  }

  let idleTimer;
  window.addEventListener("mousemove", (e) => {
    if (!opts.cursor) return;
    ensure();
    cursor.classList.remove("hidden");
    cursor.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`;
    clearTimeout(idleTimer);
  }, true);
  window.addEventListener("mousedown", (e) => {
    if (!opts.cursor) return;
    ensure();
    const r = document.createElement("div");
    r.className = "ripple";
    r.style.left = e.clientX + "px";
    r.style.top = e.clientY + "px";
    layer.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }, true);
  // Fade the cursor while typing so it doesn't sit on top of the text.
  window.addEventListener("keydown", () => {
    if (!cursor) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => cursor.classList.add("hidden"), 250);
  }, true);

  window.__monkeysee = { showKeys, keyCaps, caption: setCaption, card: showCard, hideCard, highlight };
})();
