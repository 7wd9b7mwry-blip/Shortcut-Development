// Node simulation of shortcut/hevy-stats.cherri (native actions, no JS).
//
// Faithful mirror of the Cherri control flow: numeric errFlag (0/1),
// explicit == "" / != "" emptiness checks (bare truthiness checks are NOT
// used in the shortcut — device testing Sep 30, 2026 showed they
// misbehave at runtime), comma-padded `contains` for set types, text
// round-trip for setValue numbers, and hand-built JSON with escaping.
//
// NOTE: the sim uses direct property access (`d["key"]`) for the Cherri
// `getValue(@d, "key")` calls — same semantics. The `@d['key']` subscript
// spelling must NOT be used in the .cherri source: Cherri 2.3.0 silently
// compiles it to a plain variable copy (verified Sep 30, 2026).
//
// Run: node test/native-sim.js
"use strict";

var fs = require("fs");
var path = require("path");
var assert = require("assert");

var FIX = path.join(__dirname, "fixtures");
function load(name) {
  return JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8"));
}

// Device-faithful: Shortcuts' Number action FAILS on empty or non-numeric
// text instead of returning 0. The template therefore only calls number()
// on text already checked non-empty; an unguarded call surfaces here as a
// loud test failure — exactly like the Sep 30 device failure on null
// weight_kg in bodyweight history.
function toNumber(t) {
  var s = String(t).trim();
  if (s === "") throw new Error("Number: could not convert empty text");
  var n = Number(s);
  if (isNaN(n)) throw new Error("Number: could not convert text: " + s);
  return n;
}
function txt(v) {
  return v == null ? "" : String(v);
}
function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

var OK_TYPES = ",normal,failure,dropset,";

