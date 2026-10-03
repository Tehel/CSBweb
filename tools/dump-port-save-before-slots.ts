/**
 * A save the port wrote before its RNs were CSBWin's slots loads, mended
 * (`mendDoorZero`, `src/data/CsbwinDungeonImage.ts`).
 *
 * `tools/fixtures/port/dmweb-before-slots.dat` is `csbgame-early-1hero.dat` loaded and
 * saved again by that writer, at `aa4618b`. Its maps give every record a slot from 1 and
 * leave slot 0 free, `0xff`/`0xffff`, and it wrote door 0 in corner 0, the packed RN 0,
 * as 0, which `checkIndirectIndex` refuses. The checks:
 *
 * - the fixture carries both marks, read straight from the file;
 * - it loads, and every cell's chain names the same records in the same corners as the
 *   CSBWin save it was made from, door 0 as slot 1 at the head of its cell's chain;
 * - the party is the same, it plays 300 ticks, and the port's save of it reads back with
 *   CSBWin's slot 0, `0`/`0`, and no 0 in its object list.
 *
 * It lives under `tools/fixtures/port/`, out of `genuineSaves()`' sight: it is not
 * CSBWin's.
 *
 * Run: `npx tsx tools/dump-port-save-before-slots.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readU16BE } from '../src/core/bytes';
import { Position, type ObjectID } from '../src/core/types';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import type { DungeonState } from '../src/engine/DungeonState';
import type { Game } from '../src/engine/Game';
import { applySaveBytes, buildSaveFile } from '../src/engine/SaveGameFile';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';
import { savePath } from './lib/saves';

const FIXTURE = resolve('tools/fixtures/port/dmweb-before-slots.dat');
const SOURCE = savePath('csbgame-early-1hero.dat');

function newDmGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  return newGame(data, stockGraphics());
}

/** The 0s in a file's object list, read from its bytes, and its slot 0. */
function rawMarks(bytes: Uint8Array): { zeros: number[]; slot0: [number, number] } {
  const save = loadSaveGameState(bytes);
  const layout = save.imageLayout;
  const index = save.objectIndex;
  if (!layout || !index) throw new Error('no image layout or object index');
  const zeros: number[] = [];
  for (let i = 0; i < layout.objectListSize; i++) {
    if (readU16BE(bytes, layout.objectList + i * 2) === 0) zeros.push(i);
  }
  return { zeros, slot0: [index.typeMap[0], index.indexMap[0]] };
}

/** Every cell's chain as `db:idx@pos`, level by level. */
function chains(dungeon: DungeonState): string[] {
  const lines: string[] = [];
  const { maps } = dungeon.getData();
  maps.forEach((map, z) => {
    if (!map) return;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const objects: string[] = [];
        for (let rn = dungeon.findFirstObject(new Position(x, y, z)); rn !== 0xfffe; rn = dungeon.getDBRecordLink(rn)) {
          objects.push(`${dungeon.rnMaps.dbType(rn)}:${dungeon.rnMaps.idx(rn)}@${dungeon.rnMaps.pos(rn)}`);
        }
        if (objects.length) lines.push(`${z} (${x},${y}) ${objects.join(' ')}`);
      }
    }
  });
  return lines;
}

function party(game: Game): string {
  const s = game.ctx.party.state;
  return `${s.champions.map((c) => c.name).join(',')} at (${s.position.x},${s.position.y}) L${s.position.z} facing ${s.facing}`;
}

function main(): void {
  const fixture = new Uint8Array(readFileSync(FIXTURE));

  // --- the old writer's marks ---------------------------------------------------
  const marks = rawMarks(fixture);
  console.log(`fixture: slot 0 ${marks.slot0.map((v) => '0x' + v.toString(16)).join('/')}, 0 in the object list at ${marks.zeros.join(', ')}`);
  check(marks.slot0[0] === 0xff && marks.slot0[1] === 0xffff, 'the fixture leaves slot 0 free, as the old writer did');
  check(marks.zeros.length === 1, 'the fixture writes door 0 as 0 in one object list entry');

  // --- loaded, mended --------------------------------------------------------------
  const world = loadCsbwinWorld(fixture);
  const maps = world.dungeon.rnMaps;
  const entry = marks.zeros[0] ?? 0;
  const head = world.dungeon.objectList[entry] as ObjectID;
  console.log(`object list ${entry}: slot ${head}, database ${maps.dbType(head)} record ${maps.idx(head)} corner ${maps.pos(head)}`);
  check(head === 1 && maps.dbType(head) === 0 && maps.idx(head) === 0 && maps.pos(head) === 0,
    'the entry is slot 1, door 0 in corner 0');
  check(world.save.objectIndex?.typeMap[0] === 0 && world.save.objectIndex?.indexMap[0] === 0, "slot 0 becomes CSBWin's, 0/0");

  const mended = newDmGame();
  applySaveBytes(mended, fixture);
  const genuine = newDmGame();
  applySaveBytes(genuine, new Uint8Array(readFileSync(SOURCE)));

  const a = chains(mended.ctx.dungeon);
  const b = chains(genuine.ctx.dungeon);
  const differ = a.filter((line, i) => line !== b[i]).length + Math.abs(a.length - b.length);
  console.log(`${a.length} cells hold objects; ${differ} differ from ${SOURCE.split('/').pop()}`);
  check(a.length > 0 && differ === 0, 'every chain names the records and corners of the CSBWin save');
  console.log(`party: ${party(mended)}`);
  check(party(mended) === party(genuine), 'the party is the CSBWin save\'s');

  // --- played, saved again -------------------------------------------------------
  for (let i = 0; i < 300; i++) (mended as unknown as { gameTick(): void }).gameTick();
  const again = buildSaveFile(mended);
  const marksAgain = rawMarks(again);
  check(marksAgain.slot0[0] === 0 && marksAgain.slot0[1] === 0 && marksAgain.zeros.length === 0,
    "after 300 ticks the port's save has CSBWin's slot 0 and no 0 in its object list");
  const reread = newDmGame();
  applySaveBytes(reread, again);
  check(chains(reread.ctx.dungeon).join('\n') === chains(mended.ctx.dungeon).join('\n'), 'and reads back the same chains');

  finish();
}

main();
