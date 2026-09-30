// Native-simulation test for shortcut/hevy-stats.cherri.
//
// The shortcut cannot run on this machine, so this file re-implements the
// Cherri template's logic step-for-step in plain JS and runs it against the
// API fixtures. Anything the template computes (control flow, string
// building, JSON escaping, Epley math, rounding) is validated here; the
// Cherri COMPILATION itself is validated separately by inspecting the
// compiled plist (action sequence, conditionals, terminal output).
//
// Mirroring notes (Shortcuts semantics):
//  - "{@d['k']}" interpolation of null/missing -> "".
//  - number("") -> NaN here; every numeric comparison with it is false,
//    which matches the shortcut excluding the set.
//  - `if @okTypes contains ",{t},"` -> okTypes.includes("," + t + ",").
//  - round(x, "Tenths") -> Math.round(x*10)/10.

var fs = require("fs");
var path = require("path");

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

// Shortcuts text interpolation: null/undefined -> "", else String(v).
function txt(v) {
  return v === null || v === undefined ? "" : String(v);
}

// Shortcuts Number action on text.
function toNumber(s) {
  if (s === null || s === undefined || String(s).trim() === "") return NaN;
  var n = Number(s);
  return isNaN(n) ? NaN : n;
}

function jsonEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

var OK_TYPES = ",normal,failure,dropset,";

// Simulates the template. historyByTid maps template id -> history JSON text.
// Returns { finalJson } on success or { errJson } on error, mirroring the
// shortcut's terminal branch.
function runShortcut(apiKey, routinesJson, templatesJson, historyByTid) {
  var errMsg = "", errDetail = "", errStage = "";

  function fail(stage, msg, detail) {
    if (!errMsg) { errStage = stage; errMsg = msg; errDetail = detail; }
  }

  if (!apiKey) {
    fail("read-input", "Missing API key",
      "Shortcut Input was empty. Pass your Hevy API key as the shortcut input.");
  }

  var routinesDict = null, templatesDict = null;
  var routineName = "", routine = null, templates = [];
  if (!errMsg) {
    if (!routinesJson) {
      fail("fetch-routines", "Routines request returned no data",
        "GET /v1/routines came back empty. Check your network connection.");
    }
  }
  if (!errMsg) {
    try { routinesDict = JSON.parse(routinesJson); }
    catch (e) { routinesDict = null; }
    if (!routinesDict || typeof routinesDict !== "object" || Array.isArray(routinesDict)) {
      fail("parse-routines", "Routines response is not valid JSON",
        "The /v1/routines response could not be parsed as JSON.");
    }
  }
  if (!errMsg) {
    var routinesList = (routinesDict && routinesDict.routines) || [];
    if (!Array.isArray(routinesList)) routinesList = [];
    if (routinesList.length === 0) {
      fail("parse-routines", "No routines found",
        "The /v1/routines response contained zero routines. Check that the API key is correct and Hevy Pro is active.");
    } else {
      routine = routinesList[0];
      routineName = txt(routine.title);
      if (!routineName) {
        fail("parse-routines", "First routine has no title",
          "The most recently updated routine has no usable 'title'.");
      }
    }
  }
  if (!errMsg) {
    if (!templatesJson) {
      fail("fetch-templates", "Exercise templates request returned no data",
        "GET /v1/exercise_templates came back empty. Check your network connection.");
    }
  }
  if (!errMsg) {
    try { templatesDict = JSON.parse(templatesJson); }
    catch (e) { templatesDict = null; }
    if (!templatesDict || typeof templatesDict !== "object" || Array.isArray(templatesDict)) {
      fail("parse-templates", "Templates response is not valid JSON",
        "The /v1/exercise_templates response could not be parsed as JSON.");
    } else {
      templates = templatesDict.exercise_templates || [];
      if (!Array.isArray(templates)) templates = [];
    }
  }

  var resultJson = "";
  if (!errMsg) {
    var exercises = (routine && routine.exercises) || [];
    if (!Array.isArray(exercises)) exercises = [];
    var wsDict = {}, muscleOrder = [], seenTids = "|", rmEntries = [];

    exercises.forEach(function (ex) {
      var tid = txt(ex.exercise_template_id);

      var muscle = "other";
      templates.forEach(function (t) {
        if (txt(t.id) === tid) {
          var pmg = txt(t.primary_muscle_group);
          if (pmg) muscle = pmg;
        }
      });

      // Working sets: counted for EVERY occurrence, even duplicates.
      var sets = ex.sets || [];
      if (!Array.isArray(sets)) sets = [];
      var wsCount = 0;
      sets.forEach(function (s) {
        if (OK_TYPES.indexOf("," + txt(s.type) + ",") >= 0) wsCount++;
      });
      if (!(muscle in wsDict)) { wsDict[muscle] = 0; muscleOrder.push(muscle); }
      wsDict[muscle] += wsCount;

      // History: fetched once per template id (deduplicated).
      var dup = false;
      if (tid) {
        if (seenTids.indexOf("|" + tid + "|") >= 0) dup = true;
        else seenTids += tid + "|";
      }
      if (dup) return;

      if (tid) {
        var best = 0;
        var hJson = historyByTid[tid];
        if (hJson) {
          var hDict = null;
          try { hDict = JSON.parse(hJson); } catch (e) { hDict = null; }
          if (hDict && typeof hDict === "object") {
            var entries = hDict.exercise_history || [];
            if (!Array.isArray(entries)) entries = [];
            entries.forEach(function (e) {
              var hType = txt(e.set_type);
              if (OK_TYPES.indexOf("," + hType + ",") < 0) return;
              var wNum = toNumber(txt(e.weight_kg));
              var rNum = toNumber(txt(e.reps));
              if (!(wNum > 0)) return;
              if (!(rNum >= 1)) return;
              if (!(rNum <= 30)) return;
              var est = (rNum === 1) ? wNum * 1 : wNum * (1 + rNum / 30);
              if (est > best) best = est;
            });
          }
        }
        if (best > 0) {
          var bestR = Math.round(best * 10) / 10;
          var title = txt(ex.title) || tid;
          rmEntries.push('"' + jsonEscape(title) + '": ' + bestR);
        }
      }
    });

    var wsEntries = muscleOrder.map(function (m) {
      return '"' + jsonEscape(m) + '": ' + wsDict[m];
    });
    resultJson = '{"routineName": "' + jsonEscape(routineName) +
      '", "workingSetsPerMuscleGroup": {' + wsEntries.join(", ") +
      '}, "oneRepMaxKgPerExercise": {' + rmEntries.join(", ") + '}}';
  }

  if (errMsg) {
    var errJson = '{"_error": "' + jsonEscape(errMsg) + '", "_context": ' +
      '{"stage": "' + jsonEscape(errStage) + '", "detail": "' + jsonEscape(errDetail) + '"}}';
    return { errJson: errJson };
  }
  return { finalJson: resultJson };
}

