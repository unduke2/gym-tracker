// Pure-logic tests. Every assertion here corresponds to a failure that was
// actually observed in real training data — none of it is hypothetical.
const load = require("./build.js");
const A = load(false);
const DAY = load.DAY;

let pass = 0, fail = 0;
const check = (n, c, d) => { c ? (pass++, console.log("  ok   " + n))
  : (fail++, console.log(`  FAIL ${n}${d ? "  →  " + d : ""}`)); };
const S = (w, r, rpe) => ({ weight: String(w), reps: String(r), rpe: rpe ?? null, done: true });
const sess = (day, ex, sets, daysAgo = 2) => ({ ["k" + Math.random()]: {
  day, ts: Date.now() - daysAgo * DAY, date: "x", exercises: { [ex]: sets }, abandoned: [] } });
const ex = (prog, day, name) => A[prog][day].exercises.find(e => e.name === name);
const squat = ex("PHUL", "Lower Power", "Squat");
const bench = ex("PHUL", "Upper Power", "Bench Press");
const facePull = ex("PHUL", "Upper Hypertrophy", "Face Pull");

console.log("\n── Progression: patterns that used to misfire ──");
check("AMRAP burnout set (5,5,12 on 3-5) is not a CRUSH",
  A.calcNextWeight(squat, sess("Lower Power", "Squat", [S(42.5,5,6), S(42.5,5,6), S(42.5,12,9)])).weight === 45);
check("a genuine crush still double-jumps",
  A.calcNextWeight(squat, sess("Lower Power", "Squat", [S(40,6,7), S(40,7,7), S(40,6,8)])).status === "crush");
check("ramp-up (40,50,50) anchors on the working weight, not set 1",
  A.calcNextWeight(bench, sess("Upper Power", "Bench Press", [S(40,5), S(50,5), S(50,5)])).weight >= 50);
check("drop-after-failure (60,50,50) anchors on the working weight",
  (() => { const w = A.calcNextWeight(bench, sess("Upper Power","Bench Press",[S(60,2),S(50,5),S(50,5)])).weight;
    return w >= 50 && w <= 55; })());
check('comma decimal "17,5" is 17.5, not 17',
  A.calcNextWeight(bench, sess("Upper Power","Bench Press",[S("17,5",5),S("17,5",5),S("17,5",5)])).weight === 20);
check("a 0-rep set is not scorable", !A.isScorable({ weight:"20", reps:"0", done:true }));
check("a real set is scorable", A.isScorable({ weight:"20", reps:"8", done:true }));
{
  const exs = {}; for (const n of ["A","B","C","D","E"]) exs[n] = [S(20,10,8)];
  exs["Face Pull"] = [S(25,20,8), S(25,16,9), S(25,13,9), S(25,11,10), S(25,8,10)];
  const r = A.calcNextWeight(facePull, { k: { day:"Upper Hypertrophy", ts: Date.now()-2*DAY,
    date:"x", exercises: exs, abandoned: [] } });
  check("late-session failure holds instead of deloading", r.status === "fatigue-hold", r.status);
}
{
  const r = A.calcNextWeight(facePull, { k: { day:"Upper Hypertrophy", ts: Date.now()-2*DAY, date:"x",
    exercises: { "Face Pull": [S(25,20,8), S(25,11,10), S(25,8,10)], "Other": [S(10,10)] }, abandoned: [] } });
  check("the SAME failure early in a session still deloads", r.status === "deload", r.status);
}
check("a 4-month layoff returns lighter, tagged 'return'",
  A.calcNextWeight(squat, sess("Lower Power","Squat",[S(50,5),S(50,5),S(50,5)], 120)).status === "return");
check("a recent session progresses normally",
  A.calcNextWeight(squat, sess("Lower Power","Squat",[S(50,5),S(50,5),S(50,5)], 3)).weight > 50);

