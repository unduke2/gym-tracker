// Production build. Optional — index.html still opens directly in a browser and
// remains the single source of truth. This exists purely to delete Babel from
// the runtime path.
//
// Measured cost of NOT doing this, on the real 4500-line JSX block:
//   babel.min.js parse+eval    ~83 ms
//   in-browser JSX transform  ~1664 ms   (desktop V8)
//   ----------------------------------
//   ~1.75 s on a desktop, so roughly 5–9 s of blocked startup on a mid-range
//   phone — every single launch, including standing in the gym between sets.
//
// Output: dist/ containing the same app with the JSX pre-transpiled to app.js,
// the 2.8 MB Babel bundle dropped entirely, and sw.js's precache list rewritten
// to match. If this script ever breaks, Cloudflare Pages keeps serving the last
// good deploy and index.html still works unbuilt.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

const ROOT = import.meta.dirname;
const DIST = join(ROOT, "dist");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, "vendor"), { recursive: true });

// ── 1. Extract the JSX ────────────────────────────────────────────────────
const html = read("index.html");
const blocks = [...html.matchAll(/<script type="text\/babel">([\s\S]*?)<\/script>/g)];
if (blocks.length !== 1) {
  throw new Error(`Expected exactly 1 text/babel block, found ${blocks.length}. ` +
    `build.mjs assumes a single block — update it if the app is split up.`);
}

// ── 2. Transpile ──────────────────────────────────────────────────────────
// Target is es2018, not the ES5 that Babel's preset-env produces. Every browser
// that can run this PWA has supported es2018 for years, and keeping native
// const/let means temporal-dead-zone bugs now throw in the browser instead of
// being silently masked by Babel's const→var downleveling (which hid a real bug
// in v7.1 — see CLAUDE.md).
const { code, warnings } = await esbuild.transform(blocks[0][1], {
  loader: "jsx",
  target: "es2018",
  minify: true,
  legalComments: "none",
});
for (const w of warnings) console.warn("  warn:", w.text);
writeFileSync(join(DIST, "app.js"), code);

// ── 3. Rewrite index.html ─────────────────────────────────────────────────
let out = html
  .replace(/\s*<script src="vendor\/babel\.min\.js"><\/script>/, "")
  .replace(/<script type="text\/babel">[\s\S]*?<\/script>/, '<script src="app.js"></script>');
if (out.includes("text/babel") || out.includes("babel.min.js")) {
  throw new Error("Babel references survived the rewrite — refusing to ship a broken build.");
}
writeFileSync(join(DIST, "index.html"), out);

// ── 4. Rewrite the service worker ─────────────────────────────────────────
// The precache list must match what actually ships, and CACHE_VERSION has to
// change or clients keep serving the old shell from the previous cache.
const version = (html.match(/app-version">[^<]*?v([\d.]+)/) || [, "0"])[1];
let sw = read("sw.js")
  .replace(/const CACHE_VERSION = "[^"]*";/, `const CACHE_VERSION = "gym-v${version}";`)
  .replace(/^\s*"\.\/vendor\/babel\.min\.js",\n/m, '  "./app.js",\n');
if (sw.includes("babel.min.js")) throw new Error("sw.js still precaches babel.min.js");
if (!sw.includes('"./app.js"')) throw new Error("sw.js precache is missing app.js");
writeFileSync(join(DIST, "sw.js"), sw);

// ── 5. Copy the rest of the shell ─────────────────────────────────────────
for (const f of ["vendor/react.min.js", "vendor/react-dom.min.js", "icon.svg"]) {
  try { copyFileSync(join(ROOT, f), join(DIST, f)); }
  catch (e) { if (e.code !== "ENOENT") throw e; console.warn(`  skipped missing ${f}`); }
}

const kb = (s) => (s / 1024).toFixed(0).padStart(5) + " KB";
console.log(`\n  dist/ built — v${version}`);
console.log(`    app.js       ${kb(code.length)}   (was ${kb(blocks[0][1].length)} of JSX + 2867 KB of Babel)`);
console.log(`    index.html   ${kb(out.length)}`);
console.log(`    saved        ${kb(2867 * 1024 + blocks[0][1].length - code.length)} per cold load, ~1.7 s of parse per launch\n`);
