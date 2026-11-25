// Hush (laffan/hush): a Markdown writing app. Its frontend already runs in
// a plain browser: with no Tauri bridge it keeps the library in
// localStorage (hush_files / hush_settings), so seeding content is just
// writing those keys before the app boots. No IPC mock needed.
import path from "node:path";

export default {
  name: "hush",
  title: "Hush",
  url: "http://localhost:5173/",
  platform: "mac",
  server: {
    // Run from a hush checkout (--app-dir, MONKEYSEE_HUSH_DIR, or ../hush).
    command: ["npx", "vite", "--port", "5173", "--strictPort"],
    cwd: path.resolve(process.cwd(), "..", "hush"),
  },
  defaultContent: ["moby-dick/chapter-1"],

  // content: [{title, text}] -> one Hush document each, first one open.
  // options.settings is merged into Hush's settings (theme, font, ...).
  seed(content, options = {}) {
    const files = content.filter((c) => c.text != null).map((c, i) => ({
      id: `demo-${i + 1}`,
      name: c.title,
      content: c.text,
      modified: 1700000000 - i,
    }));
    return {
      arg: { files, settings: options.settings || null },
      fn: ({ files, settings }) => {
        if (sessionStorage.getItem("monkeysee-seeded")) return; // keep edits across reloads
        sessionStorage.setItem("monkeysee-seeded", "1");
        localStorage.clear();
        if (files.length) localStorage.setItem("hush_files", JSON.stringify(files));
        if (settings) localStorage.setItem("hush_settings", JSON.stringify(settings));
      },
    };
  },

  async ready(page) {
    await page.waitForSelector(".cm-content", { timeout: 20_000 });
    // The boot splash fades out on its own; give it a moment.
    await page.waitForTimeout(800);
  },

  // Read by the planner (and by you). Keep it to what a demo needs.
  guide: `
Hush is a distraction-free Markdown writing app (macOS menu-bar app and iPad).
The seeded documents are open in the editor; the first one is showing.

Selectors:
- Editor text area: ".cm-content" (CodeMirror 6). The editor has focus at start.
  To click into it, click a body line such as ".cm-line:has-text(\"Call me Ishmael\")";
  clicking the "# Title" line at the top takes focus away from the editor.
- A line of text: ".cm-line" (use :has-text("...") or :nth-match to pick one).
- Command palette input (after Meta+P): "input[placeholder='Type a command…']".
  Type a command name, then press Enter to run the top match.

Default shortcuts (Mod = Meta on macOS; write them as Meta+... in press steps):
- Meta+P            command palette (almost every feature is here)
- Meta+S            Focus Mode: dims everything but the current sentence
- Meta+Shift+S      Zen Focus: fullscreen overlay, current line centred, edges blurred (Meta+Shift+S again exits)
- Meta+Shift+P      Private Mode: blacks out every word on screen
- Meta+Shift+W      word count pill above the text
- Meta+Backslash     toggle the sidebar (file list)
- Meta+Shift+Backslash  toggle the Overview
- Meta+Shift+T      typewriter scrolling
- Meta+Shift+E      Shuffle Editor: explode the selection into draggable sentences
- Meta+L            select the current sentence; Meta+Shift+L shrinks it
- Meta+ArrowRight / Meta+ArrowLeft            jump to next / previous sentence
- Alt+Meta+ArrowRight / Alt+Meta+ArrowLeft    move the current sentence forward / back
- Alt+ArrowUp / Alt+ArrowDown                 move the current line up / down
- Meta+Backspace    delete the sentence the caret is in
- Meta+B / Meta+I / Meta+=    bold / italic / highlight the selection
- Meta+.            blockquote the selected lines
- Meta+F            quick find; Meta+Shift+F find and replace
- Meta+End          caret to end of document (handy before typing new text)

Good demo moves: start with the caret at the end of a paragraph, type a sentence
at a natural pace, then show a mode with its shortcut. Focus Mode and Zen Focus
read best after the caret is inside a paragraph of real text.
`,
};
