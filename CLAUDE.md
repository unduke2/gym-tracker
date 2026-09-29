# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

There is no build step. The entire app lives in `index.html` — React 18 and Babel Standalone are loaded from CDN and JSX is transpiled in the browser via `<script type="text/babel">`. Open `index.html` directly in a browser (or serve the directory with any static server) to run it.

Because Babel runs client-side, there is **no type-check, no lint, no test command** — syntax errors only surface when the page is loaded. After any edit, verify by reloading the page and exercising the affected UI path.

## Tests

```sh
sh test/run.sh      # or: npm test
```

Syntax check → 90 logic assertions → render every screen. **Run this before claiming any change works**, especially anything touching progression. First run installs devDependencies.

- `test/build.js` — extracts the babel block, transpiles it, shims `localStorage`/`document`/`window`, and returns the app's real functions and components. `load(false)` for logic, `load(true)` for `renderToString`.
- `test/fixtures/sample-backup.json` — **synthetic**, not real user data (`Backup/` is gitignored). Every entry reproduces a bug that was actually observed: AMRAP burnout sets, comma decimals, 0-rep sets, late-session collapse, lean-mass loss on a bulk. Dates are `daysAgo` and hydrated to absolute timestamps at load, so the fixture never ages into staleness. Don't "tidy" the messy values — they're the test.
- `test/logic.test.js` / `test/render.test.js` — the render suite is the only thing that catches temporal-dead-zone bugs (see below) and missing props.

When adding a plan, exercise, or progression branch, add the assertion too. The program-integrity block already checks superset reciprocity, rep-range parsing, `lookupDay` resolution, and that no exercise silently falls through `getEquipmentType`.

Caveat worth knowing: **Babel Standalone downlevels `const`/`let` to `var`**, so temporal-dead-zone errors (using a `const` above its declaration) are silently invisible in the browser but throw under esbuild. If a headless render fails with "Cannot access X before initialization" and the browser seems fine, the browser is wrong — fix the ordering. (v7.1 shipped one of these in `SessionLogger`.)

## Production build

```sh
npm run build       # → dist/
```

Optional, and `index.html` remains the single source of truth — it still opens directly in a browser with no build. `build.mjs` exists solely to get Babel out of the runtime path, which is worth far more than it sounds:

| | cost per launch |
|---|---|
| `babel.min.js` parse + eval | ~83 ms |
| in-browser JSX transform | **~1664 ms** (desktop V8) |
| | ≈ **5–9 s on a mid-range phone**, every open |

The build pre-transpiles to `dist/app.js` (es2018, minified), drops the 2.8 MB Babel bundle, and rewrites `sw.js`'s precache list and `CACHE_VERSION` to match. ~3.0 MB and ~1.7 s of parse saved per cold load. It throws rather than shipping if any Babel reference survives the rewrite.

**Cloudflare Pages**: build command `npm run build`, output directory `dist`. If the build ever fails, Pages keeps serving the last good deploy and `index.html` still works unbuilt.

## Architecture

Single-file SPA (`index.html`, ~7200 lines) implementing a personal gym + diet + body-comp tracker. All state is persisted to `localStorage`; there is no backend.

### Persistence layer
All reads/writes go through `lsGet`/`lsSet` (top of the script). Keys used:
- `phul_phase` — "bulk" | "cut"
- `phul_stats` — array of body-composition entries
- `phul_logs` — map of workout sessions keyed by `${date}_${day}_${ts}`
- `phul_diet` — map of daily nutrition entries keyed by ISO date
- `phul_draft` — the single in-progress session (auto-saved; enables resume after reload/screen-off)
- `phul_meals` — user's meal database (overrides `DEFAULT_MEALS`)
- `phul_custom_sessions` — array of imported custom session plans (see `SESSION_FORMAT.md`)
- `phul_theme` — "carbon" | "blueprint"
- `phul_program` — "fullbody" | "phul" — which program drives the rotation
- `phul_migration_v` — integer stamp for the one-time data repair (see below)

The `DataBackup` component exports/imports these keys as JSON — this is the migration path between app versions, so preserve key names when changing shapes.

