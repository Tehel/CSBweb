/**
 * Prove YA BRO ROS marks the trail the party walks, and that a save carries that mark.
 *
 * CSBWin holds the trail's count and the magic range's two ends once each, in `d.`:
 *
 * - the spell starts the range at the trail's end, `d.IndexOfFirstMagicFootprint =
 *   d.NumFootprintEnt`, and closes it there for a spell power under 3 or sets its end to
 *   0 otherwise (`doc/CSBwin-src/Magic.cpp:1331-1342`);
 * - each party move while `d.MagicFootprintsActive` raises the end to the new count
 *   (`Code11f52.cpp:3237-3241`);
 * - the save writes the count and both ends into the party tail beside the trail.
 *
 * So a party that casts, then walks four squares, saves the range from the count at the
 * cast to the count after the walk, whatever the spell's power, and a game loaded from
 * that save reads the same range back.
 *
 * The party is the one of `csbgame-early-3hero-nospace.dat`, a genuine CSBWin save whose
 * trail holds three prints, so the walk leaves the ring short of its 24.
 *
 * Run: `npx tsx tools/dump-magic-footprints.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { RoomType } from '../src/core/types';
import { readCsbwinPartyTail } from '../src/data/CsbwinCharacters';
import { applyCsbwinSave } from '../src/data/CsbwinSaveGame';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import type { Game } from '../src/engine/Game';
import { applySaveBytes, buildSavePayload, decodeBase64ToBytes, encodeSavePayload } from '../src/engine/SaveGamePayload';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';

const SAVE = 'static/gamefiles/saves/csbgame-early-3hero-nospace.dat';

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
  const { x, y, z } = game.party.state.position;
  const map = game.dungeonState.getMap(z)!;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= map.descriptor.width || ny >= map.descriptor.height) continue;
    if (((map.cellFlags[nx]![ny]! >> 5) & 7) === RoomType.OPEN) return { x: nx, y: ny };
  }
  throw new Error('no open square beside the party');
}

function scenario(power: number): void {
  const label = `power ${power}`;
  const game = loadWorld();
  applyCsbwinSave(game, new Uint8Array(readFileSync(resolve(SAVE))));
  const prints = game.footprints;
  const party = game.party.state;

  // A caster who masters the spell at any power: no fizzle, no random draw.
  const caster = party.champions[0]!;
  for (const skill of caster.skills as unknown as Array<{ experience: number }>) skill.experience = 500000;
  caster.incantation = [0x5f + power, ...YA_BRO_ROS];
  const atCast = prints.getCount();
  const cast = (game.magic as unknown as { castMagic(i: number): number }).castMagic(0);
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
    game.state.tickCount += 8;
    game.worldMove.moveParty(from.x, from.y, to.x, to.y);
    from = to;
  }
  const count = prints.getCount();
  const last = prints.getIndexOfLastMagicFootprint();
  console.log(`${label}: after ${route.length} moves count=${count} range=[${prints.getIndexOfFirstMagicFootprint()},${last})`);
  check(count === atCast + route.length, `${label}: each move adds a print (${count})`);
  check(last === count, `${label}: each move while the spell runs raises the range's end to the count`);

  const payload = buildSavePayload(game);
  const tail = readCsbwinPartyTail(loadSaveGameState(decodeBase64ToBytes(payload.raw)).characterBlock!);
  console.log(`${label}: saved tail count=${tail.numFootprintEnt} range=[${tail.indexOfFirstMagicFootprint},` +
    `${tail.indexOfLastMagicFootprint}) active=${tail.magicFootprintsActive}`);
  check(tail.numFootprintEnt === count, `${label}: the save writes the trail's count`);
  check(tail.indexOfFirstMagicFootprint === first && tail.indexOfLastMagicFootprint === last,
    `${label}: the save writes the range the walk left, [${first},${last})`);

  const loaded = loadWorld();
  applySaveBytes(loaded, encodeSavePayload(payload));
  check(loaded.footprints.getIndexOfFirstMagicFootprint() === first
    && loaded.footprints.getIndexOfLastMagicFootprint() === last,
  `${label}: a game loaded from the save reads the range back`);
}

scenario(2);
scenario(4);
finish();