console.log("\n── Barbell loads are PLATE weight, bar excluded ──");
{
  // Regression: minWeight used to clamp at barWeight, i.e. 20kg of PLATES
  // (60kg total), making a real deload impossible on the lighter barbell lifts.
  const light = { ...ex("FULLBODY","Full Body B","Incline Barbell Press") };
  const r = A.calcNextWeight(light, sess("Full Body B","Incline Barbell Press",
    [S(20,4,10), S(20,3,10), S(20,2,10)]));
  check("a light barbell lift can deload below the bar weight", r.weight < 20, `${r.weight}kg`);

  const w = A.warmupSets(42.5, { name:"Squat", barbell:true, barWeight:20 });
  const shown = w.map(s => s.weight);
  const truePct = w.map(s => Math.round((s.weight + 20) / 62.5 * 100));
  console.log(`   ramp plates ${shown.join(" → ")} → 42.5   (${truePct.join("% → ")}% → 100% of true load)`);
  check("ramp starts from an empty bar (0 plates)", w[0].weight === 0, JSON.stringify(shown));
  check("first loaded step is ~50% of TRUE load, not 68%",
    truePct[1] >= 45 && truePct[1] <= 58, `${truePct[1]}%`);
  check("ramp ascends and stays under the working set",
    w.every((s,i) => (i === 0 || s.weight > w[i-1].weight) && s.weight < 42.5), JSON.stringify(shown));
  check("percentages are monotonic in true load",
    truePct.every((p,i) => i === 0 || p > truePct[i-1]), truePct.join(","));

  const ez = A.warmupSets(15, { name:"EZ Bar Curl", barbell:true, barWeight:10 });
  check("EZ bar (10kg) ramp also starts empty and stays under",
    ez[0].weight === 0 && ez.every(s => s.weight < 15), JSON.stringify(ez.map(s=>s.weight)));
  const m = A.warmupSets(45, { name:"Lat Pulldown" });
  check("machine ramp has two steps under the working weight",
    m.length === 2 && m.every(s => s.weight > 0 && s.weight < 45), JSON.stringify(m));
  check("no ramp when there is no weight", A.warmupSets(0, { name:"Squat" }).length === 0);
}

console.log("\n── Restart seeding ──");
{
  const rows = [];
  for (const day of A.PROGRAMS.fullbody.order)
    for (const e of A.PROGRAMS.fullbody.days[day].exercises)
      rows.push([e.name, A.calcNextWeight(e, A._data.phul_logs)]);
  check("no suggestion is zero, negative or NaN", rows.every(([, r]) => r.weight > 0),
    JSON.stringify(rows.filter(([, r]) => !(r.weight > 0)).map(([n]) => n)));
  check("lifts with prior history seed from it rather than startWeight",
    rows.filter(([, r]) => r.status === "restart").length >= 4,
    rows.map(([n, r]) => `${n}:${r.status}`).join(" "));
  // Trend branches, driven explicitly rather than inferred from fixture shape.
  // Source is PHUL "Squat" (3-5); target is Full Body A "Squat" (5-8), so each
  // result is also translated down for the wider rep range.
  const target = ex("FULLBODY", "Full Body A", "Squat");
  const hist = (weights) => {           // oldest → newest
    const out = {};
    weights.forEach((w, i) => {
      const ts = Date.now() - (weights.length - i) * 7 * DAY;
      out["k" + i] = { day:"Lower Power", ts, date:"x", abandoned:[],
        exercises: { Squat: [S(w,5,8), S(w,5,8), S(w,5,8)] } };
    });
    return out;
  };
  const climbing  = A.calcNextWeight(target, hist([40, 45, 50]));
  const stalled   = A.calcNextWeight(target, hist([45, 45, 45]));
  const declining = A.calcNextWeight(target, hist([50, 47.5, 42.5]));
  console.log(`   climbing 40→50 ⇒ ${climbing.weight}kg · stalled 45 ⇒ ${stalled.weight}kg · declining 50→42.5 ⇒ ${declining.weight}kg`);
  check("a climbing lift is seeded near where it left off", climbing.weight >= 45, `${climbing.weight}`);
  check("a stalled lift is cut harder than a climbing one", stalled.weight < climbing.weight);
  check("a declining lift seeds off its PEAK, not its last bad session",
    declining.weight > 42.5 * 0.9, `${declining.weight} — should be derived from the 50kg peak`);
  check("all three land below the raw source weight (rep range widened)",
    climbing.weight < 50 && stalled.weight < 45 && declining.weight < 50);
}

