# Writing demo clips with monkeysee

This repo is the recorder. Clips for real apps live in a workspace (a
folder with a `monkeysee.json`, e.g. `demos/` in tools.natelaffan.com):
`<app>/<feature>.yml` beside `adapters/` and `content/`. Don't add
app-specific adapters, content or clips here; only the engine, the
notepad fixture and the sample pack belong in this repo.

Each clip is one file. A person writes the top half (feature, state,
description: the beats in order); you write the script under it. When
asked to script or record a spec, working from the workspace folder:

1. Read `docs/SCRIPT.md` here (format) and the app's adapter in the
   workspace's `adapters/` (its `guide` lists selectors, shortcuts and how
   to reach common states).
2. Run `npx monkeysee inspect --app <app> [--content pack/item]` and look
   at the screenshot it writes to `out/`. Use only selectors you saw there
   or in the guide.
3. Under the spec, after the line
   `# Script (written from the spec above; edit freely) ----…`, write
   `content` and `setup` to reach the `state`, then `steps`, one group per
   beat with the beat's words as the first step's `note`. Leave the spec
   as the person wrote it. No captions or labels exist; the clip shows the
   app, the cursor and the keys. Aim for 8 to 30 seconds. Wait 800 to
   2000 ms after anything changes on screen. Use content packs for text.
4. Run `npx monkeysee check <app>/<feature>.yml` until it passes.
   `check` only proves the steps ran; it doesn't prove the feature appeared.
5. Run `npx monkeysee record <app>/<feature>.yml`, then pull a few frames
   (`ffmpeg -i clip.mp4 -vf "fps=1/2.5,scale=640:-1,tile=4x4" sheet.png`)
   and look at them before calling the clip done. Typing that lands
   nowhere, modes that don't open and panes showing an empty part of a
   canvas are the usual failures, and only the frames show them.

Adding an app: write `adapters/<app>.mjs` in the workspace, exporting the
adapter as its default (`src/apps/fixture.mjs` here is the smallest
example; the Hush and Snorkle adapters in tools.natelaffan.com are full
ones). For a Tauri app, give the adapter
`tauri: { backend: (content, options) => ({ command_name: (args) => … }) }`;
the frontend's `invoke` calls are answered by that object in Node. Small
apps can use `tauri: { handlers: { command_name: (args, data) => … }, data }`
instead, which runs in the page. Helper modules can sit beside adapters;
`monkeysee apps` lists only files that export an adapter.

Adding content: a folder in the workspace's `content/` with `pack.yaml`
listing items. Use public-domain or original text only.
