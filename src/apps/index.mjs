// App adapters. Each one says how to start the app's frontend, how to seed
// demo content into it, when it is ready, and gives the planner a short
// guide to its selectors and shortcuts. See docs/DESIGN.md ("Adapters").
import hush from "./hush.mjs";
import fixture from "./fixture.mjs";
import snorkle from "./snorkle.mjs";

const apps = { hush, snorkle, fixture };

export function getApp(name) {
  const app = apps[name];
  if (!app) throw new Error(`Unknown app "${name}". Known apps: ${Object.keys(apps).join(", ")}`);
  return app;
}

export const appNames = () => Object.keys(apps);
