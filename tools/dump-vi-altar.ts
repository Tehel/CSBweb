/**
 * The Altar of Vi: bones in, champion out.
 *
 * None of this is visible on a frame, and all of it is timing. `ProcessTT_ViAltar`
 * (`doc/CSBwin-src/Timer.cpp:2709`) is a three-state countdown that reschedules itself,
 * so the resurrection is spread over six ticks and each state must hand the right
 * thing to the next:
 *
 *   - **2** — `CreateCloud(RNffe4)` over the bones, `Time += 5`, drop to state 1.
 *   - **1** — find those exact bones again, resolve which champion they belong to,
 *     refuse if that champion is not dead, destroy the bones, `Time += 1`, drop to
 *     state 0 carrying the champion index in `packedPos`.
 *   - **0** — `BringCharacterToLife(packedPos)`.
 *
 * Resolving the champion has two arms, and this tool drives both, because the
 * difference between them is where the port was wrong. Bones made by a **death** carry
 * an expool record holding the champion's fingerprint, and their `value` is the *kind*
 * of bones — 2, "a dead champion's" (`doc/CSBwin-src/CSB.h:1264`). Bones placed by the
 * **dungeon** carry no record, and there `value` *is* the champion index
 * (`Timer.cpp:2789`, `Mouse.cpp:934`). The port used to have no second arm at all: it
 * guessed, resurrecting the single dead champion if there was exactly one and refusing
 * outright if there were two, and the drop handler rejected any bones whose `value`
 * was not 2 — which is every dungeon-authored bones object aimed at a champion other
 * than index 2.
 *
 * The last case is `BringCharacterToLife`'s corner search (`Character.cpp:804`). A
 * champion is revived into a corner someone living already stands in, and must be
 * moved; the champion themselves is still dead while that is decided, which is why
 * `CharacterAtPosition` skipping the dead (`Code11f52.cpp:4062`) is load-bearing
 * rather than a detail.
 *
 * Run: `npx tsx tools/dump-vi-altar.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MISC_BONES_OF_HERO } from '../src/core/constants';
import { DBType, OBJECT_ID_EOF, Position, RoomType, decodeObjectID, encodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, fail, finish } from './lib/check';

/** Every champion starts at 200/200, so a `MaxHP/64` cut is visible without rounding. */
function champion(i: number, name: string): Champion {
  return {
    name,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [], weaponHand: null, shieldHand: null, quiver: null,
    possessions: new Array(30).fill(null),
    partyPosition: i,
    fingerprint: 0x1000 + i,
  };
}

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  const game = new Game(
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
      monsterAttackSounds: objectTables.monsterAttackSounds,
      uByte590: uiTables.graphic232.uByte590,
      byte586: uiTables.graphic232.byte586,
      clothingArmour: objectTables.clothingArmour,
      clothingFlags: objectTables.clothingFlags,
      byte1412: uiTables.graphic232.byte1412,
    },
  );
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.addChampion(champion(i, `HERO${i}`));
  return game;
}

/** Any ordinary walkable cell — the altar itself is a wall decoration, not a room type. */
function findOpenCell(game: Game): Position {
  const dungeon = game.dungeonState;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 1; x < map.descriptor.width - 1; x++) {
      for (let y = 1; y < map.descriptor.height - 1; y++) {
        const flag = map.cellFlags[x]?.[y];
        if (flag === undefined) continue;
        if (((flag >> 5) & 0x7) !== RoomType.OPEN) continue;
        if ((flag & 0x08) !== 0) continue; // keep clear of cells that already hold objects
        return new Position(x, y, z);
      }
    }
  }
  throw new Error('no empty open cell in dungeon.dat');
}

/** A bones object the dungeon might have authored: no expool record, `value` = chIdx. */
function makeDungeonBones(game: Game, chIdx: number, posInCell: number): ObjectID {
  const db = game.dungeonState.getData().databases.misc;
  db.records.push({
    nextObject: OBJECT_ID_EOF,
    specialState: chIdx & 0x3,
    important: true,
    miscType: MISC_BONES_OF_HERO,
  });
  db.count++;
  return encodeObjectID(posInCell & 0x3, DBType.MISC, db.records.length - 1) as ObjectID;
}

