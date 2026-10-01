# Hevy Stats Shortcut

An Apple Shortcut that analyzes your Hevy workout data and returns a dictionary with:

- **`routineName`** — the name of the analyzed routine (your most recently updated)
- **`workingSetsPerMuscleGroup`** — working sets per muscle group for that routine
- **`volumeKgPerExercise`** — total working volume (kg) per exercise, from your Hevy history
- **`volumeKgPerMuscleGroup`** — total working volume (kg) per muscle group
- **`oneRepMaxKgPerExercise`** — estimated 1RM (kg) per exercise, from your Hevy history
- **`bodyWeightKgUsed`** — the body weight used for bodyweight sets, or `null` when unknown
- **`routineWorkingSets`** — total working sets in the routine (all exercises, warmups excluded)
- **`routineVolumeKg`** — total working volume (kg) across the routine
- **`routineDurationMinutes`** — duration (minutes, 0.1) of the latest history workout matching the routine name, or `null` when no matching workout has both timestamps

Every run returns either that dictionary or a detailed error dictionary (`{"_error": ..., "_context": {...}}`); error branches also show a notification. There are no silent failures.

## Hevy Record Metrics

A second shortcut, **Hevy Record Metrics**, runs Hevy Stats (input passed through unchanged) and returns a **list of `RecordMetric` dictionaries** — the shape the Record Metrics form expects (`Form Name`, `Metric Name`, `Set Value` as a real number, `Increment`/`Decrement`/`Reset` as real booleans = `false`, `Increment Amount` = `""`). One record per reported metric, across the `Hevy - Muscle Group`, `Hevy - Exercise`, and `Hevy - Routine` forms; the `<routine> duration` record is skipped when no duration is known. If Hevy Stats returns a handled error, it is passed through unchanged — no records are fabricated. See [docs/RECORD_METRIC.md](docs/RECORD_METRIC.md).

Both shortcuts must be installed (Hevy Record Metrics calls Hevy Stats by name). Input contract is identical to Hevy Stats.

## Input

Shortcut Input is either:

- your **Hevy API key as plain text** (Hevy Pro required; find it in the Hevy app under Settings), or
- a **dictionary** `{"api_key": "...", "body_weight_kg": 70}` — as JSON text or a real Dictionary object.

`body_weight_kg` is optional. When absent, the shortcut falls back to your latest Hevy body measurement (`GET /v1/body_measurements`); when no weight is known either way, bodyweight sets simply get no weight-based metrics. The key is used for the API calls and never stored or prompted for.

## Bodyweight exercises

A history set with no logged weight (`weight_kg` null or 0) is treated as a bodyweight set: its effective weight becomes your body weight when known. That gives bodyweight work real metrics — an Epley 1RM on total weight (the standard for weighted calisthenics) and a volume in kg. Sets with a logged weight always use the logged weight; body weight never inflates them.

## How it works

```
┌──────────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ Shortcut         │────▶│ Hevy API     │────▶│ Native actions:     │
│ Input (key or    │     │ (4 calls)    │     │ parse, loop, math,  │
│ key+body weight) │     │              │     │ assemble JSON       │
└──────────────────┘     └──────────────┘     └────────┬────────────┘
                                                       │
                                              ┌────────▼────────────┐
                                              │ Dictionary result   │
                                              └─────────────────────┘
```

1. **Shortcut Input** — API key (plain text) or `{"api_key", "body_weight_kg"}` dictionary.
2. **Get Contents of URL** × 4 — fetches your routines, your latest body measurements, each routine exercise's template (single-template endpoint, so templates past page 1 are never missed), and each exercise's history from `https://api.hevyapp.com`.
3. **Native parsing + math** — dictionaries, repeat loops, conditions, and math actions compute working sets per muscle group, working volume per exercise/muscle group, and the best Epley 1RM per exercise (all rounded to 0.1 kg), then assemble the result JSON by hand (with escaping for special characters in titles).
4. **Result** — the JSON is converted to a Dictionary, which is the shortcut's output. The success branch also shows the result.

Volume and 1RM share one definition of a qualifying set: type `normal`/`failure`/`dropset` (warmup excluded), effective weight > 0, reps 1–30. Exercises with no qualifying set are omitted from those dictionaries.

No JavaScript, no HTML, no Rich Text actions — the shortcut is pure native Shortcuts actions, compiled from `shortcut/hevy-stats.cherri` with [Cherri](https://github.com/grysvn/cherri).

## Repository layout

```
src/hevy-stats.js              JavaScript spec (working sets, Epley 1RM, volume,
                               bodyweight effective weight) — the native
                               shortcut mirrors this logic
test/run-tests.js              Node test harness for the JS spec
test/native-sim.js             Node simulation of the Cherri logic, same fixtures
test/real-fixtures-check.js    Regression check against real API responses
                               (local-fixtures/, never committed)
test/record-metrics-sim.js     Node simulation of the Record Metrics wrapper
test/fixtures/                 Hevy-shaped test data
shortcut/hevy-stats.cherri     Cherri source (native actions)
shortcut/hevy-record-metrics.cherri  Cherri source for the RecordMetric wrapper
build/build.py                 Build script: compiles, post-processes, sanity-checks
dist/HevyStats.shortcut        Compiled shortcut (unsigned)
dist/HevyStats_signed.shortcut Compiled shortcut (signed via RoutineHub HubSign)
dist/HevyRecordMetrics.shortcut        Compiled wrapper (unsigned)
dist/HevyRecordMetrics_signed.shortcut Compiled wrapper (signed via RoutineHub HubSign)
docs/RECORD_METRIC.md          The RecordMetric dictionary type + wrapper contract
```

## Building and testing

```bash
node test/run-tests.js             # JS spec tests
node test/native-sim.js            # native-logic simulation tests
node test/record-metrics-sim.js    # Record Metrics wrapper tests
node test/real-fixtures-check.js   # real-response regression (needs local-fixtures/)
python3 build/build.py             # compile + audit both shortcuts
```

To sign: `cherri shortcut/hevy-stats.cherri --hubsign --output=dist/HevyStats_signed.shortcut` (RoutineHub HubSign service).

The build script post-processes the Cherri output to set `WFWorkflowHasShortcutInputVariables` and `WFWorkflowName`, and sanity-checks the compiled plist (no Ask/HTML/JavaScript actions, no bare-truthiness conditions, downloadurl present).

## Decisions

See [docs/DECISIONS.md](docs/DECISIONS.md) for the judgment calls (working-set definition, Epley formula, volume scope, bodyweight handling, Cherri quirks, error contract, etc.).

## Security

- Your Hevy API key is passed as Shortcut Input at runtime and never written into the shortcut, the source, or this repo.
- `dist/HevyStats_signed.shortcut` is signed via RoutineHub's HubSign service, so iOS treats it as trusted. The unsigned build is also kept for inspection.
- `local-fixtures/` (real API responses used for regression testing) is never committed.
