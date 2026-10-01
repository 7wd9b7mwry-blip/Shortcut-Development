// Test harness for src/hevy-stats.js. No dependencies: `node test/run-tests.js`.
var fs = require("fs");
var path = require("path");
var stats = require("../src/hevy-stats.js");

var failures = 0;

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function check(name, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  if (a === e) {
    console.log("ok   " + name);
  } else {
    failures++;
    console.log("FAIL " + name);
    console.log("  expected: " + e);
    console.log("  actual:   " + a);
  }
}

function checkClose(name, actual, expected, tol) {
  tol = tol || 0.051;
  if (Math.abs(actual - expected) <= tol) {
    console.log("ok   " + name);
  } else {
    failures++;
    console.log("FAIL " + name + " (expected ~" + expected + ", got " + actual + ")");
  }
}

function checkThrows(name, fn, expectedMsgPart) {
  try {
    fn();
    failures++;
    console.log("FAIL " + name + " (expected throw, got success)");
  } catch (e) {
    var msg = (e && e.message) || String(e);
    if (msg.indexOf(expectedMsgPart) >= 0) {
      console.log("ok   " + name);
    } else {
      failures++;
      console.log("FAIL " + name);
      console.log("  expected message containing: " + expectedMsgPart);
      console.log("  actual message: " + msg);
    }
    // HevyError must carry a context object with relevant state.
    if (e && e.name === "HevyError" && e.context && typeof e.context === "object") {
      console.log("ok   " + name + " (has context)");
    } else {
      failures++;
      console.log("FAIL " + name + " (missing HevyError context)");
    }
  }
}

// --- Parser: routines ---
var routine = stats.parseRoutinesResponse(fixture("api-routines.json"));
check("parse routines: name", routine.routineName, "Push Day");
check("parse routines: exercise count", routine.exercises.length, 5);
check("parse routines: first exercise", routine.exercises[0], {
  templateId: "tpl-bench",
  title: "Bench Press (Barbell)",
  setTypes: ["warmup", "normal", "normal", "normal", "failure"]
});

// --- Parser: templates ---
var muscles = stats.parseTemplatesResponse(fixture("api-templates.json"));
check("parse templates", muscles, {
  "tpl-bench": "chest",
  "tpl-ohp": "shoulders",
  "tpl-tri": "triceps"
});

// --- Parser: history ---
var benchHist = stats.parseHistoryResponse(fixture("api-history-bench.json"), "tpl-bench");
check("parse history: count", benchHist.length, 8);
check("parse history: first entry", benchHist[0], {
  templateId: "tpl-bench",
  weightKg: 100,
  reps: 5,
  setType: "normal"
});
check("parse history: null weight preserved", benchHist[5].weightKg, null);

// --- Parser error cases ---
checkThrows("routines: malformed JSON",
  function () { stats.parseRoutinesResponse("not json{{{"); },
  "not valid JSON");

checkThrows("routines: missing routines key",
  function () { stats.parseRoutinesResponse('{"foo": []}'); },
  "no 'routines' array");

checkThrows("routines: empty routines",
  function () { stats.parseRoutinesResponse('{"routines": []}'); },
  "zero routines");

checkThrows("routines: missing title",
  function () { stats.parseRoutinesResponse('{"routines": [{"exercises": []}]}'); },
  "no usable 'title'");

checkThrows("routines: missing exercises",
  function () { stats.parseRoutinesResponse('{"routines": [{"title": "X"}]}'); },
  "no 'exercises' array");

checkThrows("routines: exercise missing template id",
  function () {
    stats.parseRoutinesResponse('{"routines": [{"title": "X", "exercises": [{"title": "Y"}]}]}');
  },
  "no 'exercise_template_id'");

checkThrows("templates: malformed JSON",
  function () { stats.parseTemplatesResponse("{{{"); },
  "not valid JSON");

checkThrows("templates: missing key",
  function () { stats.parseTemplatesResponse('{"other": []}'); },
  "no 'exercise_templates' array");

checkThrows("history: malformed JSON",
  function () { stats.parseHistoryResponse("{{{", "tpl-x"); },
  "not valid JSON");

checkThrows("history: missing key",
  function () { stats.parseHistoryResponse('{"other": []}', "tpl-x"); },
  "no 'exercise_history' array");

