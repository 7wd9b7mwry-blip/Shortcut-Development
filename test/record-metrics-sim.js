// Simulation of the buildRecordMetrics() section (shortcut/lib/50-records.cherri).
//
// Mirrors the merged-shortcut transform: stats dictionary -> list of
// RecordMetric dictionaries (docs/RECORD_METRIC.md). Feeds the REAL
// native-sim pipeline (test/native-sim.js) so the records are tested
// against the same fixtures, plus Daniel's local real-data fixtures.
//
// The Cherri section builds each record as its own JSON object (so
// Set Value is a REAL number and Increment/Decrement/Reset are REAL
// booleans), parses it with getDictionary, and appends it to a real List
// with Add to Variable. This sim:
//   1. mirrors the transform logic (which records, which values), and
//   2. extracts the ACTUAL @recJson templates from 50-records.cherri,
//      renders them with test values (including quote/backslash edge
//      cases), and asserts each renders to valid JSON with the right
//      types — catching template bugs in the real source.
//
// Run: node test/record-metrics-sim.js
"use strict";

var fs = require("fs");
var path = require("path");
var assert = require("assert");

// Load the native pipeline + fixture helpers without executing its tests.
var simSrc = fs.readFileSync(path.join(__dirname, "native-sim.js"), "utf8");
simSrc = simSrc.slice(0, simSrc.indexOf("// ---------- tests ----------"));
var factory = new Function(
  "require", "__dirname", "fs", "path", "assert",
  simSrc + "\nreturn { runNative: runNative, happyApi: happyApi, apiWithWorkouts: apiWithWorkouts };"
);
var sim = factory(require, __dirname, fs, path, assert);

// Wrapper transform, mirroring 50-records.cherri:
// - handled _error dicts pass through unchanged (no records fabricated)
// - otherwise one RecordMetric dict per metric, key order matching the
//   Record Metrics form (Form Name, Metric Name, Set Value, Increment,
//   Decrement, Reset, Increment Amount)
function toRecordMetrics(stats) {
  if (stats && typeof stats._error === "string") {
    return stats;
  }
  var out = [];
  function rec(form, name, value) {
    out.push({
      "Form Name": form,
      "Metric Name": name,
      "Set Value": value,
      "Increment": false,
      "Decrement": false,
      "Reset": false,
      "Increment Amount": ""
    });
  }
  var ws = stats.workingSetsPerMuscleGroup || {};
  var volM = stats.volumeKgPerMuscleGroup || {};
  var volE = stats.volumeKgPerExercise || {};
  var rm = stats.oneRepMaxKgPerExercise || {};
  Object.keys(ws).forEach(function (m) {
    rec("Hevy - Muscle Group", m + " working sets", ws[m]);
    if (volM[m] !== undefined) rec("Hevy - Muscle Group", m + " volume", volM[m]);
  });
  Object.keys(volE).forEach(function (t) {
    rec("Hevy - Exercise", t + " volume", volE[t]);
    if (rm[t] !== undefined) rec("Hevy - Exercise", t + " 1RM", rm[t]);
  });
  rec("Hevy - Routine", stats.routineName + " working sets", stats.routineWorkingSets);
  rec("Hevy - Routine", stats.routineName + " volume", stats.routineVolumeKg);
  if (stats.routineDurationMinutes !== null && stats.routineDurationMinutes !== undefined) {
    rec("Hevy - Routine", stats.routineName + " duration", stats.routineDurationMinutes);
  }
  return out;
}