// --- Happy path against fixtures ---
var histories = {
  "tpl-bench": fixture("api-history-bench.json"),
  "tpl-ohp": fixture("api-history-ohp.json"),
  "tpl-tri": fixture("api-history-tri.json"),
  "tpl-missing": fixture("api-history-missing.json")
};
var r = runShortcut("KEY", fixture("api-routines.json"), fixture("api-templates.json"), histories);
check("happy path: no error", !!r.finalJson, true);
var parsed = JSON.parse(r.finalJson); // must be valid JSON
check("happy path: routineName", parsed.routineName, "Push Day");
check("happy path: workingSetsPerMuscleGroup", parsed.workingSetsPerMuscleGroup, {
  chest: 5, shoulders: 3, triceps: 2, other: 2
});
check("happy path: oneRepMaxKgPerExercise", parsed.oneRepMaxKgPerExercise, {
  "Bench Press (Barbell)": 116.7,
  "Overhead Press (Dumbbell)": 51,
  "Triceps Pushdown (Cable)": 42,
  "Mystery Machine": 93.3
});

// --- Duplicate template id is fetched once, counted per occurrence ---
check("happy path: chest working sets include dup exercise", parsed.workingSetsPerMuscleGroup.chest, 5);
check("happy path: one 1RM entry for dup template", Object.keys(parsed.oneRepMaxKgPerExercise).length, 4);

// --- Error paths produce structured error JSON ---
function errCase(name, args, expStage, expMsgPart) {
  var out = runShortcut.apply(null, args);
  if (!out.errJson) { failures++; console.log("FAIL " + name + " (expected error, got success)"); return; }
  var p = JSON.parse(out.errJson); // must be valid JSON
  var okMsg = p._error.indexOf(expMsgPart) >= 0;
  var okStage = p._context && p._context.stage === expStage;
  if (okMsg && okStage) console.log("ok   " + name);
  else {
    failures++;
    console.log("FAIL " + name + " -> " + JSON.stringify(p));
  }
}
var R = fixture("api-routines.json"), T = fixture("api-templates.json");
errCase("error: missing api key", ["", R, T, histories], "read-input", "Missing API key");
errCase("error: empty routines payload", ["K", "", T, histories], "fetch-routines", "no data");
errCase("error: routines not JSON", ["K", "not json", T, histories], "parse-routines", "not valid JSON");
errCase("error: zero routines", ["K", '{"routines":[]}', T, histories], "parse-routines", "No routines found");
errCase("error: templates not JSON", ["K", R, "nope", histories], "parse-templates", "not valid JSON");

// --- Edge: titles/muscles needing JSON escaping ---
var evilRoutines = JSON.stringify({ routines: [{ title: 'Weird "Day" \\', exercises: [
  { exercise_template_id: "t1", title: 'Lift "Heavy" \\', sets: [{ type: "normal" }] }
]}]});
var evilTemplates = JSON.stringify({ exercise_templates: [{ id: "t1", primary_muscle_group: 'che"st' }] });
var evilHist = { t1: JSON.stringify({ exercise_history: [{ weight_kg: 100, reps: 5, set_type: "normal" }] }) };
var er = runShortcut("K", evilRoutines, evilTemplates, evilHist);
var ep = JSON.parse(er.finalJson); // must parse
check("escape: routineName round-trips", ep.routineName, 'Weird "Day" \\');
check("escape: muscle key round-trips", ep.workingSetsPerMuscleGroup, { 'che"st': 1 });
check("escape: title key round-trips", ep.oneRepMaxKgPerExercise, { 'Lift "Heavy" \\': 116.7 });

// --- Edge: empty templates -> "other"; missing history -> omitted ---
var r2 = runShortcut("K", R, '{"exercise_templates":[]}', {});
var p2 = JSON.parse(r2.finalJson);
check("edge: empty templates groups under other", p2.workingSetsPerMuscleGroup, { other: 12 });
check("edge: no history -> no 1RMs", p2.oneRepMaxKgPerExercise, {});

// --- Edge: no exercises at all ---
var r3 = runShortcut("K", '{"routines":[{"title":"Rest","exercises":[]}]}', T, {});
var p3 = JSON.parse(r3.finalJson);
check("edge: empty exercises", p3, {
  routineName: "Rest", workingSetsPerMuscleGroup: {}, oneRepMaxKgPerExercise: {}
});

if (failures > 0) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
console.log("\nAll native-sim tests passed.");
