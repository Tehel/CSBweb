/**
 * The live path: a running game writes a **whole** CSBWin save file, and it loads back.
 *
 * `tools/dump-save-file-roundtrip.ts` drives the same sixteen blocks from a **parsed
 * save** — bytes CSBWin wrote, re-serialised. This one starts where the game does: a
 * real `Game` on `dungeon.dat`, played, with `buildSavePayload` writing the file the
 * disk menu and F5 write. Until the three load-time conversions were ported that was
 * impossible, and `saveSaveGameState` emitted a blocks 0-6 prefix no reader can load.
 *
 * **Why it is a round trip and not a byte comparison, in either direction.** There is
 * nothing to compare against: no CSBWin file exists for a game this port played, and
 * our own file cannot be compared with itself usefully, because the object indirect
 * index is ours — `buildObjectIndirectIndex` numbers slots its own way (see
 * `src/data/CsbwinObjectIndex.ts`), so the same world written twice from two different
 * numberings is two different byte strings that both mean the same thing. So the claim
 * this tool makes is: **the file parses as a whole**, and **the world comes back**. The
 * closure check in `loadCsbwinWorld` is what makes the first half sharp — the cell flag
 * array has to end exactly two bytes before the file does, which it only can if every
 * one of the eight image sections was written at the length the header declares.
 *
 * Two scenarios, because they exercise different halves:
 *
 *  1. **From `dungeon.dat`.** Champions added at two Hall of Champions mirrors, the
 *     party walked, an object taken onto the cursor and thrown, the missile flown for a
 *     few ticks and a second object left on the cursor at the moment of the save. This
 *     is the path that only works because the world is converted on load: a
 *     `dungeon.dat`-shaped image cannot be written into a file whose header declares
 *     `IndirectText` and `BigActuators`.
 *  2. **From `csbgame7.dat`**, played on. It carries live monsters, `ITEM16` groups and
 *     a full timer table, none of which scenario 1 produces, and its world came out of
 *     a file rather than out of `dungeon.dat` — so it is also the case where the four
 *     fields `DungeonSnapshot` had to start carrying (`expool` above all) decide whether
 *     the written image is the save's world or the dungeon the engine booted on.
 *
 * The thrown object is not decoration. A missile in flight is a `MISSILE` record plus a
 * **timer carrying an object RN in bytes 6-7**, and a timer's object is the one
 * reference nothing else in the writer reaches — `TIMER` bytes 6-9 are plain numbers to
 * every other timer function, so `buildSavePayload` has to translate them by hand
 * (`doc/PROVEN_FACTS.md` → "Everything CSBWin converts to slot numbers, and in what
 * order"). Get it wrong and the sword lands on whatever record our slot of the same
 * number happens to be.
 *
 * **What can be canaried, and what cannot.** Blanking any of these fails this tool: the
 * possession pass over `heldReferences`, `sequencedTimers`/`extendedTimers` (the header
 * then declares a 16-byte `TIMER` over a 10-byte block and the file will not parse),
 * `cellFlagArraySize`, the `BigActuators` flag, `GAMEBLOCK2.ObjectInHand`, and resolving
 * a timer's object RN on the way back in. Withholding the **timer** pass over
 * `heldReferences` fails nothing, and the reason is worth writing down rather than
 * leaving as a hole: a missile in flight is linked into a cell by `addObjectToCell`, so
 * the chain pass has already recorded its position, and `buildObjectIndirectIndex` gives
 * every record of every database a slot whether anything references it or not. The pass
 * is CSBWin's and is kept because CSBWin has it, not because this dungeon needs it.
 *
 * `GAMEBLOCK1` travels too: `d.RandomGameID`, `totalMoveCount`, `d.Word22592`-`22598`
 * and `d.Byte22808` come back, `SaveOption` is SAVE AND PLAY's 1, and a third section
 * takes `LoadGame`'s branch for an Atari DM save, which no committed save does
 * (`doc/CSBwin-src/SaveGame.cpp:1861-1877`).
 *
 * Run: `npx tsx tools/dump-live-save-file.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Direction, OBJECT_ID_EOF, OBJECT_ID_NULL, Position,
} from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { applyCsbwinSave, buildCsbwinRuntimeState } from '../src/engine/CsbwinSaveGame';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import type { Databases, DungeonData, PresetHero } from '../src/data/dungeonTypes';
import { Game } from '../src/engine/Game';
import { MovementAction } from '../src/engine/gameTypes';
import { buildSavePayload, decodeBase64ToBytes } from '../src/engine/SaveGamePayload';
import { newGame } from './lib/game';
import { check, fail, finish } from './lib/check';

const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const GRAPHICS = 'static/gamefiles/dm-atari/graphics.dat';
const SAVES = 'static/gamefiles/saves';

const DELTA_X = [0, 1, 0, -1];
const DELTA_Y = [-1, 0, 1, 0];

const DATABASE_KEYS: Array<keyof Databases> = [
  'doors', 'teleporters', 'texts', 'actuators', 'creatures', 'weapons', 'clothing',
  'scrolls', 'potions', 'containers', 'misc', 'missiles', 'clouds',
];

/** `_ResurrectReincarnateCancel`'s button ids (`doc/CSBwin-src/CSBCode.cpp:6615`). */
const RESURRECT = 160;

