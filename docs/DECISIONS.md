# Decisions

Judgment calls made while building the Hevy Stats shortcut. The user asked for "working sets per muscle group", "1RPM per exercise", and "routine name" with the Hevy API as input; the specifics below are my interpretations.

## Two-pass architecture (no dictionary access on API responses)

The shortcut never calls Get Dictionary on a Hevy API response. All JSON parsing and validation lives in `src/hevy-stats.js`:

- **Pass 1 ("ids")**: routines JSON (raw, base64) → JS parses, validates, returns comma-separated exercise template IDs.
- **I/O**: shortcut fetches each exercise history JSON + templates JSON as raw text (base64, no parsing).
- **Pass 2 ("stats")**: JS parses all JSON, validates structure, computes stats.

This eliminated the repetitive getDictionary → key-access pattern that was causing problems. Dictionary access in Shortcuts actions is limited to the two JS outputs. All parsing is testable in Node (see `test/run-tests.js`).

## Strong error handling

Every parser in `src/hevy-stats.js` validates its input and throws `HevyError` with a specific message plus a context object describing relevant state (e.g., which template ID, what keys were present, a preview of malformed JSON). `deviceMain` catches these and returns `{"_error", "_context"}`. Each shortcut pass checks for `_error` and shows a notification with the message and details, then stops. No silent failures.

## "1RPM" → estimated 1RM (Epley)

"1RPM" is read as **estimated one-rep max**. There is no standard "1RPM" metric in strength training; 1RM is the standard. The estimate uses the **Epley formula**:

- `1RM = weight × (1 + reps / 30)` for reps > 1
- `1RM = weight` for a true single (reps == 1), since Epley overestimates singles

The estimate is taken from the **best qualifying set** in the exercise's full Hevy history (via `/v1/exercise_history/{id}`), not just recent workouts.

## What counts as a "working set"

A set counts as a working set if its Hevy `type` is `normal`, `failure`, or `dropset`. **`warmup` sets are excluded.** This applies both to the working-set counts and to 1RM qualification.

## Working sets are counted from the routine prescription

"Working sets per muscle group" counts the sets **prescribed in the routine** (not sets you've logged). They are grouped by each exercise template's `primary_muscle_group`. If a template is missing from the templates response, its sets fall into `"other"`.

## Scope: most recently updated routine

The shortcut analyzes the **first routine** returned by `GET /v1/routines` (Hevy returns most-recently-updated first). After you log a workout, that's typically the routine you just used. The routine's name is in the output so you can see which one was analyzed. A routine picker was omitted to keep the shortcut robust (Cherri has no clean way to build a dynamic picker list).

## 1RM qualification rules

A history set qualifies for 1RM estimation only if:
- set type is a working-set type (normal/failure/dropset — warmups excluded)
- `weight_kg > 0` (bodyweight/assisted sets with 0/null weight are skipped)
- `1 <= reps <= 30` (Epley is unreliable beyond ~30 reps)

1RM is reported **per exercise in the routine**, keyed by exercise title, rounded to 0.1 kg. Exercises with no qualifying history set are omitted from the dictionary.

## Titles with special characters

API JSON is passed to the JavaScript as **base64** (never interpolated as text), so quotes, backslashes, newlines, and unicode in routine/exercise titles cannot break the generated code. The JS decodes base64 via `atob` + `TextDecoder` for correct UTF-8 handling.

## API key handling

The key is passed as **Shortcut Input** at runtime (per the user's request; originally it was an Ask-for-Input prompt). It is never stored in the shortcut, never committed to the repo, and never appears in build artifacts. The tradeoff is the caller must supply the key on each run; the benefit is the key cannot leak via shortcut sharing.

## What was not validated

- **iPhone execution** — the data-URL JavaScript round trip was verified in Node and the plist structure was inspected, but the shortcut has not been run on a real iPhone.
- **Live Hevy API** — request shapes follow the official OpenAPI spec, but no call was made with a real API key.
- **HubSign** — the signing service was intermittently unreachable at build time; retries via curl succeeded and `dist/HevyStats_signed.shortcut` is signed.
