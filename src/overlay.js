// Injected into every page before the app's own scripts run (via
// context.addInitScript). Draws the parts of the video that are not the
// app: a keystroke HUD (the keys only, no words) and a visible cursor
// with click ripples. Everything lives in a closed shadow root on a custom
// element, with pointer-events off, so it cannot catch input or be styled
// by the app.
//
// The runner drives it through window.__monkeysee.showKeys. The cursor
// follows real mousemove events, so it is exactly where Playwright's
// mouse is.
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
    .cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; transform: translate(-100px,-100px);
      transition: opacity .3s ease; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    .cursor.hidden { opacity: 0; }
    .ripple { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      border: 3px solid ${opts.accent}; animation: ripple .5s ease-out forwards; }
    @keyframes ripple { from { transform: scale(.4); opacity: .9; } to { transform: scale(3.2); opacity: 0; } }
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

  let host, root, layer, hud, cursor;
  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement("monkeysee-overlay");
    root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${css}</style><div class="layer">
      <div class="hud ${opts.hudTheme === "light" ? "light" : ""}"><div class="keys"></div></div>
      <svg class="cursor hidden" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8.2 16.3 L11.6 24 L15 22.5 L11.7 15 L19 15 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`;
    layer = root.querySelector(".layer");
    hud = root.querySelector(".hud");
    cursor = root.querySelector(".cursor");
    document.documentElement.appendChild(host);
  }
  // Apps sometimes rebuild <body> or the whole document; keep the overlay attached.
  const ensure = () => { if (document.documentElement) mount(); };
  if (document.documentElement) ensure();
  document.addEventListener("DOMContentLoaded", ensure);
  setInterval(ensure, 500);

  let hudTimer;
  function showKeys(combo, _unused, holdMs = 1400) {
    ensure();
    const keys = hud.querySelector(".keys");
    keys.innerHTML = "";
    for (const k of keyCaps(combo)) {
      const el = document.createElement("div");
      el.className = "cap pop";
      el.textContent = k;
      keys.appendChild(el);
    }
    hud.classList.add("show");
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hud.classList.remove("show"), holdMs);
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
  // Fade the cursor while typing so it doesn't sit on top of the text
  // (but not for a held modifier, which is usually part of a drag).
  const MODIFIERS = new Set(["Meta", "Control", "Alt", "Shift"]);
  window.addEventListener("keydown", (e) => {
    if (!cursor || MODIFIERS.has(e.key)) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => cursor.classList.add("hidden"), 250);
  }, true);

  window.__monkeysee = { showKeys, keyCaps };
})();
