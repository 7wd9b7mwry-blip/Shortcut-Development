#!/usr/bin/env python3
"""Build the Hevy shortcuts.

Compiles each .cherri source with Cherri (unsigned), post-processes the
plist, and writes the final unsigned .shortcut to the dist dir:

- Hevy Stats (shortcut/hevy-stats.cherri): the Hevy API analyzer. Pure
  native Shortcuts actions (no JavaScript, no HTML); all parsing and math
  mirror src/hevy-stats.js, which remains the tested spec
  (see test/native-sim.js).
- Hevy Record Metrics (shortcut/hevy-record-metrics.cherri): runs
  Hevy Stats via Run Shortcut and converts its result into a list of
  RecordMetric dictionaries (see docs/RECORD_METRIC.md).

Post-processing sets WFWorkflowHasShortcutInputVariables so iOS knows the
shortcut accepts input (the Hevy API key is passed as Shortcut Input, not
prompted; Cherri does not set this flag for dictionary values).

Sign the results with `cherri --hubsign` (or the repo's sign step) before
delivering to a device.

The Hevy API key is taken from Shortcut Input at runtime. It is never
stored in the shortcut or the repo.

Usage: python3 build/build.py [hevy-stats|hevy-record-metrics]
       (default: build both)
"""
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "dist"

# name -> (cherri source, installed WFWorkflowName, dist filename,
#          must_have action, must_not_have actions)
SHORTCUTS = {
    "hevy-stats": (
        "hevy-stats.cherri",
        "Hevy Stats",
        "HevyStats.shortcut",
        "is.workflow.actions.downloadurl",
        (),
    ),
    "hevy-record-metrics": (
        "hevy-record-metrics.cherri",
        "Hevy Record Metrics",
        "HevyRecordMetrics.shortcut",
        "is.workflow.actions.runworkflow",
        ("is.workflow.actions.downloadurl",),  # the wrapper makes no API calls itself
    ),
}


def build_one(key: str, src_name: str, wf_name: str, dist_name: str,
              must_have: str, must_not_have: tuple) -> int:
    work = OUT_DIR / "work" / key
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    shutil.copy(ROOT / "shortcut" / src_name, work / src_name)

    cherri = shutil.which("cherri") or str(Path.home() / ".local" / "bin" / "cherri")
    cmd = [cherri, src_name, "--skip-sign"]
    print("+", " ".join(cmd), f"(cwd={work})")
    proc = subprocess.run(cmd, cwd=work, capture_output=True, text=True)
    # Cherri prints progress bars to stdout; only surface real errors.
    if proc.returncode != 0:
        print(proc.stdout[-3000:], file=sys.stderr)
        print(proc.stderr[-3000:], file=sys.stderr)
        return 1

    unsigned = next(work.glob("*_unsigned.shortcut"), None)
    if unsigned is None:
        print("ERROR: Cherri produced no _unsigned.shortcut", file=sys.stderr)
        return 1

    with unsigned.open("rb") as f:
        plist = plistlib.load(f)

    # Cherri sets this flag when ShortcutInput is used in text, but not when
    # it appears in dictionary values (our api-key headers). Set it so iOS
    # treats the shortcut as accepting input.
    plist["WFWorkflowHasShortcutInputVariables"] = True
    plist["WFWorkflowName"] = wf_name

    # Sanity checks on the compiled shortcut.
    idents = [a.get("WFWorkflowActionIdentifier", "") for a in plist["WFWorkflowActions"]]
    for ident in idents:
        low = ident.lower()
        if "is.workflow.actions.ask" in low:
            print("ERROR: unexpected Ask action in compiled shortcut", file=sys.stderr)
            return 1
        if "richtextfromhtml" in low or "javascript" in low:
            # crude guard: the native build must not depend on HTML/JS execution
            print(f"ERROR: unexpected {ident} in native build", file=sys.stderr)
            return 1
        # Bare-truthiness conditions (100/101) misbehave on device; the
        # sources must use explicit == / != comparisons instead.
        for a in plist["WFWorkflowActions"]:
            if a.get("WFWorkflowActionIdentifier") == "is.workflow.actions.conditional":
                cond = a.get("WFWorkflowActionParameters", {}).get("WFCondition")
                if cond in (100, 101):
                    print("ERROR: bare-truthiness condition 100/101 in compiled shortcut",
                          file=sys.stderr)
                    return 1
    if must_have not in idents:
        print(f"ERROR: no {must_have} actions found", file=sys.stderr)
        return 1
    for banned in must_not_have:
        if banned in idents:
            print(f"ERROR: unexpected {banned} actions in {key}", file=sys.stderr)
            return 1

    # The wrapper must call Hevy Stats by its installed name.
    if key == "hevy-record-metrics":
        found = False
        for a in plist["WFWorkflowActions"]:
            if a.get("WFWorkflowActionIdentifier") == "is.workflow.actions.runworkflow":
                p = a.get("WFWorkflowActionParameters", {})
                name_param = p.get("WFWorkflowName", {})
                # The name is passed via the hevyStatsName variable ("Hevy Stats").
                var = (name_param.get("Value", {}) or {}).get("attachmentsByRange", {})
                for _rng, att in var.items():
                    if att.get("VariableName") == "hevyStatsName":
                        found = True
        if not found:
            print("ERROR: wrapper has no Run Shortcut action targeting hevyStatsName",
                  file=sys.stderr)
            return 1

    out_path = OUT_DIR / dist_name
    with out_path.open("wb") as f:
        plistlib.dump(plist, f)
    print(f"Wrote {out_path} ({len(idents)} actions)")
    return 0


def main() -> int:
    OUT_DIR.mkdir(exist_ok=True)
    targets = sys.argv[1:] or list(SHORTCUTS)
    for key in targets:
        if key not in SHORTCUTS:
            print(f"ERROR: unknown target {key} (choose from {list(SHORTCUTS)})",
                  file=sys.stderr)
            return 1
    rc = 0
    for key in targets:
        src_name, wf_name, dist_name, must_have, must_not_have = SHORTCUTS[key]
        if build_one(key, src_name, wf_name, dist_name, must_have, must_not_have) != 0:
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