// --- Full pipeline: parse all -> computeStats ---
function runPipeline() {
  var r = stats.parseRoutinesResponse(fixture("api-routines.json"));
  var m = stats.parseTemplatesResponse(fixture("api-templates.json"));
  // History parts aligned by index with routine.exercises (as the shortcut does).
  var histFiles = [
    "api-history-bench.json",
    "api-history-ohp.json",
    "api-history-tri.json",
    "api-history-bench.json", // tpl-bench appears twice
    "api-history-missing.json"
  ];
  var entries = [];
  var seenTid = {};
  for (var i = 0; i < histFiles.length; i++) {
    var tid = r.exercises[i].templateId;
    if (seenTid[tid]) {
      continue; // shortcut fetches history once per template id (seenTids)
    }
    seenTid[tid] = true;
    var parsed = stats.parseHistoryResponse(fixture(histFiles[i]), tid);
    for (var j = 0; j < parsed.length; j++) {
      entries.push(parsed[j]);
    }
  }
  return stats.computeStats({ routine: r, muscleByTemplate: m, historyEntries: entries });
}

var push = runPipeline();
check("pipeline routineName", push.routineName, "Push Day");
check("pipeline working sets", push.workingSetsPerMuscleGroup, {
  chest: 5,
  shoulders: 3,
  triceps: 2,
  other: 2
});
checkClose("pipeline 1RM bench (100x5 -> 116.7)",
  push.oneRepMaxKgPerExercise["Bench Press (Barbell)"], 116.7);
checkClose("pipeline 1RM ohp (42.5x6 failure -> 51.0)",
  push.oneRepMaxKgPerExercise["Overhead Press (Dumbbell)"], 51.0);
checkClose("pipeline 1RM triceps (30x12 -> 42.0)",
  push.oneRepMaxKgPerExercise["Triceps Pushdown (Cable)"], 42.0);
checkClose("pipeline 1RM missing template (70x10 -> 93.3)",
  push.oneRepMaxKgPerExercise["Mystery Machine"], 93.3);
check("pipeline volume per exercise",
  push.volumeKgPerExercise, {
    "Bench Press (Barbell)": 917.5,
    "Overhead Press (Dumbbell)": 575,
    "Triceps Pushdown (Cable)": 360,
    "Mystery Machine": 700
  });
check("pipeline volume per muscle",
  push.volumeKgPerMuscleGroup, {
    chest: 917.5,
    shoulders: 575,
    triceps: 360,
    other: 700
  });
check("pipeline bodyWeightKgUsed null when unknown",
  push.bodyWeightKgUsed, null);

// --- Volume + bodyweight ---
check("effectiveWeightKg: logged weight wins", stats.effectiveWeightKg(100, 70), 100);
check("effectiveWeightKg: null falls back to body weight", stats.effectiveWeightKg(null, 70), 70);
check("effectiveWeightKg: zero falls back to body weight", stats.effectiveWeightKg(0, 70), 70);
check("effectiveWeightKg: unknown without body weight", stats.effectiveWeightKg(null, undefined), 0);
check("effectiveWeightKg: non-positive body weight ignored", stats.effectiveWeightKg(null, 0), 0);

(function testBodyweight() {
  var r = stats.parseRoutinesResponse(fixture("api-routines.json"));
  var m = stats.parseTemplatesResponse(fixture("api-templates.json"));
  var entries = stats.parseHistoryResponse(JSON.stringify({ exercise_history: [
    { weight_kg: null, reps: 12, set_type: "normal" },
    { weight_kg: null, reps: 10, set_type: "normal" },
    { weight_kg: null, reps: null, set_type: "normal" }
  ]}), "tpl-bench");
  var out = stats.computeStats({ routine: r, muscleByTemplate: m, historyEntries: entries, bodyWeightKg: 70 });
  checkClose("bodyweight 1RM (70x12 -> 98)", out.oneRepMaxKgPerExercise["Bench Press (Barbell)"], 98);
  check("bodyweight volume (70x22)", out.volumeKgPerExercise["Bench Press (Barbell)"], 1540);
  check("bodyweight volume per muscle", out.volumeKgPerMuscleGroup, { chest: 1540 });
  check("bodyweight bodyWeightKgUsed", out.bodyWeightKgUsed, 70);

  var outNoBw = stats.computeStats({ routine: r, muscleByTemplate: m, historyEntries: entries });
  check("bodyweight omitted without body weight (1RM)", outNoBw.oneRepMaxKgPerExercise, {});
  check("bodyweight omitted without body weight (volume)", outNoBw.volumeKgPerExercise, {});
  check("bodyweight bodyWeightKgUsed null", outNoBw.bodyWeightKgUsed, null);
})();

// --- epley unit checks ---
check("epley reps=1 returns weight", stats.epley1RM(110, 1), 110);
checkClose("epley 100x5", stats.epley1RM(100, 5), 116.667);

