# Decisions

Judgment calls made while building the Hevy Stats shortcut. The user asked for "working sets per muscle group", "1RPM per exercise", and "routine name" with the Hevy API as input; the specifics below are my interpretations.

## Native Shortcuts actions (no JavaScript)

An earlier version ran JavaScript through Get Rich Text from HTML. On-device testing (Sep 30, 2026) showed the JS never executed on the user's iOS version — the shortcut returned an empty result. The implementation was rebuilt with **native Shortcuts actions only**: URL fetching, dictionaries, loops, math, and text assembly. No HTML, no JavaScript, no Rich Text from HTML.

All parsing and math in the native build mirrors `src/hevy-stats.js`, which is kept as the tested spec. `test/native-sim.js` is a Node simulation of the Cherri logic (same control flow, same guards, same JSON assembly) run against the same fixtures; `test/run-tests.js` covers the JS spec itself.

## Cherri quirks discovered while writing the native template

- Use `else`, not `otherwise`.
- `and`/`or` in conditions can hang or fail the compiler — use nested `if`s.
- `getValue(@dict, @keyVariable)` supports dynamic keys.
- `setValue` accepts text values, not direct numeric variables — numbers are round-tripped through text (`"{@n}"`) and back with `number()`.
- A bare number copy (`@est = @wNum`) loses numeric type; `@est = @wNum * 1` preserves it.
- `contains` needs a variable on the left; a raw literal on the left panicked the compiler.
- Single-quoted strings are raw (no interpolation) — used for literal `{`/`}` in hand-built JSON.
- `show()` compiles to Show Result, not a notification action.

## Working sets counted per routine occurrence; history fetched once

A routine can list the same exercise template twice. Working sets are counted for **every exercise occurrence** in the routine (a duplicate exercise's sets still count toward the muscle total). History is fetched **once per template ID** (deduplicated), so the 1RM dictionary has one entry per template. The Node sim caught this divergence from the spec during development.

## Strong error handling

Every stage is guarded: missing API key, empty/non-JSON routines response, zero routines, routine with no title, empty/non-JSON templates response. Each failure sets a stage, a specific message, and a detail describing relevant state. The shortcut then shows a notification with the message and details and returns `{"_error": ..., "_context": {"stage": ..., "detail": ...}}`. There are no silent failures.

Known limitation: Get Contents of URL halts the shortcut with a system error on HTTP/network failures (e.g. a wrong API key → 401); Shortcuts offers no try/catch for that. Everything reachable from actions is handled.

## "1RPM" → estimated 1RM (Epley)

"1RPM" is read as **estimated one-rep max**. The estimate uses the **Epley formula**:

- `1RM = weight × (1 + reps / 30)` for reps > 1
- `1RM = weight` for a true single (reps == 1), since Epley overestimates singles

The estimate is taken from the **best qualifying set** in the exercise's full Hevy history (via `/v1/exercise_history/{id}`), not just recent workouts.

## What counts as a "working set"

A set counts as a working set if its Hevy `type` is `normal`, `failure`, or `dropset`. **`warmup` sets are excluded.** This applies both to the working-set counts and to 1RM qualification. The native check uses a comma-padded `,normal,failure,dropset,` string with `contains` so matches are whole-type only.

## Working sets are counted from the routine prescription

"Working sets per muscle group" counts the sets **prescribed in the routine** (not sets you've logged). They are grouped by each exercise template's `primary_muscle_group`. If a template is missing from the templates response, its sets fall into `"other"`.

## Scope: most recently updated routine

The shortcut analyzes the **first routine** returned by `GET /v1/routines` (Hevy returns most-recently-updated first). After you log a workout, that's typically the routine you just used. The routine's name is in the output so you can see which one was analyzed. A routine picker was omitted to keep the shortcut robust.

## 1RM qualification rules

A history set qualifies for 1RM estimation only if:
- set type is a working-set type (normal/failure/dropset — warmups excluded)
- `weight_kg > 0` (bodyweight/assisted sets with 0/null weight are skipped)
- `1 <= reps <= 30` (Epley is unreliable beyond ~30 reps)

1RM is reported **per exercise in the routine**, keyed by exercise title, rounded to 0.1 kg. Exercises with no qualifying history set are omitted from the dictionary.

## Titles with special characters

The result JSON is hand-assembled from text. Routine names, muscle keys, and exercise titles are escaped (`\` → `\\`, `"` → `\"`) before interpolation, so quotes, backslashes, and unicode in titles cannot break the JSON.

## API key handling

The key is passed as **Shortcut Input** at runtime (per the user's request). It is never prompted for, never stored in the shortcut, never committed to the repo, and never appears in build artifacts.

## What was not validated

- **Live Hevy API** — request shapes follow the official OpenAPI spec, but no call was made with a real API key.
- **Device end-to-end** — logic is covered by the Node sim and the compiled plist was inspected action-by-action, but the shortcut has not yet been run on a real iPhone with a real key.
