# Hevy Stats Shortcut

An Apple Shortcut that analyzes your Hevy workout data and returns a dictionary with:

- **`workingSetsPerMuscleGroup`** — working sets per muscle group for your most recently updated routine
- **`oneRepMaxKgPerExercise`** — estimated 1RM (kg) per exercise in that routine, from your full Hevy history
- **`routineName`** — the name of the analyzed routine

Every run returns either that dictionary or a detailed error dictionary (`{"_error": ..., "_context": {...}}`); error branches also show a notification. There are no silent failures.

## How it works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ Shortcut    │────▶│ Hevy API     │────▶│ Native actions:     │
│ Input (key) │     │ (3 calls)    │     │ parse, loop, math,  │
└─────────────┘     └──────────────┘     │ assemble JSON       │
                                         └────────┬────────────┘
                                                  │
                                         ┌────────▼────────────┐
                                         │ Dictionary result   │
                                         └─────────────────────┘
```

1. **Shortcut Input** — your Hevy API key (Hevy Pro required; find it in the Hevy app under Settings) is passed as the shortcut's input. The key is used for the API calls and never stored or prompted for.
2. **Get Contents of URL** × 3 — fetches your routines, exercise templates, and each routine exercise's history from `https://api.hevyapp.com`.
3. **Native parsing + math** — dictionaries, repeat loops, conditions, and math actions compute working sets per muscle group and the best Epley 1RM per exercise, then assemble the result JSON by hand (with escaping for special characters in titles).
4. **Result** — the JSON is converted to a Dictionary, which is the shortcut's output.

No JavaScript, no HTML, no Rich Text actions — the shortcut is pure native Shortcuts actions, compiled from `shortcut/hevy-stats.cherri` with [Cherri](https://github.com/grysvn/cherri).

## Repository layout

```
src/hevy-stats.js              JavaScript spec (working sets, Epley 1RM) —
                               the native shortcut mirrors this logic
test/run-tests.js              Node test harness for the JS spec
test/native-sim.js             Node simulation of the Cherri logic, same fixtures
test/fixtures/                 Hevy-shaped test data
shortcut/hevy-stats.cherri     Cherri source (native actions)
build/build.py                 Build script: compiles, post-processes, sanity-checks
dist/HevyStats.shortcut        Compiled shortcut (unsigned)
dist/HevyStats_signed.shortcut Compiled shortcut (signed via RoutineHub HubSign)
```

## Building

```bash
node test/run-tests.js      # JS spec tests
node test/native-sim.js     # native-logic simulation tests (18 tests)
python3 build/build.py      # compile the shortcut with Cherri
```

The build script post-processes the Cherri output to set `WFWorkflowHasShortcutInputVariables` and `WFWorkflowName`, and sanity-checks the compiled plist (no Ask/HTML/JavaScript actions, downloadurl present).

To sign: `cherri shortcut/hevy-stats.cherri --hubsign` (RoutineHub HubSign service).

## Decisions

See [docs/DECISIONS.md](docs/DECISIONS.md) for the judgment calls (working-set definition, Epley formula, scope, Cherri quirks, error contract, etc.).

## Security

- Your Hevy API key is passed as Shortcut Input at runtime and never written into the shortcut, the source, or this repo.
- `dist/HevyStats_signed.shortcut` is signed via RoutineHub's HubSign service, so iOS treats it as trusted. The unsigned build is also kept for inspection.