/* ------------------------------------------------------------------------ fixture --- */

function makeGame(): Game {
  const data = new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON))));
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(GRAPHICS))));
  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  return game;
}

/** Turn the clock one tick at a time, the way `Game.update` does. */
function advance(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    game.systems.timer.processTimers();
    game.ctx.state.tickCount++;
  }
}

function cellObjects(game: Game, cell: Position): ObjectID[] {
  const out: ObjectID[] = [];
  for (
    let rn = game.ctx.dungeon.findFirstObject(cell);
    rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
    rn = game.ctx.dungeon.getDBRecordLink(rn)
  ) {
    out.push(rn);
    if (out.length > 64) break;
  }
  return out;
}

function heroByName(game: Game, name: string): PresetHero | null {
  return (game.ctx.dungeon.getData().presetHeroes ?? []).find((h) => h.name === name) ?? null;
}

/** Walk up to a mirror, click it and confirm — a player recruiting a champion. */
function recruit(game: Game, name: string): boolean {
  const hero = heroByName(game, name);
  if (!hero) return false;
  const facing = (hero.location.wall + 2) & 3;
  const party = game.ctx.party.state;
  party.position = new Position(
    hero.location.x - DELTA_X[facing], hero.location.y - DELTA_Y[facing], hero.location.map,
  );
  party.facing = facing as Direction;
  game.systems.mouse.handleWallClick();
  if (party.potentialChampionIndex < 0) return false;
  game.systems.hallOfChampions.resurrectReincarnateCancel(RESURRECT);
  return party.champions.some((c) => c.name === name);
}

/* ----------------------------------------------------------------- the comparison --- */

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Everything the file has to carry, asked of the **live engine** on both sides.
 *
 * The party and the world are asked separately on purpose: a file that restores the
 * world into one dungeon and the party into another passes either half alone. The
 * possession slots are the join — each one is an RN into the same world, so a slot that
 * still names the right record is a statement about both.
 */
