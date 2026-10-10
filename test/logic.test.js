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
  check("no suggestion is zero, negative or NaN", rows.every(([n, r]) => A.getEquipmentType(n) === "bodyweight" ? r.hold > 0 : r.weight > 0),
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

console.log("\n── Weight trend: the scale as the control signal ──");
{
  const iso = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
  const t = (pairs) => A.weightTrend(pairs.map(([d, w]) => ({ date: iso(d), weight: w })), "bulk");
  const good = t([[28, 71.8], [0, 72.3]]);
  console.log(`   +0.5kg/28d ⇒ ${good.perMonth} kg/mo · ${good.verdict}`);
  check("gaining inside the band reads on-track", good.verdict === "on-track", good.verdict);
  const flat = t([[28, 71.8], [0, 71.8]]);
  check("flat weight on a bulk reads under", flat.verdict === "under");
  check("flat asks for a SMALL bump, not 500 kcal", flat.kcalAdjust > 0 && flat.kcalAdjust <= 200, String(flat.kcalAdjust));
  const losing = t([[28, 72.5], [0, 71.8]]);
  check("losing on a bulk reads under", losing.verdict === "under");
  check("losing asks for more than flat does", losing.kcalAdjust > flat.kcalAdjust);
  const fast = t([[28, 71.8], [0, 73.5]]);
  check("gaining too fast reads over", fast.verdict === "over");
  check("over suggests eating LESS", fast.kcalAdjust < 0, String(fast.kcalAdjust));
  check("one reading gives no verdict", t([[0, 71.8]]).ok === false);
  check("no readings gives no verdict", A.weightTrend([], "bulk").ok === false);
  check("an old reading is flagged stale", t([[80, 71.8], [60, 72.3]]).stale === true);
  check("a cut inverts the direction",
    A.weightTrend([{date:iso(28),weight:73},{date:iso(0),weight:72.4}], "cut").verdict === "on-track",
    A.weightTrend([{date:iso(28),weight:73},{date:iso(0),weight:72.4}], "cut").verdict);
  check("garbage weights don't produce NaN",
    A.weightTrend([{date:iso(28),weight:"abc"},{date:iso(0),weight:72}], "bulk").ok === false);
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
  // Weeks are built Monday-anchored: `per` sessions in each of the last `w`
  // calendar weeks, all placed on the Monday (+1 day per session) so they can
  // never straddle a week boundary regardless of what day the test runs.
  const monday = (weeksAgo) => { const d = new Date(); d.setHours(12,0,0,0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - weeksAgo * 7); return d.getTime(); };
  const mk = (perWeek) => { const l = {}; perWeek.forEach((n, wk) => {
    for (let i = 0; i < n; i++) l[`w${wk}s${i}`] = { ts: monday(wk) + i * DAY }; }); return l; };
  // perWeek[0] is the current week.
  for (const [w, want] of [[0,false],[1,false],[2,false],[3,true],[5,true]])
    check(`${w} weeks at 2/week → hard mode ${want ? "ON" : "off"}`, A.hardModeState(mk(Array(w).fill(2))).on === want);
  check("empty log is not hard mode", A.hardModeState({}).on === false);
  check("1 session a week for 3 weeks does NOT unlock", A.hardModeState(mk([1,1,1])).on === false);
  check("a 1-session week breaks the run", A.hardModeState(mk([2,2,1,2,2])).streak === 2);
  check("a missed week resets it", A.hardModeState(mk([2,2,0,2,2])).streak === 2);
  check("the current week can't break it while it's still running",
    A.hardModeState(mk([0,2,2,2])).on === true && A.hardModeState(mk([0,2,2,2])).atRisk === true);
  check("one session so far this week is 'at risk', not broken",
    A.hardModeState(mk([1,2,2,2])).on === true && A.hardModeState(mk([1,2,2,2])).thisWeek === 1);
  check("4/week is not required", A.hardModeState(mk([2,2,2])).on === true);
}

console.log("\n── Gym days, not logs ──");
{
  // A then B back to back in one evening is one visit, not two.
  const now = new Date(); now.setHours(12,0,0,0);
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const at = (dayOffset, h) => { const d = new Date(monday); d.setDate(d.getDate() + dayOffset); d.setHours(h); return d.getTime(); };
  const sameDay = { a:{ ts: at(0, 18) }, b:{ ts: at(0, 21) } };
  check("two logs on one date count as one day", A.consistency(sameDay).currentCount === 1);
  check("one double-session evening does not satisfy the gate's 2/week",
    A.hardModeState(sameDay).thisWeek === 1);
  const twoDays = { a:{ ts: at(0, 18) }, b:{ ts: at(0, 21) }, c:{ ts: at(1, 18) } };
  check("two separate days do", A.hardModeState(twoDays).thisWeek === 2);
}

console.log("\n── Session duration ──");
{
  const H = 3600000, M = 60000;
  check("wall clock reset to ~0 falls back to the set span",
    A.sessionDurationMins(30 * 1000, 1000, 1000 + 75 * M) === 75);
  check("honest wall clock wins when it's larger (warm-up before set 1)",
    A.sessionDurationMins(90 * M, 1000, 1000 + 80 * M) === 90);
  check("a draft finished the next morning isn't 14 hours",
    A.sessionDurationMins(14 * H, 1000, 1000 + 70 * M) === 70);
  check("no set times and no sane wall clock is 0, not NaN", A.sessionDurationMins(0, null, null) === 0);
}

console.log("\n── Catch up all: one session, one log per day ──");
{
  const groups = [
    { dayType: "Full Body A", items: [
      { exName: "Leg Extension", sourceLogKey: "kA" }, { exName: "DB Lateral Raise", sourceLogKey: "kA" },
      { exName: "EZ Bar Curl", sourceLogKey: "kA" }, { exName: "Skull Crushers", sourceLogKey: "kA" } ] },
    { dayType: "Full Body B", items: [
      { exName: "Bulgarian Split Squat", sourceLogKey: "kB" }, { exName: "DB Lateral Raise", sourceLogKey: "kB" },
      { exName: "Suitcase Carry", sourceLogKey: "kB" } ] },
  ];
  const tokens = A.catchupTokens(groups);
  const plan = A.buildCatchupPlan(tokens, A.lookupDay);
  const names = plan.exercises.map(e => e.name);
  check("every pending exercise is in the plan", ["Leg Extension","EZ Bar Curl","Bulgarian Split Squat","Suitcase Carry"].every(n => names.includes(n)));
  check("an exercise pending on both days appears once", names.filter(n => n === "DB Lateral Raise").length === 1);
  check("each exercise keeps its own day for progression",
    plan.exercises.find(e => e.name === "Leg Extension").day === "Full Body A" &&
    plan.exercises.find(e => e.name === "Bulgarian Split Squat").day === "Full Body B");
  check("the arm superset partners both made it (so the pair still alternates)",
    names.includes("EZ Bar Curl") && names.includes("Skull Crushers"));
  const done = (w, r) => ({ weight: String(w), reps: String(r), rpe: 8, done: true });
  const open = () => ({ weight: "", reps: "", rpe: null, done: false });
  const data = {
    "Leg Extension": [done(25,12), done(25,12), done(25,11)],
    "DB Lateral Raise": [done(7,15), done(7,14), done(7,12)],
    "EZ Bar Curl": [done(15,10), done(15,9), done(15,8)],
    "Skull Crushers": [done(15,10), done(15,9), done(15,8)],
    "Bulgarian Split Squat": [done(10,10), done(10,10), done(10,9)],
    "Suitcase Carry": [open(), open()],
  };
  const { logs, alsoResolved } = A.splitCatchupLogs(plan, data, ["Suitcase Carry"], { date: "2026-09-29", ts: 1000, durationMins: 60 });
  const byDay = Object.fromEntries(logs.map(l => [l.log.day, l.log]));
  check("one log per source day", logs.length === 2 && byDay["Full Body A"] && byDay["Full Body B"]);
  check("logs are makeups, so they don't advance the rotation", logs.every(l => l.log.isMakeup));
  check("A's log holds only A's exercises",
    Object.keys(byDay["Full Body A"].exercises).sort().join() === ["DB Lateral Raise","EZ Bar Curl","Leg Extension","Skull Crushers"].join());
  check("B's log holds B's, and the shared exercise is not duplicated into it",
    !byDay["Full Body B"].exercises["DB Lateral Raise"] && !!byDay["Full Body B"].exercises["Bulgarian Split Squat"]);
  check("the shared exercise resolves B's pending entry instead",
    alsoResolved.length === 1 && alsoResolved[0].dayType === "Full Body B" && alsoResolved[0].exName === "DB Lateral Raise");
  check("abandoned exercises stay with their own day", byDay["Full Body B"].abandoned.join() === "Suitcase Carry" && byDay["Full Body A"].abandoned.length === 0);
  check("duration is shared by sets done, not duplicated",
    byDay["Full Body A"].durationMins + byDay["Full Body B"].durationMins === 60 && byDay["Full Body A"].durationMins > byDay["Full Body B"].durationMins);
  check("keys are distinct", new Set(logs.map(l => l.key)).size === 2);
  const none = A.splitCatchupLogs(plan, { ...data, "Bulgarian Split Squat": [open(),open(),open()] },
    ["Bulgarian Split Squat","Suitcase Carry"], { date: "x", ts: 1, durationMins: 30 });
  check("a day where nothing got done writes no log (pending keeps its original window)",
    none.logs.length === 1 && none.logs[0].log.day === "Full Body A");
  // Written logs feed the right day's progression.
  const merged = Object.fromEntries(logs.map(l => [l.key, l.log]));
  const le = A.calcNextWeight(A.FULLBODY["Full Body A"].exercises.find(e => e.name === "Leg Extension"), merged);
  check("progression picks the catch-up up under its own day", le.status !== "restart" && le.status !== "start", le.status);
}

console.log("\n── Finishing: dated from the last set ──");
{
  const H = 3600000, M = 60000;
  const plan = A.FULLBODY["Full Body A"];
  const done = { weight:"40", reps:"8", rpe:8, done:true }, open = { weight:"", reps:"", rpe:null, done:false };
  const data = {}; for (const e of plan.exercises) data[e.name] = Array.from({length:e.sets}, () => open);
  data["Squat"] = [done, done, done]; data["Bench Press"] = [done, done, done];
  // Regression: v9.0–9.2 passed { first, last } and read lastSetAt → always
  // undefined → every log dated by the Finish tap.
  const lastSetAt = new Date(2026, 8, 24, 19, 30).getTime();
  const firstSetAt = lastSetAt - 70 * M;
  const finishAt = new Date(2026, 8, 28, 19, 59).getTime();   // closed four days later
  const { logs } = A.buildSessionLogs({ dayName:"Full Body A", plan, filter:null, data, abandoned:[],
    times:{ firstSetAt, lastSetAt }, sessionStartedAt: finishAt - 30 * 1000, endAt: finishAt, now: finishAt });
  check("a session closed days later is dated by its last set", logs[0].log.date === "2026-09-24", logs[0].log.date);
  check("…and its ts is the last set", logs[0].log.ts === lastSetAt);
  check("…and its duration is the set span, not 0", logs[0].log.durationMins === 70, logs[0].log.durationMins);
  check("the key carries the real date", logs[0].key.startsWith("2026-09-24_Full_Body_A_"));

  // Stale-draft sweep.
  const draft = { dayName:"Full Body A", data, exerciseHolds:{}, sessionStartedAt: firstSetAt - 5 * M, firstSetAt, lastSetAt };
  check("a draft idle under 3h is left alone (you might be mid-rest)", A.closeStaleDraft(draft, A.lookupDay, lastSetAt + 2 * H) === null);
  const c = A.closeStaleDraft(draft, A.lookupDay, lastSetAt + 20 * H);
  check("a draft idle 3h+ is closed", !!c && c.logs.length === 1);
  check("…timed from its last set", c.logs[0].log.ts === lastSetAt && c.logs[0].log.date === "2026-09-24");
  check("…with a real duration", c.logs[0].log.durationMins === 75, c.logs[0].log.durationMins);
  check("…unfinished core exercises go to catch-up", c.missed.includes("Lat Pulldown") && !c.missed.includes("Squat"));
  check("…optional finishers don't", !c.missed.includes("Calf Raise") && !c.missed.includes("Face Pull"));
  check("a draft with nothing logged isn't turned into a session",
    A.closeStaleDraft({ ...draft, data: Object.fromEntries(Object.keys(data).map(k => [k, [open]])) }, A.lookupDay, lastSetAt + 20 * H) === null);
  check("a draft with no set times (pre-v9.0) is left alone", A.closeStaleDraft({ ...draft, lastSetAt: null }, A.lookupDay, lastSetAt + 20 * H) === null);
  // A merged catch-up draft closes into per-day logs.
  const tokens = ["Full Body A::Leg Extension", "Full Body B::Bulgarian Split Squat"];
  const cu = A.closeStaleDraft({ dayName: A.CATCHUP_ALL, filter: tokens, sessionStartedAt: firstSetAt, firstSetAt, lastSetAt,
    data: { "Leg Extension": [done, done, done], "Bulgarian Split Squat": [done, open, open] } }, A.lookupDay, lastSetAt + 5 * H);
  check("a stale merged catch-up closes into one log per day", !!cu && cu.logs.map(l => l.log.day).sort().join() === "Full Body A,Full Body B");
}

console.log("\n── Session time: estimate from the lifter's own pace ──");
{
  const A1 = A.FULLBODY["Full Body A"], B1 = A.FULLBODY["Full Body B"];
  const done = (n) => Array.from({ length: n }, () => ({ weight:"40", reps:"8", rpe:8, done:true }));
  // Two logged sessions that took 1.4x the theoretical time → pace 1.4.
  const mk = (day, plan, daysAgo) => {
    const ex = {}; for (const e of plan.exercises.filter(e => !e.optional)) ex[e.name] = done(e.sets);
    const theo = A.planSeconds(plan.exercises.filter(e => !e.optional), plan.type) / 60;
    return { day, ts: Date.now() - daysAgo * DAY, date: "x", exercises: ex, abandoned: [], durationMins: Math.round(theo * 1.4) };
  };
  const logs = { a: mk("Full Body A", A1, 2), b: mk("Full Body B", B1, 4) };
  const pace = A.paceFactor(logs);
  check("pace is learned from real durations", Math.abs(pace - 1.4) < 0.03, pace.toFixed(3));
  check("no history → a sane default, not 1.0", A.paceFactor({}) > 1);
  const full = A.estimateMinutes(A1, logs);
  check("a full v9 session is estimated at about 2 hours at that pace", full > 105 && full < 150, full);
  check("hard mode estimates longer", A.estimateMinutes(A.applyIntensity(A1, true), logs) > full);
  check("0-minute logs (the old dating bug) are ignored", A.paceFactor({ ...logs, z: { ...logs.a, durationMins: 0 } }) === pace);

  // Fitting.
  const f60 = A.fitPlanToTime(A1, 60, 1.4);
  const sets = n => f60.exercises.find(e => e.name === n)?.sets || 0;
  console.log("   60 min →", f60.exercises.map(e => `${e.name} ${e.sets}`).join(", "));
  check("60 min fits in 60 min", A.estimateMinutes(f60, {}, 1.4) <= 60, A.estimateMinutes(f60, {}, 1.4));
  check("the main lifts survive", ["Squat","Bench Press","Lat Pulldown"].every(n => sets(n) >= 2));
  check("second-tier lifts get 2 sets before any isolation gets 1",
    sets("Romanian Deadlift") >= 2 || !f60.exercises.some(e => (e.tier || 3) === 3));
  check("what was cut is reported", f60.trimmed.length > 0 && f60.trimmed.every(n => !sets(n)));
  check("optional finishers never appear in a fitted session", !f60.exercises.some(e => e.optional));
  const f90 = A.fitPlanToTime(A1, 90, 1.4);
  check("90 min keeps every core exercise at least once", f90.trimmed.length === 0, f90.trimmed.join());
  check("a budget bigger than the session changes nothing",
    A.fitPlanToTime(A1, 600, 1.4).exercises.every(e => e.sets === A1.exercises.find(x => x.name === e.name).sets));
  check("the budget is carried on the plan (it goes into the log)", f60.budget === 60);
  const h60 = A.fitPlanToTime(A.applyIntensity(A1, true), 60, 1.4);
  const hs = n => h60.exercises.find(e => e.name === n)?.sets || 0;
  check("hard mode's 4th set comes after every main lift has 3",
    !(hs("Squat") === 4 && hs("Bench Press") < 3), `squat ${hs("Squat")} bench ${hs("Bench Press")}`);

  // Closing time.
  const wed2030 = new Date(2026, 9, 7, 20, 30);  // a Wednesday
  check("weekday close is 21:00", A.minutesUntilClose(wed2030) === 30);
  check("Saturday close is 16:00", A.minutesUntilClose(new Date(2026, 9, 10, 14, 0)) === 120);
  check("after close → null", A.minutesUntilClose(new Date(2026, 9, 7, 21, 30)) === null);
  check("unknown day (Sunday) → null", A.minutesUntilClose(new Date(2026, 9, 11, 12, 0)) === null);
}

console.log("\n── A stale time-boxed draft is judged against what it asked for ──");
{
  const plan = A.FULLBODY["Full Body A"];
  const fitted = A.fitPlanToTime(plan, 60, 1.4);
  const done = { weight:"40", reps:"8", rpe:8, done:true };
  const data = Object.fromEntries(fitted.exercises.map(e => [e.name, Array.from({ length: e.sets }, () => done)]));
  const t = Date.now() - 10 * 3600000;
  const c = A.closeStaleDraft({ dayName:"Full Body A", data, budget: 60, sessionStartedAt: t - 3600000, firstSetAt: t - 3000000, lastSetAt: t },
    A.lookupDay, Date.now(), 1.4);
  check("a finished 60-min session left open isn't turned into catch-ups", !!c && c.missed.length === 0, c && c.missed.join());
  check("…and the log says it was the 60-min version", c.logs[0].log.budget === 60);
}

console.log("\n── Catch-up window ──");
{
  const X = n => ({ [n]: [{ weight:"", reps:"", done:false }] });
  const logs = {
    k1: { day:"Full Body A", ts: Date.now() - 15*DAY, date:"old", exercises: X("DB Lateral Raise"), abandoned:["DB Lateral Raise"] },
    k2: { day:"Full Body A", ts: Date.now() - 1*DAY,  date:"new", exercises: X("DB Lateral Raise"), abandoned:["DB Lateral Raise"] },
  };
  const p = A.computePendingMakeups(logs, []);
  const it = p.find(g => g.dayType === "Full Body A")?.items.find(i => i.exName === "DB Lateral Raise");
  check("an exercise missed twice stays pending on the NEW miss's window", !!it && it.sourceLogKey === "k2", JSON.stringify(p));
  check("…and appears once", p.find(g => g.dayType === "Full Body A").items.length === 1);
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
  // v9.0: two movements per big muscle. Direct weekly sets at 2x/week — the
  // dose-response data (Pelland 2025) keeps climbing to ~11/muscle/session and
  // 20+/week, and the v8 plan sat at 6. Every muscle below must be trained in
  // BOTH sessions (full-body means every visit trains everything).
  const M = { Squat:"quads","Leg Press":"quads","Leg Extension":"quads","Bulgarian Split Squat":"quads",
    "Bench Press":"chest","Incline Barbell Press":"chest","Cable Fly":"chest",
    "Lat Pulldown":"back","Seated Cable Row":"back","One Arm DB Row":"back",
    "Romanian Deadlift":"hams",Deadlift:"hams","Seated Leg Curl":"hams",
    "DB Lateral Raise":"delts",OHP:"delts","EZ Bar Curl":"biceps","Incline DB Curl":"biceps",
    "Skull Crushers":"triceps","Overhead DB Extension":"triceps","Side Plank":"trunk","Suitcase Carry":"trunk" };
  const vol = hard => { const v = {}; for (const d of A.PROGRAMS.fullbody.order)
    for (const e of A.applyIntensity(A.PROGRAMS.fullbody.days[d], hard).exercises)
      if (!e.optional && M[e.name]) v[M[e.name]] = (v[M[e.name]] || 0) + e.sets; return v; };
  const nv = vol(false), hv = vol(true);
  console.log("   normal:", JSON.stringify(nv), "\n   hard:  ", JSON.stringify(hv));
  check("chest, back and quads get ≥ 9 direct sets/week at 2x", nv.chest >= 9 && nv.back >= 9 && nv.quads >= 9, JSON.stringify(nv));
  check("no trained muscle is below 6 sets/week", Object.entries(nv).every(([k, n]) => k === "trunk" || n >= 6), JSON.stringify(nv));
  check("hard mode never lowers any muscle", Object.keys(nv).every(k => hv[k] >= nv[k]));
  for (const d of A.PROGRAMS.fullbody.order) {
    const names = new Set(A.PROGRAMS.fullbody.days[d].exercises.filter(e => !e.optional).map(e => M[e.name]));
    check(`${d} trains every muscle group`, ["quads","chest","back","hams","delts","biceps","triceps","trunk"].every(m => names.has(m)),
      [...names].join(","));
  }
  check("every core exercise is in the volume map",
    A.PROGRAMS.fullbody.order.every(d => A.PROGRAMS.fullbody.days[d].exercises.every(e => e.optional || M[e.name])));
}

console.log("\n── Stall counter: double progression is not a stall ──");
{
  // Observed 2026-09: squat 6,6,7 → 7,7,7 at the same weight fired a 7% reset
  // because the counter only asked "did you hit the top?". Reps climbing IS
  // the protocol working. And a round logged at RPE 8 with nothing failed is
  // the leave-2-reps rule being followed, not a lift being stuck.
  const sq = ex("FULLBODY", "Full Body A", "Squat");  // 3 x 5-8
  const two = (a, b) => ({ ...sess("Full Body A", "Squat", a, 2), ...sess("Full Body A", "Squat", b, 7) });
  const climbing = A.calcNextWeight(sq, two([S(47.5,7,8),S(47.5,7,8),S(47.5,7,9)], [S(47.5,6,8),S(47.5,6,8),S(47.5,7,8)]));
  console.log(`   6,6,7 → 7,7,7 @ ~8.3  ⇒  ${climbing.weight}kg (${climbing.status})`);
  check("reps climbing at the same weight is not a stall-reset", climbing.status !== "stall-reset", climbing.status);
  check("…and at RPE ~8.3 with nothing failed it progresses", climbing.status === "increase" && climbing.weight === 50, `${climbing.weight} ${climbing.status}`);
  const rdl = ex("FULLBODY", "Full Body A", "Romanian Deadlift"); // 3 x 8-12, tier 2
  const held = A.calcNextWeight(rdl, { ...sess("Full Body A","Romanian Deadlift",[S(20,10,8),S(20,9,8),S(20,9,8)],2),
                                        ...sess("Full Body A","Romanian Deadlift",[S(20,10,8),S(20,10,8),S(20,9,8)],7) });
  check("two flat rounds at RPE 8 hold rather than reset", held.status !== "stall-reset" && held.weight === 20, `${held.weight} ${held.status}`);
  const regressed = A.calcNextWeight(sq, two([S(32.5,5,8),S(32.5,5,8),S(32.5,5,9)], [S(32.5,8,8),S(32.5,7,8),S(32.5,7,9)]));
  check("a genuine regression (22 → 15 reps, pushed) still resets", regressed.status === "stall-reset", regressed.status);
  check("the note counts the sessions honestly", /2 sessions/.test(regressed.note), regressed.note);
  const ext = ex("FULLBODY", "Full Body B", "Overhead DB Extension"); // tier 3
  const iso2 = A.calcNextWeight(ext, { ...sess("Full Body B","Overhead DB Extension",[S(12.5,13,8),S(12.5,12,8),S(12.5,10,10)],2),
                                        ...sess("Full Body B","Overhead DB Extension",[S(12.5,15,8),S(12.5,12,8),S(12.5,10,10)],7) });
  check("an isolation needs three stuck rounds, not two", iso2.status !== "stall-reset", iso2.status);
}

console.log("\n── Timed bodyweight holds ──");
{
  const plank = ex("FULLBODY", "Full Body A", "Side Plank"); // 2 x 30-45s
  const fresh = A.calcNextWeight(plank, {});
  check("no history → hold the bottom of the range", fresh.hold === 30 && fresh.weight === 0 && fresh.status === "start", JSON.stringify(fresh));
  const held = A.calcNextWeight(plank, sess("Full Body A","Side Plank",[{weight:"",reps:"40",done:true},{weight:"",reps:"32",done:true}]));
  check("target is shortest set + 5s, capped at the top", held.hold === 37, JSON.stringify(held));
  const maxed = A.calcNextWeight(plank, sess("Full Body A","Side Plank",[{weight:"",reps:"45",done:true},{weight:"",reps:"50",done:true}]));
  check("every set at the top → +5s", maxed.hold === 50 && maxed.status === "increase", JSON.stringify(maxed));
  check("a timed set with no weight is never scorable for the weight tree", !A.isScorable({ weight:"", reps:"40", done:true }));
  check("bodyweight equipment snaps to itself", A.snap(0, "bodyweight") === 0 && A.getEquipmentType("Side Plank") === "bodyweight");
}

console.log("\n── Progression notes don't repeat the weight ──");
{
  // The weight is rendered at 92px directly above the note; leading with it
  // again cost a phone card's width and pushed the note to four wrapped lines.
  const cases = [
    A.calcNextWeight(bench, sess("Upper Power","Bench Press",[S(40,4,9),S(40,5,9),S(40,5,9)])),
    A.calcNextWeight(squat, sess("Lower Power","Squat",[S(50,4,8),S(50,4,8),S(50,4,8)])),
    A.calcNextWeight(squat, sess("Lower Power","Squat",[S(50,5,8),S(50,5,8),S(50,5,8)], 120)),
    ...A.PROGRAMS.fullbody.order.flatMap(d =>
      A.PROGRAMS.fullbody.days[d].exercises.map(e => A.calcNextWeight(e, A._data.phul_logs))),
  ];
  check("no note opens by restating the weight",
    cases.every(r => !/^→\s*[\d.]+\s*kg/.test(r.note)),
    cases.filter(r => /^→\s*[\d.]+\s*kg/.test(r.note)).map(r => r.note).join(" | "));
  check("increase/decrease notes still show the delta",
    cases.filter(r => r.status === "increase" || r.status === "crush").every(r => /[↑↓]\s*\+?[\d.]+(kg|s)/.test(r.note)),
    cases.filter(r => r.status === "increase").map(r => r.note).join(" | "));
  check("every note is short enough for a phone card",
    cases.every(r => r.note.length <= 110),
    cases.filter(r => r.note.length > 110).map(r => `${r.note.length}: ${r.note}`).join(" | "));
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
    unclassified.every(n => /DB |Dumbbell|Overhead DB|Bulgarian Split Squat|Suitcase Carry/.test(n)), unclassified.join(", "));
}

console.log(`\n${"─".repeat(52)}\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
