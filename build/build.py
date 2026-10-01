#!/usr/bin/env python3
"""Build the Hevy Stats shortcut.

Compiles the .cherri source with Cherri (unsigned), post-processes the
plist, and writes the final unsigned .shortcut to the dist dir.

Hevy Stats (shortcut/lib/*.cherri): the Hevy API analyzer, whose output is
a LIST of RecordMetric dictionaries (see docs/RECORD_METRIC.md), or the
raw stats dictionary when the input dict carries "output_format": "stats".
Pure native Shortcuts actions (no JavaScript, no HTML); all parsing and
math mirror src/hevy-stats.js, which remains the tested spec
(see test/native-sim.js).

The .cherri source is split into lib/ parts — one "function" per file with
a documented in/out contract (Cherri has no #include for code and
Shortcuts has no subroutines, so modularity is by convention). build.py
concatenates the parts in filename order and compiles the result.

Post-processing sets WFWorkflowHasShortcutInputVariables so iOS knows the
shortcut accepts input (the Hevy API key is passed as Shortcut Input, not
prompted; Cherri does not set this flag for dictionary values).

Sign the result with `cherri --hubsign` (or the repo's sign step) before
delivering to a device.

The Hevy API key is taken from Shortcut Input at runtime. It is never
stored in the shortcut or the repo.

Usage: python3 build/build.py
"""
import plistlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "dist"
LIB_DIR = ROOT / "shortcut" / "lib"

# name -> (installed WFWorkflowName, dist filename,
#          must_have actions, must_not_have actions)
SHORTCUTS = {
    "hevy-stats": (
        "Hevy Stats",
        "HevyStats.shortcut",
        ("is.workflow.actions.downloadurl",
         "is.workflow.actions.appendvariable"),  # API calls + list building
        (),
    ),
}


def check_brace_literals(src_path: Path) -> int:
    """Cherri silently compiles a double-quoted lone "{" or "}" to empty
    text (it treats the brace as an interpolation start). Literal braces in
    double-quoted strings must use single quotes instead: '{' / '}'.
    Fail the build if the source contains the broken pattern."""
    text = src_path.read_text()
    bad = []
    for i, line in enumerate(text.splitlines(), 1):
        # Skip comment lines: doc comments legitimately mention "{" as an
        # example of the broken pattern.
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        # Match exactly "{" or "}" as a full double-quoted literal, or as a
        # contains/comparison operand: contains "{" / == "{" etc.  Anything
        # with more content ("{@x}", "{ShortcutInput}") is fine.
        for m in re.finditer(r'"([{}])"', line):
            bad.append((i, m.group(0)))
    if bad:
        for i, lit in bad:
            print(f"ERROR: {src_path.name}:{i}: double-quoted lone brace {lit} "
                  f"compiles to empty text; use single quotes ('{lit[1]}')",
                  file=sys.stderr)
        return 1
    return 0


def assemble_source(work: Path) -> Path:
    """Concatenate shortcut/lib/*.cherri (filename order) into the single
    source file Cherri compiles. Each part is checked for the
    double-quoted-brace gotcha first."""
    parts = sorted(LIB_DIR.glob("*.cherri"))
    if not parts:
        print(f"ERROR: no .cherri parts in {LIB_DIR}", file=sys.stderr)
        raise SystemExit(1)
    for part in parts:
        if check_brace_literals(part):
            raise SystemExit(1)
    src_name = "hevy-stats.cherri"
    dest = work / src_name
    with dest.open("w") as out:
        for part in parts:
            out.write(f"// ---- assembled from shortcut/lib/{part.name} ----\n")
            out.write(part.read_text())
            if not part.read_text().endswith("\n"):
                out.write("\n")
            out.write("\n")
    print(f"Assembled {len(parts)} parts -> {dest}")
    return dest


def build_one(key: str, wf_name: str, dist_name: str,
              must_have: tuple, must_not_have: tuple) -> int:
    work = OUT_DIR / "work" / key
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    try:
        src_path = assemble_source(work)
    except SystemExit as e:
        return int(e.code or 1)
    src_name = src_path.name

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
    for needed in must_have:
        if needed not in idents:
            print(f"ERROR: no {needed} actions found", file=sys.stderr)
            return 1
    for banned in must_not_have:
        if banned in idents:
            print(f"ERROR: unexpected {banned} actions in {key}", file=sys.stderr)
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
        wf_name, dist_name, must_have, must_not_have = SHORTCUTS[key]
        if build_one(key, wf_name, dist_name, must_have, must_not_have) != 0:
            rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
