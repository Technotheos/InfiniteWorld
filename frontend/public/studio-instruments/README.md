# Studio instrument packs

Starship Studio plays every melodic instrument two ways:

1. **Recorded samples**, if a pack is installed here: `public/studio-instruments/<id>/manifest.json` plus the audio files it lists.
2. **A built-in synth**, if there is no pack, a file fails to load, or it is still loading.

Out of the box no packs are installed, so everything uses the synth. Piano and guitar are the ones that need
recordings to sound convincing; the synthesised versions are a fallback, not the goal.

Instrument ids (must match the server allowlist in `backend-go/studio_notes.go`):
`piano`, `epiano`, `pad`, `pluck`, `bell`, `lead`, `sub808`.

## Licences: check before you ship a sample

A pack is only added if its licence allows redistribution inside this app. **Do not add a sample set because it is
free to download.** Free to download is not the same as free to redistribute.

- Prefer **CC0 / public domain**. Nothing to credit, no conditions.
- **CC-BY** is fine if you show the credit. The manifest's `credit` field is kept for this; the UI does not display it
  yet, so add it to your credits page before shipping a CC-BY pack.
- **Refuse** anything NonCommercial (CC-BY-NC), NoDerivatives, "personal use only", anything ripped from a commercial
  plugin or a song, and anything with no licence text at all.
- Keep the licence text in `<id>/LICENSE.txt` next to the samples, and note the source URL in the manifest.

Candidates worth reading the current licence terms of (this list is a starting point, not a clearance; terms can
change, so open the licence file of the exact download you use): the Versilian Community Sample Library (VCSL),
the University of Iowa Musical Instrument Samples, and the Salamander Grand Piano. Verify each one yourself.

## Building a pack

Put one WAV per root note in a folder, named by note (`C3.wav`, `F#4.wav`, `Bb2.wav`), then:

    python3 scripts/make-instrument-pack.py piano ./my-piano-wavs \
        --license "CC0-1.0" --credit "Recorded by ..." --source "https://..." --release 0.45

That converts to OGG (if `ffmpeg` is on the PATH, otherwise copies the WAVs), writes `manifest.json` and
`LICENSE.txt` placeholders into `public/studio-instruments/piano/`. The script refuses to run without `--license`.
Every 3 to 4 semitones is enough: the player repitches the nearest sample.
