/*
 * Hevy Stats — core logic.
 *
 * Single source of truth for the Hevy workout analysis. This file is:
 *   1. required by the Node test harness (test/run-tests.js), and
 *   2. embedded (base64) into the Apple Shortcut, where it runs inside a
 *      data: URL page and returns its result via document.write.
 *
 * The shortcut never parses API JSON in Shortcuts actions; it only does I/O
 * (downloadURL) and passes raw JSON strings (base64) to this file. All
 * parsing, validation, and analysis live here, which makes the data
 * collection testable in Node.
 *
 * Two device passes (see deviceMain):
 *   pass 1 ("ids"):  parse routines JSON, output comma-separated template IDs
 *   pass 2 ("stats"): parse routines + templates + history JSONs, compute stats
 *
 * Error contract: parsers throw HevyError with a specific message and a
 * context object describing the relevant state. deviceMain catches these and
 * writes {"_error": message, "_context": {...}} so the shortcut can notify
 * the user with details instead of failing silently.
 */

var WORKING_SET_TYPES = {
  normal: true,
  failure: true,
  dropset: true
  // "warmup" intentionally excluded
};

var MAX_REPS_FOR_EPLEY = 30;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

function HevyError(message, context) {
  this.name = "HevyError";
  this.message = message;
  this.context = context || {};
}
HevyError.prototype = Object.create(Error.prototype);
HevyError.prototype.constructor = HevyError;

function fail(message, context) {
  throw new HevyError(message, context);
}

/* ------------------------------------------------------------------ */
/* Parsers: raw Hevy API JSON -> validated structures                   */
/* ------------------------------------------------------------------ */

