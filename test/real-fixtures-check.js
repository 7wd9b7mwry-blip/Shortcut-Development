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

var api = {
  routines: load("routines.json"),
  templates: load("templates.json"),
  history: {
    "79D0BB3A": load("hist_79D0BB3A.json"),
    "1B2B1E7C": load("hist_1B2B1E7C.json"),
  },
};

var r = runNative("KEY", api);
assert.strictEqual(r.notifications.length, 0, "no error notifications expected");
assert.deepStrictEqual(r.result, {
  routineName: "Sample",
  workingSetsPerMuscleGroup: { chest: 3, other: 3 },
  oneRepMaxKgPerExercise: { "Bench Press (Barbell)": 69.9 },
});
console.log("real-fixtures check passed:", JSON.stringify(r.result));
