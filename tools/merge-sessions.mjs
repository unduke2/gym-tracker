// Merge two workout logs that should have been one session.
//
// Written because the "end session early" button used to fire on a single tap
// and could split a workout in half. That's fixed, but a split can still happen
// legitimately — phone died, app reloaded, you left and came back — so this is
// a general repair rather than a one-off.
//
//   node tools/merge-sessions.mjs backup.json                 # dry run, shows candidates
//   node tools/merge-sessions.mjs backup.json --apply         # merge all auto-detected pairs
//   node tools/merge-sessions.mjs backup.json --apply KEY_A KEY_B
//
// Writes <backup>.merged.json. Never edits the input.
import { readFileSync, writeFileSync } from "node:fs";

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error("usage: node tools/merge-sessions.mjs <backup.json> [--apply] [keyA keyB]"); process.exit(1); }
const apply = rest.includes("--apply");
const explicit = rest.filter(a => a !== "--apply");

const backup = JSON.parse(readFileSync(file, "utf8"));
const logs = backup.phul_logs || {};
const HOURS = 36; // a split session is same-day-ish, not a week apart

const doneSets = (sets) => (sets || []).filter(s => s?.done && String(s.reps ?? "").trim() && Number(String(s.reps).replace(",", ".")) > 0);
const doneCount = (ex) => Object.values(ex || {}).reduce((n, sets) => n + doneSets(sets).length, 0);
const exercisesWithWork = (ex) => Object.entries(ex || {}).filter(([, sets]) => doneSets(sets).length).map(([n]) => n);

// ── find candidate pairs: same day name, close in time ────────────────────
function candidates() {
  const byDay = {};
  for (const [k, v] of Object.entries(logs)) (byDay[v.day] ||= []).push([k, v]);
  const pairs = [];
  for (const entries of Object.values(byDay)) {
    entries.sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 1; i < entries.length; i++) {
      const [ka, a] = entries[i - 1], [kb, b] = entries[i];
      if (Math.abs(b.ts - a.ts) <= HOURS * 3600e3) pairs.push([ka, kb]);
    }
  }
  return pairs;
}

// ── merge b into a ─────────────────────────────────────────────────────────
function merge(a, b) {
  const out = { ...a };
  const ex = {};
  for (const name of new Set([...Object.keys(a.exercises || {}), ...Object.keys(b.exercises || {})])) {
    const sa = a.exercises?.[name], sb = b.exercises?.[name];
    // Concatenate the completed sets from both halves. A split session can cut
    // an exercise in half — 2 sets before the interruption, the 3rd after — so
    // picking one array whole would silently discard real work.
    const combined = [...doneSets(sa), ...doneSets(sb)];
    ex[name] = combined.length ? combined : (sa || sb);
  }
  out.exercises = ex;
  const worked = new Set(exercisesWithWork(ex));
  // Anything either half gave up on that still has no logged work anywhere.
  out.abandoned = [...new Set([...(a.abandoned || []), ...(b.abandoned || [])])].filter(n => !worked.has(n));
  out.ts = Math.max(a.ts, b.ts);            // the session ended when the later half ended
  out.date = a.ts <= b.ts ? a.date : b.date;
  out.durationMins = (a.durationMins || 0) + (b.durationMins || 0) || null;
  return out;
}

const pairs = explicit.length === 2 ? [explicit] : candidates();
if (!pairs.length) { console.log("No split sessions found (same day type within 36h)."); process.exit(0); }

console.log(`\nFound ${pairs.length} candidate pair(s):\n`);
const merged = { ...backup, phul_logs: { ...logs } };
for (const [ka, kb] of pairs) {
  const a = merged.phul_logs[ka], b = merged.phul_logs[kb];
  if (!a || !b) { console.log(`  ! skipped ${ka} / ${kb} — key not found`); continue; }
  const m = merge(a, b);
  console.log(`  ${a.day}`);
  console.log(`    A ${a.date}  ${doneCount(a.exercises)} sets  [${exercisesWithWork(a.exercises).join(", ") || "—"}]`);
  console.log(`      abandoned: ${(a.abandoned || []).join(", ") || "none"}`);
  console.log(`    B ${b.date}  ${doneCount(b.exercises)} sets  [${exercisesWithWork(b.exercises).join(", ") || "—"}]`);
  console.log(`      abandoned: ${(b.abandoned || []).join(", ") || "none"}`);
  console.log(`    → ${doneCount(m.exercises)} sets  [${exercisesWithWork(m.exercises).join(", ")}]`);
  console.log(`      abandoned: ${m.abandoned.join(", ") || "none"}\n`);
  if (apply) { merged.phul_logs[ka] = m; delete merged.phul_logs[kb]; }
}

if (!apply) { console.log("Dry run. Re-run with --apply to write the merged file.\n"); process.exit(0); }
const out = file.replace(/\.json$/, "") + ".merged.json";
writeFileSync(out, JSON.stringify(merged, null, 2));
console.log(`Wrote ${out}`);
console.log(`Sessions: ${Object.keys(logs).length} → ${Object.keys(merged.phul_logs).length}\n`);
