/**
 * Prove a CSBWin save restores its **timer queue** — and that the world then moves.
 *
 * No save of any kind used to carry this. `Game.buildTimerRecords` wrote one field per
 * timer, `timerWord8`, and `parseTimers` read the same one, so a load knew *what* a
 * timer was about but never *when* it was due. A door caught mid-close stayed where it
 * was for ever; only the monster movement timers came back, and only because
 * `reloadAfterSaveGame` re-creates them from the creature records.
 *
 * The evidence rests on two save files made to order, and on the fact that they are
 * nearly identical. `csbgame4-door-opening.dat` and `csbgame4-door-closing.dat` are both
 * a fresh game on level 0 with the party at (1,15) facing north, one step from the door
 * at (1,14), each saved while that door was in motion. They carry **two timers each**,
 * and the door timer's records differ in one byte:
 *
 * ```
 * opening  00 00 01 5d  01 00 01 0e 00 00  00 33 00 cd cd cd
 * closing  00 00 00 fd  01 00 01 0e 00 01  00 19 00 cd cd cd
 *          |m_time   |  |fn |u5 |x  |y  |u8 |u9| |seq | |lvl
 * ```
 *
 * `fn` is 1, `TT_DOOR_STEP`; `x`,`y` are 1 and 14; `u9` is the action, 0 in one file and
 * 1 in the other; the 0xcd tail is `TIMER`'s constructor fill
 * (`doc/CSBwin-src/CSB.h:1805-1816`), which is itself a check that byte 12 really is the
 * level and 13-15 really are unused.
 *
 * That is `TIMER` read exactly as `doc/CSBwin-src/CSB.h:1799-2052` declares it: a
 * big-endian `m_time`, the function, five bytes, a big-endian sequence, the level. The
 * door's map coordinates land on the cell the party is facing, and the one byte that
 * differs between the two files is the one CSBWin's own comment calls the action. If any
 * field were read at the wrong offset none of that would line up.
 *
 * Then the part that a parser cannot fake: each save is restored into a real `Game`, the
 * clock is turned, and the door's own cell flag is watched. One file's door must open
 * and the other's must close, from the same starting state, driven by nothing but the
 * byte that differs.
 *
 * Run: `npx tsx tools/dump-csbwin-timers.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { applyCsbwinSave } from '../src/data/CsbwinSaveGame';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';

const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const GRAPHICS = 'static/gamefiles/dm-atari/graphics.dat';
const SAVES = 'static/gamefiles/saves';

/** The door these two saves were made around, and the cell the party faces. */
const DOOR = { x: 1, y: 14, level: 0 };

function loadWorld(): Game {
  const data = new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON))));
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(GRAPHICS))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);
  return new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
    },
  );
}

/**
 * The door's state, `CELLFLAG` bits 0-2. **0 is fully open and 4 fully shut** — the
 * count is how far the door has come *down*, not how far it has risen
 * (`doc/CSBwin-src/CSBTypes.h:185-192`: "00 = open, 01 = almost open, 02 = half open,
 * 03 = almost closed, 04 = closed, 05 = bashed open"). Both saves start at 2.
 */
function doorState(game: Game): number {
  return game.dungeonState.getCellFlag(new Position(DOOR.x, DOOR.y, DOOR.level)) & 0x7;
}

/** Turn the clock one tick at a time, the way `Game.update` does. */
function advance(game: Game, ticks: number): void {
  const state = game as unknown as { state: { tickCount: number } };
  for (let i = 0; i < ticks; i++) {
    state.state.tickCount++;
    game.timerSystem.processTimers(state.state.tickCount);
  }
}

