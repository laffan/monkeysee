// A workspace is the folder that holds one project's demos: its app
// adapters, its content packs and its clip files. monkeysee itself ships
// only the engine, the built-in notepad fixture and a small sample pack;
// everything app-specific lives in a workspace, usually in the repo that
// publishes the clips.
//
// A workspace is marked by a monkeysee.json at its root:
//
//   {
//     "adapters": "adapters",                    // <app>.mjs files (default "adapters")
//     "content": "content",                      // <pack>/pack.yaml folders (default "content")
//     "output": "../{app}/videos/{feature}.mp4"  // default output path, from the root
//   }
//
// It is found by walking up from the clip file (or the current folder), or
// set with --workspace / MONKEYSEE_WORKSPACE. The path is kept in
// MONKEYSEE_WORKSPACE so that every copy of monkeysee loaded in the process
// (the CLI's and the one an adapter imports) sees the same workspace.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BUILTIN_DIR = path.resolve(here, "..");
const MARK = "monkeysee.json";

/** Finds the workspace above `start` (a file or folder) and makes it current. */
export function useWorkspace({ dir, start } = {}) {
  const root = dir ? path.resolve(dir) : findRoot(start || process.cwd());
  if (dir && !fs.existsSync(path.join(root, MARK))) throw new Error(`${root} has no ${MARK}`);
  if (root) process.env.MONKEYSEE_WORKSPACE = root;
  return workspace();
}

function findRoot(start) {
  let d = path.resolve(start);
  if (fs.existsSync(d) && fs.statSync(d).isFile()) d = path.dirname(d);
  for (;;) {
    if (fs.existsSync(path.join(d, MARK))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** The current workspace, or null when there is none (built-ins only). */
export function workspace() {
  const root = process.env.MONKEYSEE_WORKSPACE;
  if (!root) return null;
  const cfg = JSON.parse(fs.readFileSync(path.join(root, MARK), "utf8"));
  return {
    root,
    adapters: path.resolve(root, cfg.adapters || "adapters"),
    content: path.resolve(root, cfg.content || "content"),
    output: cfg.output ? path.resolve(root, cfg.output) : null,
  };
}

/** Folders searched for content packs, workspace first so it can shadow a built-in pack. */
export function contentDirs() {
  const ws = workspace();
  return [ws?.content, path.join(BUILTIN_DIR, "content")].filter((d) => d && fs.existsSync(d));
}
