// Loads the real app out of index.html so its logic and components can be
// exercised in node. There is no build step and no test framework in this
// project, so this is the entire test harness.
//
// Two things it has to work around:
//   1. The app is a single <script type="text/babel"> block, so it gets
//      extracted and transpiled with esbuild before node can require it.
//   2. It expects a browser. localStorage/document/window are shimmed, and the
//      trailing ReactDOM.createRoot(...) is stripped so nothing tries to mount.
//
// load(false) → fast path, plain-object React stub, for pure-logic tests.
// load(true)  → real React, for renderToString coverage.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const DAY = 86400000;

// Fixture dates are stored as `daysAgo` so the fixture never ages into
// staleness and the staleness/streak logic stays testable forever.
function hydrate(fixture) {
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY);

  const out = { ...fixture };
  out.phul_stats = (fixture._stats || []).map(s => {
    const { daysAgo, ...rest } = s;
    return { ...rest, date: iso(at(daysAgo)) };
  });

  out.phul_logs = {};
  for (const l of (fixture._logs || [])) {
    const { daysAgo, exercises, _why, ...rest } = l;
    const d = at(daysAgo), ts = d.getTime();
    const ex = {};
    for (const [name, sets] of Object.entries(exercises)) {
      // compact [weight, reps, rpe] tuples → the real stored set shape
      ex[name] = sets.map(([weight, reps, rpe]) => ({
        weight, reps, rpe: rpe ?? null,
        done: !!(String(weight).trim() && String(reps).trim()),
      }));
    }
    out.phul_logs[`${iso(d)}_${rest.day.replace(/ /g, "_")}_${ts}`] = { ...rest, date: iso(d), ts, exercises: ex };
  }

  out.phul_diet = {};
  for (const e of (fixture._diet || [])) {
    const { daysAgo, ...rest } = e;
    out.phul_diet[iso(at(daysAgo))] = { ...rest, meals: [] };
  }

  for (const k of Object.keys(out)) if (k.startsWith("_")) delete out[k];
  return out;
}

module.exports = function load(withReact = false) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const block = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)[1];
  const raw = path.join(HERE, ".tmp.jsx"), cjs = path.join(HERE, ".tmp.cjs.js");
  fs.writeFileSync(raw, block.replace(/ReactDOM\.createRoot\([\s\S]*?\);\s*$/m, ""));
  execFileSync("npx", ["--yes", "esbuild", "--format=cjs", `--outfile=${cjs}`, raw],
    { stdio: ["ignore", "ignore", "inherit"] });

  const data = hydrate(JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "sample-backup.json"), "utf8")));
  const store = new Map();
  for (const [k, v] of Object.entries(data)) store.set(k, JSON.stringify(v));

  global.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  global.document = {
    querySelector: () => null, getElementById: () => null,
    documentElement: { setAttribute() {} }, addEventListener() {}, removeEventListener() {},
  };
  global.window = { confirm: () => true, alert() {}, addEventListener() {}, removeEventListener() {} };
  global.navigator = { userAgent: "node" };
  global.React = withReact ? require("react") : {
    useState: i => [typeof i === "function" ? i() : i, () => {}],
    useEffect() {}, useRef: v => ({ current: v }), createElement: () => null, Component: class {},
  };
  global.ReactDOM = withReact ? require("react-dom") : { createRoot: () => ({ render() {} }) };

  const NAMES = [
    "num", "isScorable", "calcNextWeight", "computeRestartWeight", "warmupSets", "stalenessFactor",
    "getEquipmentType", "getRestSeconds", "snap", "PHUL", "FULLBODY", "PROGRAMS", "lookupDay",
    "coreExercises", "MIGRATION_REPORT", "computeTargets", "bodyTrendAlarm", "daysSinceWeighIn",
    "weightTrend", "consistency", "hardModeState", "applyIntensity", "FINISHERS", "HARD_MODE_WEEKS", "effortTarget",
    ...(withReact ? ["App", "Dashboard", "WorkoutTab", "DietTab", "StatsTab", "SessionLogger"] : []),
  ];
  const file = path.join(HERE, withReact ? ".tmp.app-react.js" : ".tmp.app.js");
  fs.writeFileSync(file, fs.readFileSync(cjs, "utf8") + "\nmodule.exports={" + NAMES.join(",") + "};\n");

  const M = require(file);
  M._data = data;
  M._store = store;
  return M;
};
module.exports.DAY = DAY;