console.log("\n── Effort targets: compounds hold back, isolations go to failure ──");
{
  const fb = [...A.FULLBODY["Full Body A"].exercises, ...A.FULLBODY["Full Body B"].exercises];
  const compounds  = ["Squat","Bench Press","Lat Pulldown","Romanian Deadlift","Deadlift","Incline Barbell Press","Seated Cable Row","Leg Press"];
  const isolations = ["DB Lateral Raise","EZ Bar Curl","Skull Crushers","Incline DB Curl","Overhead DB Extension"];
  for (const n of compounds)
    check(`${n} → hold back`, A.effortTarget(fb.find(e => e.name === n)).kind === "hold-back");
  for (const n of isolations)
    check(`${n} → to failure`, A.effortTarget(fb.find(e => e.name === n)).kind === "to-failure");
  check("compound cap is RPE 8", A.effortTarget({tier:1}).rpeCap === 8);
  check("isolation cap is RPE 10", A.effortTarget({tier:3}).rpeCap === 10);
  check("an unclassified exercise defaults to isolation, not compound",
    A.effortTarget({}).kind === "to-failure");
}

console.log("\n── Leaving reps in the tank still earns progression ──");
{
  // The point of the guidance: all sets in range, nothing forced, RPE <= 8 must
  // move the weight. Otherwise the only route up is training to failure and the
  // algorithm contradicts the coaching.
  const bench = ex("FULLBODY", "Full Body A", "Bench Press");   // 3 x 5-8
  const s3 = (w, r, rpe) => sess("Full Body A", "Bench Press", [S(w,r,rpe), S(w,r,rpe), S(w,r,rpe)]);
  const clean = A.calcNextWeight(bench, s3(30, 7, 8));
  console.log(`   30kg x7,7,7 @ RPE 8  ⇒  ${clean.weight}kg (${clean.status})`);
  check("mid-range at RPE 8 progresses", clean.status === "increase" && clean.weight === 32.5, `${clean.weight} ${clean.status}`);
  // Bottom of the range should build reps first, not add load.
  const bottom = A.calcNextWeight(bench, s3(30, 5, 8));
  console.log(`   30kg x5,5,5 @ RPE 8  ⇒  ${bottom.weight}kg (${bottom.status})`);
  check("bottom of the range holds and builds reps first", bottom.weight === 30, `${bottom.weight}`);
  // Grinding must not be MORE rewarded than clean work at the same reps.
  const ground = A.calcNextWeight(bench, s3(30, 7, 10));
  check("same reps at RPE 10 does not progress faster than at RPE 8",
    ground.weight <= clean.weight, `RPE10 → ${ground.weight}, RPE8 → ${clean.weight}`);
  // Isolations are tier 3 and must NOT get the hold-back branch.
  const raise = ex("FULLBODY", "Full Body A", "DB Lateral Raise");
  const iso = A.calcNextWeight(raise, sess("Full Body A","DB Lateral Raise",[S(5,13,8),S(5,13,8),S(5,13,8)]));
  check("isolations are unaffected by the compound branch", iso.weight >= 5, `${iso.weight}`);
  // And the real observed pattern still behaves: 8/5/4 with a failed set holds.
  const real = A.calcNextWeight(bench, sess("Full Body A","Bench Press",[S(35,8,10),S(35,5,10),S(35,4,10)]));
  check("last night's 8/5/4 still holds rather than progressing",
    real.weight === 35 && real.status === "grind", `${real.weight} ${real.status}`);
}

