// Real-data regression check — LOCAL ONLY. Feeds Daniel's actual Sep 30, 2026
// Hevy API responses (local-fixtures/, never committed) through the exact
// same native pipeline as test/native-sim.js and asserts the known-good
// result. Run: node test/real-fixtures-check.js
var fs = require("fs");
var path = require("path");
var assert = require("assert");

var DIR = path.join(__dirname, "..", "local-fixtures");
function load(name) {
  return fs.readFileSync(path.join(DIR, name), "utf8");
}

// Load the pipeline without executing the check suite: strip the trailing
// test-runner block and export runNative via a sandboxed module.
var src = fs.readFileSync(path.join(__dirname, "native-sim.js"), "utf8");
src = src.slice(0, src.indexOf("// ---------- fixtures ----------"));
var factory = new Function("require", "__dirname", "fs", "path", "assert", src + "\nreturn runNative;");
var runNative = factory(require, __dirname, fs, path, assert);

var bulkTemplates = JSON.parse(load("templates.json")).exercise_templates;
var single = {};
bulkTemplates.forEach(function (t) { single[t.id] = JSON.stringify(t); });
// Daniel's Pull Up template (1B2B1E7C) sits past page 1 of the catalogue,
// so it is absent from templates.json. Mock its single-template response;
// "lats" is the assumed primary group — the on-device run reports the real
// value, and this mock is updated to match if different.
single["1B2B1E7C"] = JSON.stringify({
  id: "1B2B1E7C",
  title: "Pull Up",
  type: "weight_reps",
  primary_muscle_group: "lats",
});

var api = {
  routines: load("routines.json"),
  template: single,
  bodyMeasurements: JSON.stringify({ body_measurements: [] }),
  history: {
    "79D0BB3A": load("hist_79D0BB3A.json"),
    "1B2B1E7C": load("hist_1B2B1E7C.json"),
  },
};

var r = runNative("KEY", api);
assert.strictEqual(r.notifications.length, 0, "no error notifications expected");
assert.deepStrictEqual(r.result, {
  routineName: "Sample",
  workingSetsPerMuscleGroup: { chest: 3, lats: 3 },
  volumeKgPerExercise: { "Bench Press (Barbell)": 1646.5 },
  volumeKgPerMuscleGroup: { chest: 1646.5 },
  oneRepMaxKgPerExercise: { "Bench Press (Barbell)": 69.9 },
  bodyWeightKgUsed: null,
  // Pull Up is bodyweight-only in history (weight_kg null) and no body
  // weight is known -> no 1RM and no volume, by design.
});
console.log("real-fixtures check passed:", JSON.stringify(r.result));

// And with an explicit body weight, Pull Up gains both metrics:
// 1RM 70*(1+12/30) = 98, volume 70*(12+11+10) = 2310.
var r2 = runNative('{"api_key": "KEY", "body_weight_kg": 70}', api);
assert.strictEqual(r2.errFlag, 0);
assert.strictEqual(r2.result.oneRepMaxKgPerExercise["Pull Up"], 98);
assert.strictEqual(r2.result.volumeKgPerExercise["Pull Up"], 2310);
assert.strictEqual(r2.result.volumeKgPerMuscleGroup.lats, 2310);
assert.strictEqual(r2.result.bodyWeightKgUsed, 70);
console.log("real-fixtures body-weight check passed:", JSON.stringify({
  pullUp1RM: r2.result.oneRepMaxKgPerExercise["Pull Up"],
  pullUpVolume: r2.result.volumeKgPerExercise["Pull Up"],
}));
