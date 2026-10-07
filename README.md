# Dungeon Master Web

A web-based port of the classic Dungeon Master game, implemented in TypeScript.

## About

Make Dungeon Master (Original Atari ST version) playable on any support, through the web browser.

This port is based on the awesome CSBWin version by Paul R. Stevens, which was created by disassembling the Atari ST binary and rewriting it in C++. This project is a TypeScript rewrite for the web, using the original game data files.

## Development

### Prerequisites

- Node.js 20+ (22 for `tools/probe-ui.mjs` without a flag)
- npm
- The original game files under `static/gamefiles/`, one directory per data set, each
  listed in `static/gamefiles/manifest.json` (parsed by `src/data/DataSets.ts`)

### Commands

```bash
npm install
npm run dev            # Vite dev server on http://localhost:9000
npm run build          # tsc, then vite build into dist/
npm run preview        # serve the build
npm test               # tsc and every asserting tool in tools/
npm test -- --frames   # ...and the golden frames (needs google-chrome)
```

`npm test` is the gate: `tsc --noEmit` type-checks what `vite build` alone would not.

## Project Structure

```
csbweb/
├── src/                   # TypeScript source; CLAUDE.md → "Code layout" has the map
│   ├── core/              # binary reads, decompression, image decoding, object ids
│   ├── data/              # dungeon.dat, graphics.dat and save-file readers and writers
│   ├── engine/            # the game: CSBWin's d., its systems, the main loop
│   ├── renderer/          # the 320x200 screen: viewport bytecode, the DM interface
│   ├── audio/             # samples
│   ├── ui/                # the debug chrome beside the canvas
│   └── main.ts            # the page's bootstrap
├── tools/                 # verification tools (dump-*.ts), the golden frames
├── static/gamefiles/      # the original game data files, one directory per data set, and manifest.json
├── doc/                   # CSBWin reference docs; CSBwin-src/ is the C++ (not ours)
├── PLAN.md, DEBT.md       # project status and technical debt
├── index.html
├── vite.config.mts
└── tsconfig.json
```

## Status

Dungeon Master plays from the title screen to the end credits: the viewport, movement,
the champions and their inventory, combat both ways, magic, monsters, timers, actuators,
sound, and saves CSBWin itself can load. `PLAN.md` has the detail and `DEBT.md` what is
left.

## Documentation

- **Orientation**: [CLAUDE.md](CLAUDE.md)
- **CSBWin reference docs**: [doc/CSBWIN_REFERENCE_INDEX.md](doc/CSBWIN_REFERENCE_INDEX.md)
- **Verified facts**: [doc/PROVEN_FACTS.md](doc/PROVEN_FACTS.md)

## People

The original authors of Dungeon Master at FTL Games / Software Heaven, Inc. Doug Bell (Director), Dennis Walker (Assistant director), Mike Newton (2nd unit director), Andy Jaros (Graphics), and Wayne Holder (Producer). 

[Paul R. Stevens](http://www.dianneandpaul.net/CSBwin/) for the crazy work of making CSBWin.

Awsome [DMweb community](http://dmweb.free.fr) for the continuous love for the original game over all these years.

People at [Swoosh Construction Kit](http://greatstone.free.fr/dm) for detailed reverse-engineering of *all* the data file structures.

[List of all contributors](https://github.com/Tehel/dmjs/graphs/contributors). Mostly me, I'm afraid.

## License

[MIT](licence.txt) for the TypeScript code

The data files, manual and intellectual property for most of the game processing still go to their original authors at FTL Games / Software Heaven, Inc.
