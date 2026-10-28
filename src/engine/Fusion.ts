/**
 * Lord Chaos's end: `_Fusion` (`doc/CSBwin-src/Attack.cpp:133`), which the FUSE attack
 * runs on the square in front, and `_FusionSequence` (`:2222`), which a boxed-in Lord
 * Chaos starts and which holds the main loop to the credits. With them, the square tests
 * both use, which the FLUXCAGE attack (`AttackSystem`) also reads to box him in.
 */
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../core/types';
import { sw } from '../core/intCast';
import type { GameContext } from './GameContext';
import { selectPaletteForLightLevel } from './LightLevel';
import { markAllPortraitsChanged } from './Party';
import { showHideInventory } from './ShowHideInventory';
import { DeleteMonsterWhy, deleteMonsterParameters } from './filterParameters';
import { waitForButtonFlashScript, type LoopScript } from './LoopState';
import { MonsterType } from './monsterTypes';
import { CloudType } from './cloudTypes';
import { RN_DISPELL_MISSILE, RN_FIREBALL } from '../core/spellRn';

/** `testdelay` (`doc/CSBwin-src/Attack.cpp:19`): every `if (testdelay) VBLDelay(MS2VBL(testdelay))`. */
const TEST_DELAY = 500;

/** `MS2VBL(milliseconds)` (`doc/CSBwin-src/Attack.cpp:17`): 16 ms a VBL, truncated. */
function ms2vbl(milliseconds: number): number {
  return Math.trunc(milliseconds / 16);
}

/** `FindFirstMonster(x, y)` on the party's level. */
function findFirstMonsterAt(ctx: GameContext, mapX: number, mapY: number): ObjectID {
  return ctx.dungeon.findFirstMonster(new Position(mapX, mapY, ctx.party.state.position.z));
}

/** `IsCellFluxcage` (`doc/CSBwin-src/Attack.cpp:57`). */
export function isCellFluxcage(ctx: GameContext, mapX: number, mapY: number): boolean {
  const party = ctx.party.state;
  const position = new Position(mapX, mapY, party.position.z);
  const roomType = (ctx.dungeon.getCellFlag(position) & 0xff) >> 5;
  if (roomType === RoomType.STONE || roomType === RoomType.STAIRS) return false;
  for (
    let rn = ctx.dungeon.findFirstObject(position);
    rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
    rn = ctx.dungeon.getDBRecordLink(rn)
  ) {
    if (ctx.dungeon.rnMaps.dbType(rn) !== DBType.CLOUD) continue;
    const cloud = ctx.dungeon.getCloudRecord(rn);
    if (cloud && cloud.cloudType === CloudType.CT_FLUXCAGE) return true;
  }
  return false;
}

/** `IsLordChaosHere` (`doc/CSBwin-src/Attack.cpp:87`). */
export function isLordChaosHere(ctx: GameContext, mapX: number, mapY: number): boolean {
  const rn = findFirstMonsterAt(ctx, mapX, mapY);
  if (rn === OBJECT_ID_EOF) return false;
  const monster = ctx.dungeon.getCreatureRecord(rn);
  return !!monster && monster.creatureType === MonsterType.mon_LordChaos;
}

/** `legalXY` (`doc/CSBwin-src/Attack.cpp:99`), on the party's level. */
function legalXY(ctx: GameContext, x: number, y: number): boolean {
  const map = ctx.dungeon.getMap(ctx.party.state.position.z);
  if (!map) return false;
  if (y < 0 || y >= map.descriptor.height) return false;
  if (x < 0 || x >= map.descriptor.width) return false;
  return true;
}

/** `(GetCellFlags(x, y) & 255) >> 5` on the party's level; off the map, stone. */
function roomTypeAt(ctx: GameContext, x: number, y: number): number {
  return (ctx.dungeon.getCellFlag(new Position(x, y, ctx.party.state.position.z)) & 255) >> 5;
}

/** `IsCellWall` (`doc/CSBwin-src/Attack.cpp:106`). */
function isCellWall(ctx: GameContext, x: number, y: number): boolean {
  const cf = roomTypeAt(ctx, x, y);
  return cf === RoomType.STONE || cf === RoomType.FALSEWALL;
}

/** `IsCellOpenOrPit` (`doc/CSBwin-src/Attack.cpp:113`). */
function isCellOpenOrPit(ctx: GameContext, x: number, y: number): boolean {
  const cf = roomTypeAt(ctx, x, y);
  return cf === RoomType.OPEN || cf === RoomType.PIT;
}

/**
 * `IsCellOccupied` (`doc/CSBwin-src/Attack.cpp:120`): a monster, or the party. The level
 * loaded during an attack is the party's, so `d.LoadedLevel == d.partyLevel` holds.
 */