// Mirrors the Cherri template exactly: errFlag numeric, explicit "" checks.
function runNative(apiKey, api) {
  var errFlag = 0;
  var errMsg = "";
  var errDetail = "";
  var errStage = "";

  if (apiKey === "") {
    errFlag = 1;
    errStage = "read-input";
    errMsg = "Missing API key";
    errDetail = "Shortcut Input was empty. Pass your Hevy API key as the shortcut input.";
  }

  var routinesJson = "";
  if (errFlag === 0) {
    routinesJson = api.routines; // raw text from downloadURL
    if (routinesJson === "") {
      errFlag = 1;
      errStage = "fetch-routines";
      errMsg = "Routines request returned no data";
      errDetail = "GET /v1/routines came back empty. Check your network connection.";
    }
  }

  var routinesList = [];
  var routineName = "";
  var routine = null;
  if (errFlag === 0) {
    var routinesDict = JSON.parse(routinesJson); // getDictionary
    routinesList = routinesDict["routines"] || [];
    if (!Array.isArray(routinesList)) routinesList = [];
    if (routinesList.length === 0) {
      errFlag = 1;
      errStage = "parse-routines";
      errMsg = "No usable routines in response";
      errDetail = "The /v1/routines response had no routines list. Check that the API key is correct and Hevy Pro is active.";
      const apiMsgTxt = txt(routinesDict["message"]);
      if (apiMsgTxt !== "") {
        errDetail = "The Hevy API itself reported an error: " + apiMsgTxt;
      }
    }
  }
  if (errFlag === 0) {
    routine = routinesList[0]; // getFirstItem
    routineName = txt(routine["title"]);
    if (routineName === "") {
      errFlag = 1;
      errStage = "parse-routines";
      errMsg = "First routine has no title";
      errDetail = "The most recently updated routine has no usable 'title'.";
    }
  }

  // NOTE: templates are NOT fetched in bulk anymore. Each exercise's
  // template comes from the single-template endpoint (no pages to miss).

  var wsDict = {};
  var muscleOrder = [];
  var rmJsonParts = [];
  if (errFlag === 0) {
    var exercises = routine["exercises"] || [];
    if (!Array.isArray(exercises)) exercises = [];
    var seenTids = "|";

    exercises.forEach(function (ex) {
      var tid = txt(ex.exercise_template_id);

      // Single-template endpoint: one call per exercise, so a template
      // past page 1 of the catalogue can never be missed. "other" on miss.
      var muscle = "other";
      if (tid !== "") {
        var tplJson = (api.template && api.template[tid]) || "";
        if (tplJson !== "") {
          var tplDict = JSON.parse(tplJson); // getDictionary; throws like a halt on garbage
          var pmg = txt(tplDict["primary_muscle_group"]);
          if (pmg !== "") muscle = pmg;
        }
      }

      // Working sets: counted for EVERY occurrence, even duplicates.
      var sets = ex.sets || [];
      if (!Array.isArray(sets)) sets = [];
      var wsCount = 0;
      sets.forEach(function (s) {
        if (OK_TYPES.indexOf("," + txt(s.type) + ",") >= 0) wsCount++;
      });
      var curVal = wsDict[muscle]; // getValue -> undefined when missing
      var curNum;
      if (curVal === undefined || curVal === "") {
        curNum = 0;
        muscleOrder.push(muscle);
      } else {
        curNum = toNumber(String(curVal)); // text round-trip
      }
      wsDict[muscle] = curNum + wsCount; // setValue stores text

      // History: fetched once per template id (deduplicated).
      var dup = false;
      if (tid !== "") {
        if (seenTids.indexOf("|" + tid + "|") >= 0) dup = true;
        else seenTids += tid + "|";
      }
      if (dup) return;
      if (tid === "") return;

      var best = 0;
      var historyJson = api.history[tid] || "";
      if (historyJson !== "") {
        var historyDict = JSON.parse(historyJson);
        var entries = historyDict["exercise_history"] || [];
        if (!Array.isArray(entries)) entries = [];
        entries.forEach(function (e) {
          var hType = txt(e.set_type);
          if (OK_TYPES.indexOf("," + hType + ",") < 0) return;
          // Mirrors the template: number() only on non-empty text.
          var wTxt = txt(e.weight_kg);
          var wNum = 0;
          if (wTxt !== "") wNum = toNumber(wTxt);
          var rTxt = txt(e.reps);
          var rNum = 0;
          if (rTxt !== "") rNum = toNumber(rTxt);
          if (!(wNum > 0)) return;
          if (!(rNum >= 1)) return;
          if (!(rNum <= 30)) return;
          var est = rNum === 1 ? wNum * 1 : wNum * (1 + rNum / 30);
          if (est > best) best = est;
        });
      }
      if (best > 0) {
        var bestR = Math.round(best * 10) / 10;
        var title = txt(ex.title);
        if (title === "") title = tid;
        rmJsonParts.push('"' + esc(title) + '": ' + bestR);
      }
    });
  }

  var wsEntries = muscleOrder
    .map(function (m) {
      return '"' + esc(m) + '": ' + wsDict[m];
    })
    .join(", ");

  var resultJson =
    '{"routineName": "' + esc(routineName) + '", "workingSetsPerMuscleGroup": {' +
    wsEntries + '}, "oneRepMaxKgPerExercise": {' + rmJsonParts.join(", ") + "}}";

  var errJson =
    '{"_error": "' + esc(errMsg) + '", "_context": {"stage": "' + errStage +
    '", "detail": "' + esc(errDetail) + '" }}';

  // Terminal: two separate explicit checks, exactly one runs.
  var notifications = [];
  var finalJson;
  if (errFlag === 1) {
    notifications.push("Hevy Stats error: " + errMsg + " (" + errDetail + ")");
    finalJson = errJson;
  }
  if (errFlag === 0) {
    finalJson = resultJson;
  }
  var finalResult = JSON.parse(finalJson); // getDictionary
  if (finalJson === "") {
    notifications.push("Hevy Stats: internal error, empty result (this should never happen).");
  }
  return { result: finalResult, notifications: notifications, errFlag: errFlag };
}