// --- Template fidelity: render the REAL @recJson templates ---------------
// Extract each `@recJson = "..."` template from 50-records.cherri, convert
// Cherri string syntax to plain text, substitute test values, and verify
// the result is valid JSON with correctly typed fields.
function cherriEscape(s) {
  // Mirrors the Cherri: replaceText("\\", "\\\\", x) then
  // replaceText("\"", "\\\"", x).
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderTemplate(cherriLine, vars) {
  // cherriLine is the full `@recJson = "..."` source line.
  var m = cherriLine.match(/@recJson = "(.*)"\s*$/);
  assert.ok(m, "could not parse template line: " + cherriLine.slice(0, 80));
  var body = m[1];
  var out = "";
  for (var i = 0; i < body.length; i++) {
    var c = body[i];
    if (c === "\\" && i + 1 < body.length) {
      var n = body[i + 1];
      if (n === '"') { out += '"'; i++; continue; }
      if (n === "\\") { out += "\\"; i++; continue; }
      out += c;
      continue;
    }
    if (c === "{") {
      var j = body.indexOf("}", i);
      assert.ok(j > i, "unbalanced { in template");
      var ref = body.slice(i + 1, j); // e.g. @ob, @safeM, @wsTxt
      if (ref === "@ob") out += "{";
      else if (ref === "@cb") out += "}";
      else {
        assert.ok(Object.prototype.hasOwnProperty.call(vars, ref),
          "no test value for " + ref);
        out += vars[ref];
      }
      i = j;
      continue;
    }
    out += c;
  }
  return out;
}

function getRecTemplates() {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "shortcut", "lib", "50-records.cherri"), "utf8");
  var lines = src.split("\n").filter(function (l) {
    return l.indexOf("@recJson = ") !== -1;
  });
  assert.ok(lines.length === 7,
    "expected 7 @recJson templates, found " + lines.length);
  return lines;
}

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

function find(records, form, name) {
  return records.filter(function (r) {
    return r["Form Name"] === form && r["Metric Name"] === name;
  })[0];
}

check("happy path: record count", function () {
  // 4 muscles x (working sets + volume) + 4 exercises x (volume + 1RM)
  // + 2 routine records (no duration: fixtures carry no workout fields)
  var records = toRecordMetrics(sim.runNative("KEY", sim.happyApi()).result);
  assert.strictEqual(records.length, 18);
});

check("happy path: exact RecordMetric shape", function () {
  var records = toRecordMetrics(sim.runNative("KEY", sim.happyApi()).result);
  assert.deepStrictEqual(records[0], {
    "Form Name": "Hevy - Muscle Group",
    "Metric Name": "chest working sets",
    "Set Value": 5,
    "Increment": false,
    "Decrement": false,
    "Reset": false,
    "Increment Amount": ""
  });
});

check("happy path: muscle group records", function () {
  var records = toRecordMetrics(sim.runNative("KEY", sim.happyApi()).result);
  assert.strictEqual(find(records, "Hevy - Muscle Group", "chest working sets")["Set Value"], 5);
  assert.strictEqual(find(records, "Hevy - Muscle Group", "chest volume")["Set Value"], 917.5);
  assert.strictEqual(find(records, "Hevy - Muscle Group", "shoulders volume")["Set Value"], 575);
});

check("happy path: exercise records", function () {
  var records = toRecordMetrics(sim.runNative("KEY", sim.happyApi()).result);
  assert.strictEqual(find(records, "Hevy - Exercise", "Bench Press (Barbell) volume")["Set Value"], 917.5);
  assert.strictEqual(find(records, "Hevy - Exercise", "Bench Press (Barbell) 1RM")["Set Value"], 116.7);
});

check("happy path: routine records (no duration when unknown)", function () {
  var records = toRecordMetrics(sim.runNative("KEY", sim.happyApi()).result);
  assert.strictEqual(find(records, "Hevy - Routine", "Push Day working sets")["Set Value"], 12);
  assert.strictEqual(find(records, "Hevy - Routine", "Push Day volume")["Set Value"], 2552.5);
  assert.strictEqual(find(records, "Hevy - Routine", "Push Day duration"), undefined);
});

check("duration record appears when Hevy Stats reports one", function () {
  var records = toRecordMetrics(sim.runNative("KEY", sim.apiWithWorkouts()).result);
  assert.strictEqual(records.length, 19);
  assert.strictEqual(find(records, "Hevy - Routine", "Push Day duration")["Set Value"], 47.3);
});

check("types: numbers stay numbers, flags stay booleans", function () {
  var records = toRecordMetrics(sim.runNative("KEY", sim.happyApi()).result);
  records.forEach(function (r) {
    assert.strictEqual(typeof r["Set Value"], "number", r["Metric Name"]);
    assert.strictEqual(r["Increment"], false);
    assert.strictEqual(r["Decrement"], false);
    assert.strictEqual(r["Reset"], false);
    assert.strictEqual(r["Increment Amount"], "");
  });
});