function bonesAt(game: Game, cell: Position): ObjectID[] {
  const out: ObjectID[] = [];
  for (
    let rn = game.dungeonState.findFirstObject(cell);
    rn !== OBJECT_ID_EOF;
    rn = game.dungeonState.getDBRecordLink(rn)
  ) {
    if (decodeObjectID(rn).category !== DBType.MISC) continue;
    if (game.dungeonState.getMiscRecord(rn)?.miscType === MISC_BONES_OF_HERO) out.push(rn);
    if (out.length > 32) break;
  }
  return out;
}

function cloudsAt(game: Game, cell: Position): number {
  let n = 0;
  for (
    let rn = game.dungeonState.findFirstObject(cell);
    rn !== OBJECT_ID_EOF;
    rn = game.dungeonState.getDBRecordLink(rn)
  ) {
    if (decodeObjectID(rn).category === DBType.CLOUD) n++;
    if (n > 32) break;
  }
  return n;
}

/** Run the clock forward, letting the altar's self-rescheduling timer advance. */
function runTicks(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    game.state.tickCount++;
    game.timerSystem.processTimers(game.state.tickCount);
  }
}

function main(): void {
  /* ---------------------------------------- 1. bones from a death ---------------- */

  console.log('=== bones left by a death: resolved by fingerprint ===');
  {
    const g = makeGame();
    const cell = findOpenCell(g);
    g.party.state.position = cell;
    g.monsterSystem.loadPartyLevel(cell.z);

    const victim = 1;
    const maxHpBefore = g.party.state.champions[victim]!.attributes.maxHealth;
    g.monsterAttack.killCharacter(victim);

    const bones = bonesAt(g, cell);
    console.log(`HERO${victim} died, leaving ${bones.length} bones object(s) at (${cell.x},${cell.y}) level ${cell.z}`);
    if (bones.length !== 1) {
      fail('the death should leave exactly one bones object');
      finish();
      return;
    }
    const rn = bones[0]!;
    const record = g.dungeonState.getMiscRecord(rn);
    check((record?.specialState ?? 0) === 2, "a death's bones carry value 2, the kind marker");
    check(
      g.dungeonState.copyChampionBonesRecord(rn) === (g.party.state.champions[victim]!.fingerprint ?? -1),
      "and an expool record holding the champion's fingerprint",
    );

    // Schedule the altar the way a drop into the alcove does.
    g.timerSystem.scheduleViAltar(rn, cell, decodeObjectID(rn).position & 0x3, g.state.tickCount);

    console.log('');
    console.log(['tick', 'clouds in cell', 'bones in cell', `HERO${victim} alive`, 'health', 'maxHealth'].join('\t'));
    const snapshot = (t: number): void => {
      const c = g.party.state.champions[victim]!;
      console.log([t, cloudsAt(g, cell), bonesAt(g, cell).length, c.alive !== false, c.attributes.health, c.attributes.maxHealth].join('\t'));
    };
    snapshot(0);

    // State 2 fires on the tick it was scheduled for and makes the cloud.
    runTicks(g, 1);
    snapshot(1);
    check(cloudsAt(g, cell) === 1, 'state 2 should put a cloud over the bones — CreateCloud(RNffe4)');
    check(bonesAt(g, cell).length === 1, 'and leave the bones alone for now');
    check(g.party.state.champions[victim]!.alive === false, 'and not yet revive anyone');

    // `Time += 5`: state 1 lands on tick 5, and consumes the bones without yet
    // reviving anyone — the two halves are a tick apart and must stay so, or a
    // champion could come back while their bones are still on the floor.
    runTicks(g, 4);
    snapshot(5);
    check(bonesAt(g, cell).length === 0, 'state 1 should consume the bones');
    check(g.party.state.champions[victim]!.alive === false, 'and still not revive anyone');

    // `Time += 1`: state 0 on tick 6.
    runTicks(g, 1);
    snapshot(6);
    const revived = g.party.state.champions[victim]!;
    check(revived.alive !== false, 'state 0 should bring the champion back');

    // `MaxHP = Larger(25, MaxHP - MaxHP/64 - 1)`, then `HP = MaxHP/2`.
    const expectedMax = Math.max(25, maxHpBefore - Math.floor(maxHpBefore / 64) - 1);
    console.log('');
    console.log(['', 'expected', 'actual'].join('\t'));
    console.log(['maxHealth', expectedMax, revived.attributes.maxHealth].join('\t'));
    console.log(['health', Math.floor(expectedMax / 2), revived.attributes.health].join('\t'));
    check(revived.attributes.maxHealth === expectedMax, 'the maximum takes a permanent MaxHP/64 + 1 cut');
    check(revived.attributes.health === Math.floor(expectedMax / 2), 'and the champion comes back at half of it');
    check(revived.facing === g.party.state.facing, 'facing the way the party faces');
    check(
      g.dungeonState.copyChampionBonesRecord(rn) === null,
      'the expool bones record should be consumed with the bones',
    );
  }

  /* ---------------------------------------- 2. bones authored by the dungeon ----- */

  console.log('');
  console.log('=== bones placed by the dungeon: value IS the champion index ===');
  console.log(['bones value', 'champion', 'was dead', 'revived'].join('\t'));
  {
    // Champion 3, deliberately not index 2 — the value the old code demanded.
    const target = 3;
    const g = makeGame();
    const cell = findOpenCell(g);
    g.party.state.position = cell;
    g.monsterSystem.loadPartyLevel(cell.z);
    g.monsterAttack.killCharacter(target);
    // Clear away the bones the death itself left, so only the authored ones are here.
    for (const rn of bonesAt(g, cell)) {
      g.dungeonState.removeObjectFromCell(cell, rn);
    }

    const rn = makeDungeonBones(g, target, 0);
    g.dungeonState.addObjectToCell(cell, rn);
    check(g.dungeonState.copyChampionBonesRecord(rn) === null, 'authored bones have no expool record');

    g.timerSystem.scheduleViAltar(rn, cell, decodeObjectID(rn).position & 0x3, g.state.tickCount);
    runTicks(g, 8);

    const c = g.party.state.champions[target]!;
    console.log([target, `HERO${target}`, true, c.alive !== false].join('\t'));
    check(c.alive !== false, `bones with value ${target} should revive champion ${target}`);
    check(bonesAt(g, cell).length === 0, 'and consume themselves doing it');
  }

  /* ---------------------------------------- 3. the altar refuses the living ------ */

  console.log('');
  console.log('=== the altar refuses a champion who is not dead ===');
  {
    const target = 3;
    const g = makeGame();
    const cell = findOpenCell(g);
    g.party.state.position = cell;
    g.monsterSystem.loadPartyLevel(cell.z);

    const rn = makeDungeonBones(g, target, 0);
    g.dungeonState.addObjectToCell(cell, rn);
    g.timerSystem.scheduleViAltar(rn, cell, decodeObjectID(rn).position & 0x3, g.state.tickCount);
    runTicks(g, 8);

    const c = g.party.state.champions[target]!;
    console.log(`HERO${target} health ${c.attributes.health}, bones still on the floor: ${bonesAt(g, cell).length === 1}`);
    check(c.attributes.health === 200, 'a living champion is untouched');
    check(bonesAt(g, cell).length === 1, 'and the bones stay on the floor');
  }

  /* ---------------------------------------- 4. the corner search ----------------- */

  console.log('');
  console.log('=== BringCharacterToLife moves a champion whose corner is taken ===');
  console.log(['champion', 'corner before', 'corner after', 'alive'].join('\t'));
  {
    const target = 1;
    const g = makeGame();
    const cell = findOpenCell(g);
    g.party.state.position = cell;
    g.monsterSystem.loadPartyLevel(cell.z);
    g.monsterAttack.killCharacter(target);

    // While the champion lies dead, a living one takes their corner. CSBWin allows
    // this precisely because `CharacterAtPosition` ignores the dead.
    const squatter = 2;
    g.party.state.champions[squatter]!.partyPosition = g.party.state.champions[target]!.partyPosition;
    const cornerBefore = g.party.state.champions[target]!.partyPosition;

    const rn = bonesAt(g, cell)[0]!;
    g.timerSystem.scheduleViAltar(rn, cell, decodeObjectID(rn).position & 0x3, g.state.tickCount);
    runTicks(g, 8);

    const c = g.party.state.champions[target]!;
    console.log([`HERO${target}`, cornerBefore, c.partyPosition, c.alive !== false].join('\t'));
    check(c.alive !== false, 'the champion still comes back');
    check(c.partyPosition !== cornerBefore, 'but not into the corner the squatter took');
    const occupants = g.party.state.champions.filter(
      (o) => o.alive !== false && o.partyPosition === c.partyPosition,
    ).length;
    check(occupants === 1, 'and the corner they land in holds nobody else living');
  }

  finish();
}

main();
