#!/usr/bin/env python3
"""Build a Starship Studio instrument pack from a folder of WAV files named by note (C3.wav, F#4.wav, Bb2.wav).

  python3 scripts/make-instrument-pack.py piano ./wavs --license CC0-1.0 --credit "..." --source https://...

It will not run without --license: a sample set whose licence you cannot name does not go in the app.
Standard library only. Uses ffmpeg to make OGG files when it is installed; otherwise the WAVs are copied as they are.
"""
import argparse, json, re, shutil, subprocess, sys
from pathlib import Path

IDS = {"piano", "epiano", "pad", "pluck", "bell", "lead", "sub808"}  # keep equal to the server allowlist
NOTES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
NAME = re.compile(r"^([A-Ga-g])([#b]?)(-?\d)$")


def midi(stem: str):
    m = NAME.match(stem)
    if not m:
        return None
    n = NOTES[m.group(1).upper()] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    v = 12 * (int(m.group(3)) + 1) + n
    return v if 0 <= v <= 127 else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("folder")
    ap.add_argument("--license", required=True, help='SPDX-style licence name, e.g. "CC0-1.0" or "CC-BY-4.0"')
    ap.add_argument("--credit", default="")
    ap.add_argument("--source", default="")
    ap.add_argument("--release", type=float, default=0.35, help="seconds the note takes to die away after release")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "public" / "studio-instruments"))
    a = ap.parse_args()

    if a.id not in IDS:
        print(f"unknown instrument id {a.id!r}; allowed: {sorted(IDS)}", file=sys.stderr)
        return 2
    lic = a.license.strip().upper()
    if not a.license.strip() or any(bad in lic for bad in ("NC", "ND", "PERSONAL", "UNKNOWN", "NONE")):
        print("refusing: NonCommercial, NoDerivatives, personal-use or unknown licences cannot be shipped in the app", file=sys.stderr)
        return 2

    src = Path(a.folder)
    dest = Path(a.out) / a.id
    dest.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    samples = []
    for f in sorted(src.glob("*.wav")):
        n = midi(f.stem)
        if n is None:
            print(f"skipping {f.name}: not named like C3 / F#4 / Bb2", file=sys.stderr)
            continue
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", f.stem)
        if ffmpeg:
            out = dest / f"{safe}.ogg"
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(f), "-ac", "1", "-c:a", "libvorbis", "-q:a", "5", str(out)], check=True)
        else:
            out = dest / f"{safe}.wav"
            shutil.copyfile(f, out)
        samples.append({"note": n, "file": out.name})
    if not samples:
        print("no usable samples found", file=sys.stderr)
        return 1
    if len(samples) > 48:
        print("too many samples (48 max)", file=sys.stderr)
        return 1
    samples.sort(key=lambda s: s["note"])
    manifest = {"id": a.id, "license": a.license.strip(), "credit": a.credit, "source": a.source, "release": a.release, "samples": samples}
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    lic_file = dest / "LICENSE.txt"
    if not lic_file.exists():
        lic_file.write_text(f"Licence: {a.license}\nCredit: {a.credit}\nSource: {a.source}\n\nPaste the full licence text of the sample set here.\n")
    print(f"wrote {len(samples)} samples + manifest to {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
