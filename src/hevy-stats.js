/*
 * Hevy Stats — core logic.
 *
 * Single source of truth for the Hevy workout analysis. This file is:
 *   1. required by the Node test harness (test/run-tests.js), and
 *   2. embedded (base64) into the Apple Shortcut, where it runs inside a
 *      data: URL page and returns its result via document.write.
 *
 * The shortcut never reimplements these decisions in Shortcuts actions; it only
 * does I/O (API calls, routine picker) and extracts plain fields that are fed
 * to computeStats() as dumb data. All semantics live here.
 *
 * Payload shape (built by the shortcut):
 *   {
 *     routineName: string,
 *     routineExercises: [ [templateId, title, [setType, ...]], ... ],
 *     templates:        [ [templateId, primaryMuscleGroup], ... ],
 *     historyEntries:   [ [templateId, weightKg, reps, setType], ... ]
 *   }
 *
 * Result shape (returned to the shortcut as a dictionary):
 *   {
 *     routineName: string,
 *     workingSetsPerMuscleGroup: { muscleGroup: count, ... },
 *     oneRepMaxKgPerExercise:    { exerciseTitle: kg, ... }
 *   }
 *
 * Judgment calls (see docs/DECISIONS.md):
 * - "Working set" = a set whose type is normal, failure, or dropset.
 *   Warmup sets are excluded.
 * - Working sets are counted from the routine's prescribed sets and grouped by
 *   each exercise template's primary_muscle_group. A template missing from the
 *   templates response falls into "other".
 * - Estimated 1RM uses the Epley formula on the best qualifying set in the
 *   exercise's full Hevy history: 1RM = w * (1 + r/30), except a true single
 *   (r == 1) which counts as w. Qualifying sets: working-set types only,
 *   weightKg > 0, 1 <= reps <= 30. Bodyweight/assisted (weight 0/null) and
 *   distance/duration sets cannot produce an estimate and are skipped.
 * - 1RM is reported per exercise in the routine, keyed by exercise title,
 *   rounded to 0.1 kg. Exercises with no qualifying history set are omitted.
 */

var WORKING_SET_TYPES = {
  normal: true,
  failure: true,
  dropset: true
  // "warmup" intentionally excluded
};

var MAX_REPS_FOR_EPLEY = 30;

function epley1RM(weightKg, reps) {
  if (reps === 1) {
    return weightKg;
  }
  return weightKg * (1 + reps / 30);
}

function qualifiesFor1RM(weightKg, reps, setType) {
  if (!WORKING_SET_TYPES[setType]) {
    return false;
  }
  if (!(weightKg > 0)) {
    return false;
  }
  if (!(reps >= 1 && reps <= MAX_REPS_FOR_EPLEY)) {
    return false;
  }
  return true;
}

function computeStats(payload) {
  var muscleByTemplate = {};
  var i;
  for (i = 0; i < payload.templates.length; i++) {
    muscleByTemplate[payload.templates[i][0]] = payload.templates[i][1];
  }

  var workingSets = {};
  var titleByTemplate = {};
  for (i = 0; i < payload.routineExercises.length; i++) {
    var ex = payload.routineExercises[i];
    var templateId = ex[0];
    var title = ex[1];
    var setTypes = ex[2];
    if (!(templateId in titleByTemplate)) {
      titleByTemplate[templateId] = title;
    }
    var muscle = muscleByTemplate[templateId] || "other";
    for (var s = 0; s < setTypes.length; s++) {
      if (WORKING_SET_TYPES[setTypes[s]]) {
        workingSets[muscle] = (workingSets[muscle] || 0) + 1;
      }
    }
  }

  var bestEpley = {}; // templateId -> number
  for (i = 0; i < payload.historyEntries.length; i++) {
    var h = payload.historyEntries[i];
    var hTemplateId = h[0];
    // The shortcut passes weight/reps as strings; nulls arrive as "".
    // parseFloat/parseInt turn those into NaN, which fails the > 0 and
    // range checks in qualifiesFor1RM and is therefore excluded.
    var w = parseFloat(h[1]);
    var r = parseInt(h[2], 10);
    var st = h[3];
    if (!qualifiesFor1RM(w, r, st)) {
      continue;
    }
    var est = epley1RM(w, r);
    if (!(hTemplateId in bestEpley) || est > bestEpley[hTemplateId]) {
      bestEpley[hTemplateId] = est;
    }
  }

  var oneRepMax = {};
  for (var tid in bestEpley) {
    if (!Object.prototype.hasOwnProperty.call(bestEpley, tid)) {
      continue;
    }
    var label = titleByTemplate[tid] || tid;
    oneRepMax[label] = Math.round(bestEpley[tid] * 10) / 10;
  }

  return {
    routineName: payload.routineName,
    workingSetsPerMuscleGroup: workingSets,
    oneRepMaxKgPerExercise: oneRepMax
  };
}

/*
 * Device entry point. The shortcut replaces the __PLACEHOLDERS__ below with
 * plain data fragments (already escaped for JS string context) before the
 * page runs. Guarded so Node never evaluates it.
 */
function deviceMain() {
  var PAYLOAD = {
    routineName: "__ROUTINE_NAME__",
    routineExercises: [__ROUTINE_EXERCISES__],
    templates: [__TEMPLATES__],
    historyEntries: [__HISTORY_ENTRIES__]
  };
  // The shortcut URL-encodes routine/exercise titles before substitution so
  // that quotes, backslashes, and newlines in custom names cannot break the
  // generated JavaScript. Decode them back here.
  PAYLOAD.routineName = decodeURIComponent(PAYLOAD.routineName);
  for (var i = 0; i < PAYLOAD.routineExercises.length; i++) {
    PAYLOAD.routineExercises[i][1] = decodeURIComponent(
      PAYLOAD.routineExercises[i][1]
    );
  }
  var result = computeStats(PAYLOAD);
  document.write(encodeURIComponent(JSON.stringify(result)));
}

if (typeof document !== "undefined" && typeof module === "undefined") {
  deviceMain();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    computeStats: computeStats,
    epley1RM: epley1RM,
    WORKING_SET_TYPES: WORKING_SET_TYPES
  };
}