// ---------- fixtures ----------
// Single-template endpoint mock: id -> template object JSON.
// Built from the old bulk fixture; the "Mystery Machine" (tpl-missing)
// deliberately has no entry, mirroring a template past page 1.
function singleTemplates() {
  var bulk = load("api-templates.json");
  var map = {};
  (bulk.exercise_templates || []).forEach(function (t) { map[t.id] = JSON.stringify(t); });
  return map;
}
function happyApi() {
  return {
    routines: JSON.stringify(load("api-routines.json")),
    template: singleTemplates(),
    history: {
      "tpl-bench": JSON.stringify(load("api-history-bench.json")),
      "tpl-ohp": JSON.stringify(load("api-history-ohp.json")),
      "tpl-tri": JSON.stringify(load("api-history-tri.json")),
      "tpl-missing": JSON.stringify(load("api-history-missing.json")),
    },
  };
}

var EXPECTED = {
  routineName: "Push Day",
  workingSetsPerMuscleGroup: { chest: 5, shoulders: 3, triceps: 2, other: 2 },
  oneRepMaxKgPerExercise: {
    "Bench Press (Barbell)": 116.7,
    "Overhead Press (Dumbbell)": 51,
    "Triceps Pushdown (Cable)": 42,
    "Mystery Machine": 93.3,
  },
};

var failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("ok  ", name);
  } catch (e) {
    failures++;
    console.log("FAIL", name);
    console.log("  " + String(e.message).split("\n").join("\n  "));
  }
}