function compareGames(label: string, before: Game, after: Game, monsters: boolean): void {
  const b = before.ctx.party.state;
  const a = after.ctx.party.state;

  check(b.position.x === a.position.x && b.position.y === a.position.y &&
    b.position.z === a.position.z,
    `${label}: the party stands where it stood (${b.position.x},${b.position.y},${b.position.z})`);
  check(b.facing === a.facing, `${label}: facing ${b.facing}`);
  check(b.cursorOwner === a.cursorOwner, `${label}: d.HandChar`);
  check(b.magicCasterIndex === a.magicCasterIndex, `${label}: d.MagicCaster`);
  check(b.objectInHand === a.objectInHand,
    `${label}: the object on the cursor is the same record ` +
    `(${b.objectInHand} vs ${a.objectInHand})`);
  check(before.getTickCount() === after.getTickCount(), `${label}: the clock`);
  // `GAMEBLOCK1` (SaveGame.cpp:1058-1072, :1603-1611, :1859-1881).
  const g1 = before.ctx.state.block1;
  const g2 = after.ctx.state.block1;
  check(g1.randomGameID === g2.randomGameID && g1.totalMoveCount === g2.totalMoveCount,
    `${label}: d.RandomGameID 0x${g2.randomGameID.toString(16)} and totalMoveCount ${g2.totalMoveCount}`);
  check(g1.word22592 === g2.word22592 && g1.word22594 === g2.word22594 &&
    g1.word22596 === g2.word22596 && g1.word22598 === g2.word22598 &&
    same(g1.byte22808, g2.byte22808),
    `${label}: d.Word22592-22598 and d.Byte22808`);
  // `gb2.partyMoveDisableTimer`, `Word11712`, `Word11714` (SaveGame.cpp:1029-1031, :1645-1647).
  check(b.partyMoveDisableTimer === a.partyMoveDisableTimer && b.word11712 === a.word11712 &&
    b.word11714 === a.word11714,
    `${label}: the move delay and the throw's move lock ` +
    `(${b.partyMoveDisableTimer}/${b.word11712}/${b.word11714} vs ` +
    `${a.partyMoveDisableTimer}/${a.word11712}/${a.word11714})`);

  check(b.champions.length === a.champions.length && b.champions.length > 0,
    `${label}: ${b.champions.length} champions come back`);
  for (let i = 0; i < Math.min(b.champions.length, a.champions.length); i++) {
    const was = b.champions[i];
    const now = a.champions[i];
    const who = `${label}/${was.name}`;
    check(was.name === now.name && was.title === now.title, `${who}: name and title`);
    check(was.attributes.health === now.attributes.health &&
      was.attributes.maxHealth === now.attributes.maxHealth, `${who}: hit points`);
    check(was.attributes.stamina === now.attributes.stamina &&
      was.attributes.mana === now.attributes.mana, `${who}: stamina and mana`);
    check(was.food === now.food && was.water === now.water, `${who}: food and water`);
    check(same(was.possessions, now.possessions), `${who}: all thirty possession slots`);
    check(same(was.skills, now.skills), `${who}: the skills`);
  }

  const wasWorld = before.ctx.state.dungeon;
  const nowWorld = after.ctx.state.dungeon;

  let flags = 0;
  let differing = 0;
  wasWorld.maps.forEach((map, level) => {
    const other = nowWorld.maps[level];
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        flags++;
        if (map.cellFlags[x][y] !== other?.cellFlags[x]?.[y]) differing++;
      }
    }
  });
  check(flags > 0 && differing === 0,
    `${label}: every one of ${flags} cell flags, all ${wasWorld.maps.length} levels (${differing} differ)`);

  check(same(wasWorld.objectList, nowWorld.objectList), `${label}: the whole object list`);
  check(same(wasWorld.columnIndex, nowWorld.columnIndex), `${label}: the column index`);
  check(wasWorld.header.objectListSize === nowWorld.header.objectListSize,
    `${label}: header.objectListSize`);
  check(same(wasWorld.header.objectCounts, nowWorld.header.objectCounts),
    `${label}: all sixteen database sizes`);

  for (const key of DATABASE_KEYS) {
    if (key === 'creatures' && !monsters) continue;
    const from = wasWorld.databases[key].records;
    const to = nowWorld.databases[key].records;
    let differ = 0;
    let free = 0;
    for (let i = 0; i < Math.max(from.length, to.length); i++) {
      // A **free** record — link `RNnul` — cannot be compared past its link, and
      // deliberately so: `DeleteDBEntry` frees the indirect slot the record's secondary
      // RN names but leaves the word alone (`doc/CSBwin-src/data.cpp:993-1015`), so this
      // port's reader drops it and its writer puts `RNnul` back. DM's scroll 33 is the
      // one such record in the shipped dungeon.
      const link = (from[i] as { nextObject?: number } | undefined)?.nextObject;
      if (link === OBJECT_ID_NULL &&
          link === (to[i] as { nextObject?: number } | undefined)?.nextObject) { free++; continue; }
      if (!same(from[i], to[i])) differ++;
    }
    check(from.length === to.length && differ === 0,
      `${label}: every ${key} record, field for field ` +
      `(${from.length}, ${differ} differ, ${free} free record(s) exempt)`);
  }

  check(same(wasWorld.indirectTextIndex, nowWorld.indirectTextIndex),
    `${label}: the indirect text index`);
  check(same(wasWorld.compressedText, nowWorld.compressedText), `${label}: the compressed text`);
  check(same(Array.from(wasWorld.expool ?? []), Array.from(nowWorld.expool ?? [])),
    `${label}: EXPOOL, byte for byte (${wasWorld.expool?.length ?? 0} bytes)`);

  if (!monsters) return;

  // The timers, through the live queue rather than the table, because the table is
  // sparse and the queue is what fires. `sequence` is excluded for the reason
  // `dump-save-roundtrip.ts` excludes it: `processMonstersOnLevel` re-creates every
  // monster movement timer on load, and CSBWin stamps a new timer with a new sequence.
  const strip = (t: { sequence?: number }) => { const { sequence, ...rest } = t; void sequence; return rest; };
  const beforeTimers = before.getRuntimeSaveState().dungeon;
  const afterTimers = after.getRuntimeSaveState().dungeon;
  check(same(beforeTimers.timerQueue, afterTimers.timerQueue), `${label}: the timer queue order`);
  check(same((beforeTimers.timers ?? []).map(strip), (afterTimers.timers ?? []).map(strip)),
    `${label}: every timer record but its sequence stamp`);
  // Less each member's status byte: a load attaches the party level's groups again, and
  // `AttachItem16ToMonster` clears the byte and re-rolls it through `NextMonsterUpdateTime`
  // (`doc/CSBwin-src/CSBCode.cpp:6107-6110`), from a seed the load itself has moved on, so
  // two loads of one game roll it differently.
  const pool = (d: typeof beforeTimers) => (d.item16 ?? []).map((slot) => {
    const { singleMonsterStatus, ...rest } = slot; void singleMonsterStatus; return rest;
  });
  check(same(pool(beforeTimers), pool(afterTimers)),
    `${label}: the ITEM16 monster pool, but for the status bytes a load re-rolls`);
}

