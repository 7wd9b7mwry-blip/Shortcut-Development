#!/usr/bin/env python3
"""Build the Hevy Stats shortcut.

1. Base64-encodes src/hevy-stats.js into shortcut/hevy-stats.cherri.template.
2. Compiles the result with Cherri (unsigned).
3. Post-processes the plist:
   - sets WFWorkflowHasShortcutInputVariables so iOS knows the shortcut
     accepts input (the Hevy API key is passed as Shortcut Input, not
     prompted; Cherri does not set this flag for dictionary values).
4. Writes the final unsigned .shortcut to the dist dir.

The Hevy API key is taken from Shortcut Input at runtime. It is never
stored in the shortcut or the repo.

Usage: python3 build/build.py
"""
import base64
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_JS = ROOT / "src" / "hevy-stats.js"
TEMPLATE = ROOT / "shortcut" / "hevy-stats.cherri.template"
OUT_DIR = ROOT / "dist"


def main() -> int:
    OUT_DIR.mkdir(exist_ok=True)

    js_b64 = base64.b64encode(SRC_JS.read_bytes()).decode("ascii")
    cherri_src = TEMPLATE.read_text().replace("__HEVY_STATS_JS_B64__", js_b64)
    if "__HEVY_STATS_JS_B64__" in cherri_src:
        print("ERROR: JS placeholder was not replaced", file=sys.stderr)
        return 1
    if "__HEVY_API_KEY__" in cherri_src:
        print("ERROR: stale API key placeholder in template", file=sys.stderr)
        return 1

    work = OUT_DIR / "work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    (work / "hevy-stats.cherri").write_text(cherri_src)

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

    # Sanity: no prompt-based key collection should remain.
    for action in plist["WFWorkflowActions"]:
        if action.get("WFWorkflowActionIdentifier") == "is.workflow.actions.ask":
            print("ERROR: unexpected Ask action in compiled shortcut", file=sys.stderr)
            return 1

    out_path = OUT_DIR / "HevyStats.shortcut"
    with out_path.open("wb") as f:
        plistlib.dump(plist, f)
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