function isCellOccupied(ctx: GameContext, x: number, y: number): boolean {
  if (findFirstMonsterAt(ctx, x, y) !== OBJECT_ID_EOF) return true;
  const party = ctx.party.state.position;
  return party.x === x && party.y === y;
}

/**
 * `_Fusion` (`doc/CSBwin-src/Attack.cpp:133`), the `NewFusion` branch, which the
 * `#define` just above it makes the live one (`:161-213`): a dispell cloud on the square
 * in front, and if Lord Chaos stands there, his escape. The four directions are
 * shuffled (`:163-171`); he steps to the first square next to him
 * that is open or a pit, unoccupied, and neither a Fluxcage nor a wall, and failing
 * that, to the first square two away in a direction whose near square is neither a
 * Fluxcage nor a wall, which may be occupied, and whose far square is on the map, open
 * or a pit, unoccupied and not a Fluxcage (`:172-212`). So he can jump over the party.
 * A `MoveObject` that leaves him in the dungeon (0) starts his movement timers there,
 * and he is gone. Nowhere to go, he is toast (`:213`), and `_FusionSequence` starts
 * (`:259`).
 */
export function fusion(ctx: GameContext, attackX: number, attackY: number): void {
  const level = ctx.party.state.position.z;
  const x = sw(attackX);
  const y = sw(attackY);
  const map = ctx.dungeon.getMap(level);
  if (!map) return;
  if (x < 0 || x >= map.descriptor.width) return;
  if (y < 0 || y >= map.descriptor.height) return;
  ctx.systems.missileEncounter.createCloud(RN_DISPELL_MISSILE, 0xff, x, y, new Position(x, y, level), 0xff);
  if (!isLordChaosHere(ctx, x, y)) return;
  const lordChaos = findFirstMonsterAt(ctx, x, y);
  const direction = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = ctx.random.below(i + 1);
    const temp = direction[i]!;
    direction[i] = direction[j]!;
    direction[j] = temp;
  }
  const x1: number[] = [], y1: number[] = [], x2: number[] = [], y2: number[] = [];
  const fluxCageOrWall: boolean[] = [], empty1: boolean[] = [], empty2: boolean[] = [];
  for (let i = 0; i < 4; i++) {
    const dx = ctx.tables.deltaX[direction[i]!]!;
    const dy = ctx.tables.deltaY[direction[i]!]!;
    x1[i] = x + dx;
    y1[i] = y + dy;
    x2[i] = x + 2 * dx;
    y2[i] = y + 2 * dy;
    fluxCageOrWall[i] = isCellFluxcage(ctx, x1[i]!, y1[i]!) || isCellWall(ctx, x1[i]!, y1[i]!);
    empty1[i] = isCellOpenOrPit(ctx, x1[i]!, y1[i]!) && !isCellOccupied(ctx, x1[i]!, y1[i]!);
    empty2[i] = legalXY(ctx, x2[i]!, y2[i]!)
      && isCellOpenOrPit(ctx, x2[i]!, y2[i]!)
      && !isCellOccupied(ctx, x2[i]!, y2[i]!)
      && !isCellFluxcage(ctx, x2[i]!, y2[i]!);
  }
  const monsters = ctx.systems.monsters;
  for (let i = 0; i < 4; i++) {
    if (!fluxCageOrWall[i] && empty1[i]) {
      if (monsters.moveMonster(lordChaos, x, y, x1[i]!, y1[i]!, level).code === 0) {
        monsters.startMonsterMovementTimers(x1[i]!, y1[i]!, level);
        return;
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    if (!fluxCageOrWall[i] && empty2[i]) {
      if (monsters.moveMonster(lordChaos, x, y, x2[i]!, y2[i]!, level).code === 0) {
        monsters.startMonsterMovementTimers(x2[i]!, y2[i]!, level);
        return;
      }
    }
  }
  // "Sorry, Mr. Chaos.  You are toast."
  ctx.systems.mainLoop.runScript(fusionSequence(ctx));
}

/**
 * `_FusionSequence` (`doc/CSBwin-src/Attack.cpp:2222`), the end of the game, which holds
 * the main loop to the credits (`LoopScript`): the game won, the light and the shields
 * up, Lord Chaos made all but unkillable and turned to face the party, the Fluxcages on
 * the party's square and his taken away, six fireballs of growing size and six dispells
 * on him, his flicker between `mon_25` and `mon_LordChaos`, a last fireball and dispell,
 * the Grey Lord in his place, every other monster on the level deleted, the texts of
 * cell (0, 0) whose first letters run on from "A", in that order and each for 780 VBLs,
 * "THE END.", and after `VBLDelay(600)` the credits, with `d.CanRestartFromSavegame`
 * cleared. With the Amiga's tables, six more dispells on him come between the last text
 * and "THE END.". Each step shows through `_ProcessTimersViewportAndSound`, which also runs the
 * timers. An open inventory is hidden first, and once the Grey Lord stands there
 * `d.Word1868` takes the shimmer off the Fluxcages still around him. The waits after a
 * text and after "THE END." run the strip's clock, which CSBWin's do not
 * (`vblDelayPlacingText`).
 */
function* fusionSequence(ctx: GameContext): LoopScript {
  const mainLoop = ctx.systems.mainLoop;
  const encounter = ctx.systems.missileEncounter;
  const party = ctx.party.state;
  const level = party.position.z;
  ctx.state.gameWon = true;
  if (party.selectedCharacterIndex >= 0) showHideInventory(ctx, 4);
  yield* waitForButtonFlashScript(ctx);
  party.brightness = 200;
  selectPaletteForLightLevel(ctx);
  party.partyShield = 100;
  party.spellShield = 100;
  party.fireShield = 100;
  markAllPortraitsChanged(ctx);
  yield* mainLoop.processTimersViewportAndSound();
  const w4 = sw(party.position.x + ctx.tables.deltaX[party.facing & 3]!);
  const w6 = sw(party.position.y + ctx.tables.deltaY[party.facing & 3]!);
  const monster = ctx.dungeon.getCreatureRecord(findFirstMonsterAt(ctx, w4, w6));
  if (!monster) throw new Error('_FusionSequence: no monster in front of the party');
  monster.hp[0] = 10000;
  const monsterDamage = ctx.systems.monsterDamage;
  monsterDamage.setMonsterPositionByte(monster, 255, level, false);
  monsterDamage.setMonsterFacingByte(monster, (party.facing + 2) & 3, level, false);
  const squares: Array<[number, number]> = [[party.position.x, party.position.y], [w4, w6]];
  for (const [x, y] of squares) {
    while (removeFluxcage(ctx, x, y, level)) { /* the next one */ }
  }
  yield* mainLoop.processTimersViewportAndSound();
  const at = new Position(w4, w6, level);
  for (let size = 55; size <= 255; size += 40) {
    encounter.createCloud(RN_FIREBALL, size, w4, w6, at, 255);
    yield* mainLoop.processTimersViewportAndSound();
    yield ms2vbl(TEST_DELAY);
  }
  ctx.sounds.queueSound(17, w4, w6, 1, party.position.z);
  monster.creatureType = MonsterType.mon_25;
  yield* mainLoop.processTimersViewportAndSound();
  yield ms2vbl(TEST_DELAY);
  for (let size = 55; size <= 255; size += 40) {
    encounter.createCloud(RN_DISPELL_MISSILE, size, w4, w6, at, 255);
    yield* mainLoop.processTimersViewportAndSound();
    yield ms2vbl(TEST_DELAY);
  }
  for (let d6 = 3; d6 !== 0; d6--) {
    for (let d7 = 4; d7 !== 0; d7--) {
      ctx.sounds.queueSound(17, w4, w6, 1, party.position.z);
      monster.creatureType = (d7 & 1) !== 0 ? MonsterType.mon_25 : MonsterType.mon_LordChaos;
      for (let d5 = d6 - 1; d5 !== 0; d5--) {
        yield* mainLoop.processTimersViewportAndSound();
        yield ms2vbl(TEST_DELAY);
      }
    }
  }
  yield* mainLoop.processTimersViewportAndSound();
  yield ms2vbl(400);
  encounter.createCloud(RN_FIREBALL, 0xff, w4, w6, at, 255);
  yield* mainLoop.processTimersViewportAndSound();
  yield ms2vbl(800);
  encounter.createCloud(RN_DISPELL_MISSILE, 0xff, w4, w6, at, 255);
  yield* mainLoop.processTimersViewportAndSound();
  yield ms2vbl(800);
  monster.creatureType = MonsterType.mon_GreyLord;
  yield* mainLoop.processTimersViewportAndSound();
  yield ms2vbl(TEST_DELAY);
  ctx.state.word1868 = true;
  yield* mainLoop.processTimersViewportAndSound();
  yield ms2vbl(TEST_DELAY);
  const map = ctx.dungeon.getMap(level)!;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      if (findFirstMonsterAt(ctx, x, y) === OBJECT_ID_EOF) continue;
      if (x === w4 && y === w6) continue;
      monsterDamage.processMonsterDeleteFilter(level, x, y, deleteMonsterParameters(DeleteMonsterWhy.DMW_Fusion, -1));
      monsterDamage.deleteMonster(level, x, y);
    }
  }
  yield* mainLoop.processTimersViewportAndSound();
  yield ms2vbl(TEST_DELAY);
  // The texts of cell (0, 0), `obj_26`. CSBWin's array holds eight, and a ninth text
  // would run past it; no dungeon we load has any there.
  const dungeon = ctx.dungeon;
  const texts: ObjectID[] = [];
  for (let rn = dungeon.findFirstObject(new Position(0, 0, level)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (ctx.dungeon.rnMaps.dbType(rn) === DBType.TEXT) texts.push(rn);
  }
  const messages = ctx.host.messages;
  let letter = 'A'.charCodeAt(0);
  for (let n = texts.length; n !== 0; n--) {
    for (const rn of texts) {
      // `DecodeText(…, 0x8001, 200)` puts a linefeed in front, so the letter is the second
      // byte, and the text is printed from there with the letter turned into a linefeed.
      const text = dungeon.decodeTextString(dungeon.getTextRecord(rn)!, 0x8001, ctx.tables.textDecode, 200);
      if (text === null || text.charCodeAt(1) !== letter) continue;
      // `TAG00187e()` (`doc/CSBwin-src/Hint.cpp:2067`) resets the hint oracle's `f.`
      // state, which only the oracle reads.
      messages.printLines(15, '\n' + text.slice(2), ctx.state.tickCount);
      yield* mainLoop.processTimersViewportAndSound();
      yield* vblDelayPlacingText(ctx, 780);
      letter++;
      break;
    }
  }
  // The Amiga 2.2's six non-material harm explosions after the last message, each followed
  // by a step of the fuse sequence (ReDMCSB `ENDGAME.C:953-958`, `MEDIA439`), the step as
  // CSBWin's dispells take it above. Only a set with the Amiga's tables has them.
  if (ctx.tables.amigaSounds) {
    for (let size = 55; size <= 255; size += 40) {
      encounter.createCloud(RN_DISPELL_MISSILE, size, w4, w6, at, 255);
      yield* mainLoop.processTimersViewportAndSound();
      yield ms2vbl(TEST_DELAY);
    }
  }
  messages.printLines(0, ctx.tables.byte1830, ctx.state.tickCount);
  messages.printLines(15, 'THE END.', ctx.state.tickCount);
  messages.printLines(0, ctx.tables.byte1830, ctx.state.tickCount);
  yield* vblDelayPlacingText(ctx, 600);
  mainLoop.clearCanRestartFromSavegame();
  yield* mainLoop.showCreditsAndEnd();
}

