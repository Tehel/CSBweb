/**
 * The map dialog's info of a square (`src/engine/CellInfo.ts`), on squares whose answers
 * are known from the data (`tools/peek-dungeon.ts cell`):
 *
 * 1. **A lock** on DM's level 2, (3,4): a topaz key, taken, opens the door at (4,5); the
 *    two topaz keys of the dungeon, on level 2 and level 12, are links. The door names the
 *    lock as what acts on it.
 * 2. **The key in hand**: with the topaz key of level 2 in the party's hand, it is listed
 *    at the party's square as the party's.
 * 3. **Where squares lead**: a teleporter's destination, and the teleporter among what
 *    arrives there; stairs and a pit's destination, `IncrementLevel`'s
 *    (`doc/CSBwin-src/CSBCode.cpp:4774`). A teleporter's turn, and a rotator, one sending
 *    to its own square, on level 3 only turning: right at (3,4), left at (5,0), to face south at (5,4)
 *    (`doc/CSBwin-src/Code11f52.cpp:3002-3012`).
 * 4. **A held pad, normally closed**: (25,3) closes the pit at (24,5) while pressed
 *    (`PressurePadOrAlcove`, `doc/CSBwin-src/Code11f52.cpp:3878-3895`).
 * 5. **A door's button**.
 * 6. **What has no target**: a local action, a generator and the launchers are no
 *    sender (`doc/CSBwin-src/CSB.h:1014-1023`).
 * 7. **A DSA**: Conflux 3.5's (4,0) of map 1 shows its description and state.
 * 8. **A generator**: DM's (5,12) of map 9 makes 1 to 4 flying eyes, its delay 12 (bit 3
 *    and 4), then rests 512 ticks, its disable time 134 (`doc/CSBwin-src/Timer.cpp:1771-1820`).
 *
 * Run: `npm test -- --only=map-cell-info.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../../src/core/types';
import type { ActuatorRecord } from '../../src/data/dungeonTypes';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { CellInfo, actuatorHasTarget, type CellRef, type InfoLine } from '../../src/engine/CellInfo';
import { DungeonState, NO_GAME } from '../../src/engine/DungeonState';
import { nameIndexOf } from '../../src/engine/GameContext';
import { check, finish } from '../lib/check';
import { gameTablesOf, graphicsTablesOf, stockGame, stockGraphics } from '../lib/game';

const CONFLUX = 'tools/fixtures/gamefiles/conflux-3.5-b8/dungeon.dat';

function show(at: CellRef, lines: readonly InfoLine[]): void {
  console.log(`map ${at.map} (${at.x},${at.y}):`);
  for (const l of lines) {
    console.log(`  ${'  '.repeat(l.indent)}${l.text}${l.link ? `  -> map ${l.link.map} (${l.link.x},${l.link.y})` : ''}`);
  }
}

const same = (a: CellRef | undefined, b: CellRef): boolean => !!a && a.map === b.map && a.x === b.x && a.y === b.y;

/** The line holding `text`, and with the link `link` when given. */
function line(lines: readonly InfoLine[], text: string, link?: CellRef): InfoLine | undefined {
  return lines.find((l) => l.text.includes(text) && (!link || same(l.link, link)));
}

