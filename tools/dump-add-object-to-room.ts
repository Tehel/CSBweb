/**
 * `AddObjectToRoom` with a cell (`doc/CSBwin-src/Code11f52.cpp:427`), as
 * `DungeonState.addObjectToCell`.
 *
 * CSBWin clears the new object's link before either arm (`:463`), so whichever way the
 * object joins the cell it ends its chain: as the first object of a cell that had none
 * (`:490-517`), as the object stuffed into an `RNeof` root (`:476-488`), or behind the last
 * object of the cell's chain (`:526-534`). Each scenario hands it an object whose link is
 * still live (the head of a chain of two or more in `dungeon.dat`) and checks that the
 * cell's chain is exactly what was there, then that object, then `RNeof`.
 *
 * Run: `npm test -- --only=dump-add-object-to-room.ts`
 */
import { OBJECT_ID_EOF, Position } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonState } from '../src/engine/DungeonState';
import { check, finish } from './lib/check';
import { stockDungeon } from './lib/game';

const hex = (rn: number): string => rn.toString(16).padStart(4, '0');

function main(): void {
  const data = stockDungeon();
  const dungeon = new DungeonState(data);

  const chainOf = (p: Position): ObjectID[] => {
    const out: ObjectID[] = [];
    for (let rn = dungeon.findFirstObject(p); rn !== OBJECT_ID_EOF && out.length < 1000; rn = dungeon.getDBRecordLink(rn)) {
      out.push(rn);
    }
    return out;
  };

  // Every cell of level 0, split into the empty ones and those whose chain has two or more.
  const map = dungeon.getMap(0);
  if (!map) throw new Error('no level 0');
  const empty: Position[] = [];
  const long: Position[] = [];
  const single: Position[] = [];
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      const p = new Position(x, y, 0);
      if ((dungeon.getCellFlag(p) & 0x10) === 0) empty.push(p);
      else if (chainOf(p).length >= 2) long.push(p);
      else single.push(p);
    }
  }
  check(empty.length > 0 && long.length >= 4 && single.length > 0,
    `level 0 has an empty cell, four chains of two or more and a single (${empty.length}, ${long.length}, ${single.length})`);

  // Take a chain's head off its cell, its link left as it was: the object to add.
  const linkedObject = (p: Position): ObjectID => {
    const head = dungeon.findFirstObject(p);
    dungeon.setFirstObject(p, dungeon.getDBRecordLink(head));
    check(dungeon.getDBRecordLink(head) !== OBJECT_ID_EOF, `${hex(head)} still links on (${hex(dungeon.getDBRecordLink(head))})`);
    return head;
  };

  const expectChain = (p: Position, expected: ObjectID[], what: string): void => {
    const got = chainOf(p);
    const ok = got.length === expected.length && got.every((rn, i) => rn === expected[i]);
    console.log(`  ${what}: ${got.map(hex).join(' ')}`);
    check(ok, `${what}: the chain is ${expected.map(hex).join(' ')} then RNeof, got ${got.map(hex).join(' ')}`);
  };

  // `:490-517`: the first object of a cell that had none.
  {
    const cell = empty[0]!;
    const obj = linkedObject(long[0]!);
    check(dungeon.addObjectToCell(cell, obj), 'the add onto the empty cell succeeds');
    expectChain(cell, [obj], `new root at (${cell.x},${cell.y})`);
  }

  // `:476-488`: the cell's flag says objects, its root is `RNeof`.
  {
    const cell = single[0]!;
    dungeon.setFirstObject(cell, OBJECT_ID_EOF);
    const obj = linkedObject(long[1]!);
    check(dungeon.addObjectToCell(cell, obj), 'the add onto the RNeof root succeeds');
    expectChain(cell, [obj], `RNeof root at (${cell.x},${cell.y})`);
  }

  // `:526-534`: behind the last object of the cell's chain.
  {
    const cell = long[2]!;
    const before = chainOf(cell);
    const obj = linkedObject(long[3]!);
    check(dungeon.addObjectToCell(cell, obj), 'the append succeeds');
    expectChain(cell, [...before, obj], `append at (${cell.x},${cell.y})`);
  }

  finish();
}

main();
