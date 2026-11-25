// A tiny built-in app (fixtures/notepad) so the recorder can be tried and
// tested without any real project checked out. It is served from disk.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const index = path.resolve(here, "..", "..", "fixtures", "notepad", "index.html");

export default {
  name: "fixture",
  title: "Notepad (fixture)",
  url: pathToFileURL(index).href,
  platform: "mac",
  defaultContent: ["moby-dick/chapter-1"],
  seed(content) {
    const doc = content.find((c) => c.text != null);
    return { arg: doc ? { title: doc.title, text: doc.text } : null, fn: (d) => { if (d) window.__seed = d; } };
  },
  async ready(page) { await page.waitForSelector("#editor"); },
  guide: `
A one-page notepad. Selectors: "#editor" (textarea), "#palette input" (command palette).
Shortcuts: Meta+K command palette, Meta+. focus mode (dims the toolbar), Meta+Shift+W word count.
`,
};
