# Nonna 👵🧹

Your desktop is a mess. Nonna has noticed.

Nonna lives in your macOS Dock or Windows 11 taskbar. Click her (or let your desktop get too cluttered) and she storms onto the screen, throws a ciabatta at you, then sweeps every loose file and folder into tidy category folders. When it's clean she approves, and off she goes.

**Website:** [nonna.imbored.fun](https://nonna.imbored.fun)

## What she does

- Moves loose desktop items into category folders on the desktop (Images, Screenshots, Screen Recordings, Documents, Spreadsheets, Presentations, Videos, Audio, Archives, Installers, Code, Apps, Other).
- Fixed rules, no AI: a category with more than 100 files gets a folder per month (`Images/2026-10`), a month with more than 1,000 files gets a folder per day (`Images/2026-10/2026-10-15`). The same desktop always ends up the same way.
- Fast on huge desktops: she sweeps in batches, so the show lasts a few seconds and the files move as fast as the disk allows (150,000 files in about 18 seconds in testing). The move log is streamed to disk, so even millions of files can be undone.
- Never deletes anything and never overwrites: name clashes get a ` (2)` suffix.
- Keeps a move log, so **Undo last tidy-up** in the Dock/tray menu puts everything back.
- Asks before her very first tidy-up.
- Optional auto-visit when the desktop has 15+ loose items (at most once an hour).

## Run from source

```bash
npm install
npm start
```

Try it safely on a fake desktop, without moving anything:

```bash
NONNA_DESKTOP=/tmp/fake-desktop NONNA_DRY_RUN=1 npm start
```

## Demo with 21,931,293 icons

```bash
npx electron scripts/record-mess.js   # -> docs/nonna-21-million.mp4
```

The files are simulated; the folder layout shown at the end comes from the real organizer rules.

## Nonna's animations

The clips in `assets/nonna/*.webm` (VP9 with alpha) are generated with FAL: a photoreal reference image, an image-to-video clip per mood (`angry`, `sweep`, `happy`, `leave`), then video background removal.

```bash
FAL_KEY=... npm run assets
```

Without the clips the app falls back to an emoji Nonna.

## Build

```bash
npm run dist:mac   # .dmg
npm run dist:win   # .exe installer
```

## License

MIT
