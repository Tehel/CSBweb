/**
 * Prove YA BRO ROS marks the trail the party walks, and that a save carries that mark.
 *
 * CSBWin holds the trail's count and the magic range's two ends once each, in `d.`:
 *
 * - the spell starts the range at the trail's end, `d.IndexOfFirstMagicFootprint =
 *   d.NumFootprintEnt`, and closes it there for a spell power under 3 or sets its end to
 *   0 otherwise (`doc/CSBwin-src/Magic.cpp:1333-1344`);
 * - each party move while `d.MagicFootprintsActive` raises the end to the new count
 *   (`Code11f52.cpp:3272-3276`);
 * - the save writes the count and both ends into the party tail beside the trail.
 *
 * So a party that casts, then walks four squares, saves the range from the count at the
 * cast to the count after the walk, whatever the spell's power, and a game loaded from
 * that save reads the same range back.
 *
 * The parties are two genuine CSBWin saves', and the walk leaves the ring short of its 24:
 *
 * - `csbgame-early-3hero-nospace.dat`, whose trail holds three prints;
 * - `csbgame-early-1hero.dat`, whose trail is empty. Only the first move's
 *   `AddFootprintEntry` waits for a print (`if (D6W != 0)`, `Code11f52.cpp:3266-3269`): the
 *   move still counts and stores its own, so the trail grows from nothing, as CSBWin's
 *   `csbgame-early-2hero-renamed.dat`, one move later, shows with its one print.
 *
 * And the ring itself, on a bare `PartyFootprints`. `DeleteFootprintEntry`
 * (`Code11f52.cpp:4356-4376`) drops an entry by moving the ones above it down one:
 * `MemMove` takes its source first (`CSBCode.cpp:834`). So a full trail is always the last
 * 24 squares walked, in order, the magic range slides down with them, and the ten-second
 * update's drop of the oldest print (`Code17818.cpp:181-195`) leaves the rest in place.
 *
 * Run: `npx tsx tools/dump-magic-footprints.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { RoomType } from '../src/core/types';
import { readCsbwinPartyTail } from '../src/data/CsbwinCharacters';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import type { Game } from '../src/engine/Game';
import { PartyFootprints } from '../src/engine/PartyFootprints';
import { applySaveBytes, buildSaveFile } from '../src/engine/SaveGameFile';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';
import { savePath } from './lib/saves';

/** YA BRO ROS: element YA (0x66), form BRO (0x70), class ROS (0x73), after a power rune. */
const YA_BRO_ROS = [0x66, 0x70, 0x73];

function loadWorld(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  return newGame(data, stockGraphics());
}

/** The first open square beside the party, to walk back and forth to. */
function openNeighbour(game: Game): { x: number; y: number } {
  const { x, y, z } = game.ctx.party.state.position;
  const map = game.ctx.dungeon.getMap(z)!;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= map.descriptor.width || ny >= map.descriptor.height) continue;
    if (((map.cellFlags[nx]![ny]! >> 5) & 7) === RoomType.OPEN) return { x: nx, y: ny };
  }
  throw new Error('no open square beside the party');
}

