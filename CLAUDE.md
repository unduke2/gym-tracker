# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

There is no build step. The entire app lives in `index.html` — React 18 and Babel Standalone are loaded from CDN and JSX is transpiled in the browser via `<script type="text/babel">`. Open `index.html` directly in a browser (or serve the directory with any static server) to run it.

Because Babel runs client-side, there is **no type-check, no lint, no test command** — syntax errors only surface when the page is loaded. After any edit, verify by reloading the page and exercising the affected UI path.

**Pre-flight checking without a build step.** You can still validate changes headlessly, and should for anything touching progression logic:
1. Extract the `<script type="text/babel">` block to a `.jsx` file, then `npx esbuild --outfile=/dev/null app.jsx` for a syntax check.
2. For runtime checks, transpile with esbuild to CJS, strip the trailing `ReactDOM.createRoot(...)` line, shim `localStorage`/`document`/`window`, and `require()` the result — you can then call `calcNextWeight` etc. directly against a real backup JSON, or `renderToString` any component with `react-dom/server`.

Caveat worth knowing: **Babel Standalone downlevels `const`/`let` to `var`**, so temporal-dead-zone errors (using a `const` above its declaration) are silently invisible in the browser but throw under esbuild. If a headless render fails with "Cannot access X before initialization" and the browser seems fine, the browser is wrong — fix the ordering.

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

### Top-level structure (all in `index.html`)
- **`App`** — root component. Owns all persistent state and the `activeSession` / `tab` routing. When `activeSession` is set, it renders `SessionLogger` full-screen instead of the tab layout.
- **Tabs**: `Dashboard`, `WorkoutTab`, `DietTab`, `StatsTab` — each receives the slices of state it needs plus setters.
- **`SessionLogger`** (lines ~572–1314) — the most complex component. Handles live set logging, rest timer, tier-gated exercise skipping (T1 → T2 → T3), draft autosave, and rest-timer restoration after the tab is backgrounded (via `restStartedAtRef` + Page Visibility).

### Core domain logic

**Auto-progression (`calcNextWeight`)** — the heart of the app. Given the planned exercise and the full `logs` map, it:
1. Pulls the last 3 same-day sessions for that exercise, skipping ones where it was abandoned. Each entry keeps `{sets, ts, pos}` — `pos` is where the exercise sat in that session (0 = first, 1 = last).
2. Derives the **working weight as the modal set weight** (heaviest breaks ties), *not* the first set's. Anchoring on set 1 misreads both ramping up (40, 50, 50) and dropping after a failed top set (60, 50, 50).
3. Computes metrics (`perf`, `failedSets`, `worstDeficit`, `stallCount`, `allTop`, `minOverTop`, `repSpread`/`burnoutPattern`, `avgRpe`).
4. Runs a **priority-ordered decision tree** (10 branches: crush / progress / fatigue-hold / hard-deload / deload / step-down / stall-reset / grind-hold / strong-hold / hold). **First match wins** — order matters. Each branch returns `{ weight, status, increment, eq, note }`.
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

**Plate calculator (`platesPerSide`, `formatPlateBreakdown`)** — greedy allocation from `PLATE_SET = [25, 20, 15, 10, 5, 2.5, 1.25]`. Uses `1e-9` float safety and reports any leftover with `kg ?`. `BAR.olympic = 20`, `BAR.ez = 10`, `BAR.short = 15`; barbell exercises carry `barWeight` in their plan entry.

**Body analysis (`analyseProgress`, lines ~1857–1913)** — 2×3 decision table over `(wDelta, bfDelta)` thresholds (`WEIGHT_NOISE = 0.5kg`, `BF_NOISE = 0.4%`), branching on `phase`. Output is the scenario text shown in `StatsTab`.

**Diet phase scaling (`getMealKcal`)** — `carbHeavy: true` meals scale their calories by phase (bulk up, cut down); protein is unchanged. When editing `DEFAULT_MEALS`, setting `carbHeavy` correctly matters for the calorie math.

### Programs (`PROGRAMS`, `PHUL`, `FULLBODY`)
There are two built-in programs, registered in `PROGRAMS` and selected by `phul_program`:
- **`fullbody`** (default) — `FULLBODY`, a 2-day A/B rotation, 6 core lifts each. Built for real-world adherence: a 4-way split assumes 4x/week and degrades badly below that, because each session only recurs every *n* visits. Two full-body days mean whatever you manage in a week, everything got trained.
- **`phul`** — the original 4-day split, kept intact.

Each exercise entry carries `{ name, day, tier, sets, repRange, startWeight, barbell?, barWeight?, note, seedFrom?, optional? }`.
- `tier` (1/2/3) drives `SessionLogger`'s skip-gating: you cannot skip past an unresolved lower-tier exercise without explicit confirmation via `tierGuardModal`.
- `seedFrom` — ordered list of prior exercise names to carry load across from (see `computeRestartWeight`).
- `optional: true` — a **finisher**. Excluded from `coreExercises(plan)`, so it never gates finishing, never counts in the `doneCount / coreEx.length` denominator, and skipping it is not "abandoning."

**Switching programs never orphans history.** Logs store their `day` name, and anything reading old logs must resolve it via `lookupDay(name)` (which unions every program's days) rather than indexing the *active* program. Grep for `lookupDay` before adding a new read path over `workoutLogs`.

### Adherence-first UI rules
These are deliberate product decisions, not styling accidents — don't "fix" them back:
- The Dashboard shows a **consistency streak** (consecutive 7-day windows containing ≥1 session), not a weekly quota. A quota you rarely hit renders a failure notice on every app open.
- `SessionLogger` offers a **minimum session** ("Good enough — log it") once `MIN_SESSION` (3) core lifts are done. A short session is a real outcome, not a quit.
- Deload/hold notes are written to be non-punitive. `sugNoteClass` renders `restart`/`return` as neutral `info`, not red.

### Versioning convention
Recent commits follow `vX.Y update` / `vX.Y-<Theme>`. The version string is rendered in the footer (`.app-version`) and should be bumped in the JSX when shipping user-visible changes.
