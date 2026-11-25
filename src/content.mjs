// Content packs: themed demo material (a novel chapter, a bibliography)
// that an app adapter seeds into the app before recording, or that a
// script types or pastes from.
//
// A pack is a folder under content/ with a pack.yaml listing its items.
// An item is either inline `text`, a `file` (Markdown or JSON), or both a
// shipped file and a `fetch` recipe that pulls the full text from its
// public-domain source into <file>.full.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = path.resolve(here, "..", "content");

export function listPacks() {
  return fs.readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(CONTENT_DIR, d.name, "pack.yaml")))
    .map((d) => readPack(d.name));
}

export function readPack(name) {
  const dir = path.join(CONTENT_DIR, name);
  const file = path.join(dir, "pack.yaml");
  if (!fs.existsSync(file)) throw new Error(`No content pack "${name}" (looked for ${file})`);
  return { ...YAML.parse(fs.readFileSync(file, "utf8")), dir };
}

/** Every item of a pack, in pack.yaml order, as "pack/item" refs. */
export function packRefs(name) {
  return Object.keys(readPack(name).items || {}).map((item) => `${name}/${item}`);
}

/** Resolves "pack/item" (or {pack, item}) to {title, kind, text, data}. */
export function loadItem(ref) {
  const { pack: packName, item: itemName } = typeof ref === "string" ? splitRef(ref) : ref;
  const pack = readPack(packName);
  const item = pack.items?.[itemName];
  if (!item) throw new Error(`Content pack "${packName}" has no item "${itemName}"`);
  let text = item.text ?? null;
  let data = null;
  if (item.file) {
    const shipped = path.join(pack.dir, item.file);
    const full = shipped.replace(/\.md$/, ".full.md");
    const src = fs.existsSync(full) ? full : shipped;
    const raw = fs.readFileSync(src, "utf8");
    if (src.endsWith(".json")) data = JSON.parse(raw);
    else text = raw;
  }
  // url and site: a web page's address and the pack's site it belongs to
  // (packs of pages for a browser, such as shoreline).
  return {
    pack: packName, item: itemName, title: item.title || itemName, kind: item.kind || "document", folder: item.in || null,
    proofread: !!item.proofread, text, data,
    url: item.url ?? null, site: item.site ?? null, dir: pack.dir,
  };
}

function splitRef(ref) {
  const [pack, item] = String(ref).split("/");
  if (!pack || !item) throw new Error(`Content reference should look like "pack/item", got "${ref}"`);
  return { pack, item };
}

/** Text a step can refer to as {content: "pack/item", paragraph: 2, words: 40}. */
export function excerpt(ref, { paragraph, paragraphs, words, chars } = {}) {
  const { text, title } = loadItem(ref);
  if (text == null) throw new Error(`${ref} has no text`);
  let out = text.replace(/^# .*\n+/, ""); // drop the heading; it is usually the doc title
  const paras = out.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraph != null) out = paras[paragraph - 1] ?? "";
  else if (paragraphs != null) out = paras.slice(0, paragraphs).join("\n\n");
  if (words != null) out = out.split(/\s+/).slice(0, words).join(" ");
  if (chars != null) out = out.slice(0, chars);
  return { text: out, title };
}

/** Downloads the full text for every item with a `fetch` recipe. */
export async function fetchAll() {
  for (const pack of listPacks()) {
    for (const [name, item] of Object.entries(pack.items || {})) {
      if (!item.fetch) continue;
      const res = await fetch(item.fetch.url);
      if (!res.ok) throw new Error(`${pack.name}/${name}: ${res.status} from ${item.fetch.url}`);
      const body = (await res.text()).replace(/\r\n/g, "\n");
      // Gutenberg files list chapter titles in a table of contents first,
      // so take the last occurrence of the start marker.
      const s = body.lastIndexOf(item.fetch.start);
      const e = item.fetch.end ? body.indexOf(item.fetch.end, s + 1) : -1;
      if (s < 0) throw new Error(`${pack.name}/${name}: start marker not found`);
      const chunk = body.slice(s + item.fetch.start.length, e > s ? e : undefined).trim();
      const paras = chunk.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
      const md = `# ${item.title}\n\n${paras.join("\n\n")}\n`;
      const dest = path.join(pack.dir, item.file.replace(/\.md$/, ".full.md"));
      fs.writeFileSync(dest, md);
      console.log(`${pack.name}/${name}: ${paras.length} paragraphs -> ${path.relative(process.cwd(), dest)}`);
    }
  }
}