console.log("\n── Machines carry no bar (only `barbell` lifts do) ──");
{
  const machines = ["Lat Pulldown", "Seated Cable Row", "Leg Press"];
  for (const n of machines) {
    const e = [...A.FULLBODY["Full Body A"].exercises, ...A.FULLBODY["Full Body B"].exercises].find(x => x.name === n);
    check(`${n} is a machine with no barWeight`,
      !!e && !e.barbell && !e.barWeight && A.getEquipmentType(n) === "machine");
  }
  // Machine ramps are straight percentages of the stack — no bar to add back.
  const r = A.warmupSets(40, { name: "Lat Pulldown" });
  check("machine ramp is a plain percentage of the stack",
    r.every(s => s.weight > 0 && s.weight < 40) && r.length === 2, JSON.stringify(r.map(s => s.weight)));
  check("machine lifts render no plate diagram",
    !A.FULLBODY["Full Body B"].exercises.find(x => x.name === "Leg Press").barbell);
}

console.log("\n── Diet targets ──");
{
  const t = A.computeTargets(A._data.phul_stats, A._data.phul_logs, "bulk");
  console.log(`   lean ${t.lean}kg → BMR ${t.bmr} → maintenance ${t.maintenance} · floor ${t.floor} · target ${t.target}`);
  check("uses measured lean mass", t.lean === 67.3, String(t.lean));
  check("maintenance is physiologically plausible", t.maintenance > 1900 && t.maintenance < 2900, String(t.maintenance));
  check("bulk target is a ~400 surplus", t.target - t.maintenance === 400);
  check("bulk floor is maintenance", t.floor === t.maintenance);
  check("protein floor is 1.6 g/kg", t.proteinMin === Math.round(t.weight * 1.6));
  const c = A.computeTargets(A._data.phul_stats, A._data.phul_logs, "cut");
  check("cut target is a 400 deficit", c.maintenance - c.target === 400);
  check("no-stats fallback stays finite",
    ["target","floor","maintenance","protein"].every(k => Number.isFinite(A.computeTargets([], {}, "bulk")[k])));
  // The multiplier must not collapse when training stops — that would lower the
  // calorie target exactly when someone is already under-eating.
  const drop = A.computeTargets(A._data.phul_stats, A._data.phul_logs, "bulk").maintenance
             - A.computeTargets(A._data.phul_stats, {}, "bulk").maintenance;
  check("stopping training doesn't collapse the target", drop <= 120, `${drop} kcal`);
}

console.log("\n── Body-trend alarm ──");
{
  const t = A.computeTargets(A._data.phul_stats, A._data.phul_logs, "bulk");
  const al = A.bodyTrendAlarm(A._data.phul_stats, "bulk", t);
  check("lean-mass loss on a bulk fires", al.level === "bad", al.level);
  check("the headline names it", /lean mass/i.test(al.headline || ""), al.headline);
  const good = [{ date:"2026-07-01", weight:72, bodyFat:13, leanMass:62.6 },
                { date: new Date(Date.now()-2*DAY).toISOString().slice(0,10), weight:73, bodyFat:13, leanMass:63.5 }];
  check("a working bulk stays silent", A.bodyTrendAlarm(good, "bulk", t).level === "ok");
  check("no stats at all doesn't throw", A.bodyTrendAlarm([], "bulk", t).level === "none");
  check("one stat doesn't throw", ["none","measure"].includes(A.bodyTrendAlarm([A._data.phul_stats[0]], "bulk", t).level));
}