function scenario(save: string, power: number): void {
  const label = `${save}, power ${power}`;
  const game = loadWorld();
  applyCsbwinSave(game, new Uint8Array(readFileSync(savePath(save))));
  const prints = game.ctx.footprints;
  const party = game.ctx.party.state;

  // A caster who masters the spell at any power: no fizzle, no random draw.
  const caster = party.champions[0]!;
  for (const skill of caster.skills as unknown as Array<{ experience: number }>) skill.experience = 500000;
  caster.incantation = [0x5f + power, ...YA_BRO_ROS];
  const atCast = prints.getCount();
  const cast = game.systems.magic.castSpellFromUi(0);
  const first = prints.getIndexOfFirstMagicFootprint();
  const lastAtCast = prints.getIndexOfLastMagicFootprint();
  console.log(`${label}: cast=${cast} active=${party.magicFootprintsActive} count=${atCast} ` +
    `range=[${first},${lastAtCast})`);
  check(cast === 1 && party.magicFootprintsActive === 1, `${label}: the spell is cast and its counter runs`);
  check(first === atCast, `${label}: the range starts at the trail's end, ${atCast}`);
  check(lastAtCast === (power < 3 ? atCast : 0),
    `${label}: the range ends at ${power < 3 ? 'the trail\'s end' : '0'} until the party moves`);

  const home = { x: party.position.x, y: party.position.y };
  const away = openNeighbour(game);
  const route = [away, home, away, home];
  let from = home;
  for (const to of route) {
    game.ctx.state.tickCount += 8;
    game.systems.worldMove.moveParty(from.x, from.y, to.x, to.y);
    from = to;
  }
  const count = prints.getCount();
  const last = prints.getIndexOfLastMagicFootprint();
  console.log(`${label}: after ${route.length} moves count=${count} range=[${prints.getIndexOfFirstMagicFootprint()},${last})`);
  check(count === atCast + route.length, `${label}: each move adds a print (${count})`);
  check(last === count, `${label}: each move while the spell runs raises the range's end to the count`);

  const file = buildSaveFile(game);
  const tail = readCsbwinPartyTail(loadSaveGameState(file).characterBlock!);
  console.log(`${label}: saved tail count=${tail.numFootprintEnt} range=[${tail.indexOfFirstMagicFootprint},` +
    `${tail.indexOfLastMagicFootprint}) active=${tail.magicFootprintsActive}`);
  check(tail.numFootprintEnt === count, `${label}: the save writes the trail's count`);
  check(tail.indexOfFirstMagicFootprint === first && tail.indexOfLastMagicFootprint === last,
    `${label}: the save writes the range the walk left, [${first},${last})`);

  const loaded = loadWorld();
  applySaveBytes(loaded, file);
  check(loaded.ctx.footprints.getIndexOfFirstMagicFootprint() === first
    && loaded.ctx.footprints.getIndexOfLastMagicFootprint() === last,
  `${label}: a game loaded from the save reads the range back`);
}

/** The ring past its 24 entries: what a delete keeps, and where the magic range lands. */
function ring(): void {
  // Square `i` of a walk of distinct squares, packed as the trail packs it.
  const cell = (i: number): { x: number; y: number } => ({ x: i & 31, y: i >> 5 });
  const packed = (i: number): number => (3 << 10) | (cell(i).y << 5) | cell(i).x;
  const trail = new PartyFootprints();
  const walk = (from: number, to: number, magic: boolean): void => {
    for (let i = from; i < to; i++) trail.recordPartyMove(100 + 5 * i, 3, cell(i).x, cell(i).y, magic);
  };
  const held = (): number[] => Array.from({ length: trail.getCount() }, (_, i) => trail.getPrint(i));
  const lastOf = (end: number, n: number): number[] => Array.from({ length: n }, (_, i) => packed(end - n + i));

  walk(0, 40, false);
  console.log(`ring: after 40 moves count=${trail.getCount()} x of each print: ${held().map((p) => p & 31).join(' ')}`);
  check(trail.getCount() === 24 && held().join() === lastOf(40, 24).join(),
    'ring: a full trail is the last 24 squares walked, oldest first');

  trail.markMagicFootprints(4);
  walk(40, 45, true);
  const first = trail.getIndexOfFirstMagicFootprint();
  const last = trail.getIndexOfLastMagicFootprint();
  console.log(`ring: cast at move 40, 5 moves on: range=[${first},${last})`);
  check(held().join() === lastOf(45, 24).join(), 'ring: and still is after the cast');
  check(first === 19 && last === 24, 'ring: the range slid down to the five prints since the cast');
  const inRange = (i: number): boolean => {
    const found = trail.searchFootprints(3, cell(i).x, cell(i).y) - 1;
    return found >= first && found < last;
  };
  check([40, 41, 42, 43, 44].every(inRange) && !inRange(39) && !inRange(21),
    'ring: the five squares walked since the cast are magic, the one before it and the oldest are not');

  // Every age but the newest falls by one a call, and the oldest print goes at zero.
  const before = held();
  let calls = 0;
  while (trail.getCount() === 24 && calls < 100) {
    trail.ageFootprints();
    calls++;
  }
  console.log(`ring: ${calls} ten-second updates drop the oldest print, count=${trail.getCount()}`);
  check(trail.getCount() === 23 && held().join() === before.slice(1).join(),
    'ring: the ten-second update drops the oldest print and keeps the rest in order');
  check(trail.getIndexOfFirstMagicFootprint() === 18 && trail.getIndexOfLastMagicFootprint() === 23,
    'ring: and the magic range follows them down');
}

ring();
scenario('csbgame-early-3hero-nospace.dat', 2);
scenario('csbgame-early-3hero-nospace.dat', 4);
scenario('csbgame-early-1hero.dat', 4);
finish();
