/**
 * Prove that the monster group lifecycle actually runs.
 *
 * Loads the real dungeon, stands a `MonsterSystem` up on the party's starting level
 * and runs `ProcessMonstersOnLevel`, then reports which groups got an `ITEM16` slot
 * and what AI timer each was given. Without this there is nothing to look at: a
 * monster with a slot renders exactly like one without.
 *
 * Run: `npx tsx tools/dump-monster-activation.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { MonsterSystem } from '../src/engine/MonsterSystem';
import { TimerQueue, TimerFunction } from '../src/engine/TimerQueue';
import { CsbRandom } from '../src/core/random';
import { MonsterType } from '../src/engine/monsterTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import type { PartyState } from '../src/engine/gameTypes';

const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const GRAPHICS = 'static/gamefiles/dm-atari/graphics.dat';

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve(process.cwd(), DUNGEON))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(process.cwd(), GRAPHICS))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);

  const dungeon = new DungeonState(data);
  const start = dungeon.getStartPosition();
  const level = process.argv[2] !== undefined ? Number(process.argv[2]) : start.z;

  const party = { position: { x: start.x, y: start.y, z: level } } as PartyState;
  const timers = new TimerQueue();
  let time = 0;
  // A fixed seed: the point is a repeatable listing, not a realistic game.
  const monsters = new MonsterSystem(
    dungeon,
    () => party,
    timers,
    () => time,
    new CsbRandom(0x12345678),
    { monsterDesc: objectTables.monsterDesc },
    { trace: () => {} },
  );

  monsters.loadPartyLevel(level);

  const pool = dungeon.getItem16Pool();
  const active = pool.filter((s) => s.word0 >= 0);
  console.log(`level ${level}: ${active.length} monster group(s) activated, pool size ${pool.length}`);
  console.log('');
  console.log(['slot', 'db4', 'type', 'name', 'n', 'at', 'facings', 'positions', 'sms'].join('\t'));
  pool.forEach((slot, index) => {
    if (slot.word0 < 0) return;
    const rec = dungeon.getCreatureRecordByIndex(slot.word0);
    if (!rec) return;
    console.log([
      index,
      slot.word0,
      rec.creatureType,
      MonsterType[rec.creatureType] ?? '?',
      (rec.numMonM1 & 3) + 1,
      `(${slot.uByte10},${slot.uByte11})`,
      '0x' + slot.facings.toString(16).padStart(2, '0'),
      '0x' + slot.positions.toString(16).padStart(2, '0'),
      slot.singleMonsterStatus.map((v) => v.toString(16).padStart(2, '0')).join(' '),
    ].join('\t'));
  });

  const aiTimers = timers.getTimers().filter(
    (t) => t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI,
  );
  console.log('');
  console.log(`${aiTimers.length} monster AI timer(s) queued:`);
  for (const t of aiTimers) {
    console.log(
      `  t=${t.time} L${t.level} (${t.uByte6},${t.uByte7}) fn=${TimerFunction[t.function] ?? t.function} uByte5=${t.uByte5}`,
    );
  }

  // Every group must have exactly one timer, and no monster may keep a stale slot.
  const bad: string[] = [];
  if (aiTimers.length !== active.length) {
    bad.push(`timer count ${aiTimers.length} != active group count ${active.length}`);
  }
  for (const slot of active) {
    const rec = dungeon.getCreatureRecordByIndex(slot.word0);
    if (!rec) { bad.push(`slot for db4 ${slot.word0} has no record`); continue; }
    if (dungeon.getAttachedItem16(rec) !== slot) {
      bad.push(`db4 ${slot.word0} groupIndex ${rec.groupIndex} does not point back at its slot`);
    }
  }
  console.log('');
  console.log(bad.length === 0 ? 'CONSISTENT' : 'PROBLEMS:\n  ' + bad.join('\n  '));
}

main();