check("error: handled _error dict passes through, no records built", function () {
  var bad = sim.runNative("", sim.happyApi());
  assert.strictEqual(bad.errFlag, 1);
  var out = toRecordMetrics(bad.result);
  assert.strictEqual(out._error, "Missing API key");
  assert.strictEqual(out._context.stage, "read-input");
  assert.ok(!Array.isArray(out));
});

check("real data: Sample routine records", function () {
  // Daniel's local fixtures via the same loader as real-fixtures-check.js.
  var DIR = path.join(__dirname, "..", "local-fixtures");
  function load(name) { return fs.readFileSync(path.join(DIR, name), "utf8"); }
  var bulk = JSON.parse(load("templates.json")).exercise_templates;
  var single = {};
  bulk.forEach(function (t) { single[t.id] = JSON.stringify(t); });
  single["1B2B1E7C"] = JSON.stringify({
    id: "1B2B1E7C", title: "Pull Up", type: "weight_reps",
    primary_muscle_group: "lats"
  });
  var api = {
    routines: load("routines.json"),
    template: single,
    bodyMeasurements: JSON.stringify({ body_measurements: [] }),
    history: {
      "79D0BB3A": load("hist_79D0BB3A.json"),
      "1B2B1E7C": load("hist_1B2B1E7C.json")
    }
  };
  var records = toRecordMetrics(sim.runNative("KEY", api).result);
  assert.strictEqual(find(records, "Hevy - Routine", "Sample working sets")["Set Value"], 6);
  assert.strictEqual(find(records, "Hevy - Routine", "Sample volume")["Set Value"], 1646.5);
  assert.strictEqual(find(records, "Hevy - Routine", "Sample duration")["Set Value"], 0.3);
  assert.strictEqual(find(records, "Hevy - Muscle Group", "chest working sets")["Set Value"], 3);
});

// --- The 7 real templates render to valid, correctly-typed JSON -----------
var TEMPLATE_CASES = [
  // [templateIndex, vars, expectedMetricName, expectedSetValue]
  [0, { "@safeM": cherriEscape("chest"), "@wsTxt": "5" },
   "chest working sets", 5],
  [1, { "@safeM": cherriEscape("chest"), "@volTxt": "917.5" },
   "chest volume", 917.5],
  [2, { "@safeT": cherriEscape("Bench Press (Barbell)"), "@volTxt": "917.5" },
   "Bench Press (Barbell) volume", 917.5],
  [3, { "@safeT": cherriEscape("Bench Press (Barbell)"), "@rmTxt": "116.7" },
   "Bench Press (Barbell) 1RM", 116.7],
  [4, { "@safeR": cherriEscape("Push Day"), "@rWsTxt": "12" },
   "Push Day working sets", 12],
  [5, { "@safeR": cherriEscape("Push Day"), "@rVolTxt": "2552.5" },
   "Push Day volume", 2552.5],
  [6, { "@safeR": cherriEscape("Push Day"), "@rDurTxt": "47.3" },
   "Push Day duration", 47.3]
];

TEMPLATE_CASES.forEach(function (tc, k) {
  check("template " + tc[0] + " renders valid typed JSON (" + tc[2] + ")", function () {
    var lines = getRecTemplates();
    var json = renderTemplate(lines[tc[0]], tc[1]);
    var rec = JSON.parse(json); // throws on invalid JSON
    assert.strictEqual(rec["Metric Name"], tc[2]);
    assert.strictEqual(rec["Set Value"], tc[3]);
    assert.strictEqual(typeof rec["Set Value"], "number");
    assert.strictEqual(rec["Increment"], false);
    assert.strictEqual(rec["Decrement"], false);
    assert.strictEqual(rec["Reset"], false);
    assert.strictEqual(rec["Increment Amount"], "");
    assert.ok(rec["Form Name"].indexOf("Hevy - ") === 0);
  });
});

check("templates survive hostile names (quotes, backslashes)", function () {
  var lines = getRecTemplates();
  var hostile = 'Weird "Quoted" \\ Backslash';
  var json = renderTemplate(lines[2], {
    "@safeT": cherriEscape(hostile), "@volTxt": "10"
  });
  var rec = JSON.parse(json);
  assert.strictEqual(rec["Metric Name"], hostile + " volume");
  assert.strictEqual(rec["Set Value"], 10);
});

if (failures > 0) {
  console.log("\n" + failures + " FAILURE(S)");
  process.exit(1);
} else {
  console.log("\nAll record-metrics-sim tests passed.");
}