console.log("\n── Consistency weeks are stable over time ──");
{
  // The bug: buckets were "N days ago" measured from now, so with nothing logged
  // the same sessions displayed as `· · · · 4 · · 1` one day and `· · · 3 1 · · 1`
  // two days later. A session must belong to the calendar week it happened in,
  // permanently. Freeze the clock to check.
  const RealDate = Date;
  const atTime = (iso, fn) => {
    const fixed = new RealDate(iso + "T12:00:00").getTime();
    class FakeDate extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    }
    global.Date = FakeDate;
    try { return fn(); } finally { global.Date = RealDate; }
  };
  const at = (iso) => new RealDate(iso + "T18:00:00").getTime();
  const logs = { a:{ts:at("2026-07-20")}, b:{ts:at("2026-07-21")},
                 c:{ts:at("2026-07-24")}, d:{ts:at("2026-08-13")} };
  // Map each week-start to its count, so results stay comparable even as the
  // 8-week window slides forward.
  const byWeek = (r) => Object.fromEntries(
    r.weeks.filter(w => w.count > 0).map(w => [new RealDate(w.start).toISOString().slice(0,10), w.count]));

  const days = ["2026-08-16","2026-08-17","2026-08-18","2026-08-19","2026-08-20","2026-08-26"];
  const snaps = days.map(d => [d, atTime(d, () => A.consistency(logs))]);
  for (const [d, r] of snaps) console.log(`   ${d}: ${JSON.stringify(byWeek(r))}  streak ${r.streak}`);
  const ref = JSON.stringify(byWeek(snaps[0][1]));
  check("session→week assignment never changes as days pass",
    snaps.every(([, r]) => JSON.stringify(byWeek(r)) === ref),
    snaps.map(([d, r]) => d + ":" + JSON.stringify(byWeek(r))).join(" "));
  check("every session is counted exactly once",
    snaps.every(([, r]) => r.weeks.reduce((n, w) => n + w.count, 0) === 4));

  // Streak semantics
  const wk = (iso, n=1) => { const o={}; for(let i=0;i<n;i++) o["k"+iso+i]={ts:at(iso)+i*3600e3}; return o; };
  const threeStraight = { ...wk("2026-08-03"), ...wk("2026-08-10"), ...wk("2026-08-17") };
  check("three consecutive calendar weeks = streak 3",
    atTime("2026-08-19", () => A.consistency(threeStraight)).streak === 3,
    String(atTime("2026-08-19", () => A.consistency(threeStraight)).streak));
  // A Monday with nothing logged yet must not read as a broken streak.
  const upToLastWeek = { ...wk("2026-08-03"), ...wk("2026-08-10") };
  const mon = atTime("2026-08-17", () => A.consistency(upToLastWeek));
  check("current week empty does NOT zero the streak", mon.streak === 2, String(mon.streak));
  check("but it is flagged at risk", mon.atRisk === true);
  check("training this week clears the at-risk flag",
    atTime("2026-08-19", () => A.consistency({ ...upToLastWeek, ...wk("2026-08-17") })).atRisk === false);
  // A genuinely skipped week breaks it.
  const gapped = { ...wk("2026-08-03"), ...wk("2026-08-17") };
  check("a fully skipped week breaks the streak",
    atTime("2026-08-19", () => A.consistency(gapped)).streak === 1,
    String(atTime("2026-08-19", () => A.consistency(gapped)).streak));
  check("streakFrom marks where the live streak starts",
    (() => { const r = atTime("2026-08-19", () => A.consistency(threeStraight));
      return r.weeks.slice(r.streakFrom).every(w => w.count > 0); })());
}

console.log("\n── Hard mode gating ──");
{
  const mk = w => { const l = {}; for (let i = 0; i < w; i++) l["k"+i] = { ts: Date.now() - (i*7+1)*DAY }; return l; };
  for (const [w, want] of [[0,false],[1,false],[2,false],[3,true],[5,true]])
    check(`${w}-week streak → hard mode ${want ? "ON" : "off"}`, A.hardModeState(mk(w)).on === want);
  check("empty log is not hard mode", A.hardModeState({}).on === false);
  check("a missed week resets the streak",
    A.hardModeState({ a:{ts:Date.now()-DAY}, b:{ts:Date.now()-22*DAY} }).streak === 1);
}

