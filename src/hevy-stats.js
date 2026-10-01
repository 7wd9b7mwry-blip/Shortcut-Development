/*
 * Hevy Stats — core logic.
 *
 * Tested spec mirror for the native Apple Shortcut. The shortcut itself is
 * pure native Shortcuts actions compiled from shortcut/hevy-stats.cherri
 * (Cherri); it never embeds or executes this file. The parsing, validation,
 * and analysis logic here is mirrored action-by-action in the .cherri
 * source, which makes the data collection testable in Node via
 * test/run-tests.js (unit tests for this file) and test/native-sim.js
 * (a line-by-line simulation of the Cherri logic over the same fixtures).
 *
 * Error contract: parsers throw HevyError with a specific message and a
 * context object describing the relevant state. The shortcut mirrors this
 * by returning {"_error": message, "_context": {...}} so it can notify
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
 * Single exercise-history response -> [{templateId, weightKg, reps, setType,
 * workoutTitle, workoutStartTime, workoutEndTime}]
 * Weight/reps arrive as whatever the API sent (number, string, or null);
 * normalization to float/int happens in computeStats via parseFloat/parseInt,
 * where NaN fails qualification and is excluded. Workout fields are used
 * for routineDurationMinutes (most recent workout of this routine).
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
      setType: e.set_type,
      workoutTitle: e.workout_title,
      workoutStartTime: e.workout_start_time,
      workoutEndTime: e.workout_end_time
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

/*
 * Effective weight for a history set: the logged weight when > 0, else the
 * body weight for bodyweight sets (null/0 weight_kg) when known, else 0
 * (the set contributes no weight-based metrics).
 */
function effectiveWeightKg(weightKg, bodyWeightKg) {
  var w = parseFloat(weightKg);
  if (w > 0) {
    return w;
  }
  var b = parseFloat(bodyWeightKg);
  if (b > 0) {
    return b;
  }
  return 0;
}

function computeStats(parsed) {
  var muscleByTemplate = parsed.muscleByTemplate;
  var routine = parsed.routine;
  var bodyWeightKg = parsed.bodyWeightKg; // optional

  var workingSets = {};
  var titleByTemplate = {};
  var muscleByTid = {};
  var routineWorkingSets = 0;
  var i, s;
  for (i = 0; i < routine.exercises.length; i++) {
    var ex = routine.exercises[i];
    if (!(ex.templateId in titleByTemplate)) {
      titleByTemplate[ex.templateId] = ex.title;
    }
    var muscle = muscleByTemplate[ex.templateId] || "other";
    if (!(ex.templateId in muscleByTid)) {
      muscleByTid[ex.templateId] = muscle;
    }
    for (s = 0; s < ex.setTypes.length; s++) {
      if (WORKING_SET_TYPES[ex.setTypes[s]]) {
        workingSets[muscle] = (workingSets[muscle] || 0) + 1;
        routineWorkingSets++;
      }
    }
  }

  var bestEpley = {}; // templateId -> number
  var volumeByTid = {}; // templateId -> number (effective weight x reps)
  // Most recent workout of this routine (for routineDurationMinutes):
  // max workoutStartTime among entries whose workout title matches the
  // routine, compared as parsed dates (robust to mixed ISO offsets).
  var latestWorkoutStart = null;
  var latestWorkoutEnd = null;
  var latestStartMs = NaN;
  for (i = 0; i < parsed.historyEntries.length; i++) {
    var h0 = parsed.historyEntries[i];
    if (typeof h0.workoutTitle === "string" &&
        h0.workoutTitle === routine.routineName &&
        typeof h0.workoutStartTime === "string" && h0.workoutStartTime &&
        typeof h0.workoutEndTime === "string" && h0.workoutEndTime) {
      var startMs = Date.parse(h0.workoutStartTime);
      if (isNaN(startMs)) {
        continue;
      }
      if (latestWorkoutStart === null || startMs > latestStartMs) {
        latestWorkoutStart = h0.workoutStartTime;
        latestWorkoutEnd = h0.workoutEndTime;
        latestStartMs = startMs;
      }
    }
  }
  var routineDurationMinutes = null;
  if (latestWorkoutStart !== null) {
    var durMs = Date.parse(latestWorkoutEnd) - Date.parse(latestWorkoutStart);
    if (!isNaN(durMs) && durMs >= 0) {
      routineDurationMinutes = Math.round(durMs / 6000) / 10;
    }
  }
  for (i = 0; i < parsed.historyEntries.length; i++) {
    var h = parsed.historyEntries[i];
    // Weight/reps may be strings or null; parseInt(null) is NaN and fails
    // the range check below.
    var r = parseInt(h.reps, 10);
    if (!WORKING_SET_TYPES[h.setType]) {
      continue;
    }
    if (!(r >= 1 && r <= MAX_REPS_FOR_EPLEY)) {
      continue;
    }
    var effW = effectiveWeightKg(h.weightKg, bodyWeightKg);
    if (!(effW > 0)) {
      continue;
    }
    var est = epley1RM(effW, r);
    if (!(h.templateId in bestEpley) || est > bestEpley[h.templateId]) {
      bestEpley[h.templateId] = est;
    }
    volumeByTid[h.templateId] = (volumeByTid[h.templateId] || 0) + effW * r;
  }

  var oneRepMax = {};
  for (var tid in bestEpley) {
    if (!Object.prototype.hasOwnProperty.call(bestEpley, tid)) {
      continue;
    }
    var label = titleByTemplate[tid] || tid;
    oneRepMax[label] = Math.round(bestEpley[tid] * 10) / 10;
  }

  var volumePerExercise = {};
  var volumePerMuscle = {};
  var routineVolumeKg = 0;
  for (var vtid in volumeByTid) {
    if (!Object.prototype.hasOwnProperty.call(volumeByTid, vtid)) {
      continue;
    }
    var vlabel = titleByTemplate[vtid] || vtid;
    var v = Math.round(volumeByTid[vtid] * 10) / 10;
    if (!(v > 0)) {
      continue;
    }
    volumePerExercise[vlabel] = v;
    routineVolumeKg = Math.round((routineVolumeKg + v) * 10) / 10;
    var vm = muscleByTid[vtid] || "other";
    volumePerMuscle[vm] = Math.round(((volumePerMuscle[vm] || 0) + v) * 10) / 10;
  }

  var bwNum = parseFloat(bodyWeightKg);
  return {
    routineName: routine.routineName,
    workingSetsPerMuscleGroup: workingSets,
    volumeKgPerExercise: volumePerExercise,
    volumeKgPerMuscleGroup: volumePerMuscle,
    oneRepMaxKgPerExercise: oneRepMax,
    bodyWeightKgUsed: bwNum > 0 ? bwNum : null,
    routineWorkingSets: routineWorkingSets,
    routineVolumeKg: routineVolumeKg,
    routineDurationMinutes: routineDurationMinutes
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    computeStats: computeStats,
    parseRoutinesResponse: parseRoutinesResponse,
    parseTemplatesResponse: parseTemplatesResponse,
    parseHistoryResponse: parseHistoryResponse,
    epley1RM: epley1RM,
    qualifiesFor1RM: qualifiesFor1RM,
    effectiveWeightKg: effectiveWeightKg,
    HevyError: HevyError,
    WORKING_SET_TYPES: WORKING_SET_TYPES
  };
}
