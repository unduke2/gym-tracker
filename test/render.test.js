// Render coverage. Catches what a syntax check can't: undefined identifiers,
// missing props, and crashes inside a screen you only reach by navigating there.
// This is also the only thing that surfaces temporal-dead-zone bugs, which the
// browser hides because Babel Standalone downlevels const/let to var.
const M = require("./build.js")(true);
const { renderToString } = require("react-dom/server");
const h = React.createElement, noop = () => {};

const warn = []; const origErr = console.error;
console.error = (...a) => warn.push(a.join(" "));

let fails = 0;
const T = (label, el) => {
  try { const o = renderToString(el); console.log(`  ok   ${label}`); return o; }
  catch (e) { fails++; console.log(`  FAIL ${label}\n       ${e.message.split("\n")[0]}`); return ""; }
};
const has = (l, hay, n) => hay.includes(n) ? console.log("  ok   " + l)
  : (fails++, console.log(`  FAIL ${l}  (missing: ${n})`));
const hasnt = (l, hay, n) => !hay.includes(n) ? console.log("  ok   " + l)
  : (fails++, console.log(`  FAIL ${l}  (should not contain: ${n})`));

const logs = M._data.phul_logs, stats = M._data.phul_stats, diet = M._data.phul_diet;
const tg = (st, lg, ph) => M.computeTargets(st, lg, ph);

console.log("\n── Whole app ──");
const app = T("App (mounts and renders)", h(M.App));

console.log("\n── Dashboard: each program × hard mode on/off ──");
let locked = "";
for (const pid of Object.keys(M.PROGRAMS)) for (const hm of [false, true]) {
  const t = tg(stats, logs, "bulk");
  const o = T(`Dashboard [${pid}, hard=${hm}]`, h(M.Dashboard, {
    latest: stats[stats.length-1], phase:"bulk", kcalTarget:t.target, todayDiet:{kcal:0,protein:0},
    workoutLogs: logs, setTab:noop, setActiveSession:noop, startSession:noop, draftSession:null,
    pendingMakeups:[], startMakeup:noop, dismissMakeup:noop, program:M.PROGRAMS[pid],
    targets:t, trend:M.bodyTrendAlarm(stats,"bulk",t), hardMode:{on:hm,streak:hm?4:1,need:3} }));
  if (pid === "fullbody" && !hm) locked = o;
}
const t0 = tg([], {}, "bulk");
const fresh = T("Dashboard [fresh install, no data]", h(M.Dashboard, {
  latest: stats[0], phase:"bulk", kcalTarget:t0.target, todayDiet:{kcal:0,protein:0},
  workoutLogs:{}, setTab:noop, setActiveSession:noop, startSession:noop, draftSession:null,
  pendingMakeups:[], startMakeup:noop, dismissMakeup:noop, program:M.PROGRAMS.fullbody,
  targets:t0, trend:M.bodyTrendAlarm([],"bulk",t0), hardMode:{on:false,streak:0,need:3} }));

console.log("\n── SessionLogger: every day, both intensities ──");
const hard = {}, normal = {};
for (const pid of Object.keys(M.PROGRAMS)) for (const day of M.PROGRAMS[pid].order) for (const hm of [false, true]) {
  const o = T(`SessionLogger [${day}${hm ? " HARD" : ""}]`, h(M.SessionLogger, {
    dayName: day, plan: M.applyIntensity(M.PROGRAMS[pid].days[day], hm), workoutLogs: logs,
    onFinish:noop, onCancel:noop, onDiscard:noop, savedSession:null, onSaveSession:noop }));
  (hm ? hard : normal)[day] = o;
}
T("SessionLogger [hard, zero history]", h(M.SessionLogger, {
  dayName:"Full Body A", plan: M.applyIntensity(M.FULLBODY["Full Body A"], true), workoutLogs:{},
  onFinish:noop, onCancel:noop, onDiscard:noop, savedSession:null, onSaveSession:noop }));

console.log("\n── Other tabs ──");
for (const pid of Object.keys(M.PROGRAMS))
  T(`WorkoutTab [${pid}]`, h(M.WorkoutTab, { workoutLogs:logs, setWorkoutLogs:noop, setActiveSession:noop,
    startSession:noop, draftSession:null, customSessions:[], setCustomSessions:noop,
    program:M.PROGRAMS[pid], programId:pid, setProgramId:noop }));
