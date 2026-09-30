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
  for (var i = 0; i < histFiles.length; i++) {
    var tid = r.exercises[i].templateId;
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

// --- Two-pass device simulation ---
// Simulates the shortcut: base64 JSONs -> placeholder substitution -> eval with
// stubbed document/atob/TextDecoder -> decode written output.
(function testDeviceTwoPass() {
  var src = fs.readFileSync(path.join(__dirname, "..", "src", "hevy-stats.js"), "utf8");

  function runPass(mode, routinesB64, templatesB64, historyB64) {
    var page = src
      .replace(/__MODE__/g, mode)
      .replace(/__ROUTINES_B64__/g, routinesB64)
      .replace(/__TEMPLATES_B64__/g, templatesB64 || "")
      .replace(/__HISTORY_B64__/g, historyB64 || "");
    var written = null;
    var document = { write: function (s) { written = s; } };
    var module = undefined;
    // atob / TextDecoder stubs for Node.
    var atob = function (b64) { return Buffer.from(b64, "base64").toString("binary"); };
    var TextDecoder = function () {};
    TextDecoder.prototype.decode = function (bytes) {
      return Buffer.from(bytes).toString("utf8");
    };
    eval(page);
    return JSON.parse(decodeURIComponent(written));
  }

  function b64(s) { return Buffer.from(s, "utf8").toString("base64"); }

  var routinesB64 = b64(fixture("api-routines.json"));

  // Pass 1: ids
  var idsResult = runPass("ids", routinesB64);
  check("device pass1: no error", idsResult._error, undefined);
  check("device pass1: ids", idsResult.ids,
    "tpl-bench,tpl-ohp,tpl-tri,tpl-bench,tpl-missing");

  // Pass 2: stats
  var templatesB64 = b64(fixture("api-templates.json"));
  var histB64 = [
    "api-history-bench.json", "api-history-ohp.json", "api-history-tri.json",
    "api-history-bench.json", "api-history-missing.json"
  ].map(function (f) { return b64(fixture(f)); }).join("|");
  var statsResult = runPass("stats", routinesB64, templatesB64, histB64);
  check("device pass2: no error", statsResult._error, undefined);
  check("device pass2: routineName", statsResult.routineName, "Push Day");
  check("device pass2: working sets", statsResult.workingSetsPerMuscleGroup, {
    chest: 5, shoulders: 3, triceps: 2, other: 2
  });
  checkClose("device pass2: 1RM bench",
    statsResult.oneRepMaxKgPerExercise["Bench Press (Barbell)"], 116.7);

  // Pass 1 error: malformed routines JSON
  var errResult = runPass("ids", b64("not json{{{"));
  check("device pass1 error: has _error", typeof errResult._error, "string");
  check("device pass1 error: mentions JSON",
    errResult._error.indexOf("not valid JSON") >= 0, true);
  check("device pass1 error: has context", typeof errResult._context, "object");
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
