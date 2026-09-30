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

## 2026-09-30 — bare truthiness checks removed (device failure)
Daniel ran the native build and got `Hevy Stats error: ()` — the error
notification fired with an EMPTY message. Compiled-plist inspection showed
the terminal `if !@errMsg {A} else {B}` was logically correct (Cherri
normalizes it to `if @errMsg {B} else {A}` with cond 100/101), so an empty
message reaching the notification is only possible if bare truthiness
conditions (`if @x` / `if !@x`, WFCondition 100/101) misbehave at runtime —
either inverted, or empty strings counting as "has any value".
Fix: the template now uses NO bare truthiness checks anywhere. Error state
is a numeric `@errFlag` (0/1) tested with `==`; emptiness is tested with
explicit `== @empty` / `!= @empty` text comparisons (cond 4/5), and
`downloadURL`/`getValue` outputs are coerced to text via `"{@var}"`
interpolation because Cherri's type checker rejects `==` on unknown-typed
variables. Compiled build verified: zero 100/101 conditions remain.

## 2026-09-30 — `@dict['key']` subscript silently dropped (device failure)

Daniel ran the fixed build with a real key and got
`Hevy Stats error: No usable routines in response` even though the API
returned his "Sample" routine. Daniel shared his key for testing (kept out
of the repo); a direct API call returned HTTP 200 with a valid
`{"page","page_count","routines":[...]}` payload, proving the bug was in the
compiled shortcut, not the API.

Root cause: Cherri 2.3.0 **silently compiles `@dict['key']` to a plain
variable copy**, dropping the key lookup — no `getvalueforkey` action is
emitted. Verified with a minimal repro: `@b = @a['routines']` produced only
`setvariable b`, while `@c = getValue(@a, "templates")` correctly produced
`getvalueforkey`. So `@routinesList` was the whole response dict, and
`count()` on it did not yield the list length, tripping the empty-routines
error branch.

Fix: every `@x['key']` replaced with `getValue(@x, "key")`. Complication:
Cherri's type checker only accepts `getValue` on statically-typed
`dictionary` values ("For constants only, otherwise `dictionary['key']`
syntax should be used"), and loop variables / `getFirstItem()` results are
typed `variable`. Workaround: cast with `@xDict = getDictionary(@x)` first
(`getDictionary` takes `variable` and returns `dictionary`; the underlying
"Get Dictionary from Input" coercion is identity for dict input), then
`getValue(@xDict, "key")`. The cast pattern was verified in isolation before
applying.

Post-fix audit of the compiled plist: 387 actions, 17 `getValue` calls in
source = 17 `getvalueforkey` actions in plist (all expected keys present:
routines, message, title, exercise_templates, exercises,
exercise_template_id, id, primary_muscle_group, sets, type,
exercise_history, weight_kg, reps, set_type + 2 dynamic keys), 1 setValue =
1 setvalueforkey, zero bare-truthiness conditions.

End-to-end verification with Daniel's real API responses (routines,
templates, both exercise histories; fixtures kept local, never committed):
`{"routineName":"Sample","workingSetsPerMuscleGroup":{"chest":3,"other":3},
"oneRepMaxKgPerExercise":{"Bench Press (Barbell)":69.9}}` — correct.
(Pull Up's template id was absent from templates page 1, so it groups under
"other" per the documented design; its history weights are null so it has no
1RM.)

## FIX 4 (Sep 30, 2026): Number action fails on empty text (null weight_kg)

Daniel's device run failed with "Number failed because shortcuts couldn't
convert from Text to Number." Root cause: bodyweight history entries (his
Pull Up) have `weight_kg: null` -> the template coerced to `""` and called
`number("")` unconditionally for every qualifying history entry. Shortcuts'
Number action FAILS on empty text instead of returning 0.

Fix in `shortcut/hevy-stats.cherri`: `@wNum`/`@rNum` now default to 0 and
`number()` is only called when the text is explicitly non-empty (`!= @empty`).
Null weight/reps then falls through the existing `> 0` / `>= 1` guards and
the entry is skipped — correct, since a null weight can't produce a 1RM.

Test hardening (same session, at Daniel's suggestion):
- `test/native-sim.js`: `toNumber` is now device-faithful — it THROWS on
  empty/non-numeric input like the real Number action, so any unguarded call
  fails loudly in tests instead of silently returning 0. Added regression
  test "edge: null weight_kg (bodyweight) never reaches number()" with null
  weight AND null reps entries. Negative control confirmed: with the old
  unguarded sim, this test fails with the exact device error.
- His real API responses are now saved as mocked regression data in
  `local-fixtures/` (routines, templates, both histories) with
  `test/real-fixtures-check.js` feeding them through the same pipeline and
  asserting the known-good result. local-fixtures/ is NEVER pushed to the
  public repo (personal workout data); old code run against it throws the
  exact device error, new code passes.

## Signing flow (corrected Sep 30, 2026)

- `python3 build/build.py` compiles with `cherri --skip-sign`, then
  post-processes the plist (sets `WFWorkflowHasShortcutInputVariables` and
  `WFWorkflowName`). Output: `dist/HevyStats.shortcut` (unsigned, for
  inspection).
- Signing: `cherri shortcut/hevy-stats.cherri --hubsign
  --output=dist/HevyStats_signed.shortcut` compiles the source and signs via
  RoutineHub's HubSign (`https://hubsign.routinehub.services/sign`), producing
  an AEA1 container. cherri does NOT accept a pre-built `.shortcut` file for
  signing — only `.cherri` source. (`npx cherri` does not exist; the binary is
  at `~/.local/bin/cherri`.)
- `#define name Hevy Stats` at the top of the source sets the output
  filename; the plist `WFWorkflowName` is only set by build.py's
  post-processing (unsigned artifact). The signed artifact's display name
  therefore comes from cherri's default.
- HubSign can be flaky: on Sep 30, 2026 ~19:25 EDT it began timing out on
  POST /sign (host up, 404 on root; signing worker hanging). Retry loop
  approach works; do not mistake the Go panic for a source error.
