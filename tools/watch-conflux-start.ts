/**
 * Conflux 3.5's first ticks, as the page plays them (the manifest's `conflux-3.5`).
 *
 * 1. **Its files.** `dungeon.dat` reads enciphered, 64 levels and 131 DSAs, and the party
 *    starts on level 0 at (13,24) facing north, with no champion. `graphics.dat` is
 *    Conflux's own, 456953 bytes: its tables differ from DM's in their values, and are
 *    read at DM's offsets. The canary is the object names, Conflux's own words, 199 of
 *    them: the burnt torch (7), THE ONE RING (16), PLASMA (197).
 * 2. **The start.** 600 ticks from a seeded random, `CSBgraphics.dat` wired as `main.ts`
 *    wires it: its opener checks it against the signature the dungeon names, and a
 *    DSA's `&SOUND` plays from it. No VBL throws, nothing is traced as unimplemented or
 *    illegal, the DSAs play their sounds, every one a sample, and the party stays where
 *    it started. Conflux's own scripts delete monsters as it goes (a DSA on (13,22) of
 *    level 0, two squares in front of the party): the deletions are printed, not judged.
 * 3. **Repeatable.** The same seed plays the same 600 ticks: the same trace, line for line.
 *
 * Run: `npm test -- --only=watch-conflux-start.ts [ticks]`
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { CSBGraphicsLoader } from '../src/data/CSBGraphicsLoader';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { csbGraphicsOpener } from '../src/engine/FileSignatures';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame, runVbl, TICK_DUE } from './lib/game';

const BASE = 'static/gamefiles/conflux-3.5-b8';
const TICKS = Number(process.argv[2] ?? 600);
const SEED = 0x2545f491;

const read = (file: string): Uint8Array => new Uint8Array(readFileSync(`${BASE}/${file}`));

const graphicsBytes = read('graphics.dat');
const graphics = new GraphicsLoader();
graphics.loadFromArray(graphicsBytes);

interface Run {
  traces: string[];
  sounds: number;
  emptySounds: number;
  position: string;
  tick: number;
}

/** A game on Conflux, wired as `main.ts` wires it, played `ticks` ticks from `SEED`. */
function play(ticks: number): Run {
  const data = new DungeonLoader().loadDungeonDat(read('dungeon.dat'));
  const csbGraphics = new CSBGraphicsLoader();
  csbGraphics.loadFromArray(read('CSBgraphics.dat'));
  const run: Run = { traces: [], sounds: 0, emptySounds: 0, position: '', tick: 0 };
  const game = newGame(data, graphics, {
    trace: (line) => run.traces.push(line),
    playCustomSound: (sound) => {
      run.sounds++;
      if (sound.length === 0) run.emptySounds++;
    },
  });
  csbGraphics.opener = csbGraphicsOpener(game.ctx);
  game.ctx.sounds.csbGraphics = csbGraphics;
  game.ctx.overlay.csbGraphics = csbGraphics;
  csbGraphics.cannotOpen = () => { game.ctx.overlay.active = false; };
  game.ctx.random.setSeed(SEED);
  for (let t = 0; t < ticks; t++) runVbl(game, TICK_DUE);
  const { x, y, z } = game.ctx.party.state.position;
  run.position = `${z}:(${x},${y}) facing ${game.ctx.party.state.facing}`;
  run.tick = game.ctx.state.tickCount;
  return run;
}

console.log('1. The files');
{
  const data = new DungeonLoader().loadDungeonDat(read('dungeon.dat'));
  const game = newGame(data, graphics);
  const party = game.ctx.party.state;
  const dsas = (data.dsaIndex?.entries ?? []).filter((dsa) => dsa).length;
  console.log(`  dungeon.dat: ${data.maps.length} levels, ${dsas} DSAs; the party at ${party.position.z}:(${party.position.x},${party.position.y})`
    + ` facing ${party.facing}, ${party.champions.length} champions`);
  check(data.maps.length === 64 && dsas === 131, 'dungeon.dat: 64 levels, 131 DSAs');
  check(party.position.z === 0 && party.position.x === 13 && party.position.y === 24 && party.facing === 0
    && party.champions.length === 0, 'the party starts on level 0 at (13,24) facing north, with no champion');
  const names = graphicsTablesOf(graphics).objects.objectNames;
  console.log(`  graphics.dat: ${graphicsBytes.length} bytes, ${names.length} object names: ${names[7]}, ${names[16]}, ${names[197]}`);
  check(graphicsBytes.length === 456953, 'graphics.dat is Conflux\'s, 456953 bytes');
  check(names.length === 199 && names[7] === 'BURNT TORCH' && names[16] === 'THE ONE RING' && names[197] === 'PLASMA',
    'its object names are Conflux\'s, read where DM\'s are');
}

console.log(`2. The first ${TICKS} ticks`);
const first = play(TICKS);
{
  const wrong = first.traces.filter((line) => /not implemented|NotImplemented|illegal|Design Error|Cannot find/i.test(line));
  const deleted = first.traces.filter((line) => line.startsWith('Deleting monster'));
  console.log(`  tick ${first.tick}, the party at ${first.position}; ${first.traces.length} trace lines,`
    + ` ${first.sounds} sounds from CSBgraphics.dat`);
  for (const line of deleted) console.log(`  ${line}`);
  for (const line of wrong.slice(0, 10)) console.log(`  !! ${line}`);
  check(first.tick === TICKS, `every tick ran (${first.tick})`);
  check(wrong.length === 0, 'nothing is traced as unimplemented or illegal, and every file opens');
  check(first.sounds > 0 && first.emptySounds === 0, 'the DSAs play their sounds from CSBgraphics.dat, every one a sample');
  check(first.position === '0:(13,24) facing 0', 'the party stays where it started');
}

console.log('3. Repeatable');
{
  const again = play(TICKS);
  const digest = (run: Run): string => createHash('sha256').update(run.traces.join('\n')).digest('hex').slice(0, 16);
  console.log(`  trace digests ${digest(first)} and ${digest(again)}`);
  check(digest(first) === digest(again) && first.sounds === again.sounds, 'the same seed plays the same ticks');
}

finish();