### Custom sessions (imported via `SESSION_FORMAT.md`)
Beyond the fixed PHUL 4-day split, users can import one-off session plans as JSON — makeup days, recovery, running, accessory-only days. See `SESSION_FORMAT.md` at the repo root for the schema + example + a prompt template for asking Claude to generate one. `App.resolvePlan(key)` looks up `lookupDay(key)` (all programs) first, then custom sessions by id. Custom session exercises can override rest times via `ex.rest.set` / `ex.rest.betweenEx`, which `SessionLogger` reads through `resolveSetRest` / `resolveBetweenExRest` wrappers instead of calling `getRestSeconds` directly. Custom session logs carry `isCustom: true`, `dayLabel: <name>`, and `type: <power|hypertrophy|custom>` so history + dashboard can render them gracefully.

### Makeup flow (catch up missed exercises)
When a PHUL session's `abandoned: [...]` list is non-empty, those exercises become "pending makeups." `computePendingMakeups(workoutLogs, windowDays=14)` derives pending state on every render — no new storage — by iterating logs chronologically, resolving any pending whose exercise has since been completed in a same-day-type session, and keeping anything still unresolved within the 14-day window. Result is grouped by day type. Dashboard renders a `.catchup-card` with tappable groups; tapping opens a choice modal and then `startMakeup(dayType, exNames)` sets `activeSessionFilter` + `activeSession`, which makes SessionLogger run a filtered slice of the day's plan. The resulting log carries `isMakeup: true`, `makeupFrom: [exNames]`, and `day: <original PHUL day>`, so `calcNextWeight` picks it up naturally. Direct "Skip" button on the active-exercise card (Taken-and-abandoned are now cleanly distinct; Skip uses a two-tap inline confirm).

A twice-missed exercise is refreshed to the newer miss's date (it used to keep the first, and aged out of the 14-day window while still missing). Makeup logs **don't advance the A/B rotation** — the Dashboard's next-day pick skips `isMakeup`.

**Catch up all (v9.2).** With more than one pending group, the catch-up card offers one merged session: `activeSession = CATCHUP_ALL` with a filter of `"Day::Exercise"` tokens (names alone are ambiguous — `DB Lateral Raise` is in both A and B). `buildCatchupPlan` keeps each exercise's own `day`, so progression suggestions come from the right history; `splitCatchupLogs` writes **one makeup log per source day** on finish (a day with nothing done writes nothing), and an exercise pending on two days is done once, logged to the first, and the other day's entry dismissed.

### Top-level structure (all in `index.html`)
- **`App`** — root component. Owns all persistent state and the `activeSession` / `tab` routing. When `activeSession` is set, it renders `SessionLogger` full-screen instead of the tab layout.
- **Tabs**: `Dashboard`, `WorkoutTab`, `DietTab`, `StatsTab` — each receives the slices of state it needs plus setters.
- **`SessionLogger`** — the most complex component. Handles live set logging, rest timer, tier-gated exercise skipping (T1 → T2 → T3), superset alternation, draft autosave, and rest-timer restoration after the tab is backgrounded (via `restStartedAtRef` + Page Visibility). **Every draft save goes through `snapshot()`**, which reads a `latest` ref updated on each render — the rest-timer interval and visibility handler are closures from when the rest *started*, and used to write that stale copy over the draft when the timer hit zero (an edit made during the rest was lost on the next reload). The draft also carries `firstSetAt`/`lastSetAt`; `App.onFinish` dates the log by the last set and falls back to first→last span for duration, so a draft finished the next morning isn't dated as if it happened at the tap. Duration is `sessionDurationMins`: the larger of wall clock and first→last-set span, each only if plausible — the logger resets its start when a draft is reopened >3h later, which made a real 75-minute session log as 0 (Full Body A, 2026-09-28).

### Core domain logic

**Auto-progression (`calcNextWeight`)** — the heart of the app. Given the planned exercise and the full `logs` map, it:
1. Pulls the last 3 same-day sessions for that exercise, skipping ones where it was abandoned. Each entry keeps `{sets, ts, pos}` — `pos` is where the exercise sat in that session (0 = first, 1 = last).
2. Derives the **working weight as the modal set weight** (heaviest breaks ties), *not* the first set's. Anchoring on set 1 misreads both ramping up (40, 50, 50) and dropping after a failed top set (60, 50, 50).
3. Computes metrics (`perf`, `failedSets`, `worstDeficit`, `stallCount`, `allTop`, `minOverTop`, `repSpread`/`burnoutPattern`, `avgRpe`).
4. Runs a **priority-ordered decision tree** (10 branches: crush / progress / fatigue-hold / hard-deload / deload / step-down / stall-reset / grind-hold / strong-hold / hold). **First match wins** — order matters. Each branch returns `{ weight, status, increment, eq, note }`.
   - **The stall counter is protocol-aware.** A session at the same weight only counts as "stuck" if it was *pushed* (avg RPE > 8, RPE missing, or a set under the range) — a round logged at RPE ≤ 8 with nothing failed is the leave-2-reps rule being followed. Total reps rising session-over-session ends the count (double progression working). Compounds reset after 2 counted sessions, isolations after 3. This replaced a counter that fired a 7% reset on squat 6,6,7 → 7,7,7 — punishing the exact behaviour the effort targets ask for. Branch 2a's RPE cap is 8.5, not 8, for the same reason: the last set of an honest RIR-2 round drifts to a 9.