function main(): void {
  const cases: Array<{ file: string; action: number; label: string }> = [
    { file: 'csbgame4-door-opening.dat', action: 0, label: 'opening' },
    { file: 'csbgame4-door-closing.dat', action: 1, label: 'closing' },
  ];

  /* ---- the records, straight out of the file ---- */

  console.log(['file', 'idx', 'time', 'fn', 'u5', 'x', 'y', 'u8', 'u9', 'seq', 'lvl'].join('\t'));
  const seen: Array<{ label: string; action: number; before: number }> = [];

  for (const { file, action, label } of cases) {
    const bytes = new Uint8Array(readFileSync(resolve(SAVES, file)));
    const save = loadSaveGameState(bytes);
    const queue = save.timerQueue ?? [];
    const gb2 = save.block2;
    if (!gb2) { check(false, `${file}: GAMEBLOCK2 should be present`); continue; }

    for (const index of queue) {
      const t = save.timers?.[index];
      if (!t) { check(false, `${file}: queue names timer ${index}, which is not in the table`); continue; }
      console.log([file, index, t.time, t.function, t.uByte5, t.uByte6, t.uByte7, t.uByte8, t.uByte9, t.sequence, t.level].join('\t'));
    }

    check(queue.length === gb2.numTimer, `${file}: the queue holds gb2.NumTimer entries (${queue.length} vs ${gb2.numTimer})`);
    check(queue.length > 0, `${file}: the queue is not empty`);
    check(
      (save.timers?.length ?? 0) === save.maxTimers,
      `${file}: the timer table is MaxTimers long`,
    );

    // The queue *is* the firing order — CSBWin keeps it sorted as it inserts and
    // restores it verbatim (`doc/CSBwin-src/SaveGame.cpp:1687-1723`).
    let ordered = true;
    for (let i = 1; i < queue.length; i++) {
      const a = save.timers?.[queue[i - 1]];
      const b = save.timers?.[queue[i]];
      if (a && b && a.time > b.time) ordered = false;
    }
    check(ordered, `${file}: the queue is in non-decreasing time order`);

    const door = (save.timers ?? []).filter(
      (t, i) => queue.includes(i) && t.function === TimerFunction.TT_DOOR_STEP,
    );
    check(door.length === 1, `${file}: exactly one TT_DOOR_STEP timer is queued`);
    const t = door[0];
    if (!t) continue;

    // The door the party is standing in front of. `gb2` says (1,15) facing north, so
    // the cell one step ahead is (1,14) — which is what the timer names.
    check(t.uByte6 === DOOR.x && t.uByte7 === DOOR.y,
      `${file}: the door timer names cell (${t.uByte6},${t.uByte7}), expected (${DOOR.x},${DOOR.y})`);
    check(t.uByte6 === gb2.partyX && t.uByte7 === gb2.partyY - 1,
      `${file}: and that cell is the one the party faces`);
    check(t.level === gb2.partyLevel, `${file}: on the party's own level`);
    check(t.uByte9 === action, `${file}: uByte9 is ${t.uByte9}, the ${label} action`);
    // Sequence numbers are stamped from a counter GAMEBLOCK2 also carries, so every
    // queued timer must have been stamped before the next one to be handed out.
    check(
      (save.timers ?? []).every((r, i) => !queue.includes(i) || r.sequence < gb2.timerSequence),
      `${file}: every queued timer's sequence is below gb2.TimerSequence (${gb2.timerSequence})`,
    );

    /* ---- and now the world actually moves ---- */

    const game = loadWorld();
    applyCsbwinSave(game, bytes);

    const restored = game.timerQueue.getTimers();
    check(restored.length === queue.length, `${file}: the live queue holds ${queue.length} timers`);
    check(
      restored.map((e) => e.index).join(',') === queue.join(','),
      `${file}: in the file's own order, with the file's own indices`,
    );
    check(
      game.timerQueue.getNextSequence() === gb2.timerSequence,
      `${file}: the sequence counter continues from gb2.TimerSequence`,
    );

    const before = doorState(game);
    advance(game, 40);
    const after = doorState(game);
    console.log(`  ${file}: door at (${DOOR.x},${DOOR.y}) went ${before} -> ${after} over 40 ticks`);

    check(before === 2, `${file}: the door starts half way (state ${before})`);
    if (action === 0) {
      check(after < before, `${file}: the door opened (${before} -> ${after})`);
      check(after === 0, `${file}: and reached fully open`);
    } else {
      check(after > before, `${file}: the door closed (${before} -> ${after})`);
      check(after === 4, `${file}: and reached fully shut`);
    }
    seen.push({ label, action, before });
  }

  check(seen.length === 2, 'both door saves were read');

  // The vacuity guard, and the sharpest thing here: the two files start the door in a
  // comparable state and end in opposite ones. Nothing but the timer they carry can
  // account for that — the dungeon, the party and the cell are the same in both.
  check(
    seen.length === 2 && seen[0].action !== seen[1].action,
    'the two saves carry opposite door actions',
  );

  // A world loaded with no timer queue at all would leave the door where it is, which
  // is what every load did before this. Prove the control case.
  const idle = loadWorld();
  const idleBefore = doorState(idle);
  advance(idle, 40);
  check(
    doorState(idle) === idleBefore,
    `a fresh dungeon.dat leaves the door alone (${idleBefore} -> ${doorState(idle)})`,
  );

  finish();
}

main();
