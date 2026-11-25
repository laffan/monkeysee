# Writing demo clips in this repo

Each clip is one file, `demos/<app>/<feature>.yml`. A person writes the top
half (feature, state, description: the beats in order); you write the
script under it. When asked to script or record a spec:

1. Read `docs/SCRIPT.md` (format) and the app's adapter in `src/apps/`
   (its `guide` lists selectors, shortcuts and how to reach common states).
2. Run `node src/cli.mjs inspect --app <app> [--content pack/item]` and look
   at the screenshot it writes to `out/`. Use only selectors you saw there
   or in the guide.
3. Under the spec, after the line
   `# Script (written from the spec above; edit freely) ----…`, write
   `content` and `setup` to reach the `state`, then `steps`, one group per
   beat with the beat's words as the first step's `note`. Leave the spec
   as the person wrote it. No captions or labels exist; the clip shows the
   app, the cursor and the keys. Aim for 8 to 30 seconds. Wait 800 to
   2000 ms after anything changes on screen. Use content packs for text.
4. Run `node src/cli.mjs check demos/<app>/<feature>.yml` until it passes.
   `check` only proves the steps ran; it doesn't prove the feature appeared.
5. Run `node src/cli.mjs record demos/<app>/<feature>.yml`, then pull a few
   frames (`ffmpeg -i out/x.mp4 -vf "fps=1/2.5,scale=640:-1,tile=4x4"
   sheet.png`) and look at them before calling the clip done. Typing that
   lands nowhere, modes that don't open and panes showing an empty part of
   a canvas are the usual failures, and only the frames show them.

Adding an app: copy `src/apps/hush.mjs`, register it in
`src/apps/index.mjs`. For a Tauri app, give the adapter
`tauri: { backend: (content, options) => ({ command_name: (args) => … }) }`;
the frontend's `invoke` calls are answered by that object in Node
(`src/apps/hush-backend.mjs` is a full example). Small apps can use
`tauri: { handlers: { command_name: (args, data) => … }, data }` instead,
which runs in the page.

Adding content: a folder in `content/` with `pack.yaml` listing items
(`kind: notebook` for a Hush notebook). Use public-domain or original text
only.