let dietOut = "";
for (const [lbl, st, lg, dt, ph] of [["real",stats,logs,diet,"bulk"], ["cut",stats,logs,diet,"cut"],
    ["no diet logs",stats,logs,{},"bulk"], ["no body stats",[],logs,diet,"bulk"], ["totally empty",[],{},{},"bulk"]]) {
  const t = tg(st, lg, ph);
  const o = T(`DietTab [${lbl}]`, h(M.DietTab, { today:"2026-08-03", todayDiet:dt["2026-08-03"]||{kcal:0,protein:0},
    dietLogs:dt, setDietLogs:noop, phase:ph, stats:st, targets:t, trend:M.bodyTrendAlarm(st,ph,t), setTab:noop }));
  if (lbl === "real") dietOut = o;
}
T("StatsTab", h(M.StatsTab, { stats, setStats:noop, phase:"bulk", theme:"carbon", setTheme:noop }));

console.log("\n── Technique cues appear only on the final set ──");
{
  const plan = M.applyIntensity(M.FULLBODY["Full Body A"], true);
  const at = (exName, idx, doneBefore) => {
    const data = {};
    for (const e of plan.exercises) data[e.name] = Array.from({length:e.sets}, () => ({weight:"",reps:"",rpe:null,done:false}));
    for (let i = 0; i < doneBefore; i++) data[exName][i] = { weight:"20", reps:"8", rpe:8, done:true };
    return renderToString(h(M.SessionLogger, { dayName:"Full Body A", plan, workoutLogs: logs,
      onFinish:noop, onCancel:noop, onDiscard:noop, onSaveSession:noop,
      savedSession:{ data, activeEx:exName, activeIdx:idx, exerciseHolds:{}, warmedUp:[exName], sessionStartedAt:Date.now() } }));
  };
  const first = at("Squat", 0, 0), last = at("Squat", 3, 3), myo = at("EZ Bar Curl", 2, 2);
  hasnt("no AMRAP cue on set 1", first, "AMRAP");
  has("AMRAP cue on the final set", last, "AMRAP");
  has("AMRAP cue names the RPE 9 stop", last, "still in the tank");
  has("myo-rep cue on an isolation final set", myo, "Myo-reps");
  has("myo cue says to break the superset", myo, "not in the superset");
}

console.error = origErr;
const real = warn.filter(w => !/useLayoutEffect does nothing on the server/.test(w));
if (real.length) { console.log("\n── React warnings ──");
  [...new Set(real)].slice(0, 8).forEach(w => console.log("  ! " + w.slice(0, 200))); }

console.log("\n── Content ──");
hasnt("no weekly-quota shame text anywhere", app, "/4 sessions");
has("locked hard-mode gate shows before the streak", fresh, "HARD MODE");
has("gate explains why it's locked", fresh, "boring Tuesday");
{
  const n = normal["Full Body A"].replace(/<[^>]*>/g," ").replace(/\s+/g," ");
  const d = hard["Full Body A"].replace(/<[^>]*>/g," ").replace(/\s+/g," ");
  has("hard mode puts main lifts on 4 sets", d, "0 / 4");
  hasnt("normal mode keeps them on 3", n, "0 / 4");
}
has("warm-up ramp starts from an empty bar", normal["Full Body A"], "bar only");
has("diet shows the 7-day average", dietOut, "7-day average");
has("diet quick-add is mined from logged meals", dietOut, "Dinner");

console.log("\n── Diet tab: fast log, scale first ──");
{
  has("weigh-in card is present", dietOut, "Weigh-in");
  has("weigh-in has a call to action", dietOut, "Log a weigh-in");
  has("one-tap section exists", dietOut, "One tap");
  has("rough whole-day escape hatch exists", dietOut, "be bothered");
  has("rough buttons are labelled", dietOut, "normal");
  has("chip numbers are explained", dietOut, "middle of what you");
  hasnt("meal library tab is gone", dietOut, ">Meals<");
  hasnt("no per-ingredient library UI", dietOut, "carbHeavy");
}

{
  // The modal is state-gated, so drive it: render with an entry present and
  // confirm the row exposes an edit affordance rather than only a delete.
  const t = tg(stats, logs, "bulk");
  const withEntry = { "2026-08-03": { kcal: 1200, protein: 60,
    extras: [{ name: "Lunch", kcal: 1200, prot: 60 }], meals: [] } };
  const out = renderToString(h(M.DietTab, { today:"2026-08-03", todayDiet: withEntry["2026-08-03"],
    dietLogs: withEntry, setDietLogs: noop, phase:"bulk", stats, targets: t,
    trend: M.bodyTrendAlarm(stats,"bulk",t), setTab: noop }));
  has("a logged entry renders an edit affordance", out, "mr-edit");
  has("and still offers delete", out, "Remove Lunch");
}