/**
 * `VBLDelay(vbls)` after a line of the ending, with `scrollingText.ClockTick()` on each
 * of its VBLs. That call is the port's own (`DEBT.md` H, "The ending's speech is shown
 * whole"): CSBWin's `_VBLDelay` only waits (`doc/CSBwin-src/CSBCode.cpp:1147-1157`), so
 * a row held back by a scroll is placed when the next text is printed, one row per
 * text, and the credits come with most of the speech never shown
 * (`doc/PROVEN_FACTS.md` → "The Grey Lord's speech reaches the strip one row per text
 * once the strip scrolls"). Here a row is placed in the VBL its scroll ends. The VBLs
 * waited are CSBWin's, and `d.Time` stands still through them, so no row times out.
 */
function* vblDelayPlacingText(ctx: GameContext, vbls: number): LoopScript {
  const messages = ctx.host.messages;
  for (let n = vbls; n !== 0; n--) {
    yield 1;
    messages.clockTick(ctx.state.tickCount);
  }
}

/**
 * One pass of `_FusionSequence`'s cage removal (`doc/CSBwin-src/Attack.cpp:2290-2304`):
 * the first Fluxcage from the square's first drawable object on
 * (`FindFirstDrawableObject`, `CSBCode.cpp:5205`) taken out of the square
 * (`RemoveObjectFromRoom`). Says whether there was one.
 */
function removeFluxcage(ctx: GameContext, x: number, y: number, level: number): boolean {
  const dungeon = ctx.dungeon;
  const position = new Position(x, y, level);
  let rn = dungeon.findFirstObject(position);
  while (rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL && ctx.dungeon.rnMaps.dbType(rn) < DBType.CREATURE) {
    rn = dungeon.getDBRecordLink(rn);
  }
  for (; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = dungeon.getDBRecordLink(rn)) {
    if (ctx.dungeon.rnMaps.dbType(rn) !== DBType.CLOUD) continue;
    if (dungeon.getCloudRecord(rn)?.cloudType !== CloudType.CT_FLUXCAGE) continue;
    dungeon.removeObjectFromCell(position, rn);
    return true;
  }
  return false;
}