function parseJsonText(jsonText, label) {
  var parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    fail(label + " response is not valid JSON", {
      label: label,
      parseError: String((e && e.message) || e),
      preview: String(jsonText).slice(0, 200)
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(label + " response is not a JSON object", {
      label: label,
      actualType: Array.isArray(parsed) ? "array" : typeof parsed
    });
  }
  return parsed;
}

/*
 * Routines response -> { routineName, exercises: [{templateId, title, setTypes}] }
 * Uses the first routine (most recently updated).
 */
function parseRoutinesResponse(jsonText) {
  var obj = parseJsonText(jsonText, "routines");
  var routines = obj.routines;
  if (!Array.isArray(routines)) {
    fail("routines response has no 'routines' array", {
      keys: Object.keys(obj)
    });
  }
  if (routines.length === 0) {
    fail("routines response contains zero routines", {
      hint: "Check that the API key is correct and Hevy Pro is active"
    });
  }
  var routine = routines[0];
  if (!routine || typeof routine !== "object") {
    fail("first routine entry is not an object", {
      actualType: typeof routine
    });
  }
  var routineName = routine.title;
  if (typeof routineName !== "string" || routineName.length === 0) {
    fail("first routine has no usable 'title'", {
      keys: Object.keys(routine)
    });
  }
  var rawExercises = routine.exercises;
  if (!Array.isArray(rawExercises)) {
    fail("routine '" + routineName + "' has no 'exercises' array", {
      routineName: routineName,
      keys: Object.keys(routine)
    });
  }
  var exercises = [];
  for (var i = 0; i < rawExercises.length; i++) {
    var ex = rawExercises[i];
    if (!ex || typeof ex !== "object") {
      fail("routine exercise at index " + i + " is not an object", {
        routineName: routineName,
        index: i,
        actualType: typeof ex
      });
    }
    var templateId = ex.exercise_template_id;
    if (typeof templateId !== "string" || templateId.length === 0) {
      fail("routine exercise at index " + i + " has no 'exercise_template_id'", {
        routineName: routineName,
        index: i,
        keys: Object.keys(ex)
      });
    }
    var title = typeof ex.title === "string" ? ex.title : templateId;
    var setTypes = [];
    var sets = ex.sets;
    if (Array.isArray(sets)) {
      for (var s = 0; s < sets.length; s++) {
        if (sets[s] && typeof sets[s].type === "string") {
          setTypes.push(sets[s].type);
        }
      }
    }
    exercises.push({ templateId: templateId, title: title, setTypes: setTypes });
  }
  return { routineName: routineName, exercises: exercises };
}

/*
 * Templates response -> { templateId: primaryMuscleGroup }
 */
function parseTemplatesResponse(jsonText) {
  var obj = parseJsonText(jsonText, "exercise_templates");
  var templates = obj.exercise_templates;
  if (!Array.isArray(templates)) {
    fail("templates response has no 'exercise_templates' array", {
      keys: Object.keys(obj)
    });
  }
  var muscleByTemplate = {};
  for (var i = 0; i < templates.length; i++) {
    var t = templates[i];
    if (!t || typeof t !== "object") {
      continue;
    }
    if (typeof t.id === "string" && typeof t.primary_muscle_group === "string") {
      muscleByTemplate[t.id] = t.primary_muscle_group;
    }
  }
  return muscleByTemplate;
}

/*
 * Single exercise-history response -> [{templateId, weightKg, reps, setType}]
 * Weight/reps arrive as whatever the API sent (number, string, or null);
 * normalization to float/int happens in computeStats via parseFloat/parseInt,
 * where NaN fails qualification and is excluded.
 */
function parseHistoryResponse(jsonText, templateId) {
  var obj = parseJsonText(jsonText, "exercise_history[" + templateId + "]");
  var entries = obj.exercise_history;
  if (!Array.isArray(entries)) {
    fail("history response for template '" + templateId + "' has no 'exercise_history' array", {
      templateId: templateId,
      keys: Object.keys(obj)
    });
  }
  var out = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e || typeof e !== "object") {
      continue;
    }
    out.push({
      templateId: templateId,
      weightKg: e.weight_kg,
      reps: e.reps,
      setType: e.set_type
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

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

function computeStats(parsed) {
  var muscleByTemplate = parsed.muscleByTemplate;
  var routine = parsed.routine;

  var workingSets = {};
  var titleByTemplate = {};
  var i, s;
  for (i = 0; i < routine.exercises.length; i++) {
    var ex = routine.exercises[i];
    if (!(ex.templateId in titleByTemplate)) {
      titleByTemplate[ex.templateId] = ex.title;
    }
    var muscle = muscleByTemplate[ex.templateId] || "other";
    for (s = 0; s < ex.setTypes.length; s++) {
      if (WORKING_SET_TYPES[ex.setTypes[s]]) {
        workingSets[muscle] = (workingSets[muscle] || 0) + 1;
      }
    }
  }

  var bestEpley = {}; // templateId -> number
  for (i = 0; i < parsed.historyEntries.length; i++) {
    var h = parsed.historyEntries[i];
    // Weight/reps may be strings or null; parseFloat/parseInt turn nulls
    // into NaN, which fails the checks in qualifiesFor1RM and is excluded.
    var w = parseFloat(h.weightKg);
    var r = parseInt(h.reps, 10);
    if (!qualifiesFor1RM(w, r, h.setType)) {
      continue;
    }
    var est = epley1RM(w, r);
    if (!(h.templateId in bestEpley) || est > bestEpley[h.templateId]) {
      bestEpley[h.templateId] = est;
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
    routineName: routine.routineName,
    workingSetsPerMuscleGroup: workingSets,
    oneRepMaxKgPerExercise: oneRepMax
  };
}

/* ------------------------------------------------------------------ */
/* Device entry points                                                 */
/* ------------------------------------------------------------------ */

function b64ToUtf8(b64) {
  var bin = atob(b64.replace(/\s+/g, ""));
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }
  // Fallback for environments without TextDecoder.
  return decodeURIComponent(escape(bin));
}

function writeOutput(text) {
  document.write(encodeURIComponent(text));
}

function writeError(err) {
  var payload = { _error: "unknown error", _context: {} };
  if (err && err.name === "HevyError") {
    payload._error = err.message;
    payload._context = err.context || {};
  } else if (err) {
    payload._error = String((err && err.message) || err);
  }
  writeOutput(JSON.stringify(payload));
}

/*
 * The shortcut replaces the __PLACEHOLDERS__ below before the page runs:
 *   __MODE__            "ids" | "stats"
 *   __ROUTINES_B64__     base64 of GET /v1/routines JSON
 *   __TEMPLATES_B64__    base64 of GET /v1/exercise_templates JSON
 *   __HISTORY_B64__      newline-joined base64 of each GET /v1/exercise_history JSON
 * Guarded so Node never evaluates it.
 */
function deviceMain() {
  var MODE = "__MODE__";
  try {
    if (MODE === "ids") {
      var routine = parseRoutinesResponse(b64ToUtf8("__ROUTINES_B64__"));
      var ids = [];
      for (var i = 0; i < routine.exercises.length; i++) {
        ids.push(routine.exercises[i].templateId);
      }
      // JSON dict: the shortcut reads 'ids' (comma-separated) or '_error'.
      writeOutput(JSON.stringify({ ids: ids.join(",") }));
      return;
    }
    if (MODE === "stats") {
      var parsedRoutine = parseRoutinesResponse(b64ToUtf8("__ROUTINES_B64__"));
      var muscleByTemplate = parseTemplatesResponse(b64ToUtf8("__TEMPLATES_B64__"));
      var historyEntries = [];
      var histParts = "__HISTORY_B64__".split("|");
      // History parts are aligned by index with routine.exercises.
      // Parts are pipe-joined base64 (| never appears in base64).
      for (var h = 0; h < histParts.length; h++) {
        var part = histParts[h].replace(/\s+/g, "");
        if (!part) {
          continue;
        }
        var templateId = parsedRoutine.exercises[h]
          ? parsedRoutine.exercises[h].templateId
          : "index-" + h;
        var entries = parseHistoryResponse(b64ToUtf8(part), templateId);
        for (var e = 0; e < entries.length; e++) {
          historyEntries.push(entries[e]);
        }
      }
      var result = computeStats({
        routine: parsedRoutine,
        muscleByTemplate: muscleByTemplate,
        historyEntries: historyEntries
      });
      writeOutput(JSON.stringify(result));
      return;
    }
    fail("unknown device mode", { mode: MODE });
  } catch (err) {
    writeError(err);
  }
}

if (typeof document !== "undefined" && typeof module === "undefined") {
  deviceMain();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    computeStats: computeStats,
    parseRoutinesResponse: parseRoutinesResponse,
    parseTemplatesResponse: parseTemplatesResponse,
    parseHistoryResponse: parseHistoryResponse,
    epley1RM: epley1RM,
    qualifiesFor1RM: qualifiesFor1RM,
    HevyError: HevyError,
    WORKING_SET_TYPES: WORKING_SET_TYPES
  };
}
