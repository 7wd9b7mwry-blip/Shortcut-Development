#!/usr/bin/env python3
"""Build the Hevy Stats shortcut.

1. Compiles shortcut/hevy-stats.cherri with Cherri (unsigned).
2. Post-processes the plist:
   - sets WFWorkflowHasShortcutInputVariables so iOS knows the shortcut
     accepts input (the Hevy API key is passed as Shortcut Input, not
     prompted; Cherri does not set this flag for dictionary values).
3. Writes the final unsigned .shortcut to the dist dir.

The shortcut is pure native Shortcuts actions (no JavaScript, no HTML):
all parsing and math mirror src/hevy-stats.js, which remains the tested
spec (see test/native-sim.js). Sign the result with `cherri --hubsign`
(or the repo's sign step) before delivering to a device.

The Hevy API key is taken from Shortcut Input at runtime. It is never
stored in the shortcut or the repo.

Usage: python3 build/build.py
"""
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "shortcut" / "hevy-stats.cherri"
OUT_DIR = ROOT / "dist"


def main() -> int:
    OUT_DIR.mkdir(exist_ok=True)

    work = OUT_DIR / "work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    shutil.copy(SRC, work / "hevy-stats.cherri")

    cherri = shutil.which("cherri") or str(Path.home() / ".local" / "bin" / "cherri")
    cmd = [cherri, "hevy-stats.cherri", "--skip-sign"]
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
    plist["WFWorkflowName"] = "Hevy Stats"

    # Sanity checks on the compiled shortcut.
    idents = [a.get("WFWorkflowActionIdentifier", "") for a in plist["WFWorkflowActions"]]
    for a in plist["WFWorkflowActions"]:
        if a.get("WFWorkflowActionIdentifier") == "is.workflow.actions.ask":
            print("ERROR: unexpected Ask action in compiled shortcut", file=sys.stderr)
            return 1
    for ident in idents:
        low = ident.lower()
        if "richtext" in low or "javascript" in low or "html" in low.replace("is.workflow.actions", ""):
            # crude guard: the native build must not depend on HTML/JS execution
            if "richtextfromhtml" in low or "javascript" in low:
                print(f"ERROR: unexpected {ident} in native build", file=sys.stderr)
                return 1
    if "is.workflow.actions.downloadurl" not in idents:
        print("ERROR: no downloadurl actions found", file=sys.stderr)
        return 1

    out_path = OUT_DIR / "HevyStats.shortcut"
    with out_path.open("wb") as f:
        plistlib.dump(plist, f)
    print(f"Wrote {out_path} ({len(idents)} actions)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