/**
 * Object chains, walked by the **engine** on both sides rather than compared as arrays.
 *
 * `objectList` is compared above, which is the same information — but a chain is what
 * the engine actually reads, through `columnIndex` and `levelIndex`, and a save that
 * restored the list without the index it is read at would pass the array comparison and
 * fail here. That is not hypothetical: it is the column-index bug `DungeonSnapshot`
 * records.
 *
 * Two cells: the party's own, and the first cell on the party's level that holds
 * anything, so there is always a non-empty chain in the run.
 */
function compareChains(label: string, before: Game, after: Game): void {
  const at = before.ctx.party.state.position;
  const cells: Position[] = [new Position(at.x, at.y, at.z)];

  const map = before.ctx.state.dungeon.maps[at.z];
  outer: for (let x = 0; x < (map?.descriptor.width ?? 0); x++) {
    for (let y = 0; y < (map?.descriptor.height ?? 0); y++) {
      const cell = new Position(x, y, at.z);
      if (cellObjects(before, cell).length > 0) { cells.push(cell); break outer; }
    }
  }

  let nonEmpty = 0;
  for (const cell of cells) {
    const was = cellObjects(before, cell);
    const now = cellObjects(after, new Position(cell.x, cell.y, cell.z));
    if (was.length > 0) nonEmpty++;
    console.log(`  (${cell.x},${cell.y},${cell.z}) holds ` +
      `[${was.map((r) => `0x${r.toString(16)}`).join(' ')}]`);
    check(same(was, now), `${label}: the chain the engine walks at (${cell.x},${cell.y},${cell.z})`);
  }
  check(nonEmpty > 0, `${label}: at least one of the two chains has something in it`);
}

/* ------------------------------------------------------------- write and read back --- */

/**
 * Write the file the game writes, and prove it is a file rather than a prefix.
 *
 * `loadCsbwinWorld` is unforgiving on purpose: it re-reads the Extended Features header,
 * verifies both map checksums, walks the five scrambled blocks with their own checksums,
 * parses the image and then refuses unless the cell flag array ends exactly two bytes
 * before the file does. A section written at the wrong length fails there rather than
 * silently.
 */