// --- qualifiesFor1RM ---
check("qualifies: warmup excluded", stats.qualifiesFor1RM(100, 5, "warmup"), false);
check("qualifies: zero weight excluded", stats.qualifiesFor1RM(0, 5, "normal"), false);
check("qualifies: null weight excluded", stats.qualifiesFor1RM(null, 5, "normal"), false);
check("qualifies: 40 reps excluded", stats.qualifiesFor1RM(50, 40, "normal"), false);
check("qualifies: normal ok", stats.qualifiesFor1RM(100, 5, "normal"), true);
check("qualifies: failure ok", stats.qualifiesFor1RM(42.5, 6, "failure"), true);
check("qualifies: dropset ok", stats.qualifiesFor1RM(30, 12, "dropset"), true);

// --- Routine-level aggregates ---
check("pipeline routineWorkingSets (5+3+2+2)", push.routineWorkingSets, 12);
check("pipeline routineVolumeKg (sum of per-exercise volumes)",
  push.routineVolumeKg, 2552.5);
check("pipeline routineDurationMinutes null without workout timestamps",
  push.routineDurationMinutes, null);

// --- routineDurationMinutes: most recent workout of this routine ---
(function testDuration() {
  function histWithWorkouts(entries) {
    return stats.computeStats({
      routine: { routineName: "Push Day", exercises: [] },
      muscleByTemplate: {},
      historyEntries: entries
    }).routineDurationMinutes;
  }
  var base = { weight_kg: 100, reps: 5, set_type: "normal" };
  function entry(title, start, end) {
    return Object.assign({}, base, {
      workoutTitle: title, workoutStartTime: start, workoutEndTime: end
    });
  }
  // Picks the latest workout by start time: 45.5 minutes.
  check("duration: latest workout wins", histWithWorkouts([
    entry("Push Day", "2026-09-28T18:00:00+00:00", "2026-09-28T19:00:00+00:00"),
    entry("Push Day", "2026-09-30T18:00:00+00:00", "2026-09-30T18:45:30+00:00")
  ]), 45.5);
  // A later workout under a different title is ignored.
  check("duration: other routine titles ignored", histWithWorkouts([
    entry("Push Day", "2026-09-30T18:00:00+00:00", "2026-09-30T18:45:00+00:00"),
    entry("Leg Day", "2026-10-01T18:00:00+00:00", "2026-10-01T19:30:00+00:00")
  ]), 45);
  // Entries missing timestamps are skipped.
  check("duration: missing timestamps skipped", histWithWorkouts([
    entry("Push Day", null, "2026-09-30T18:45:00+00:00"),
    entry("Push Day", "2026-09-30T18:00:00+00:00", null),
    entry("Push Day", "2026-09-30T17:00:00+00:00", "2026-09-30T17:30:00+00:00")
  ]), 30);
  // No usable workout -> null.
  check("duration: null when no workouts", histWithWorkouts([
    entry("Other", "2026-09-30T18:00:00+00:00", "2026-09-30T18:45:00+00:00")
  ]), null);
  check("duration: null for empty history", histWithWorkouts([]), null);
  // End before start (bad data) -> null, not a negative number.
  check("duration: null when end precedes start", histWithWorkouts([
    entry("Push Day", "2026-09-30T18:45:00+00:00", "2026-09-30T18:00:00+00:00")
  ]), null);
})();

// --- Unicode through the full base64 pipeline ---
(function testUnicode() {
  var routinesJson = JSON.stringify({
    routines: [{
      title: "Leg Day éè",
      exercises: [{
        exercise_template_id: "tpl-squat",
        title: "Back Squat (Barbell)",
        sets: [{ type: "normal" }, { type: "normal" }, { type: "normal" }]
      }]
    }]
  });
  var templatesJson = JSON.stringify({
    exercise_templates: [{ id: "tpl-squat", primary_muscle_group: "quadriceps" }]
  });
  var historyJson = JSON.stringify({
    exercise_history: [{ weight_kg: 150, reps: 3, set_type: "normal" }]
  });
  var r = stats.parseRoutinesResponse(routinesJson);
  var m = stats.parseTemplatesResponse(templatesJson);
  var h = stats.parseHistoryResponse(historyJson, "tpl-squat");
  var out = stats.computeStats({ routine: r, muscleByTemplate: m, historyEntries: h });
  check("unicode routineName", out.routineName, "Leg Day éè");
  check("unicode working sets", out.workingSetsPerMuscleGroup, { quadriceps: 3 });
  checkClose("unicode 1RM", out.oneRepMaxKgPerExercise["Back Squat (Barbell)"], 165.0);
})();

if (failures > 0) {
  console.log("\n" + failures + " test(s) failed");
  process.exit(1);
}
console.log("\nAll tests passed");
