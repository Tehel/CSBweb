/**
 * A missile flying into a teleporter.
 *
 * `MissileTimer` moves its missile into the next cell with the world
 * `MoveObject(missileFilterObject, origMapX, origMapY, curMapX, curMapY, NULL, NULL)`
 * (`doc/CSBwin-src/Timer.cpp:382-397`), which reads the direction, `d.NewDir`, off the
 * timer the missile's record names (`Code11f52.cpp:2891-2898`): inside `MissileTimer` that
 * is timer 0xffff, the copy (`Timer.cpp:224-226`, `:700-714`). Each teleporter on the way
 * turns it through `TeleportMissile` (`Code11f52.cpp:2392-2411`): an absolute one sets the
 * direction to its rotation and leaves the corner, a relative one adds its rotation to
 * both. `MissileTimer` then writes `d.NewX`, `d.NewY` and `d.NewDir` into the timer's
 * word 8, `d.NewPos` into the missile, and `d.NewLevel` into the timer.
 *
 * This takes a real active teleporter open to objects in `dungeon.dat`, sets its rotation
 * for each case, flies a fireball into it from the cell beside it, runs the one tick, and
 * compares the missile's cell, corner and direction with `TeleportMissile`'s.
 *
 * Run: `npx tsx tools/dump-missile-teleport.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType, decodeObjectID, type ObjectID } from '../src/core/types';
import { RN_FIREBALL } from '../src/core/spellRn';
import type { TeleporterRecord } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { Game } from '../src/engine/Game';
import { decodeMissileTimerWord8 } from '../src/engine/missileHelpers';
import { newGame, stockGraphics, processTimersAt } from './lib/game';
import { check, finish } from './lib/check';

const DELTA = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = newGame(data, stockGraphics());
  game.setRandomSeed(0x12345678);
  return game;
}

interface Site { teleporter: TeleporterRecord; at: Position; from: Position; direction: number; dest: Position }

/**
 * An active teleporter open to objects, whose destination is another cell, with an empty
 * floor cell beside it to fly from, towards it.
 */
function findSite(game: Game): Site {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const flag = map.cellFlags[x][y];
        if (((flag >> 5) & 7) !== RoomType.TELEPORTER || (flag & 0x08) === 0) continue;
        const at = new Position(x, y, z);
        let teleporter: TeleporterRecord | null = null;
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (decodeObjectID(rn).category === DBType.TELEPORTER) { teleporter = dungeon.getTeleporterRecord(rn); break; }
        }
        if (!teleporter || (teleporter.scope & 3) === 1) continue;
        let dest: Position | null = null;
        for (let dz = 0; dz < dungeon.getMapCount(); dz++) {
          if (dungeon.getMap(dz)!.descriptor.level === teleporter.destMap) dest = new Position(teleporter.destX, teleporter.destY, dz);
        }
        if (!dest || (dest.x === x && dest.y === y && dest.z === z)) continue;
        for (let d = 0; d < 4; d++) {
          const fx = x - DELTA[d][0];
          const fy = y - DELTA[d][1];
          if (fx < 0 || fy < 0 || fx >= map.descriptor.width || fy >= map.descriptor.height) continue;
          if (((map.cellFlags[fx][fy] >> 5) & 7) !== RoomType.OPEN) continue;
          const from = new Position(fx, fy, z);
          if (dungeon.findFirstObject(from) !== OBJECT_ID_EOF) continue;
          return { teleporter, at, from, direction: d, dest };
        }
      }
    }
  }
  throw new Error('no active object teleporter with an empty floor cell beside it');
}

function missileIn(game: Game, at: Position, index: number): ObjectID | null {
  for (let rn = game.ctx.dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    const d = decodeObjectID(rn);
    if (d.category === DBType.MISSILE && d.index === index) return rn;
  }
  return null;
}

const game = makeGame();
const tq = game.ctx.timers;
const site = findSite(game);
const at = (p: Position): string => `L${p.z}(${p.x},${p.y})`;
console.log(`teleporter at ${at(site.at)} to ${at(site.dest)}, scope ${site.teleporter.scope}; the fireball flies from ${at(site.from)}, direction ${site.direction}`);

const cases: { label: string; absolute: boolean; rotation: number; corner: number }[] = [
  { label: 'relative, rotation 1', absolute: false, rotation: 1, corner: site.direction },
  { label: 'relative, rotation 3', absolute: false, rotation: 3, corner: (site.direction + 1) & 3 },
  { label: 'absolute, rotation 2', absolute: true, rotation: 2, corner: site.direction },
];

for (const c of cases) {
  site.teleporter.absoluteRotation = c.absolute;
  site.teleporter.rotation = c.rotation;
  const before = new Set<number>();
  for (let rn = game.ctx.dungeon.findFirstObject(site.from); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) before.add(rn);
  if (!game.systems.magic.launchMissile(RN_FIREBALL, site.from.x, site.from.y, site.from.z, c.corner, site.direction, 40, 10, 1, game.ctx.state.tickCount, true)) {
    throw new Error('missile not launched');
  }
  let launched: ObjectID | null = null;
  for (let rn = game.ctx.dungeon.findFirstObject(site.from); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    if (!before.has(rn) && decodeObjectID(rn).category === DBType.MISSILE) launched = rn;
  }
  if (launched === null) throw new Error('missile not placed');
  const index = decodeObjectID(launched).index;

  processTimersAt(game, game.ctx.state.tickCount + 1);

  // `MissileTimer`: the corner it enters the next cell by (`Timer.cpp:370-377`), then
  // `TeleportMissile` (`Code11f52.cpp:2392-2411`).
  const entering = (site.direction & 1) === (c.corner & 1) ? (c.corner + 3) & 3 : (c.corner + 1) & 3;
  const wantCorner = c.absolute ? entering : (entering + c.rotation) & 3;
  const wantDir = c.absolute ? c.rotation : (site.direction + c.rotation) & 3;

  const rn = missileIn(game, site.dest, index);
  const record = game.ctx.dungeon.getMissileRecord(launched)!;
  const timer = tq.getTimer(record.timerIndex);
  const word8 = timer ? decodeMissileTimerWord8(timer.timerWord8) : null;
  const corner = rn === null ? -1 : decodeObjectID(rn).position;
  console.log(`${c.label}: corner ${c.corner} enters by ${entering}; at the destination: ${rn === null ? 'absent' : `corner ${corner}`}, `
    + `timer ${word8 ? `(${word8.x},${word8.y}) L${timer!.level} direction ${word8.dir}` : 'none'}; want corner ${wantCorner}, direction ${wantDir}`);
  check(rn !== null, `${c.label}: the fireball is in the destination's chain`);
  check(missileIn(game, site.from, index) === null && missileIn(game, site.at, index) === null,
    `${c.label}: and neither in the cell it left nor on the teleporter`);
  check(corner === wantCorner, `${c.label}: its corner is TeleportMissile's, ${wantCorner}`);
  check(timer !== null && timer.object === rn, `${c.label}: its record names its queued timer, which names it`);
  check(word8 !== null && word8.x === site.dest.x && word8.y === site.dest.y && timer!.level === site.dest.z,
    `${c.label}: the timer holds d.NewX, d.NewY and d.NewLevel`);
  check(word8?.dir === wantDir, `${c.label}: and d.NewDir, ${wantDir}`);

  if (rn !== null) game.ctx.dungeon.removeObjectFromCell(site.dest, rn);
  if (timer) tq.deleteTimer(record.timerIndex);
}

finish();