function writeAndReload(label: string, game: Game): Game | null {
  const bytes = decodeBase64ToBytes(buildSavePayload(game).raw);
  console.log(`  ${label}: ${bytes.length} bytes written`);

  let parsed;
  try {
    parsed = loadCsbwinWorld(bytes);
  } catch (error) {
    fail(`${label}: the file this port wrote should parse as a whole — ${(error as Error).message}`);
    return null;
  }
  check(parsed.save.extendedFeatures !== undefined, `${label}: it carries an Extended Features block`);
  check(parsed.save.dungeonImageOffset !== undefined, `${label}: and a dungeon image`);
  // Plus `DMRules` when the game holds `DMRulesDesignOption` (`SaveGame.cpp:952-953`).
  const flagsExpected = game.ctx.rules.dmRulesDesignOption ? 0xe9 : 0xa9;
  check((parsed.save.extendedFeatures?.flags ?? 0) === flagsExpected,
    `${label}: flags declare LevelDSAInfo|IndirectText|ExpandedPortraits|BigActuators, and DMRules ` +
    `with the design option (0x${(parsed.save.extendedFeatures?.flags ?? 0).toString(16)})`);
  check(parsed.save.sequencedTimers === true && parsed.save.extendedTimers === true,
    `${label}: and the 16-byte TIMER the block 5 writer used`);
  check(parsed.save.cellFlagArraySize === 12366,
    `${label}: cellFlagArraySize is the 12366 dungeon.dat declares ` +
    `(${parsed.save.cellFlagArraySize})`);
  check(parsed.dungeon.header.textDataSize === (parsed.dungeon.indirectTextIndex ?? []).length,
    `${label}: NumWordsInTextArray is the index length the conversion wrote`);
  check((parsed.save.objectIndex?.countAliases() ?? -1) === 0,
    `${label}: no two slots of the object indirect index name the same record`);
  // `gb2.ObjectInHand = d.objectInHand.ConvertToInteger()` (`SaveGame.cpp:1033`): an
  // empty cursor is `RNnul`, as in every committed save that has one. `RNempty` (0)
  // would load in CSBWin as an object in hand (`:1649`, `:2753`).
  check(parsed.save.block1?.saveOption === 1, `${label}: SaveOption is SAVE AND PLAY's 1`);
  const inHand = game.ctx.party.state.objectInHand;
  if (inHand === OBJECT_ID_NULL) {
    const word = parsed.save.block2?.objectInHand;
    check(word === 0xffff, `${label}: the empty cursor is written as RNnul (0x${(word ?? 0).toString(16)})`);
  }

  const next = makeGame();
  try {
    applyCsbwinSave(next, bytes);
  } catch (error) {
    fail(`${label}: and should load back into a running game — ${(error as Error).message}`);
    return null;
  }
  return next;
}

/* ------------------------------------------------------------------------ the play --- */

/**
 * Scenario 1 — a game that never touched a save file.
 *
 * Two champions off the level-0 mirrors, a walk, and a thrown object left in flight
 * with a second object still on the cursor.
 */
function playFromDungeonDat(): Game {
  const game = makeGame();
  check(recruit(game, 'HALK'), 'HALK joins the party at his mirror');
  check(recruit(game, 'TIGGY'), 'TIGGY joins at hers');

  // Away from the mirror it is facing — forward is a wall — and then a few steps that
  // fire whatever pressure plates the corridor has.
  const party = game.ctx.party.state;
  const from = new Position(party.position.x, party.position.y, party.position.z);
  const walk = [
    MovementAction.TURN_RIGHT, MovementAction.TURN_RIGHT, MovementAction.MOVE_FORWARD,
    MovementAction.MOVE_FORWARD, MovementAction.TURN_LEFT, MovementAction.MOVE_FORWARD,
    MovementAction.STRAFE_RIGHT, MovementAction.MOVE_FORWARD,
  ];
  let moved = 0;
  for (const action of walk) {
    if (game.move(action)) moved++;
    advance(game, 4);
  }
  const to = party.position;
  console.log(`  walked: ${moved} of ${walk.length} actions took, ` +
    `(${from.x},${from.y}) -> (${to.x},${to.y}) facing ${party.facing}`);
  check(moved > 0 && (to.x !== from.x || to.y !== from.y),
    'the party actually walked somewhere else');

  // An object onto the cursor and thrown. `throwObjectFromCursor` is the UI's own path;
  // what it leaves behind is a MISSILE record and a timer carrying the object's RN.
  const thrower = party.champions[0];
  const toThrow = thrower.possessions.find((p) => p !== OBJECT_ID_NULL) ?? null;
  if (toThrow !== null) {
    const slot = thrower.possessions.indexOf(toThrow);
    thrower.possessions[slot] = OBJECT_ID_NULL;
    party.objectInHand = toThrow as ObjectID;
    party.cursorOwner = 0;
    const thrown = game.systems.mouse.throwObjectFromCursor(0);
    console.log(`  threw 0x${(toThrow as number).toString(16)}: ${thrown}`);
    check(thrown, 'the object left the cursor as a missile');
    // `d.Word11712 = 4; d.Word11714 = d.partyFacing;` (Mouse.cpp:753-754).
    check(party.word11712 === 4 && party.word11714 === party.facing,
      `the throw locks steps in its direction for 4 ticks (${party.word11712}, ${party.word11714})`);
  } else {
    fail('the first champion should have carried something to throw');
  }

  // Two ticks, so the missile is mid-flight rather than landed: the timer that carries
  // it has to be live at the moment of the save for the translation to be exercised.
  advance(game, 2);

  // And a second object left on the cursor, which is `GAMEBLOCK2.ObjectInHand`.
  const other = party.champions[1];
  const held = other?.possessions.find((p) => p !== OBJECT_ID_NULL) ?? null;
  if (held !== null && other) {
    const slot = other.possessions!.indexOf(held);
    other.possessions[slot] = OBJECT_ID_NULL;
    party.objectInHand = held as ObjectID;
    party.cursorOwner = 1;
  }
  check(party.objectInHand !== OBJECT_ID_NULL,
    'an object is on the cursor at the moment of the save');
  return game;
}

