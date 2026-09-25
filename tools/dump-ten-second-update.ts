/**
 * `TenSecondUpdate` (`doc/CSBwin-src/Code17818.cpp:160-436`) — everything a champion
 * recovers or consumes while simply standing there. None of it shows on a golden
 * frame until minutes of play have passed.
 *
 *   1. Cadence: every 64 ticks awake, 16 asleep (`doc/CSBwin-src/CSBCode.cpp:686-688`).
 *   2. Attributes: Current steps one point toward Maximum every 256 ticks (64 asleep),
 *      which is what clears the red a level gain leaves on the stats panel. Above
 *      Maximum it falls by `Current / Maximum`.
 *   3. Food and water are consumed, and pay stamina back while positive.
 *   4. HP regenerates when `random112 < Vitality + 12`.
 *   5. A provisional Hall of Champions recruit is skipped entirely.
 *
 * Run: `npx tsx tools/dump-ten-second-update.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { AttributeIndex, incrAttributeMaximum, makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
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
  game.addChampion(champion(0));
  game.party.state.position = new Position(6, 14, 2);
  return game;
}

type Internals = { state: { tickCount: number }; processTenSecondUpdate(): void };

/** Run `TenSecondUpdate`'s gate at every tick in `[from, to]`, as the game tick does. */
function runTicks(game: Game, from: number, to: number): void {
  const g = game as unknown as Internals;
  for (let t = from; t <= to; t++) {
    g.state.tickCount = t;
    g.processTenSecondUpdate();
  }
}

function main(): void {
  console.log('=== cadence (CSBCode.cpp:686-688) ===');
  {
    const game = makeGame();
    const champ = game.party.state.champions[0]!;
    runTicks(game, 1, 63);
    console.log(`after ticks 1..63: food=${champ.food} water=${champ.water}`);
    check(champ.food === 1500 && champ.water === 1500, 'nothing happens before tick 64');
    runTicks(game, 64, 64);
    console.log(`after tick 64:     food=${champ.food} water=${champ.water}`);
    // Rested (Stamina == MaxStamina): D6 stays 4, one pass of the do-loop — food -2, water -1.
    check(champ.food === 1498 && champ.water === 1499, 'a rested champion eats 2 and drinks 1 per update');
    check(champ.attributes.stamina === 100, 'stamina paid back by food stays clamped at MaxStamina');
  }
  {
    const game = makeGame();
    game.party.state.sleeping = true;
    const champ = game.party.state.champions[0]!;
    runTicks(game, 1, 64);
    console.log(`asleep, after ticks 1..64: food=${champ.food}`);
    check(champ.food === 1500 - 4 * 2, 'asleep, the update runs every 16 ticks');
  }

  console.log('');
  console.log('=== attributes return to Maximum (Code17818.cpp:384-414) ===');
  {
    const game = makeGame();
    const champ = game.party.state.champions[0]!;
    const str = champ.attributes.stats[AttributeIndex.Strength];
    incrAttributeMaximum(str, 3); // what LevelUp does (Magic.cpp:98-148)
    const trace: string[] = [];
    for (let t = 64; t <= 1024; t += 64) {
      runTicks(game, t - 63, t);
      trace.push(`${t}:${str.current}/${str.maximum}`);
    }
    console.log(trace.join(' '));
    const g = makeGame();
    const s = g.party.state.champions[0]!.attributes.stats[AttributeIndex.Strength];
    incrAttributeMaximum(s, 3);
    runTicks(g, 1, 255);
    check(s.current === 60, 'no recovery before tick 256');
    runTicks(g, 256, 256);
    check(s.current === 61, 'one point at tick 256');
    runTicks(g, 257, 767);
    check(s.current === 62, 'still one point per 256 ticks');
    runTicks(g, 768, 768);
    check(s.current === 63 && s.maximum === 63, 'a +3 level gain is fully caught up by tick 768');
    runTicks(g, 769, 2048);
    check(s.current === 63, 'Current never overshoots Maximum');
  }
  {
    const game = makeGame();
    game.party.state.sleeping = true;
    const s = game.party.state.champions[0]!.attributes.stats[AttributeIndex.Wisdom];
    incrAttributeMaximum(s, 2);
    runTicks(game, 1, 128);
    check(s.current === 52, 'asleep, one point per 64 ticks');
  }
  {
    const game = makeGame();
    const s = game.party.state.champions[0]!.attributes.stats[AttributeIndex.Dexterity];
    s.current = 120; // maximum 50, e.g. after a potion
    runTicks(game, 1, 256);
    console.log(`over-max Dexterity 120/50 after tick 256: ${s.current}`);
    check(s.current === 118, 'above Maximum, Current drops by Current/Maximum (120/50 = 2)');
  }

  console.log('');
  console.log('=== HP regeneration (Code17818.cpp:350-372) ===');
  {
    const game = makeGame();
    const champ = game.party.state.champions[0]!;
    champ.attributes.health = 100;
    runTicks(game, 64, 64);
    // random112 at 64 is 0x40 = 64, not below Vitality 50 + 12.
    check(champ.attributes.health === 100, 'no regen when random112 (64) >= Vitality+12 (62)');
    runTicks(game, 128, 128);
    // random112 at 128 is 0x80>>2 = 32; (200 >> 7) + 1 = 2.
    console.log(`health after tick 128: ${champ.attributes.health}`);
    check(champ.attributes.health === 102, 'regen of (MaxHP>>7)+1 when random112 (32) < 62');
    // Food is eaten before the HP check and pays stamina back, so a fed champion
    // climbs over the quarter mark in the same update. A starving one does not.
    champ.attributes.stamina = 24;
    champ.food = -600;
    champ.water = -600;
    runTicks(game, 128, 128);
    check(champ.attributes.health === 102, 'no regen below a quarter of MaxStamina');
  }

  console.log('');
  console.log('=== skipped champions ===');
  {
    const game = makeGame();
    game.party.state.potentialChampionIndex = 0;
    const champ = game.party.state.champions[0]!;
    runTicks(game, 64, 64);
    check(champ.food === 1500, 'a provisional recruit (PotentialCharacterOrdinal) is skipped');
  }
  {
    const game = makeGame();
    const champ = game.party.state.champions[0]!;
    champ.attributes.health = 0;
    runTicks(game, 64, 64);
    check(champ.food === 1500, 'a dead champion is skipped');
  }

  finish();
}

main();
