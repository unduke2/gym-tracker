# PHUL Tracker — Custom Session Format

This document defines the JSON schema for **custom sessions** imported into PHUL Tracker. Use it when asking another Claude session (or writing by hand) to generate a one-off session — makeup days, recovery/deload sessions, running, accessory-only days, whatever.

Paste the resulting JSON into the app: **Train tab → Import session**.

## Schema (v1)

```jsonc
{
  "schemaVersion": 1,
  "id": "unique-id-here",           // required — slug / short string, no spaces preferred
  "name": "Human Readable Name",    // required — appears in UI
  "description": "one-line hook",   // optional — shown under the name
  "type": "hypertrophy",            // required — "power" | "hypertrophy" | "custom"
  "icon": "◆",                      // optional — single character/emoji, defaults by type
  "exercises": [                    // required — ≥1 exercise
    {
      "name": "One Arm DB Row",     // required
      "tier": 2,                    // required — 1 (heavy compound), 2 (accessory), 3 (isolation)
      "sets": 3,                    // required — integer
      "repRange": "8-10",           // required — e.g. "3-5", "8-12", "12-15"
      "startWeight": 17.5,          // required — kg. For "per dumbbell" exercises, that's per-DB weight.
      "note": "coach cue / rationale",  // optional — shown in session as the italic cue
      "barbell": true,              // optional — enables plate-loading diagram
      "barWeight": 20,              // optional — 20 (olympic), 10 (EZ), 15 (short). Needed if barbell=true.
      "supersetWith": "Other Ex",   // optional — name of paired exercise (must exist in this session)
      "optional": true,             // optional — marks a FINISHER: never gates finishing the
                                    //   session, never counted in the done/total denominator,
                                    //   and skipping it is not recorded as abandoning anything.
      "seedFrom": ["Bent Over Row"],// optional — carry the starting load across from prior
                                    //   history on these exercises instead of using startWeight
                                    //   cold. Discounted for time since, and translated if the
                                    //   rep range differs. First name is the canonical match.
      "rest": {                     // optional — overrides default getRestSeconds/getBetweenExerciseRest
        "set": 90,                  //   seconds between sets of THIS exercise
        "betweenEx": 120            //   seconds after this exercise before moving to next
      }
    }
  ]
}
```

### Field notes

- **`id`** — must be unique across your saved custom sessions. Use dates / descriptive slugs (`makeup-2026-04-18`, `recovery-lower`, `running-5k`). Logs key off this.
- **`type`** — controls default rest times (power = longer, hypertrophy = shorter) and day-color (orange for power, teal for hyper, neutral for custom). Pick the one whose rest defaults match; override per-exercise with `rest` if you need different numbers.
- **`tier`** — keep it honest. T1 = heavy compounds you prioritize, T2 = accessories, T3 = isolations. Drives the skip-gating logic.
- **`rest.set` and `rest.betweenEx`** — override the defaults. If omitted, the app falls back to `getRestSeconds(exName, dayType)` which has reasonable defaults for known PHUL exercises and generic defaults otherwise.
- **`supersetWith`** — both exercises should reference each other. Creates an antagonist-pair hint.

## Example — "Upper Hyper Makeup" session

```json
{
  "schemaVersion": 1,
  "id": "makeup-upper-hyper-2026-04-18",
  "name": "Upper Hyper Makeup",
  "description": "Catching up exercises missed from previous Upper Hyper session",
  "type": "hypertrophy",
  "icon": "◆",
  "exercises": [
    {
      "name": "One Arm DB Row",
      "tier": 2,
      "sets": 3,
      "repRange": "8-10",
      "startWeight": 17.5,
      "rest": { "set": 90 },
      "note": "Last time (4/07) only logged 1 set at 20kg. Dropped to 17.5kg to ensure clean 3 sets. Per dumbbell."
    },
    {
      "name": "Cable Fly",
      "tier": 2,
      "sets": 3,
      "repRange": "12-15",
      "startWeight": 10,
      "rest": { "set": 75 },
      "note": "Hit 24 reps on the top set at 10kg on 4/07 — if it flies again, bump to 11.25 or 12.5kg next."
    },
    {
      "name": "Incline DB Curl",
      "tier": 3,
      "sets": 3,
      "repRange": "8-12",
      "startWeight": 10,
      "rest": { "set": 75 },
      "supersetWith": "Tricep Pushdown",
      "note": "Full stretch — great for long head. Per dumbbell."
    },
    {
      "name": "Tricep Pushdown",
      "tier": 3,
      "sets": 3,
      "repRange": "12-15",
      "startWeight": 25,
      "rest": { "set": 75 },
      "supersetWith": "Incline DB Curl"
    },
    {
      "name": "EZ Bar Curl",
      "tier": 3,
      "sets": 2,
      "repRange": "8-10",
      "startWeight": 10,
      "barbell": true,
      "barWeight": 10,
      "rest": { "set": 90 },
      "supersetWith": "Skull Crushers"
    },
    {
      "name": "Skull Crushers",
      "tier": 3,
      "sets": 2,
      "repRange": "8-10",
      "startWeight": 10,
      "barbell": true,
      "barWeight": 10,
      "rest": { "set": 90 },
      "supersetWith": "EZ Bar Curl"
    },
    {
      "name": "Seated Calf Raise",
      "tier": 3,
      "sets": 4,
      "repRange": "10-12",
      "startWeight": 30,
      "rest": { "set": 60 }
    }
  ]
}
```

## Prompt template — ask Claude to generate one

> Generate a PHUL Tracker custom session JSON matching the schema in `SESSION_FORMAT.md`. I need [describe goal, exercises, context]. Output only the JSON, no prose.

The returned JSON goes straight into **Train tab → Import session** in the app.