5. Applies a **layoff override**: if the last session was >21 days ago, the result is scaled by `stalenessFactor(days)` and re-tagged `status: "return"`.

Three invariants worth not regressing, each of which fixed an observed real-data failure:
- **Excess is measured on the weakest set (`minOverTop`), never the total.** A single big finisher set (5,5,12 on a 3-5 range) used to sum to "+7 over top" and fire a double increment every session, walking the weight far past what three honest sets could hold.
- **`burnoutPattern` suppresses the RPE-easy double jump.** When rep spread across same-weight sets is wide, average RPE stops being a trustworthy "was this easy?" signal.
- **`fatigueSuspect` (late in session + tier ≥2) holds instead of deloading on a first bad round.** Without it, end-of-session accessories get deloaded for being tired and spiral downward while the compounds at the front keep climbing.

**Restart seeding (`computeRestartWeight`)** — when an exercise has no history for its own day but declares `seedFrom: [names]`, load is carried across from prior history. Staleness is read from the newest hit across *all* seed names (a variation done last week means the movement is recent), but trend/peak are read only from hits whose source `repRange` midpoint is closest to the target's — the same name can mean different things on different days. Also applies `rangeAdj` (~2.5%/rep) when the new rep range differs from the old one.

**Numeric parsing (`num`, `isScorable`)** — always parse weights/reps through `num()`, which handles comma decimals (`"17,5"` → 17.5; `parseFloat` gives 17). `isScorable` additionally rejects 0-rep sets, which otherwise read as catastrophic failures and trigger phantom deloads.

**One-time migration (`runMigrations`)** — version-stamped in `phul_migration_v`, idempotent. Repairs comma decimals, un-completes 0-rep sets, drops empty makeup drafts. Returns a report rendered once on the Dashboard; bump `MIGRATION_VERSION` to add a new pass.

**Warm-up ramps (`warmupSets`)** — display-only ramp shown before the first working set of tier-1/barbell exercises. Deliberately **not** logged: warm-ups aren't performance data and feeding them to the progression tree would drag the working weight down.

**Equipment-aware weight snapping** — `getEquipmentType` → `snap` → `getBaseIncrement` / `snapDB` / `dbIncrement`. Four equipment classes (`barbell`, `machine`, `dumbbell_heavy`, `dumbbell_light`) with different increments and rounding. Dumbbells under 10kg use 1kg steps, otherwise 2.5kg. When adding a new exercise to any plan, also add it to the appropriate list inside `getEquipmentType` or it will default to `dumbbell_heavy`.

**Rest times (`getRestSeconds`, `getBetweenExerciseRest`)** — classified as heavy / med / isolation, with power-day multiplier. Same caveat: new exercises must be categorized here or they fall through to the isolation default.

**Barbell weights are PLATE weight — the bar is excluded.** This convention runs through the whole app (`platesPerSide(totalPlateWeight)`, and the "65kg plates" notes in `PHUL`). A logged Bench of `42.5` means 42.5kg of plates on a 20kg bar = **62.5kg actually lifted**. Two bugs came from conflating the two, both fixed: `minWeight` clamped deloads at `barWeight` (a 20kg-of-*plates* floor, i.e. 60kg total, making a real deload impossible on lighter lifts), and `warmupSets` took its percentages of plate weight, so a "55%" ramp step was really 68% of true load. Warm-up percentages now convert to total, take the percentage, and convert back. **Machines and dumbbells are logged as-is** — the bar adjustment applies only to `barbell: true`.

**Plate calculator (`platesPerSide`, `formatPlateBreakdown`)** — greedy allocation from `PLATE_SET = [25, 20, 15, 10, 5, 2.5, 1.25]`. Uses `1e-9` float safety and reports any leftover with `kg ?`. `BAR.olympic = 20`, `BAR.ez = 10`, `BAR.short = 15`; barbell exercises carry `barWeight` in their plan entry.

