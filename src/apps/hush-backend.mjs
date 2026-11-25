// An in-memory stand-in for Hush's Rust side, so the full app (notebooks,
// panes, desks) runs in Chromium. It implements the file and settings
// commands Hush needs to boot and edit; everything else answers null, as
// a fresh install would. Runs in Node; the page reaches it through the
// Tauri mock (see src/tauri-mock.mjs).
import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const now = () => Math.floor(Date.now() / 1000);
const hash = (s) => crypto.createHash("sha1").update(s ?? "").digest("hex");

/**
 * content: [{title, kind: "document" | "notebook", text, data}]
 * options.settings: merged into Hush's settings.
 */
export function hushBackend(content, options = {}) {
  const files = new Map();
  let tree = [];
  // An item's `in` puts it inside a container: "Inbox" is Hush's own
  // Inbox; any other name is a project, made the first time it is named.
  // With containers, everything sits in one desk, as on a real install.
  const deskId = id();
  const containers = new Map();
  const container = (name) => {
    if (!containers.has(name)) {
      const node = name === "Inbox"
        ? { id: `__inbox__:${deskId}`, name: "Inbox", type: "project", children: [] }
        : { id: id(), name, type: "project", children: [] };
      containers.set(name, node);
      tree.push(node);
    }
    return containers.get(name);
  };
  for (const c of content) {
    const fileId = id();
    const kind = c.kind === "notebook" ? "notebook" : "document";
    const body = kind === "notebook" ? JSON.stringify(c.data ?? []) : c.text ?? "";
    files.set(fileId, { id: fileId, name: c.title, content: body, modified: now() - files.size, kind });
    const node = { id: id(), name: c.title, type: kind, fileId, children: [], ...(c.proofread ? { proofread: true } : {}) };
    (c.folder ? container(c.folder).children : tree).push(node);
  }
  if (containers.size) {
    if (!containers.has("Inbox")) container("Inbox");
    const inbox = containers.get("Inbox");
    tree = [{ id: deskId, name: "Personal", type: "desk", createdAt: now(), children: [inbox, ...tree.filter((n) => n !== inbox)] }];
  }
  let fileTree = tree;
  let settings = { ...(options.settings || {}) };

  const entry = (f) => ({ id: f.id, name: f.name, content: f.content, modified: f.modified, hash: hash(f.content) });
  const newFile = (content = "") => {
    const f = { id: id(), name: "Untitled", content, modified: now(), kind: "document" };
    files.set(f.id, f);
    return f;
  };
  const insert = (nodes, parentId, node) => {
    if (!parentId) { nodes.push(node); return true; }
    for (const n of nodes) {
      if (n.id === parentId) { (n.children ||= []).push(node); return true; }
      if (n.children && insert(n.children, parentId, node)) return true;
    }
    return false;
  };
  const createKind = (type, initial) => ({ name, parentId }) => {
    const f = newFile(initial);
    f.kind = type;
    f.name = name;
    const node = { id: id(), name, type, fileId: f.id, children: [] };
    if (!insert(fileTree, parentId, node)) fileTree.push(node);
    return { node, file: entry(f) };
  };

  return {
    get_settings: () => settings,
    patch_settings: ({ patch }) => (settings = { ...settings, ...(patch || {}) }),
    save_settings: ({ settings: s }) => { if (s) settings = s; return null; },
    // Like the real listing: documents carry their text, notebooks and
    // stacks come with null and are read through load_file.
    list_files: () => [...files.values()].map((f) => ({
      id: f.id, name: f.name, modified: f.modified, content: f.kind === "document" ? f.content : null,
    })),
    read_document_bodies: () => Object.fromEntries([...files.values()].filter((f) => f.kind === "document").map((f) => [f.id, f.content])),
    get_file_tree: () => fileTree,
    save_file_tree: ({ tree: t }) => { if (Array.isArray(t)) fileTree = t; return null; },
    load_file: ({ id: fid }) => {
      const f = files.get(fid);
      if (!f) throw new Error(`File not found: ${fid}`);
      return entry(f);
    },
    save_file: ({ id: fid, content }) => {
      const f = files.get(fid) || newFile();
      f.content = content;
      f.modified = now();
      files.set(fid, { ...f, id: fid });
      return null;
    },
    // Hush sends a notebook save as raw bytes with the file id in a header
    // (the Tauri mock hands them over as base64).
    save_file_raw: (args) => {
      const fid = args.__rawBody != null ? args.__headers?.["file-id"] : args.id;
      const content = args.__rawBody != null ? Buffer.from(args.__rawBody, "base64").toString("utf8") : args.content;
      const f = files.get(fid);
      if (f && typeof content === "string") { f.content = content; f.modified = now(); }
      return null;
    },
    file_availability: ({ id: fid }) => ({ state: files.has(fid) ? "ready" : "missing" }),
    create_file: () => entry(newFile()),
    create_notebook: createKind("notebook", "[]"),
    create_stack: createKind("stack", '{"format":"hushstack","version":1,"items":[],"scrollX":0}'),
    rename_file: ({ id: fid, name }) => { const f = files.get(fid); if (f) f.name = name; return null; },
    delete_file: ({ id: fid }) => { files.delete(fid); return null; },
  };
}
