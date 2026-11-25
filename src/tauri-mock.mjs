// A stand-in for Tauri's IPC bridge, so a Tauri frontend can run in plain
// Chromium. Tauri v2's @tauri-apps/api calls window.__TAURI_INTERNALS__
// for everything (invoke, events, window labels), so defining that object
// before the app loads is enough for most apps.
//
// An app adapter supplies `tauri.handlers`: a map from command name to a
// function (cmd args) => result. Handlers are serialized into the page, so
// they must be self-contained (no closures over Node variables); pass data
// through `tauri.data`, available to handlers as `data`.
//
// For a stateful fake backend, an adapter can instead give
// `tauri.backend(content, options)`, which runs in Node and returns
// {command: (args) => result}. Commands the page doesn't handle itself are
// forwarded to it through window.__monkeyseeInvoke (see browser.mjs).
//
// Unknown commands resolve to null and are logged once, which is usually
// what a "nothing on disk yet" state looks like to the frontend.

export function tauriMockScript({ handlers = {}, data = {}, label = "main", platform = "macos" } = {}) {
  const entries = Object.entries(handlers)
    .map(([name, fn]) => `${JSON.stringify(name)}: ${typeof fn === "function" ? fn.toString() : fn}`)
    .join(",\n");
  return `(() => {
    const data = ${JSON.stringify(data)};
    const handlers = {${entries}};
    // Built-in plugin commands most apps touch at startup.
    const builtins = {
      "plugin:event|listen": () => Math.floor(Math.random() * 1e9),
      "plugin:event|unlisten": () => null,
      "plugin:event|emit": () => null,
      "plugin:os|platform": () => ${JSON.stringify(platform)},
      "plugin:os|os_type": () => ${JSON.stringify(platform)},
      "plugin:app|version": () => "0.0.0-demo",
      "plugin:window|is_visible": () => true,
      "plugin:window|is_fullscreen": () => false,
      "plugin:window|scale_factor": () => window.devicePixelRatio,
    };
    const warned = new Set();
    let cb = 1;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: ${JSON.stringify(label)} }, currentWebview: { windowLabel: ${JSON.stringify(label)}, label: ${JSON.stringify(label)} } },
      plugins: {},
      transformCallback: (fn, once) => { const id = cb++; window["_" + id] = (...a) => { if (once) delete window["_" + id]; return fn && fn(...a); }; return id; },
      unregisterCallback: (id) => { delete window["_" + id]; },
      convertFileSrc: (p, protocol = "asset") => protocol + "://localhost/" + encodeURIComponent(p),
      invoke: async (cmd, args = {}, options) => {
        // A raw-body invoke (bytes as the payload, details in headers) would
        // cross to Node as a huge plain object. Send it as base64 instead;
        // backends read it from args.__rawBody (and args.__headers).
        if (args instanceof ArrayBuffer || ArrayBuffer.isView(args)) {
          const bytes = args instanceof ArrayBuffer ? new Uint8Array(args) : new Uint8Array(args.buffer, args.byteOffset, args.byteLength);
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          args = { __rawBody: btoa(bin), __headers: (options && options.headers) || {} };
        }
        const h = handlers[cmd] || builtins[cmd];
        if (h) return h(args, data);
        if (window.__monkeyseeInvoke) return window.__monkeyseeInvoke(cmd, args);
        if (!warned.has(cmd)) { warned.add(cmd); console.debug("[monkeysee tauri mock] unhandled", cmd, args); }
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  })();`;
}
