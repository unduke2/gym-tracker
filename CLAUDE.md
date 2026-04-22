# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

There is no build step. The entire app lives in `index.html` — React 18 and Babel Standalone are loaded from CDN and JSX is transpiled in the browser via `<script type="text/babel">`. Open `index.html` directly in a browser (or serve the directory with any static server) to run it.

Because Babel runs client-side, there is **no type-check, no lint, no test command** — syntax errors only surface when the page is loaded. After any edit, verify by reloading the page and exercising the affected UI path.

## Architecture

Single-file SPA (`index.html`, ~2160 lines) implementing a personal PHUL (Power Hypertrophy Upper Lower) gym + diet + body-comp tracker. All state is persisted to `localStorage`; there is no backend.

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

The `DataBackup` component exports/imports these keys as JSON — this is the migration path between app versions, so preserve key names when changing shapes.

### Custom sessions (imported via `SESSION_FORMAT.md`)
Beyond the fixed PHUL 4-day split, users can import one-off session plans as JSON — makeup days, recovery, running, accessory-only days. See `SESSION_FORMAT.md` at the repo root for the schema + example + a prompt template for asking Claude to generate one. `App.resolvePlan(key)` looks up PHUL first, then custom sessions by id. Custom session exercises can override rest times via `ex.rest.set` / `ex.rest.betweenEx`, which `SessionLogger` reads through `resolveSetRest` / `resolveBetweenExRest` wrappers instead of calling `getRestSeconds` directly. Custom session logs carry `isCustom: true`, `dayLabel: <name>`, and `type: <power|hypertrophy|custom>` so history + dashboard can render them gracefully.

### Top-level structure (all in `index.html`)
- **`App`** — root component. Owns all persistent state and the `activeSession` / `tab` routing. When `activeSession` is set, it renders `SessionLogger` full-screen instead of the tab layout.
- **Tabs**: `Dashboard`, `WorkoutTab`, `DietTab`, `StatsTab` — each receives the slices of state it needs plus setters.
- **`SessionLogger`** (lines ~572–1314) — the most complex component. Handles live set logging, rest timer, tier-gated exercise skipping (T1 → T2 → T3), draft autosave, and rest-timer restoration after the tab is backgrounded (via `restStartedAtRef` + Page Visibility).

### Core domain logic

**Auto-progression (`calcNextWeight`, lines ~88–232)** — the heart of the app. Given the planned exercise and the full `logs` map, it:
1. Pulls the last 3 same-day sessions for that exercise.
2. Computes performance metrics (`perf`, `failedSets`, `worstDeficit`, `stallCount`, `allTop`, `totalOverTop`).
3. Runs a **priority-ordered decision tree** (9 branches: crush / progress / hard-deload / deload / step-down / stall-reset / grind-hold / strong-hold / hold). **First match wins** — when adding or modifying rules, order matters. Each branch returns `{ weight, status, increment, eq, note }` where `note` is shown to the user.

**Equipment-aware weight snapping** — `getEquipmentType` → `snap` → `getBaseIncrement` / `snapDB` / `dbIncrement`. Four equipment classes (`barbell`, `machine`, `dumbbell_heavy`, `dumbbell_light`) with different increments and rounding. Dumbbells under 10kg use 1kg steps, otherwise 2.5kg. When adding a new exercise to `PHUL`, also add it to the appropriate list inside `getEquipmentType` or it will default to `dumbbell_heavy`.

**Rest times (`getRestSeconds`, `getBetweenExerciseRest`)** — classified as heavy / med / isolation, with power-day multiplier. Same caveat: new exercises must be categorized here or they fall through to the isolation default.

**Plate calculator (`platesPerSide`, `formatPlateBreakdown`)** — greedy allocation from `PLATE_SET = [25, 20, 15, 10, 5, 2.5, 1.25]`. Uses `1e-9` float safety and reports any leftover with `kg ?`. `BAR.olympic = 20`, `BAR.ez = 10`, `BAR.short = 15`; barbell exercises carry `barWeight` in their plan entry.

**Body analysis (`analyseProgress`, lines ~1857–1913)** — 2×3 decision table over `(wDelta, bfDelta)` thresholds (`WEIGHT_NOISE = 0.5kg`, `BF_NOISE = 0.4%`), branching on `phase`. Output is the scenario text shown in `StatsTab`.

**Diet phase scaling (`getMealKcal`)** — `carbHeavy: true` meals scale their calories by phase (bulk up, cut down); protein is unchanged. When editing `DEFAULT_MEALS`, setting `carbHeavy` correctly matters for the calorie math.

### The `PHUL` plan object
`PHUL` (lines ~295–361) is the source of truth for the 4-day split. Each exercise entry carries `{ name, day, tier, sets, repRange, startWeight, barbell?, barWeight?, note }`. `tier` (1/2/3) drives `SessionLogger`'s skip-gating: you cannot skip past an unresolved lower-tier exercise without explicit confirmation via `tierGuardModal`.

### Versioning convention
Recent commits follow `vX.Y update` / `vX.Y-<Theme>`. The version string is rendered in the header next to "PHUL TRACKER" and should be bumped in the JSX (`index.html` line ~439) when shipping user-visible changes.