console.log("\n── UI regressions found by the v8.10 audit ──");
{
  const css = require("fs").readFileSync(__dirname + "/../index.html", "utf8")
    .match(/<style>([\s\S]*?)<\/style>/)[1];
  // .section-head was scoped to .card, so the seven headers on non-.card panels
  // (roll-card, quick-card x2, weigh-card, stats-current, log-form, catchup-card)
  // rendered with no flex, no space-between and no bottom margin at all.
  const scoped = /^\.card \.section-head \{/m.test(css);
  const bare = /^\.section-head \{/m.test(css);
  bare && !scoped ? console.log("  ok   .section-head applies outside .card")
    : (fails++, console.log("  FAIL .section-head is still card-scoped"));
  // The rotation strip was a fixed 4-column grid; the default program has 2 days.
  const strip = css.match(/\.week-strip \{[^}]*\}/)[0];
  !/repeat\(4/.test(strip) ? console.log("  ok   rotation strip adapts to program length")
    : (fails++, console.log("  FAIL .week-strip still hardcodes 4 columns"));
  // Card gutters have to match or stacked cards step in and out.
  const radii = [...css.matchAll(/\.(next-card|trend-alarm|roll-card|weigh-card)[^{]*\{[^}]*border-radius:\s*([^;]+);/g)]
    .map(m => m[2].trim());
  radii.every(r => r.startsWith("var(--r")) ? console.log("  ok   card radii use the shape scale")
    : (fails++, console.log("  FAIL off-scale card radii: " + radii.join(", ")));
}
{
  // Full-body days carry type "fullbody"; both ternaries fell through to
  // "Hypertrophy", mislabelling the default program on the first screen.
  const t = tg(stats, logs, "bulk");
  const dash = renderToString(h(M.Dashboard, {
    latest: stats[stats.length-1], phase:"bulk", kcalTarget:t.target, todayDiet:{kcal:0,protein:0},
    workoutLogs: {}, setTab:noop, setActiveSession:noop, startSession:noop, draftSession:null,
    pendingMakeups:[], startMakeup:noop, dismissMakeup:noop, program:M.PROGRAMS.fullbody,
    targets:t, trend:M.bodyTrendAlarm(stats,"bulk",t), hardMode:{on:false,streak:0,need:3} }));
  hasnt("full-body day is not labelled Hypertrophy", dash, "Hypertrophy");
  has("it is labelled Full body", dash, "Full body");
  const sess = renderToString(h(M.SessionLogger, { dayName:"Full Body A",
    plan: M.FULLBODY["Full Body A"], workoutLogs: logs,
    onFinish:noop, onCancel:noop, onDiscard:noop, savedSession:null, onSaveSession:noop }));
  hasnt("session header is not labelled Hypertrophy either", sess, "Hypertrophy");
  // The hero counted optional finishers as exercises.
  hasnt("hero does not count optional finishers", dash, "9 exercises");
}
{
  // Two identically-labelled CTAs stacked on the diet tab.
  const n = (dietOut.match(/Log a weigh-in/g) || []).length;
  n <= 1 ? console.log("  ok   only one 'Log a weigh-in' CTA")
    : (fails++, console.log(`  FAIL ${n} duplicate weigh-in CTAs`));
}

console.log("\n── Consistency card is legible ──");
{
  has("week columns are labelled with dates", app, 'class="wk-d"');
  has("the current week is marked 'now'", app, ">now<");
  has("row is explained rather than eight bare squares", app, "sessions per week");
  hasnt("no bare 30-day count masquerading as a headline", app, "· 30d");
}

console.log("\n── Effort target is visible on every exercise ──");
{
  const plan = M.FULLBODY["Full Body A"];
  const at = (exName) => {
    const data = {};
    for (const e of plan.exercises) data[e.name] = Array.from({length:e.sets}, () => ({weight:"",reps:"",rpe:null,done:false}));
    return renderToString(h(M.SessionLogger, { dayName:"Full Body A", plan, workoutLogs: logs,
      onFinish:noop, onCancel:noop, onDiscard:noop, onSaveSession:noop,
      savedSession:{ data, activeEx:exName, activeIdx:0, exerciseHolds:{}, warmedUp:[exName], sessionStartedAt:Date.now() } }));
  };
  const compound = at("Bench Press"), isolation = at("EZ Bar Curl");
  has("compound shows the hold-back target", compound, "Stop at RPE 8");
  has("compound explains it", compound, "leave 2 clean reps");
  hasnt("compound is not told to go to failure", compound, "Last set to failure");
  has("isolation is told to go to failure", isolation, "Last set to failure");
  hasnt("isolation is not capped at RPE 8", isolation, "Stop at RPE 8");
}

console.log("\n── Ending a session early requires confirmation ──");
{
  // Regression: this button was green, sat under the set-logging controls, said
  // "Good enough — log it ✓" and fired on ONE tap. It ended a real workout
  // mid-session. It must never be one-tap or read as a per-exercise action.
  const plan = M.FULLBODY["Full Body A"];
  const core = plan.exercises.filter(e => !e.optional);
  const data = {};
  for (const e of plan.exercises) data[e.name] = Array.from({length:e.sets}, () => ({weight:"",reps:"",rpe:null,done:false}));
  for (const e of core.slice(0, 3)) data[e.name] = data[e.name].map(() => ({weight:"40",reps:"8",rpe:8,done:true}));
  const out = renderToString(h(M.SessionLogger, { dayName:"Full Body A", plan, workoutLogs: logs,
    onFinish:noop, onCancel:noop, onDiscard:noop, onSaveSession:noop,
    savedSession:{ data, activeEx: core[3].name, activeIdx:0, exerciseHolds:{}, warmedUp:[], sessionStartedAt:Date.now() } }));
  has("early-exit option appears once 3 lifts are done", out, "End session early");
  hasnt("it no longer says 'log it', which read as logging one exercise", out, "log it");
  hasnt("it is not styled as a positive/confirmed action", out, "Good enough");
  has("it states what it costs", out, "still counts");
  // The armed state must be reachable only after an explicit first tap, so the
  // destructive copy must NOT be in the initial render.
  hasnt("the destructive confirm is not shown unarmed", out, "This ends the session now");
  hasnt("no one-tap End button in the unarmed state", out, ">End session<");
}

console.log("\n── v9.0: supersets and timed holds render ──");
{
  const plan = M.FULLBODY["Full Body A"];
  const at = (exName, extra = {}) => {
    const data = {};
    for (const e of plan.exercises) data[e.name] = Array.from({length:e.sets}, () => ({weight:"",reps:"",rpe:null,done:false}));
    Object.assign(data, extra);
    return renderToString(h(M.SessionLogger, { dayName:"Full Body A", plan, workoutLogs: logs,
      onFinish:noop, onCancel:noop, onDiscard:noop, onSaveSession:noop,
      savedSession:{ data, activeEx:exName, activeIdx:0, exerciseHolds:{}, warmedUp:[exName], sessionStartedAt:Date.now() } }));
  };
  const curl = at("EZ Bar Curl");
  has("superset leader announces its partner", curl, "superset · then <strong>Skull Crushers");
  has("paired rows are marked in the list", curl, ">⇄<");
  const skullsDone = at("EZ Bar Curl", { "Skull Crushers": [1,2,3].map(() => ({weight:"15",reps:"10",rpe:9,done:true})) });
  hasnt("no partner tag once the partner is finished", skullsDone, "superset · then");
  const plank = at("Side Plank");
  has("timed hold shows a target in seconds", plank, "s / side");
  has("timed hold shows the seconds range", plank, "30-45 sec");
  hasnt("no plate/kg suggestion on a bodyweight hold", plank, "kg plates");
  const logged = at("Side Plank", { "Side Plank": [{weight:"",reps:"40",rpe:null,done:true},{weight:"",reps:"",rpe:null,done:false}] });
  has("a logged hold reads as seconds, not '×40'", logged, ">40s<");
  const carry = renderToString(h(M.SessionLogger, { dayName:"Full Body B", plan: M.FULLBODY["Full Body B"], workoutLogs: logs,
    onFinish:noop, onCancel:noop, onDiscard:noop, onSaveSession:noop,
    savedSession:{ data: Object.fromEntries(M.FULLBODY["Full Body B"].exercises.map(e => [e.name, Array.from({length:e.sets}, () => ({weight:"",reps:"",rpe:null,done:false}))])),
      activeEx:"Suitcase Carry", activeIdx:0, exerciseHolds:{}, warmedUp:[], sessionStartedAt:Date.now() } }));
  has("a loaded carry still takes a weight", carry, "Suggested");
  has("…in seconds", carry, "30-45 sec");
}

console.log(`\n${"─".repeat(52)}\n  ${fails ? fails + " FAILED" : "all render checks passed"}\n`);
process.exit(fails ? 1 : 0);
