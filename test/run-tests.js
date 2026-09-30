// Test harness for src/hevy-stats.js. No dependencies: `node test/run-tests.js`.
var fs = require("fs");
var path = require("path");
var stats = require("../src/hevy-stats.js");

var failures = 0;

function fixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
  );
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

// --- push-day fixture ---
var push = stats.computeStats(fixture("push-day.json"));

check("routineName passes through", push.routineName, "Push Day");

// Working sets: bench has warmup+3x normal+failure (x2 entries: 4+1), ohp 2x normal+dropset,
// triceps 2x normal, missing-template 2x normal.
// bench: entry1 -> 4 working (3 normal + 1 failure), entry2 -> 1 working => 5 chest
// ohp: 3 working => shoulders 3; triceps: 2; missing template => other 2
check("workingSetsPerMuscleGroup", push.workingSetsPerMuscleGroup, {
  chest: 5,
  shoulders: 3,
  triceps: 2,
  other: 2
});

// 1RM bench: candidates: 100x5 -> 116.67, 102.5x3 -> 112.75, 110x1 -> 110.
// warmup excluded, 0/null weight excluded, null reps excluded, 40 reps excluded.
checkClose(
  "1RM bench (Epley best = 100x5)",
  push.oneRepMaxKgPerExercise["Bench Press (Barbell)"],
  116.7
);
// ohp: 40x8 -> 50.67, 42.5x6 -> 51.0 (failure counts)
checkClose(
  "1RM ohp (failure set counts)",
  push.oneRepMaxKgPerExercise["Overhead Press (Dumbbell)"],
  51.0
);
// triceps: 30x12 -> 42.0
checkClose(
  "1RM triceps",
  push.oneRepMaxKgPerExercise["Triceps Pushdown (Cable)"],
  42.0
);
// missing template still gets a 1RM keyed by routine title
checkClose(
  "1RM unknown template uses routine title",
  push.oneRepMaxKgPerExercise["Mystery Machine"],
  93.3
);

// --- epley unit checks ---
check("epley reps=1 returns weight", stats.epley1RM(110, 1), 110);
checkClose("epley 100x5", stats.epley1RM(100, 5), 116.667);

// --- empty routine ---
var empty = stats.computeStats(fixture("empty.json"));
check("empty routineName", empty.routineName, "Empty Routine");
check("empty working sets", empty.workingSetsPerMuscleGroup, {});
check("empty 1RM", empty.oneRepMaxKgPerExercise, {});

// --- unicode fixture ---
var uni = stats.computeStats(fixture("unicode.json"));
check("unicode routineName", uni.routineName, "Leg Day éè");
check("unicode working sets", uni.workingSetsPerMuscleGroup, { quadriceps: 3 });
checkClose("unicode 1RM squat (150x3 -> 165)", uni.oneRepMaxKgPerExercise["Back Squat (Barbell)"], 165.0);

// --- deviceMain simulation: placeholder replacement + data-URL round trip ---
// Simulates exactly what the shortcut does: substitute fragments into the JS
// source, run it with a stubbed document, and decode the written payload.
(function testDeviceRoundTrip() {
  // Simulates exactly what the shortcut does: URL-encode titles (as Cherri's
  // urlEncode does), substitute fragments into the JS source, run it with a
  // stubbed document, and decode the written payload.
  var src = fs.readFileSync(path.join(__dirname, "..", "src", "hevy-stats.js"), "utf8");
  function frag(ex) {
    return (
      '["' + ex[0] + '","' + encodeURIComponent(ex[1]) + '",["' + ex[2].join('","') + '"]]'
    );
  }
  var p = fixture("push-day.json");
  var page = src
    .replace("__ROUTINE_NAME__", encodeURIComponent(p.routineName))
    .replace("__ROUTINE_EXERCISES__", p.routineExercises.map(frag).join(","))
    .replace(
      "__TEMPLATES__",
      p.templates.map(function (t) { return '["' + t[0] + '","' + t[1] + '"]'; }).join(",")
    )
    .replace(
      "__HISTORY_ENTRIES__",
      p.historyEntries
        .map(function (h) {
          return '["' + h[0] + '","' + h[1] + '","' + h[2] + '","' + h[3] + '"]';
        })
        .join(",")
    );
  var written = null;
  var document = { write: function (s) { written = s; } };
  var module = undefined;
  eval(page); // runs deviceMain via the document guard
  var decoded = decodeURIComponent(written);
  var result = JSON.parse(decoded);
  check("device round trip: routineName", result.routineName, "Push Day");
  check("device round trip: working sets", result.workingSetsPerMuscleGroup, {
    chest: 5,
    shoulders: 3,
    triceps: 2,
    other: 2
  });
  checkClose(
    "device round trip: 1RM bench",
    result.oneRepMaxKgPerExercise["Bench Press (Barbell)"],
    116.7
  );
})();

// --- tricky titles (quotes/backslashes survive via URL-encoding) ---
(function testTrickyTitles() {
  var src = fs.readFileSync(path.join(__dirname, "..", "src", "hevy-stats.js"), "utf8");
  var p = fixture("tricky-titles.json");
  var page = src
    .replace("__ROUTINE_NAME__", encodeURIComponent(p.routineName))
    .replace(
      "__ROUTINE_EXERCISES__",
      '[\"tpl-q\",\"' + encodeURIComponent(p.routineExercises[0][1]) + '\",[\"normal\",\"normal\"]]'
    )
    .replace("__TEMPLATES__", '[\"tpl-q\",\"quadriceps\"]')
    .replace("__HISTORY_ENTRIES__", '[\"tpl-q\",\"80\",\"10\",\"normal\"]');
  var written = null;
  var document = { write: function (s) { written = s; } };
  var module = undefined;
  eval(page);
  var result = JSON.parse(decodeURIComponent(written));
  check("tricky routineName", result.routineName, 'Leg "Day" \\ Test');
  check("tricky working sets", result.workingSetsPerMuscleGroup, { quadriceps: 2 });
  checkClose("tricky 1RM", result['oneRepMaxKgPerExercise']['My "Special" \\ Leg (Day)'], 106.7);
})();

if (failures > 0) {
  console.log("\n" + failures + " test(s) failed");
  process.exit(1);
}
console.log("\nAll tests passed");
