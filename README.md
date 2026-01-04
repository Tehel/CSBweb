# Dungeon Master Web

A web-based port of the classic Dungeon Master game, implemented in TypeScript.

## About

Make Dungeon Master (Original Atari ST version) playable on any support, through the web browser.

This port is based on the awesome CSBWin version by Paul R. Stevens, which was created by disassembling the Atari ST binary and rewriting it in C++. This project is a TypeScript rewrite for the web, using the original game data files.

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
npm install
```

### Development Server

Start the Vite dev server with hot reload:

```bash
npm run dev
```

Open http://localhost:9000 in your browser.

### Build for Production

```bash
npm run build
```

Output will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
dmweb/
├── src/                    # TypeScript source code
│   ├── core/              # Core game types and utilities
│   ├── data/              # Data file parsers (dungeon.dat, graphics.dat)
│   ├── engine/            # Game engine (movement, collision, state)
│   ├── renderer/          # 3D viewport rendering
│   ├── ui/                # User interface components
│   └── main.ts            # Application entry point
├── static/                # Static assets (served by Vite)
│   ├── gamefiles/         # Original game data files
│   │   ├── dungeon.dat
│   │   └── graphics.dat
│   └── favicon.ico
├── doc/                   # Documentation
│   ├── CSBWIN_ARCHITECTURE.md    # CSBWin C++ architecture analysis
│   ├── DUNGEON_DAT_FORMAT.md     # dungeon.dat file format spec
│   └── CSBwin-src/               # Original C++ source for reference
├── index.html             # Main HTML file
├── vite.config.ts         # Vite configuration
└── tsconfig.json          # TypeScript configuration
```

## Implementation Status

- [x] Project setup (TypeScript + Vite)
- [x] Architecture documentation
- [x] File format documentation
- [ ] Data file parsers
  - [ ] dungeon.dat parser
  - [ ] graphics.dat parser (port from existing JS)
- [ ] Core game engine
  - [ ] Party state management
  - [ ] Movement system
  - [ ] Collision detection
- [ ] Rendering
  - [ ] First-person viewport
  - [ ] Wall rendering
  - [ ] Floor/ceiling rendering
- [ ] Game loop
  - [ ] Tick-based timing
  - [ ] Input handling
  - [ ] State updates

## Documentation

- **Architecture**: See [doc/CSBWIN_ARCHITECTURE.md](doc/CSBWIN_ARCHITECTURE.md)
- **File Formats**: See [doc/DUNGEON_DAT_FORMAT.md](doc/DUNGEON_DAT_FORMAT.md)

## People

The original authors of Dungeon Master at FTL Games / Software Heaven, Inc. Doug Bell (Director), Dennis Walker (Assistant director), Mike Newton (2nd unit director), Andy Jaros (Graphics), and Wayne Holder (Producer). 

[Paul R. Stevens](http://www.dianneandpaul.net/CSBwin/) for the crazy work of making CSBWin.

Awsome [DMweb community](http://dmweb.free.fr) for the continuous love for the original game over all these years.

People at [Swoosh Construction Kit](http://greatstone.free.fr/dm) for detailed reverse-engineering of *all* the data file structures.

[List of all contributors](https://github.com/Tehel/dmjs/graphs/contributors). Mostly me, I'm afraid.

## License

[MIT](LICENSE) for the JS code

The data files, manual and intellectual property for most of the game processing still go to their original authors at FTL Games / Software Heaven, Inc.
