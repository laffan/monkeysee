// A stand-in for Snorkle's native side (laffan/snorkle), run in the page
// before the chrome's scripts. Snorkle's chrome (ui/) talks to Rust
// through window.__TAURI__ (core.invoke, event.listen); this answers those
// calls from a small in-memory browser: tabs, research sessions, Save for
// Later, history, pins, bookmarks, view modes and one notebook per session.
//
// Natively, pages are WKWebViews drawn beside the chrome. Here each tab's
// page is a same-origin iframe placed where the chrome reports the content
// area (set_chrome_layout), with Snorkle's own page-side code installed in
// it, taken verbatim from the checkout by snorkle.mjs: the view modes' CSS
// and the notebook's watcher (⌥-click, clip mode, the quote button's line
// and sentence). Page addresses and bodies come from a content pack
// (content/shoreline), so links between demo pages work and nothing is
// fetched.
//
// Configured by window.__snorkleDemo (set by snorkle.mjs just before this
// file): { pages, sites, css, watch, options }.
(() => {
  if (window.top !== window) return;
  const D = window.__snorkleDemo;
  const O = D.options || {};
  const now = Date.now();

  // ---- the chrome's own remembered settings ---------------------------------
  try {
    localStorage.clear();
    localStorage.setItem("notebookOpen", O.notebookOpen ? "1" : "0");
    for (const [k, v] of Object.entries(O.prefs || {})) localStorage.setItem(k, String(v));
  } catch { /* storage unavailable */ }

  // Snorkle asks for -apple-system: on Linux that is Inter (installed for
  // recordings), so the chrome looks as it does on a Mac.
  const FONT_FACES = [400, 500, 600, 700].map((w) => {
    const name = { 400: "Inter", 500: "Inter Medium", 600: "Inter SemiBold", 700: "Inter Bold" }[w];
    return `@font-face{font-family:-apple-system;font-weight:${w};src:local("${name}")}` +
      `@font-face{font-family:BlinkMacSystemFont;font-weight:${w};src:local("${name}")}`;
  }).join("");
  const addStyle = (doc, css) => {
    const s = doc.createElement("style");
    s.textContent = css;
    (doc.head || doc.documentElement).appendChild(s);
    return s;
  };
  if (document.documentElement) addStyle(document, FONT_FACES);
  else document.addEventListener("DOMContentLoaded", () => addStyle(document, FONT_FACES));

  // ---- events ----------------------------------------------------------------
  const listeners = new Map();
  let eventId = 0;
  function emit(name, payload) {
    for (const cb of [...(listeners.get(name) || [])]) {
      try { cb({ event: name, id: ++eventId, payload }); } catch (e) { console.error(e); }
    }
  }
  const later = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- pages -----------------------------------------------------------------
  const pages = D.pages || {};
  const pageOf = (url) => pages[String(url).split("#")[0]] || null;
  function display(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    const parts = u.hostname.split(".");
    return {
      transport: u.protocol === "http:" ? "http" : "https",
      subdomain: parts.slice(0, -2).join("."),
      registrable: parts.slice(-2).join("."),
      port: u.port ? Number(u.port) : null,
      punycode_forced: false,
      had_userinfo: false,
      full: url,
    };
  }
  const hostOf = (url) => (display(url) || {}).registrable || "";
  function titleOf(url) {
    const p = pageOf(url);
    return p ? p.title : hostOf(url);
  }

  // Favicons: drawn here as PNGs (the chrome takes only PNG data URLs).
  const icons = {};
  function drawIcon(site) {
    const spec = (D.sites[site] || {}).icon || { bg: "#555", fg: "#fff", glyph: "?" };
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = spec.bg;
    g.beginPath();
    g.roundRect(0, 0, 64, 64, 14);
    g.fill();
    g.fillStyle = spec.fg;
    g.font = `${spec.serif ? "700 44px 'Bitstream Charter', serif" : "800 40px Inter, sans-serif"}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(spec.glyph, 32, spec.serif ? 35 : 34);
    return c.toDataURL("image/png");
  }
  function iconFor(url) {
    const p = pageOf(url);
    const host = hostOf(url);
    if (p && !icons[host]) icons[host] = drawIcon(p.site);
    return icons[host] || null;
  }

  // ---- the browser -----------------------------------------------------------
  let nextTab = 1;
  const tabs = []; // { id, url, title, hist, idx, space, saved, launcher, loading, progress, frame }
  let active = null;
  let space = null;
  const lastActive = new Map(); // space ("" for everyday) → tab id
  const research = []; // { id, name }
  let nextResearch = 1;
  const closed = [];
  const historyVisits = [];
  const laterItems = []; // { id, url, title, host, pages, urls, saved_ms }
  let nextLater = 1;
  const notebooks = new Map(Object.entries(O.notebooks || {}));
  let viewModes = {
    modes: { desaturate: false, hide_media: false, dark: false, night: false, ...(O.modes || {}) },
    launch: { desaturate: true, hide_media: true, dark: false, night: false },
    exempt: {},
  };

  function visit(url, ago = 0) {
    historyVisits.unshift({ url, title: titleOf(url), display: display(url), visited_ms: now - ago, cache_bytes: 0 });
  }

  function makeTab(url, { spaceId = space, saved = null, launcher = null } = {}) {
    const t = { id: nextTab++, url: url || null, title: url ? titleOf(url) : "", hist: url ? [url] : [], idx: url ? 0 : -1, space: spaceId, saved, launcher, loading: false, progress: 0, frame: null };
    tabs.push(t);
    return t;
  }
  const byId = (id) => tabs.find((t) => t.id === id) || null;
  const listed = (t) => !t.saved && !t.launcher;

  function tabView(t) {
    const d = t.url ? display(t.url) : null;
    return {
      id: t.id, private: false, title: t.title, url: d, loading: t.loading, progress: t.progress,
      can_go_back: t.idx > 0, can_go_forward: t.idx >= 0 && t.idx < t.hist.length - 1,
      security: t.url ? "secure" : "none", live: true, notice: null,
      adblock: d ? { site: d.registrable, blocking: true, can_toggle: true } : null,
      sheet_over: null, launcher: t.launcher, zoom: 100, url_bar_attached: false, offline_saved_ms: null,
      name: null, emoji: null, saved: t.saved ? { ...t.saved } : null, space: t.space, group: null,
    };
  }
  function stateView() {
    return {
      tabs: tabs.map(tabView), active, space,
      os: { status: "ok", current: { major: 26, minor: 1, patch: 0 }, recommended: { major: 26, minor: 1, patch: 0 }, minimum: { major: 26, minor: 0, patch: 0 } },
      content_visible: true, split: null, splits: [], sheet: null, max_live_tabs: 30,
      adblock: { state: "ready" },
      research: research.map((r) => ({ id: r.id, name: r.name, tabs: tabs.filter((t) => t.space === r.id && listed(t)).length })),
      groups: [], preview: null,
    };
  }
  function pushState() {
    showFrames();
    emit("state", stateView());
  }

  function activate(id) {
    const t = byId(id);
    if (!t) return;
    active = id;
    space = t.space;
    lastActive.set(space || "", id);
  }
  function startTab(spaceId) {
    const t = makeTab(null, { spaceId });
    return t;
  }
  function closeTab(id) {
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [t] = tabs.splice(i, 1);
    if (t.url && listed(t)) closed.push({ url: t.url, space: t.space });
    if (t.frame) t.frame.remove();
    if (active === id) {
      const same = tabs.filter((x) => x.space === t.space && listed(x));
      const next = same[Math.min(i, same.length) - 1] || same[0] || null;
      if (next) activate(next.id);
      else activate(startTab(t.space).id);
    }
  }

  // ---- loading a page --------------------------------------------------------
  function navigate(t, url, { push = true } = {}) {
    if (push) {
      t.hist = t.hist.slice(0, t.idx + 1);
      t.hist.push(url);
      t.idx = t.hist.length - 1;
    }
    t.url = url;
    t.title = titleOf(url);
    t.loading = true;
    t.progress = 10;
    if (listed(t)) visit(url);
    loadFrame(t);
  }
  function resolveInput(input) {
    const s = String(input || "").trim();
    if (pages[s]) return s;
    const withScheme = /^https?:/i.test(s) ? s : `https://${s}`;
    if (pageOf(withScheme)) return withScheme.split("#")[0];
    const words = s.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = Object.entries(pages).find(([, p]) => words.every((w) => p.title.toLowerCase().includes(w)));
    return hit ? hit[0] : withScheme;
  }

  // ---- page frames -------------------------------------------------------------
  let box = null; // the content area's container
  let layout = { top: 0, left: 0, right: 0, bottom: 0, overlay: false };
  function container() {
    if (box && box.isConnected) return box;
    box = document.createElement("div");
    box.id = "mk-pages";
    box.style.cssText = "position:fixed;z-index:10;overflow:hidden;background:#fff;visibility:hidden;";
    document.body.appendChild(box);
    placeBox(false);
    return box;
  }
  function placeBox(animate) {
    if (!box) return;
    box.style.transition = animate ? "left .25s ease-in-out, right .25s ease-in-out" : "none";
    box.style.left = layout.left + "px";
    box.style.right = layout.right + "px";
    box.style.top = layout.top + "px";
    box.style.bottom = layout.bottom + "px";
  }
  function shownTab() {
    const t = byId(active);
    return t && t.url ? t : null;
  }
  function showFrames() {
    if (!document.body) return;
    const shown = shownTab();
    const c = container();
    c.style.visibility = shown && !layout.overlay ? "visible" : "hidden";
    for (const t of tabs) {
      if (!t.frame) continue;
      t.frame.style.visibility = t === shown && !layout.overlay ? "visible" : "hidden";
    }
    if (shown && !shown.frame) loadFrame(shown);
  }

  function pageDoc(url) {
    const p = pageOf(url);
    if (p) return p.doc;
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:17px/1.5 Inter,sans-serif;margin:80px auto;max-width:520px;color:#333}</style></head>` +
      `<body><h1>${hostOf(url)}</h1><p>This page isn't part of the demo.</p></body></html>`;
  }

  function loadFrame(t) {
    if (!document.body) { document.addEventListener("DOMContentLoaded", () => loadFrame(t), { once: true }); return; }
    if (!t.frame) {
      const f = document.createElement("iframe");
      f.className = "mk-page";
      f.dataset.tab = String(t.id);
      f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;visibility:hidden;";
      container().appendChild(f);
      t.frame = f;
    }
    const f = t.frame;
    const url = t.url;
    emit("progress", { tab: t.id, loading: true, progress: 10 });
    f.onload = () => {
      if (t.url !== url) return;
      installPage(t);
      // A short, visible load (the pill's bar).
      later(140).then(() => { t.progress = 70; emit("progress", { tab: t.id, loading: true, progress: 70 }); return later(160); })
        .then(() => { t.loading = false; t.progress = 100; emit("progress", { tab: t.id, loading: false, progress: 100 }); pushState(); });
    };
    f.srcdoc = pageDoc(url);
    showFrames();
  }

  // Snorkle's page-side code and the stand-in's own hooks, in one page.
  function installPage(t) {
    const w = t.frame.contentWindow;
    const doc = t.frame.contentDocument;
    if (!w || !doc) return;
    addStyle(doc, FONT_FACES);
    // The notebook's watcher posts to a WebKit message handler.
    w.webkit = { messageHandlers: { snorkle: { postMessage: (json) => pageReport(t.id, json) } } };
    try { w.eval(D.watch); } catch (e) { console.error("watcher", e); }
    applyModes(t);
    // Links: the stand-in browser follows them (or, while adding pages to
    // a saved copy, chooses them).
    doc.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      e.preventDefault();
      linkClicked(t, a.href);
    });
    // App shortcuts (natively the app's menu takes them from the page).
    doc.addEventListener("keydown", (e) => {
      if (!e.metaKey) return;
      const k = keyOf(e);
      const hit = k && SHORTCUTS.find((s) => s.key === k.key && s.mods === k.mods);
      if (!hit) return;
      e.preventDefault();
      emit("shortcut", hit.action);
    }, true);
    // The recording's cursor lives in the top document.
    const fwd = (type) => (e) => {
      const r = t.frame.getBoundingClientRect();
      window.__monkeysee?.pointer?.(type, e.clientX + r.left, e.clientY + r.top);
    };
    doc.addEventListener("mousemove", fwd("move"), true);
    doc.addEventListener("mousedown", fwd("down"), true);
  }

  function effectiveModes(t) {
    const ex = viewModes.exempt[t.id] || [];
    const on = (m) => !!viewModes.modes[m] && !ex.includes(m);
    return { desaturate: on("desaturate"), hide_media: on("hide_media") };
  }
  function applyModes(t, { bare = false } = {}) {
    const doc = t.frame && t.frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    const m = bare ? { desaturate: false, hide_media: false } : effectiveModes(t);
    // As natively: one style element per mode, its id the mode's marker.
    const set = (id, css, on) => {
      let el = doc.getElementById(id);
      if (on && !el) {
        el = doc.createElement("style");
        el.id = id;
        el.textContent = css;
        (doc.head || doc.documentElement).appendChild(el);
      } else if (!on && el) el.remove();
    };
    set("__snorkle_grayscale", D.css.grayscale, m.desaturate);
    set("__snorkle_no_images", D.css.noMedia, m.hide_media);
  }
  const applyAll = () => tabs.forEach((t) => applyModes(t));

  function linkClicked(t, href) {
    const url = href.split("#")[0];
    if (t.saved && t.saved.picking) {
      const label = new URL(url).pathname;
      const i = t.saved.picking.indexOf(label);
      if (i >= 0) t.saved.picking.splice(i, 1);
      else t.saved.picking.push(label);
      t.saved.pickUrls = t.saved.picking.map((p) => new URL(p, t.url).href);
      pushState();
      return;
    }
    navigate(t, url);
    pushState();
  }

  function pageReport(tab, json) {
    let m;
    try { m = JSON.parse(json); } catch { return; }
    const rect = Array.isArray(m.r) ? { x: m.r[0], y: m.r[1], w: m.r[2], h: m.r[3], vw: m.vw } : null;
    emit("notebook_pick", { tab, kind: m.nb, rect, url: m.url || null });
  }

  const nbOf = (tab) => {
    const t = byId(tab);
    return t && t.frame && t.frame.contentWindow ? t.frame.contentWindow.__snorkleNb : null;
  };
  const frames = (w) => new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));

  async function clip({ tab, x, y, w, h, vw }) {
    const t = byId(tab);
    if (!t || !t.frame) throw new Error("No page to clip.");
    const r = t.frame.getBoundingClientRect();
    const k = r.width / (vw || r.width);
    const box = { x: r.left + x * k, y: r.top + y * k, w: w * k, h: h * k };
    const nb = nbOf(tab);
    let text = null;
    try { text = nb && nb.regionText ? JSON.parse(nb.regionText(x, y, w, h)).t || null : null; } catch { /* none */ }
    // As natively: the picture is taken without the view modes.
    applyModes(t, { bare: true });
    await frames(t.frame.contentWindow);
    let image;
    try {
      image = window.__monkeyseeShot ? await window.__monkeyseeShot(box) : null;
    } finally {
      applyModes(t);
    }
    if (!image) image = placeholderImage(box);
    return { image, text, words: null };
  }
  function placeholderImage(b) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(b.w));
    c.height = Math.max(1, Math.round(b.h));
    const g = c.getContext("2d");
    g.fillStyle = "#cfd8dc";
    g.fillRect(0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  }

  // ---- shortcuts (the defaults in snorkle-content/src/shortcuts.rs) -------------
  const SHIFT = 1;
  const SHORTCUT_DEFS = [
    ["new_tab", "New Tab", "t", 0, "new_tab"], ["new_private_tab", "New Private Tab", "n", SHIFT, "new_private_tab"],
    ["reload", "Reload Page", "r", 0, "reload"], ["reopen_tab", "Reopen Closed Tab", "t", SHIFT, "reopen_tab"],
    ["bookmark", "Bookmark Page", "d", 0, "bookmark"], ["split_columns", "Split Side by Side", "s", 0, "split_columns"],
    ["split_rows", "Split Top and Bottom", "s", SHIFT, "split_rows"], ["close_tab", "Close Tab", "w", 0, "close_tab"],
    ["find", "Find on Page", "f", 0, "find"], ["find_next", "Find Next", "g", 0, "find_next"],
    ["find_prev", "Find Previous", "g", SHIFT, "find_prev"], ["toggle_sidebar", "Show or Hide Sidebar", "\\", 0, "toggle_sidebar"],
    ["toggle_right", "Toggle Right Panel", "\\", SHIFT, "toggle_right"], ["toggle_images", "Show or Hide Images", "i", 0, "toggle_images"],
    ["item_1", "Go to Item 1", "1", 0, "item:1"], ["item_2", "Go to Item 2", "2", 0, "item:2"], ["item_3", "Go to Item 3", "3", 0, "item:3"],
    ["item_4", "Go to Item 4", "4", 0, "item:4"], ["item_5", "Go to Item 5", "5", 0, "item:5"],
    ["next_tab", "Next Tab", "]", SHIFT, "next_tab"], ["prev_tab", "Previous Tab", "[", SHIFT, "prev_tab"],
    ["back", "Back", "left", 0, "go_back"], ["forward", "Forward", "right", 0, "go_forward"],
    ["detach_bar", "Detach URL Bar", "up", 0, "detach_bar"], ["attach_bar", "Attach URL Bar", "down", 0, "attach_bar"],
    ["night_vision", "Night Vision", "r", SHIFT, "night_vision"], ["history", "Show or Hide History", "h", SHIFT, "history"],
    ["notebook_page", "Send Page to Notebook", "d", SHIFT, "notebook_page"], ["quit", "Quit Snorkle", "q", 0, "quit"],
  ];
  const SHORTCUTS = SHORTCUT_DEFS.map(([id, title, key, mods, action]) => ({ id, title, key, mods, default_key: key, default_mods: mods, action }));
  const ARROWS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  const CODE_KEYS = { BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Minus: "-", Equal: "=", Backquote: "`" };
  function keyOf(e) {
    let key = null;
    if (ARROWS[e.code] || ARROWS[e.key]) key = ARROWS[e.code] || ARROWS[e.key];
    else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
    else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
    else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
    else if (e.key && e.key.length === 1) key = e.key.toLowerCase();
    if (!key) return null;
    return { key, mods: (e.shiftKey ? 1 : 0) | (e.altKey ? 2 : 0) | (e.ctrlKey ? 4 : 0) };
  }

  // ---- items -------------------------------------------------------------------
  const pin = (url) => ({ url, title: titleOf(url).split(" · ").pop(), display: display(url), icon: iconFor(url), icon_dark: null, emoji: null });
  const bookmark = (url) => ({ url, title: titleOf(url), display: display(url), group: null });
  let pins = (O.pins || []).map(pin);
  let bookmarks = (O.bookmarks || []).map(bookmark);

  function saveLater(url, urls, ago = 0) {
    const item = { id: `l${nextLater++}`, url, title: titleOf(url), host: hostOf(url), pages: urls.length, urls: [...urls], saved_ms: now - ago };
    laterItems.unshift(item);
    return item;
  }
  const laterView = (it) => ({ id: it.id, url: it.url, title: it.title, host: it.host, pages: it.pages });
  function openSavedCopy(it, picking) {
    let t = tabs.find((x) => x.saved && x.saved.item === it.id);
    if (!t) {
      t = makeTab(it.url, { saved: { item: it.id, saved_ms: it.saved_ms, pages: it.pages, picking: null } });
      loadFrame(t);
    }
    t.saved.pages = it.pages;
    t.saved.picking = picking ? [] : null;
    activate(t.id);
    return t;
  }

  // ---- the starting state --------------------------------------------------------
  for (const [i, r] of (O.research || []).entries()) {
    research.push({ id: `r${nextResearch++}`, name: r.name });
    for (const url of r.tabs || []) makeTab(url, { spaceId: research[i].id });
  }
  for (const url of O.tabs || []) makeTab(url, { spaceId: null });
  if (!tabs.some((t) => t.space === null)) makeTab(null, { spaceId: null });
  for (const h of O.history || []) visit(h.url, (h.minutesAgo || 0) * 60_000);
  for (const t of tabs) if (t.url) visit(t.url, 5 * 60_000);
  for (const l of [...(O.later || [])].reverse()) saveLater(l.url, l.pages || [l.url], (l.minutesAgo || 60) * 60_000);
  {
    const everyday = tabs.filter((t) => t.space === null);
    const pick = everyday[Math.min(O.active ?? 0, everyday.length - 1)];
    activate(pick.id);
    if (O.space) {
      const r = research[O.space - 1];
      if (r) activate((tabs.find((t) => t.space === r.id) || startTab(r.id)).id);
    }
  }

  // ---- commands ----------------------------------------------------------------
  const commands = {
    get_state: () => stateView(),
    get_view_mode: () => viewModes,
    set_view_mode: ({ mode, on }) => { viewModes.modes[mode] = !!on; applyAll(); return viewModes; },
    set_launch_mode: ({ mode, on }) => { viewModes.launch[mode] = !!on; return viewModes; },
    set_tab_view_exempt: ({ tab, mode, exempt }) => {
      const list = new Set(viewModes.exempt[tab] || []);
      if (exempt) list.add(mode); else list.delete(mode);
      viewModes.exempt[tab] = [...list];
      applyAll();
      return viewModes;
    },
    set_shortcuts: () => SHORTCUTS,
    get_shortcuts: () => SHORTCUTS,
    list_pins: () => pins,
    list_bookmarks: () => bookmarks,
    list_bookmark_groups: () => [],
    list_later: () => laterItems.map(laterView),
    list_user_scripts: () => [],
    list_downloads: () => [],
    list_chats: () => [],
    ai_status: () => ({ configured: false }),
    passkey_status: () => ({ entitled: false }),
    tab_icons: () => {
      const tabsMap = {};
      for (const t of tabs) if (t.url) { iconFor(t.url); tabsMap[t.id] = hostOf(t.url); }
      const bm = {};
      for (const b of bookmarks) { iconFor(b.url); bm[b.url] = hostOf(b.url); }
      for (const l of laterItems) iconFor(l.url);
      return { tabs: tabsMap, bookmarks: bm, icons: { ...icons }, dark: {} };
    },
    set_chrome_layout: (a) => {
      layout = { top: a.top, left: a.left, right: a.right, bottom: a.bottom, overlay: !!a.overlay };
      container();
      placeBox(a.animateSince != null);
      showFrames();
      return null;
    },

    activate_tab: ({ tab }) => { activate(tab); pushState(); return null; },
    new_tab: ({ private: priv } = {}) => {
      const t = startTab(space);
      activate(t.id);
      pushState();
      return t.id;
    },
    navigate: ({ tab, input }) => {
      const t = byId(tab);
      if (!t) return null;
      navigate(t, resolveInput(input));
      pushState();
      return null;
    },
    close_tab: ({ tab }) => { closeTab(tab); pushState(); return null; },
    close_tabs: ({ tabs: ids }) => { for (const id of ids || []) closeTab(id); pushState(); return null; },
    reopen_closed_tab: () => {
      const c = closed.pop();
      if (!c) return null;
      const t = makeTab(c.url, { spaceId: c.space });
      activate(t.id);
      loadFrame(t);
      pushState();
      return null;
    },
    go_back: ({ tab }) => {
      const t = byId(tab);
      if (t && t.idx > 0) { t.idx--; navigate(t, t.hist[t.idx], { push: false }); pushState(); }
      return null;
    },
    go_forward: ({ tab }) => {
      const t = byId(tab);
      if (t && t.idx < t.hist.length - 1) { t.idx++; navigate(t, t.hist[t.idx], { push: false }); pushState(); }
      return null;
    },
    reload: ({ tab }) => { const t = byId(tab); if (t && t.url) { navigate(t, t.url, { push: false }); pushState(); } return null; },
    open_launcher: ({ url }) => {
      let t = tabs.find((x) => x.launcher === url);
      if (!t) { t = makeTab(url, { launcher: url }); loadFrame(t); }
      activate(t.id);
      pushState();
      return null;
    },
    bookmark_tab: ({ tab }) => {
      const t = byId(tab);
      if (t && t.url && !bookmarks.some((b) => b.url === t.url)) bookmarks.push(bookmark(t.url));
      return null;
    },
    toggle_bookmark: ({ tab }) => {
      const t = byId(tab);
      if (!t || !t.url) return false;
      const i = bookmarks.findIndex((b) => b.url === t.url);
      if (i >= 0) { bookmarks.splice(i, 1); return false; }
      bookmarks.push(bookmark(t.url));
      return true;
    },

    list_history: ({ limit } = {}) => historyVisits.slice(0, limit || 500),
    search_history: ({ query }) => {
      const q = String(query || "").toLowerCase();
      return historyVisits.filter((v) => (v.title + " " + v.url).toLowerCase().includes(q));
    },

    // Save for Later
    begin_conversation_capture: () => null,
    save_for_later: async ({ tab }) => {
      const t = byId(tab);
      if (!t || !t.url) throw new Error("Nothing to save.");
      await later(650);
      saveLater(t.url, [t.url]);
      closeTab(tab);
      pushState();
      return null;
    },
    save_page_for_later: async ({ url }) => { await later(500); saveLater(url, [url]); return null; },
    open_later: ({ id }) => {
      const it = laterItems.find((x) => x.id === id);
      if (it) { openSavedCopy(it, false); pushState(); }
      return null;
    },
    restore_later: ({ id }) => {
      const it = laterItems.find((x) => x.id === id);
      if (!it) return null;
      const t = makeTab(it.url, { spaceId: space });
      activate(t.id);
      loadFrame(t);
      pushState();
      return null;
    },
    add_later_pages: ({ id }) => {
      const it = laterItems.find((x) => x.id === id);
      if (it) { openSavedCopy(it, true); pushState(); }
      return null;
    },
    cancel_adding_pages: ({ tab }) => {
      const t = byId(tab);
      if (t && t.saved) { t.saved.picking = null; pushState(); }
      return null;
    },
    finish_adding_pages: async ({ tab }) => {
      const t = byId(tab);
      if (!t || !t.saved || !t.saved.picking) return 0;
      const urls = (t.saved.pickUrls || []).filter(Boolean);
      const it = laterItems.find((x) => x.id === t.saved.item);
      await later(500 + 350 * urls.length);
      let n = 0;
      for (const u of urls) if (it && !it.urls.includes(u)) { it.urls.push(u); n++; }
      if (it) it.pages = it.urls.length;
      t.saved.pages = it ? it.pages : t.saved.pages;
      t.saved.picking = null;
      t.saved.pickUrls = null;
      pushState();
      return n;
    },
    bookmark_later: ({ id }) => {
      const it = laterItems.find((x) => x.id === id);
      if (it && !bookmarks.some((b) => b.url === it.url)) bookmarks.push(bookmark(it.url));
      return null;
    },
    delete_later: ({ id }) => {
      const i = laterItems.findIndex((x) => x.id === id);
      if (i >= 0) laterItems.splice(i, 1);
      return null;
    },

    // Research sessions
    new_research: ({ name }) => {
      const r = { id: `r${nextResearch++}`, name: name || "New Research" };
      research.push(r);
      activate(startTab(r.id).id);
      pushState();
      return r.id;
    },
    enter_research: ({ space: to }) => {
      const key = to || "";
      const prev = byId(lastActive.get(key));
      const t = prev && prev.space === (to || null) ? prev : tabs.find((x) => x.space === (to || null) && listed(x)) || startTab(to || null);
      activate(t.id);
      pushState();
      return null;
    },
    rename_research: ({ id, name }) => {
      const r = research.find((x) => x.id === id);
      if (r) { r.name = name; pushState(); }
      return null;
    },
    delete_research: ({ id }) => {
      const i = research.findIndex((x) => x.id === id);
      if (i < 0) return null;
      research.splice(i, 1);
      for (const t of tabs.filter((x) => x.space === id)) closeTab(t.id);
      for (let j = tabs.length - 1; j >= 0; j--) if (tabs[j].space === id) tabs.splice(j, 1);
      if (space === id) commands.enter_research({ space: null });
      else pushState();
      return null;
    },
    send_tabs: ({ tabs: ids, to }) => {
      for (const id of ids || []) { const t = byId(id); if (t) t.space = to || null; }
      if (byId(active) && byId(active).space !== space) {
        const here = tabs.find((x) => x.space === space && listed(x));
        activate((here || startTab(space)).id);
      }
      pushState();
      return null;
    },
    send_page: ({ url, to }) => { makeTab(url, { spaceId: to || null }); pushState(); return null; },

    // The notebook
    load_notebook: ({ space: s } = {}) => notebooks.get(s || "") ?? null,
    save_notebook: ({ notebook, space: s } = {}) => { notebooks.set(s || "", notebook); return null; },
    notebook_add_page: () => true,
    notebook_clip_mode: ({ tab, on }) => { const nb = nbOf(tab); if (nb) nb.setClip(!!on); return null; },
    notebook_clip: (a) => clip(a),
    notebook_clip_words: () => null,
    notebook_link_title: ({ url }) => titleOf(url),
    notebook_link_hover: ({ tab, fx, fy, fromY }) => {
      const nb = nbOf(tab);
      if (!nb) return null;
      if (fx < 0) nb.leave(); else nb.hover(fx, fy, fromY);
      return null;
    },
    notebook_link_drop: ({ tab, fx, fy }) => {
      const nb = nbOf(tab);
      if (!nb) return null;
      try { return JSON.parse(nb.drop(fx, fy)).t || null; } catch { return null; }
    },
    read_selection: ({ tab }) => {
      const t = byId(tab);
      const s = t && t.frame && t.frame.contentWindow ? String(t.frame.contentWindow.getSelection() || "").trim() : "";
      return s || null;
    },
    export_notebook: () => null,
  };

  const unhandled = new Set();
  async function invoke(cmd, args) {
    const fn = commands[cmd];
    if (!fn) {
      if (!unhandled.has(cmd)) { unhandled.add(cmd); console.debug("[snorkle stand-in] unhandled", cmd); }
      return null;
    }
    // Answers come back asynchronously, as Tauri's do.
    await Promise.resolve();
    return fn(args || {});
  }

  window.__TAURI__ = {
    core: { invoke },
    event: {
      listen: (name, cb) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(cb);
        return Promise.resolve(() => listeners.get(name).delete(cb));
      },
      emit: (name, payload) => { emit(name, payload); return Promise.resolve(); },
    },
  };
  // For scripts (eval steps) and debugging.
  window.__snorkleSim = { emit, tabs, laterItems, research, commands, stateView };
  document.addEventListener("DOMContentLoaded", () => { container(); showFrames(); });
})();