**Body analysis (`analyseProgress`, lines ~1857–1913)** — 2×3 decision table over `(wDelta, bfDelta)` thresholds (`WEIGHT_NOISE = 0.5kg`, `BF_NOISE = 0.4%`), branching on `phase`. Output is the scenario text shown in `StatsTab`.

**Calorie / protein targets (`computeTargets`)** — targets are derived from body composition and real training frequency, not the legacy `BULK_KCAL`/`CUT_KCAL` constants (which survive only as a no-stats fallback). BMR uses Katch-McArdle when lean mass is known, Mifflin-St Jeor otherwise. Maintenance is `bmr × 1.30 + sessionsPerWeek × 350/7` — **deliberately not a tier ladder keyed on training frequency**, because a ladder collapses toward sedentary during a bad stretch, quietly lowering the calorie target exactly when someone is already under-eating. Validated against the user's own logged intake and weight change (within 1.4%).

Two numbers come back, not one: `floor` (below this the phase stops working — on a bulk that's maintenance) and `target`. A single target that gets missed most days just renders a daily failure notice; a floor is passable, so it's worth aiming at. `Dashboard` and `DietTab` shadow the module-level `kcalTarget`/`PROTEIN_G` with the computed values, so existing references pick them up unchanged.

**Body trend alarm (`bodyTrendAlarm`, `daysSinceWeighIn`)** — surfaced on both the Dashboard and the Diet tab. Losing lean mass is a silent failure: the training log looks great while the result goes backwards. This is what went unnoticed for four months in early 2026 (−1.0 kg lean during a "bulk"), because `analyseProgress` lived one tab away and nothing prompted a weigh-in. Prompts to measure past 14 days.

**Diet phase scaling (`getMealKcal`)** — `carbHeavy: true` meals scale their calories by phase (bulk up, cut down); protein is unchanged. When editing `DEFAULT_MEALS`, setting `carbHeavy` correctly matters for the calorie math.

### Programs (`PROGRAMS`, `PHUL`, `FULLBODY`)
There are two built-in programs, registered in `PROGRAMS` and selected by `phul_program`:
- **`fullbody`** (default) — `FULLBODY`, a 2-day A/B rotation, ~11 core exercises each (~90 min). Built for real-world adherence: a 4-way split assumes 4x/week and degrades badly below that, because each session only recurs every *n* visits. Two full-body days mean whatever you manage in a week, everything got trained. **v9.0 doubled the volume** (two movements per big muscle: press + fly, pulldown + row, squat + leg extension, etc.) after the v8 six-lift version turned out to be a minimum-dose plan — chest was getting 6 direct sets/week at 2x, and the dose-response data (Pelland 2025) keeps rising to ~11/muscle/session. The user was explicit that he wants to *be* at the gym, not out of it fast; don't trim this plan back for session length. Session B's `Bulgarian Split Squat` / A's `Side Plank` / B's `Suitcase Carry` are there for a left/right balance issue — unilateral and frontal-plane trunk work. Keep them.
- **`phul`** — the original 4-day split, kept intact.

Each exercise entry carries `{ name, day, tier, sets, repRange, startWeight, barbell?, barWeight?, note, seedFrom?, optional?, hardMode?, supersetWith?, unit?, bodyweight? }`.
- `unit: "s"` — a **timed** exercise: `reps` is seconds per side. `bodyweight: true` on top of that (Side Plank) means no load at all: `calcNextWeight` short-circuits to `calcNextHold`, which returns `{ hold, weight: 0 }` (a target time, not a weight), and the logger hides the weight input. `isScorable` rejects weightless sets, so these never reach the weight tree. A loaded timed exercise (Suitcase Carry: dumbbell kg × seconds) goes through the normal tree unchanged. `fmtSet(ex, s)` renders either shape.
- `supersetWith` is a **real flow** in `SessionLogger` since v9.0, not a display note: leader set → 20s "switch" rest → partner set → full rest → leader's next set. The pair only runs as a pair while both halves are live (neither held, abandoned, nor done) — see `livePartner`. A hard-mode `myo` final set on the partner gets the full rest instead of the switch. Before this the user alternated by tapping between exercises in the list, which the rest timer blocked, and took two full rests per round.
- `tier` (1/2/3) drives `SessionLogger`'s skip-gating: you cannot skip past an unresolved lower-tier exercise without explicit confirmation via `tierGuardModal`.
- `seedFrom` — ordered list of prior exercise names to carry load across from (see `computeRestartWeight`).
- `supersetWith` — pair exercises so they alternate. **Pair by equipment as well as by antagonist**: the arm pairs are EZ-bar/EZ-bar (session A) and dumbbell/dumbbell (session B), so each pair is one station you load once. An antagonist pair split across two stations is worse than not supersetting at all — it means walking back and forth or occupying two things.
- `optional: true` — a **finisher**. Excluded from `coreExercises(plan)`, so it never gates finishing, never counts in the `doneCount / coreEx.length` denominator, and skipping it is not "abandoning."

**Switching programs never orphans history.** Logs store their `day` name, and anything reading old logs must resolve it via `lookupDay(name)` (which unions every program's days) rather than indexing the *active* program. Grep for `lookupDay` before adding a new read path over `workoutLogs`.

### Intensity phasing (`hardModeState`, `applyIntensity`, `FINISHERS`)
Hard mode is **earned, not chosen**: `HARD_MODE_WEEKS` (3) consecutive calendar weeks with at least `HARD_MODE_MIN_SESSIONS` (2) sessions each unlocks it (`hardModeState`), and a week under the minimum resets the gate. The minimum is 2 because on a 2-day rotation that means A and B both ran — every muscle got its two exposures. The user asked for 4; his 2026 logs contain one 4-session week, followed by three weeks off. A bar never met is a lock, not a gate. The visible consistency streak (`consistency().streak`) still counts any-session weeks — the two are deliberately different numbers. **Both count distinct calendar days, not logs** (v9.2): A and B back to back in one evening, or a merged catch-up writing two logs, is one visit — otherwise a single evening satisfies the 2/week gate on its own. Weeks 1–3 run deliberately submaximal because every prior restart failed the same way — come back, go hard, vanish within a month. Effort was never the missing input (53% of logged sets were RPE 9–10); turning up on an unexciting Tuesday was.

`applyIntensity(plan, on)` layers per-exercise `hardMode: { sets?, finish? }` overrides onto a resolved plan and is a **no-op returning the identical object** when off, so the normal path is untouched. It's applied in `App.resolvePlan` and only to built-in program days, never to custom sessions. Hard mode: T1 → 4 sets + `amrap` finish, T2 → `amrap`, T3 → `myo`, isolation rest compressed to 60s via `resolveSetRest`. Compound rest is deliberately NOT compressed — cutting rest there just makes the next set lighter, costing the load progression that's the actual goal.

Technique selection is narrow on purpose. Volume-controlled trials show intensity techniques yield the *same* hypertrophy as straight sets, just in less time, so they're included only where they buy density (myo-reps) or drive progression (AMRAP). **Past-failure lengthened partials are deliberately excluded**: rep-matched they grow no more than extra full-ROM sets, and they cost additional recovery. Don't add them back without new evidence.

### Effort targets (`effortTarget`)
Proximity to failure is prescribed **per exercise, split on tier** — a blanket rule is wrong in both directions:
- **tier 1–2 (compounds)** → stop at RPE 8, ~2 reps in reserve. Strength gains measurably favour staying further from failure; technique degrades under a fatigued CNS on loaded spinal work; and failing set 1 costs reps on sets 2–3, which costs total volume. Observed directly in real data: bench 8/5/4 = 17 reps, where stopping set 1 at 6 would have yielded ~6/6/6 = 18.
- **tier 3 (isolations)** → last set to failure. Near-zero systemic cost, fast recovery, no technique to lose. Hard mode's myo-reps take these past failure deliberately.

This is **displayed in the session**, not left to memory. The app previously showed a bare rep range, which reads as "get the top number" and quietly taught training every set to failure — the user said so explicitly ("when I see 8-12 I always go for 12, that seems like what I have to do"). An overshoot note also fires in the RPE picker, but only on hold-back lifts and only when the cap is actually exceeded.

**Branch 2a of `calcNextWeight` exists to keep the algorithm honest about this.** Without it, the only route to more load is hitting the top of the range on *every* set, which can only be done by training to failure — so the tree would punish the exact behaviour the guidance asks for. Clean work (no failed sets, tier ≤2, avgRpe ≤8, `perf >= 0.5`) now earns one increment. The `perf >= 0.5` floor makes it build reps before adding load.

### Adherence-first UI rules
These are deliberate product decisions, not styling accidents — don't "fix" them back:
- The Dashboard shows a **consistency streak**, not a weekly quota. A quota you rarely hit renders a failure notice on every app open.
- `consistency()` buckets by **Monday-anchored calendar weeks**, never by "N days ago". It originally used rolling `Math.floor(age / 7d)` buckets, which re-sorted themselves daily: with nothing logged, the same four sessions rendered as `· · · · 4 · · 1` one day and `· · · 3 1 · · 1` two days later. Numbers moving while the user does nothing destroys trust in the whole card. A session belongs to the week it happened in, permanently — guarded by a clock-mocking test.
- The current week **never breaks the streak while it's still running** (`atRisk` flags it instead). Opening the app on a Monday morning must not report that the streak is gone.
- `SessionLogger` offers a **minimum session** ("End session early") once `MIN_SESSION` (3) core lifts are done. A short session is a real outcome, not a quit. **It requires a two-tap confirm and is deliberately not styled green.** The first version was green, sat under the set-logging controls, said "Good enough — log it ✓" and fired on one tap — it read as "log this exercise" and silently ended a real workout mid-session. Destructive actions never get the affirmative colour, an ambiguous verb, or a one-tap path. Guarded by a regression test in `test/render.test.js`.
- `tools/merge-sessions.mjs` repairs a workout that got split across two logs (dry-run by default; `--apply` writes `*.merged.json` to import). It concatenates completed sets per exercise rather than picking one log, because a split can cut an exercise in half.
- Hard mode is gated behind a 3-week streak rather than offered as a toggle. The gate is the intervention, not a limitation.
- Deload/hold notes are written to be non-punitive. `sugNoteClass` renders `restart`/`return` as neutral `info`, not red.
- The Diet tab judges a **rolling 7-day average**, not the single day. Daily intake swings far too much (820 → 3160 kcal in one month) for a per-day verdict to mean anything, and bodyweight responds to the weekly average anyway. Unlogged days are excluded from the average rather than counted as zero — counting them would punish not-logging twice.
- **The scale outranks the food log.** `weightTrend()` is the primary diet signal, shown above the logging UI: it integrates every meal logged *and* every one forgotten, which matters at low logging adherence. Target rate is `RATE_TARGET` (+0.25–0.6 kg/month on a bulk); the verdict converts the gap to a kcal/day adjustment at 7700 kcal/kg. Note that "flat" only asks for ~+100 kcal — the large corrections are only for actual deficits.
- **The per-ingredient meal library was deleted in v8.8.** It was used 18 times against 37 freeform entries; the detail was never the bottleneck, the typing was. `DEFAULT_MEALS`/`getMealKcal` survive so old logs still total correctly and saved meals fold into the quick-add strip, but there is no library view or editor. Don't rebuild it.
- **A rough whole-day estimate beats a blank day.** The `[light|normal|big]` buttons replace the day's total outright, anchored to `computeTargets`. His logged "Lunch" ranges 750–1350 kcal, so everything in this app was always an estimate — precision was never available to lose.
- **Quick-add buttons are mined from repeated freeform `extras`**, not from the meal library. The library wants per-ingredient detail; the real logging pattern is coarse and repetitive ("Lunch ~1200"). Build for the observed behaviour, not the intended one.

### Notifications (`worker/`, optional)
`PUSH_ENDPOINT` in `index.html` is empty by default and the entire feature is then absent — the app stays a zero-backend static file. Setting it to a deployed Cloudflare Worker URL enables **one weekly weigh-in reminder**, deliberately nothing else: a daily food nudge becomes something you learn to dismiss, which is a recurring failure notice.

`worker/src/index.js` implements VAPID (RFC 8292) directly against WebCrypto — no `web-push` dependency, since Workers has no Node crypto and the ES256 signing is ~40 lines. **Pushes carry no payload**: an empty push still wakes the service worker, which composes the text locally, so payload encryption is skipped entirely and the push service learns nothing about the user. Dead subscriptions (404/410) are deleted on send.

iOS delivers web push only to a Home-Screen-installed app; `PushToggle` detects a plain Safari tab and says so instead of offering a button that silently fails.

### Versioning convention
Recent commits follow `vX.Y update` / `vX.Y-<Theme>`. The version string is rendered in the footer (`.app-version`) and should be bumped in the JSX when shipping user-visible changes.