function main(): void {
  const game = stockGame();
  const { ctx } = game;
  const objectNames = graphicsTablesOf(stockGraphics()).objects.objectNames;
  const info = (): CellInfo => new CellInfo({ dungeon: ctx.dungeon, tables: ctx.tables, objectNames, party: ctx.party.state });
  const describe = (map: number, x: number, y: number): InfoLine[] => {
    const at = { map, x, y };
    const lines = info().describe(at);
    show(at, lines);
    return lines;
  };

  // 1. The lock and its door.
  const lock = describe(1, 3, 4);
  check(!!line(lock, 'S side: Lock: a TOPAZ KEY, taken'), 'the lock at (3,4) takes a topaz key, on its south side');
  check(!!line(lock, 'Opens door (4,5)', { map: 1, x: 4, y: 5 }), 'it opens the door at (4,5), a link');
  check(!!line(lock, 'L2 (1,9)', { map: 1, x: 1, y: 9 }) && !!line(lock, 'L12 (19,21)', { map: 11, x: 19, y: 21 }),
    'the topaz keys of level 2 (1,9) and level 12 (19,21) are links');
  const door = describe(1, 4, 5);
  check(door[0]?.text === '(4,5) Door, closed', 'the door at (4,5) is closed');
  check(!!line(door, '(3,4) S side: Lock', { map: 1, x: 3, y: 4 }), 'the door is acted on by the lock at (3,4)');

  // 2. The key in the party's hand.
  const keySquare = new Position(1, 9, 1);
  let key = OBJECT_ID_EOF as ObjectID;
  for (let rn = ctx.dungeon.findFirstObject(keySquare); rn !== OBJECT_ID_EOF; rn = ctx.dungeon.getDBRecordLink(rn)) {
    if (objectNames[nameIndexOf(ctx, rn)] === 'TOPAZ KEY') key = rn;
  }
  check(key !== OBJECT_ID_EOF, 'the topaz key lies at (1,9) of map 1');
  ctx.dungeon.removeObjectFromCell(keySquare, key);
  ctx.party.state.objectInHand = key;
  const party = ctx.party.state.position;
  const inHand = describe(1, 3, 4);
  check(!!line(inHand, 'the party has it', { map: party.z, x: party.x, y: party.y }), 'the key in hand is the party\'s, at its square');
  check(!line(inHand, 'L2 (1,9)'), 'and no longer at (1,9)');

  // 3. Where squares lead.
  const teleporter = describe(1, 30, 3);
  check(!!line(teleporter, 'Sends everything to L2 (30,1)', { map: 1, x: 30, y: 1 }), 'the teleporter at (30,3) sends everything to (30,1)');
  check(!!line(describe(1, 30, 1), 'L2 (30,3)', { map: 1, x: 30, y: 3 }), '(30,1) names the teleporter at (30,3) among its arrivals');
  check(!!line(describe(1, 31, 1), 'Sends everything to L2 (29,4), facing E', { map: 1, x: 29, y: 4 }), 'the teleporter at (31,1) sends everything to (29,4), facing east');
  const right = describe(2, 3, 4);
  check(right[0]?.text === '(3,4) Rotator, on, invisible', 'the teleporter at (3,4) of level 3, to its own square, is a rotator');
  check(!!line(right, 'Turns everything right') && !line(right, 'Sends') && !line(right, 'Teleporters to here'),
    'the teleporter at (3,4) of level 3, to its own square, only turns everything right, and is no arrival of its own');
  check(!!line(describe(2, 5, 0), 'Turns everything left'), 'the one at (5,0) turns everything left');
  check(!!line(describe(2, 5, 4), 'Turns everything to face S'), 'the one at (5,4) turns everything to face south');
  const up = ctx.dungeon.incrementLevel(new Position(3, 1, 1), -1)!;
  check(!!line(describe(1, 3, 1), 'Leads to L1', { map: up.z, x: up.x, y: up.y }), `the stairs up at (3,1) lead to IncrementLevel's (${up.x},${up.y}) of map ${up.z}`);
  const down = ctx.dungeon.incrementLevel(new Position(24, 5, 1), 1)!;
  const pit = describe(1, 24, 5);
  check(!!line(pit, 'Falls to L3', { map: down.z, x: down.x, y: down.y }), `the pit at (24,5) falls to IncrementLevel's (${down.x},${down.y}) of map ${down.z}`);

  // 4. The held pad.
  check(!!line(pit, '(25,3): Pad: party, monster or item', { map: 1, x: 25, y: 3 }) && !!line(pit, 'Closes pit while pressed'),
    'the pad at (25,3), normally closed and held, closes the pit while pressed');

  // 5. A door's button.
  check(!!line(describe(1, 1, 0), 'Has a button'), 'the door at (1,0) has a button');

  // 6. What has no target.
  const actuator = (type: number, word4 = 0): ActuatorRecord => ({ word2: type, word4, word6: 0x2980 }) as unknown as ActuatorRecord;
  check(!actuatorHasTarget(actuator(6), RoomType.OPEN), 'a generator has no target');
  check([7, 8, 9, 10, 14, 15].every((t) => !actuatorHasTarget(actuator(t), RoomType.STONE)), 'a launcher has no target');
  check(!actuatorHasTarget(actuator(1, 0x800), RoomType.OPEN), 'a local action has no target');
  check(actuatorHasTarget(actuator(4), RoomType.STONE) && actuatorHasTarget(actuator(3), RoomType.OPEN), 'a lock and a pad have one');

  // 7. A DSA.
  const conflux = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(CONFLUX))));
  const dsa = new CellInfo({ dungeon: new DungeonState(conflux, NO_GAME), tables: gameTablesOf(stockGraphics()), objectNames, party: null });
  const at = { map: 1, x: 4, y: 0 };
  const lines = dsa.describe(at);
  show(at, lines);
  check(!!line(lines, 'E side: Script "Decoration AB", state 0'), 'Conflux\'s DSA at (4,0) of map 1 shows its description and state');

  // 8. A generator.
  check(!!line(describe(9, 5, 12), 'Generator: 1 to 4 x Flying eye, then off 512 ticks'),
    'the generator at (5,12) of map 9 makes 1 to 4 flying eyes, then rests 512 ticks');

  finish();
}

main();