/** Scenario 2 — a genuine save, restored and played on. */
function playFromCsbwinSave(file: string): Game {
  const game = makeGame();
  applyCsbwinSave(game, new Uint8Array(readFileSync(resolve(SAVES, file))));
  const before = game.getRuntimeSaveState().dungeon.timerQueue?.length ?? 0;
  advance(game, 40);
  const after = game.getRuntimeSaveState().dungeon.timerQueue?.length ?? 0;
  console.log(`  ${file}: ${before} live timers before 40 ticks, ${after} after`);
  check(before > 0, `${file} carries live timers to play with`);
  return game;
}

/** How many of a world's live timers carry an object reference. */
function carriedObjects(game: Game): number {
  const { timers = [], timerQueue = [] } = game.getRuntimeSaveState().dungeon;
  const live = new Set(timerQueue);
  return timers.filter((t, slot) =>
    live.has(slot) && (t.function === 48 || t.function === 49 ||
      t.function === 24 || t.function === 25 || t.function === 60 || t.function === 61),
  ).length;
}

function countRecords(world: DungeonData): number {
  return DATABASE_KEYS.reduce((n, key) => n + world.databases[key].records.length, 0);
}

/* ------------------------------------------------------------------------- the run --- */

function main(): void {
  console.log('=== 1. a game that started from dungeon.dat ===');
  const fresh = playFromDungeonDat();
  const missiles = fresh.ctx.state.dungeon.databases.missiles.records.length;
  const carrying = carriedObjects(fresh);
  console.log(`  ${missiles} MISSILE records, ${carrying} live timer(s) carrying an object`);
  check(carrying > 0,
    'a timer is carrying an object at the moment of the save — the case the writer has to translate by hand');

  // The vacuity guard for `GAMEBLOCK1`: a file that wrote zeros there would carry
  // nothing a fresh load does not already have. The walk above goes round the mouse
  // queue, which is where moves are counted (`tools/dump-mouse-queue.ts`), so the count
  // is set here to one that has to travel.
  fresh.ctx.state.block1.totalMoveCount = 0x12345;
  check(fresh.ctx.state.block1.randomGameID !== 0 && fresh.ctx.state.block1.totalMoveCount > 0,
    `dungeon.dat: the game drew a RandomGameID and counted its moves ` +
    `(0x${fresh.ctx.state.block1.randomGameID.toString(16)}, ${fresh.ctx.state.block1.totalMoveCount})`);
  const freshBack = writeAndReload('dungeon.dat', fresh);
  if (freshBack) {
    compareGames('dungeon.dat', fresh, freshBack, true);
    compareChains('dungeon.dat', fresh, freshBack);
    check(carriedObjects(freshBack) === carrying,
      `dungeon.dat: the thrown object is still in flight (${carrying} carrying timer(s))`);
    // The vacuity guard. A file that wrote `dungeon.dat` back unchanged would pass every
    // comparison above, because the fresh game it loads into *is* dungeon.dat.
    const pristine = makeGame().ctx.state.dungeon;
    check(countRecords(freshBack.ctx.state.dungeon) !== countRecords(pristine) ||
      !same(freshBack.ctx.state.dungeon.objectList, pristine.objectList),
      'dungeon.dat: the world that came back is the played one, not the file the game booted on');
  }

  console.log('\n=== 2. a game restored from csbgame7.dat and played on ===');
  const played = playFromCsbwinSave('csbgame7.dat');
  const creatures = played.ctx.state.dungeon.databases.creatures.records.length;
  check(creatures > 0 && (played.ctx.state.dungeon.item16?.length ?? 0) > 0,
    `csbgame7.dat: it really does carry monsters (${creatures} creature records, ` +
    `${played.ctx.state.dungeon.item16?.length ?? 0} ITEM16 slots)`);
  check((played.ctx.state.dungeon.expool?.length ?? 0) > 0,
    'csbgame7.dat: and an EXPOOL that dungeon.dat does not have');
  check(played.ctx.state.block1.randomGameID === 0x261fdc50 && played.ctx.state.block1.totalMoveCount === 69897,
    `csbgame7.dat: the loaded game has the file's RandomGameID and totalMoveCount ` +
    `(0x${played.ctx.state.block1.randomGameID.toString(16)}, ${played.ctx.state.block1.totalMoveCount})`);

  // **A load is not a no-op, and CSBWin's is not either.** `reloadAfterSaveGame` deletes
  // and re-creates the movement timers of every monster group on the party's level, and
  // `NextMonsterUpdateTime` re-rolls each member's walk offsets
  // (`doc/CSBwin-src/CSBCode.cpp:10491`, `doc/CSBwin-src/CSBCode.cpp:5842`), so a
  // world with live monsters comes back with different timer slots, a different queue
  // order, different `ITEM16` walk bytes and the odd creature facing. That is play, not
  // loss, and it is why `tools/dump-save-roundtrip.ts` says the same thing.
  //
  // So the monster state is held to a **fixed point** instead: write, load, write, load,
  // and the two loaded games must agree — both have been through the re-creation exactly
  // once, so anything that differs is the file losing something rather than the engine
  // moving. Everything the reload does not touch is still compared against the played
  // game directly, one round trip earlier.
  const once = writeAndReload('csbgame7.dat', played);
  if (once) {
    compareGames('csbgame7.dat', played, once, false);
    compareChains('csbgame7.dat', played, once);
    const twice = writeAndReload('csbgame7.dat (again)', once);
    if (twice) compareGames('csbgame7.dat fixed point', once, twice, true);
  }

  // `LoadGame`'s other branch, which no committed save takes: `Byte22596 == 1` marks an
  // Atari DM save, whose `Word22592` comes from the dungeon it holds and whose
  // `Word22596` / `Word22594` stay `_ReadEntireGame`'s 2 and 1
  // (doc/CSBwin-src/SaveGame.cpp:1467-1470, :1861-1877). DM's image has fourteen levels
  // and a sentinel of 99, which is the 10.
  console.log('\n=== 3. GAMEBLOCK1 of an Atari DM save ===');
  const world = loadCsbwinWorld(new Uint8Array(readFileSync(resolve(SAVES, 'csbgame7.dat'))));
  const own = buildCsbwinRuntimeState(world).game.block1;
  world.save.block1!.byte22596 = 1;
  const atari = buildCsbwinRuntimeState(world).game.block1;
  console.log(`  csbgame7.dat as written: Word22592 ${own?.word22592}, Word22596 ${own?.word22596}; ` +
    `with Byte22596 1: ${atari?.word22592}, ${atari?.word22596}`);
  check(own?.word22592 === 13 && own?.word22594 === 1 && own?.word22596 === 2 && own?.word22598 === 1,
    'a CSBWin save brings its own words: 13, 1, 2 and 1');
  check(atari?.word22592 === 10 && atari?.word22594 === 1 && atari?.word22596 === 2,
    'an Atari DM save takes Word22592 10 from fourteen levels and sentinel 99');

  console.log();
  finish();
}

main();