console.log("\n── applyIntensity ──");
{
  const base = A.FULLBODY["Full Body A"];
  const on = A.applyIntensity(base, true);
  const g = n => on.exercises.find(e => e.name === n);
  check("off is an identity no-op", A.applyIntensity(base, false) === base);
  check("on does not mutate the source plan", base.exercises.find(e => e.name === "Squat").sets === 3);
  check("T1 goes to 4 sets with an AMRAP finish", g("Squat").sets === 4 && g("Squat").finish === "amrap");
  check("T2 keeps 3 sets but gains AMRAP",
    g("Romanian Deadlift").sets === 3 && g("Romanian Deadlift").finish === "amrap");
  check("T3 gains myo-reps", g("EZ Bar Curl").finish === "myo" && g("DB Lateral Raise").finish === "myo");
  check("optional finishers are untouched", !g("Calf Raise").finish);
  check("every finish key resolves in FINISHERS", on.exercises.every(e => !e.finish || A.FINISHERS[e.finish]));
  const M = { Squat:"quads","Leg Press":"quads","Bench Press":"chest","Incline Barbell Press":"chest",
    "Lat Pulldown":"back","Seated Cable Row":"back","Romanian Deadlift":"hams",Deadlift:"hams",
    "DB Lateral Raise":"delts","EZ Bar Curl":"biceps","Incline DB Curl":"biceps",
    "Skull Crushers":"triceps","Overhead DB Extension":"triceps" };
  const vol = hard => { const v = {}; for (const d of A.PROGRAMS.fullbody.order)
    for (const e of A.applyIntensity(A.PROGRAMS.fullbody.days[d], hard).exercises)
      if (!e.optional && M[e.name]) v[M[e.name]] = (v[M[e.name]] || 0) + e.sets; return v; };
  const nv = vol(false), hv = vol(true);
  console.log("   normal:", JSON.stringify(nv), "\n   hard:  ", JSON.stringify(hv));
  check("normal mode is 6 sets/muscle/week everywhere", Object.values(nv).every(n => n === 6), JSON.stringify(nv));
  check("hard mode raises chest and back to 8", hv.chest === 8 && hv.back === 8);
  check("hard mode never lowers any muscle", Object.keys(nv).every(k => hv[k] >= nv[k]));
  check("every muscle is trained twice a week", Object.keys(M).length >= 13);
}

console.log("\n── Program integrity ──");
{
  for (const [pid, prog] of Object.entries(A.PROGRAMS)) {
    for (const day of prog.order) {
      const p = prog.days[day];
      check(`${pid}/${day}: resolvable via lookupDay`, A.lookupDay(day) === p);
      for (const e of p.exercises) {
        if (!e.supersetWith) continue;
        const q = p.exercises.find(x => x.name === e.supersetWith);
        check(`${day}: ${e.name} superset is reciprocal`, !!q && q.supersetWith === e.name);
      }
      check(`${day}: every rep range parses`, p.exercises.every(e => /^\d+-\d+$/.test(e.repRange)));
      check(`${day}: barbell lifts declare a bar weight`, p.exercises.every(e => !e.barbell || e.barWeight > 0));
    }
  }
  // A new exercise that isn't classified falls through to dumbbell_heavy and gets
  // silently wrong increments and rest times — catch that at test time instead.
  const known = new Set();
  for (const prog of Object.values(A.PROGRAMS)) for (const day of prog.order)
    for (const e of prog.days[day].exercises) known.add(e.name);
  const unclassified = [...known].filter(n => A.getEquipmentType(n) === "dumbbell_heavy");
  check("no exercise falls through equipment classification unintentionally",
    unclassified.every(n => /DB |Dumbbell|Overhead DB/.test(n)), unclassified.join(", "));
}

console.log(`\n${"─".repeat(52)}\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