// ---------- tests ----------
check("happy path: no error", function () {
  var r = runNative("KEY", happyApi());
  assert.strictEqual(r.errFlag, 0);
  assert.deepStrictEqual(r.notifications, []);
});
check("happy path: routineName", function () {
  assert.strictEqual(runNative("KEY", happyApi()).result.routineName, EXPECTED.routineName);
});
check("happy path: workingSetsPerMuscleGroup", function () {
  assert.deepStrictEqual(
    runNative("KEY", happyApi()).result.workingSetsPerMuscleGroup,
    EXPECTED.workingSetsPerMuscleGroup
  );
});
check("happy path: oneRepMaxKgPerExercise", function () {
  assert.deepStrictEqual(
    runNative("KEY", happyApi()).result.oneRepMaxKgPerExercise,
    EXPECTED.oneRepMaxKgPerExercise
  );
});
check("happy path: chest working sets include dup exercise", function () {
  // tpl-bench appears twice (4 + 1 working sets) -> chest == 5
  assert.strictEqual(runNative("KEY", happyApi()).result.workingSetsPerMuscleGroup.chest, 5);
});
check("happy path: one 1RM entry for dup template", function () {
  var rms = runNative("KEY", happyApi()).result.oneRepMaxKgPerExercise;
  assert.strictEqual(Object.keys(rms).filter(function (k) { return k.indexOf("Bench") >= 0; }).length, 1);
});
check("error: missing api key -> notification + error dict", function () {
  var r = runNative("", happyApi());
  assert.strictEqual(r.errFlag, 1);
  assert.strictEqual(r.notifications.length, 1);
  assert.ok(r.notifications[0].indexOf("Missing API key") >= 0);
  assert.strictEqual(r.result._error, "Missing API key");
  assert.strictEqual(r.result._context.stage, "read-input");
});
check("error: empty routines payload", function () {
  var api = happyApi(); api.routines = "";
  var r = runNative("KEY", api);
  assert.strictEqual(r.result._error, "Routines request returned no data");
  assert.strictEqual(r.result._context.stage, "fetch-routines");
  assert.ok(r.notifications[0].indexOf("Routines request returned no data") >= 0);
});
check("error: routines not JSON -> throws (system-level, like halt)", function () {
  var api = happyApi(); api.routines = "<html>nope</html>";
  assert.throws(function () { runNative("KEY", api); }, SyntaxError);
});
check("error: zero routines", function () {
  var api = happyApi(); api.routines = JSON.stringify({ routines: [] });
  var r = runNative("KEY", api);
  assert.strictEqual(r.result._error, "No usable routines in response");
  assert.ok(r.result._context.detail.indexOf("no routines list") >= 0);
});
check("error: API-side message is surfaced", function () {
  var api = happyApi();
  api.routines = JSON.stringify({ message: "Invalid API key", routines: [] });
  var r = runNative("KEY", api);
  assert.strictEqual(r.result._error, "No usable routines in response");
  assert.strictEqual(r.result._context.detail, "The Hevy API itself reported an error: Invalid API key");
  assert.ok(r.notifications[0].indexOf("Invalid API key") >= 0);
});
check("error: single template not JSON -> throws (system-level, like halt)", function () {
  var api = happyApi(); api.template["tpl-bench"] = "garbage{";
  assert.throws(function () { runNative("KEY", api); }, SyntaxError);
});
check("escape: routineName round-trips", function () {
  var api = happyApi();
  var rej = load("api-routines.json");
  rej.routines[0].title = 'Leg "Day" \\ Hard';
  api.routines = JSON.stringify(rej);
  var r = runNative("KEY", api);
  assert.strictEqual(r.result.routineName, 'Leg "Day" \\ Hard');
});
check("escape: muscle key round-trips", function () {
  var api = happyApi();
  var t = JSON.parse(api.template["tpl-bench"]);
  t.primary_muscle_group = 'we"ird\\m';
  api.template["tpl-bench"] = JSON.stringify(t);
  var r = runNative("KEY", api);
  assert.strictEqual(r.result.workingSetsPerMuscleGroup['we"ird\\m'], 5);
});
check("escape: title key round-trips", function () {
  var api = happyApi();
  var rej = load("api-routines.json");
  rej.routines[0].exercises[0].title = 'Be"nch\\Press';
  api.routines = JSON.stringify(rej);
  var r = runNative("KEY", api);
  assert.strictEqual(r.result.oneRepMaxKgPerExercise['Be"nch\\Press'], 116.7);
});
check("edge: no template entries -> everything groups under other", function () {
  var api = happyApi(); api.template = {};
  var r = runNative("KEY", api);
  assert.deepStrictEqual(r.result.workingSetsPerMuscleGroup, { other: 12 });
});
check("regression: template past page 1 resolves via single endpoint", function () {
  // Sep 30: Daniel's Pull Up template id was absent from templates page 1,
  // so its sets grouped under "other". The single-template endpoint has no
  // pages to miss: giving the missing template an entry must regroup it.
  var api = happyApi();
  api.template["tpl-missing"] = JSON.stringify({ id: "tpl-missing", title: "Mystery Machine", primary_muscle_group: "lats" });
  var r = runNative("KEY", api);
  assert.strictEqual(r.errFlag, 0);
  assert.strictEqual(r.result.workingSetsPerMuscleGroup.lats, 2);
  assert.ok(!("other" in r.result.workingSetsPerMuscleGroup));
});
check("edge: no history -> no 1RMs", function () {
  var api = happyApi(); api.history = {};
  var r = runNative("KEY", api);
  assert.deepStrictEqual(r.result.oneRepMaxKgPerExercise, {});
  assert.strictEqual(r.result.workingSetsPerMuscleGroup.chest, 5);
});
check("edge: null weight_kg (bodyweight) never reaches number()", function () {
  // Regression: Sep 30 device failure — Shortcuts' Number action fails on
  // empty text; bodyweight history has weight_kg: null. Must not throw and
  // must simply omit the exercise from 1RMs.
  var api = happyApi();
  api.history["tpl-bench"] = JSON.stringify({ exercise_history: [
    { weight_kg: null, reps: 12, set_type: "normal" },
    { weight_kg: null, reps: 10, set_type: "normal" },
    { weight_kg: null, reps: null, set_type: "normal" }
  ]});
  var r = runNative("KEY", api);
  assert.strictEqual(r.notifications.length, 0);
  assert.ok(!("Bench Press (Barbell)" in r.result.oneRepMaxKgPerExercise));
  assert.strictEqual(r.result.workingSetsPerMuscleGroup.chest, 5);
});
check("edge: empty exercises", function () {
  var api = happyApi();
  var rej = load("api-routines.json");
  rej.routines[0].exercises = [];
  api.routines = JSON.stringify(rej);
  var r = runNative("KEY", api);
  assert.deepStrictEqual(r.result.workingSetsPerMuscleGroup, {});
  assert.deepStrictEqual(r.result.oneRepMaxKgPerExercise, {});
});

if (failures > 0) {
  console.log("\n" + failures + " FAILURE(S)");
  process.exit(1);
} else {
  console.log("\nAll native-sim tests passed.");
}
