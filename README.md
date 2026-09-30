# Hevy Stats Shortcut

An Apple Shortcut that analyzes your Hevy workout data and returns a dictionary with:

- **`workingSetsPerMuscleGroup`** — working sets per muscle group for your most recently updated routine
- **`oneRepMaxKgPerExercise`** — estimated 1RM (kg) per exercise in that routine, from your full Hevy history
- **`routineName`** — the name of the analyzed routine

## How it works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ Shortcut    │────▶│ Hevy API     │────▶│ Extract fragments   │
│ Input (key) │     │ (3 calls)    │     │ (routine, templates,│
└─────────────┘     └──────────────┘     │  history)           │
                                         └────────┬────────────┘
                                                  │
                                         ┌────────▼────────────┐
                                         │ data: URL page runs │
                                         │ src/hevy-stats.js   │
                                         └────────┬────────────┘
                                                  │
                                         ┌────────▼────────────┐
                                         │ Dictionary result   │
                                         └─────────────────────┘
```

1. **Shortcut Input** — your Hevy API key (Hevy Pro required; find it in the Hevy app under Settings) is passed as the shortcut's input. The key is used for the API calls and never stored.
2. **Get Contents of URL** × 3 — fetches your routines, exercise templates, and each routine exercise's history from `https://api.hevyapp.com`.
3. **Fragment extraction** — plain data (IDs, URL-encoded titles, set types, weight/reps strings) is pulled out with Repeat loops. No analysis happens here.
4. **JavaScript core** — `src/hevy-stats.js` is embedded base64, decoded, and run inside a `data:text/html` page via Rich Text coercion. It computes the stats and `document.write`s the URL-encoded JSON result.
5. **Result** — the JSON is URL-decoded and converted to a Dictionary, which is the shortcut's output.

All analysis semantics live in `src/hevy-stats.js`. The shortcut actions only do I/O.

## Repository layout

```
src/hevy-stats.js              JavaScript core (working sets, Epley 1RM)
test/run-tests.js              Node test harness (no dependencies)
test/fixtures/                 Hevy-shaped test data
shortcut/hevy-stats.cherri.template
                               Cherri source (template; built by build.py)
build/build.py                 Build script: inlines JS, compiles, post-processes
dist/HevyStats.shortcut
                               Compiled shortcut (unsigned)
dist/HevyStats_signed.shortcut
                               Compiled shortcut (signed via RoutineHub HubSign)
```

## Building

```bash
node test/run-tests.js     # run the JS tests (20 tests)
python3 build/build.py      # compile the shortcut
```

The build script post-processes the Cherri output to set `WFWorkflowHasShortcutInputVariables` (Cherri does not set this flag when `ShortcutInput` appears in dictionary header values).

To sign: POST the compiled plist XML to `https://hubsign.routinehub.services/sign` as `{"shortcutName": ..., "shortcut": ...}`; the response is the signed `.shortcut` file.

## Decisions

See [docs/DECISIONS.md](docs/DECISIONS.md) for the judgment calls (working-set definition, Epley formula, scope, etc.).

## Security

- Your Hevy API key is passed as Shortcut Input at runtime and never written into the shortcut, the source, or this repo.
- `dist/HevyStats_signed.shortcut` is signed via RoutineHub's HubSign service, so iOS treats it as trusted. The unsigned build is also kept for inspection.
