# CSBweb

Dungeon Master and Chaos Strikes Back, in the browser, written in TypeScript.

## About

CSBweb makes Dungeon Master (the original Atari ST version) and its sequel playable on
anything with a web browser, from the original game data files.

It is a port of CSBWin, Paul R. Stevens' C++ version of the game, which he wrote by
disassembling the Atari ST binary. CSBWin's source is the specification: the port follows
it function by function, under the same names, so the two codebases can be read side by
side.

Every FTL dungeon plays, and so do the fans' dungeons the welcome page lists. A player can
also add a dungeon of their own. Saves are CSBWin's own files, so a game moves between the
two.

## Development

### Prerequisites

- Node.js 24 (`.nvmrc`)
- `7z` (7-Zip or p7zip), for the two fetch commands
- `npm run fetch-csbwin-src` once: it fetches `doc/CSBwin-src/`, CSBWin's C++ source, which
  the docs cite and `npm test` reads
- `npm run fetch-gamefiles` once: it fetches the original game files and the fans' dungeons
  into `tools/fixtures/gamefiles/`, one directory per data set listed in
  `tools/data-sets.json`, from dmweb.free.fr, Paul R. Stevens' site and the Dungeon Master
  forum's shared OneDrive. The tests and the dev server read them
- Google Chrome, for the golden frames

### Commands

```bash
npm install
npm run dev            # Vite dev server on http://localhost:9000
npm run build          # tsc, then vite build into dist/, and the server's module into dist/server/
npm start              # the server, over dist/
npm test               # tsc and every asserting tool in tools/
npm test -- --frames   # ...and the golden frames
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
│   ├── ui/                # the page's DOM side, and the welcome page
│   ├── stats/             # the statistics page
│   ├── assets/            # the page's fonts, icons and the FTL logo
│   └── main.ts            # the page's bootstrap
├── server/                # the deployed server: the page, the data sets, the statistics
├── tools/                 # verification tools (checks/), the golden frames, the fetch commands
├── tools/fixtures/        # CSBWin saves the tools read; gamefiles/, the data sets (not ours, fetched)
├── utils/                 # the maintainer's scripts: deploying, backups, the forum's dungeons submitted
├── doc/                   # CSBWin reference docs; CSBwin-src/ is the C++ (not ours, fetched)
├── PLAN.md, DEBT.md       # project status and technical debt
├── index.html, stats.html # the two pages, Vite's entries
└── Dockerfile             # the deployed image
```

## Documentation

- **Orientation**: [CLAUDE.md](CLAUDE.md)
- **CSBWin reference docs**: [doc/CSBWIN_REFERENCE_INDEX.md](doc/CSBWIN_REFERENCE_INDEX.md)
- **Verified facts**: [doc/PROVEN_FACTS.md](doc/PROVEN_FACTS.md)
- **Saves**: [doc/SAVES.md](doc/SAVES.md)
- **Deployment**: [doc/DEPLOYMENT.md](doc/DEPLOYMENT.md)

## People

The original authors of Dungeon Master at FTL Games / Software Heaven, Inc.: Doug Bell
(Director), Dennis Walker (Assistant director), Mike Newton (2nd unit director), Andy Jaros
(Graphics), and Wayne Holder (Producer).

[Paul R. Stevens](http://www.dianneandpaul.net/CSBwin/) for the crazy work of making CSBWin.

The awesome [DMweb community](http://dmweb.free.fr), for its continuous love of the
original game over all these years.

The people at [Swoosh Construction Kit](http://greatstone.free.fr/dm), for the detailed
reverse-engineering of *all* the data file structures.

The authors of the fans' dungeons the welcome page lists.

[List of all contributors](https://github.com/Tehel/csbweb/graphs/contributors). Mostly me,
I'm afraid.

## License

The code is [MIT](LICENSE). It is a TypeScript port written from CSBWin, Paul R. Stevens'
C++ reconstruction of Dungeon Master: it follows CSBWin's behaviour and structure but
contains none of its code. The MIT licence covers this project's own work, not the rights of
CSBWin's author or of Dungeon Master's.

Dungeon Master and Chaos Strikes Back, their data files, manuals and artwork belong to their
original authors at FTL Games / Software Heaven, Inc., and the fans' dungeons to their
authors. Neither they nor CSBWin's source are in this repository: the two fetch commands
download them from where their authors and the community publish them.

What the repository does hold that is not under the MIT licence:

- `src/assets/swoosh.img`, the FTL logo from the Atari ST disk, and `src/assets/swoosh.wav`,
  its sound, recorded from an Atari ST.
- `src/assets/dm-screen.ttf`, Dungeon Master's font, made into a TrueType font by
  `tools/gen-font.ts`.
- `tools/fixtures/`, CSBWin saves, which hold a whole dungeon, and `tools/frames/`, the
  golden frames, which are screenshots of the game.
- `src/assets/spectral-*.woff2`, the Spectral font, under the SIL Open Font License
  (`src/assets/spectral-OFL.txt`).
