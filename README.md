# Nonna 👵🧹

Your desktop is a mess. Nonna has noticed.

Nonna lives in your macOS Dock or Windows 11 taskbar. Click her (or let your desktop get too cluttered) and she storms onto the screen, throws a ciabatta at you, then sweeps every loose file and folder into tidy category folders. When it's clean she approves, and off she goes.

**Website:** [nonna.imbored.fun](https://nonna.imbored.fun)

## What she does

- Moves loose desktop items into `Desktop/Nonna Tidy/<Category>` (Images, Screenshots, Documents, Spreadsheets, Presentations, Videos, Audio, Archives, Installers, Code, Apps, Folders, Other).
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
