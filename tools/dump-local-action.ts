/**
 * An actuator's local action (`PerformLocalAction`, `doc/CSBwin-src/Mouse.cpp:239-257`) —
 * which champion a skill increaser credits, and what position a pad or alcove hands on.
 *
 *  1. Type 10 is `SkillIncreaser(8, 300, mapPos == -1 ? 0 : 1)` (`Mouse.cpp:210-231`).
 *     With a position it credits `d.HandChar`, the champion who owns the cursor, and
 *     nobody when there is none. The port used to look for the living champion whose
 *     *cell* (`partyPosition`) equalled the actuator's wall position — a cell treated
 *     as a champion index, the same confusion once fixed in `Party.getPartyChampion`.
 *  2. With `-1` the 300 is split: `sw(300 / d.NumCharacter)` to every champion with
 *     `HP() != 0`, the dead still counting in the divisor.
 *  3. `PressurePadOrAlcove` ends `QueueSwitchAction(DB3A3, tmrAction, mapX, mapY, -1)`
 *     (`doc/CSBwin-src/Code11f52.cpp:3910`) — `-1` for an alcove as much as a floor pad.
 *     The port passed the alcove's wall position on, so an alcove skill increaser
 *     credited one champion instead of splitting, and an alcove's `RotateActuatorList`
 *     (`:3506-3560`) filtered by a position CSBWin never gives it.
 *
 * Run: `npx tsx tools/dump-local-action.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, Direction, Position } from '../src/core/types';
import { CsbRandom } from '../src/core/random';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { ActuatorSystem } from '../src/engine/ActuatorSystem';
import { DsaSystem } from '../src/engine/DsaSystem';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import type { AddCharacterTables } from '../src/engine/AddCharacter';
import { Party } from '../src/engine/Party';
import { graphicsTablesOf, newContext, presetHeroesOf } from './lib/game';
import { check, finish } from './lib/check';

const SKILL = 8;

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const uiTables = graphicsTablesOf(graphics).ui;
  const objectTables = graphicsTablesOf(graphics).objects;
  const addTables: AddCharacterTables = {
    carryLocation: uiTables.graphic232.carryLocation,
    objDescWord4: objectTables.objDescWord4,
  };
  const heroes = presetHeroesOf(data, graphics);
  if (heroes.length < 3) throw new Error('dungeon.dat carries fewer than three preset heroes');

  // Three champions whose cells are deliberately not their indices: index 0 stands in
  // cell 2, index 1 in cell 0, index 2 in cell 1.
  const CELLS = [2, 0, 1];
  const makeParty = (handChar: number): { party: Party; actuators: ActuatorSystem } => {
    const party = new Party(new Position(1, 1, 0), Direction.NORTH);
    CELLS.forEach((cell, i) =>
      party.addChampion(createChampionFromPreset(heroes[i], cell, assignPresetHeroPossessions(heroes[i].inventory, addTables))));
    party.state.cursorOwner = handChar;
    const ctx = newContext(data, graphics, { party, random: new CsbRandom(0x1234) });
    ctx.state.tickCount = 1000;
    const actuators = new ActuatorSystem(ctx);
    // `AdjustSkills` asks the DSA's skill filter, which this dungeon does not define.
    ctx.systems.dsa = new DsaSystem(ctx);
    return { party, actuators };
  };
  const exp = (party: Party): number[] => party.state.champions.map((c) => c.skills[SKILL].experience);
  const gained = (before: number[], after: number[]): number[] => after.map((v, i) => v - before[i]);

  // ---- 1. A positioned skill increaser credits d.HandChar, not whoever stands in that cell.
  {
    const { party, actuators } = makeParty(1);
    const before = exp(party);
    (actuators as any).performLocalAction(10, 5, 5, 0, 2);
    const g = gained(before, exp(party));
    console.log(`1. HandChar 1, wall position 2 (champion 0's cell): gained ${g.join(', ')}`);
    check(g[1] > 0 && g[0] === 0 && g[2] === 0, 'only d.HandChar (champion 1) is credited, not the champion standing in cell 2');
  }
  {
    const { party, actuators } = makeParty(-1);
    const before = exp(party);
    (actuators as any).performLocalAction(10, 5, 5, 0, 2);
    const g = gained(before, exp(party));
    console.log(`   HandChar -1: gained ${g.join(', ')}`);
    check(g.every((v) => v === 0), 'with no cursor owner a positioned skill increaser credits nobody');
  }

  // ---- 2. mapPos -1: 300 / NumCharacter to each living champion, the dead in the divisor.
  let split = 0;
  {
    const { party, actuators } = makeParty(0);
    party.state.champions[2].attributes.health = 0;
    const before = exp(party);
    (actuators as any).performLocalAction(10, 5, 5, 0, -1);
    const g = gained(before, exp(party));
    split = g[0];
    console.log(`2. mapPos -1, champion 2 dead: gained ${g.join(', ')}`);
    check(g[0] > 0 && g[0] === g[1] && g[2] === 0, 'the whole-party split credits the living equally and the dead not at all');
  }
  {
    const { party, actuators } = makeParty(0);
    const before = exp(party);
    (actuators as any).performLocalAction(10, 5, 5, 0, 2);
    const whole = gained(before, exp(party))[0];
    console.log(`   one champion's share of the split vs the whole 300: ${split} vs ${whole}`);
    check(split < whole, 'the split share is smaller than a single champion\'s whole 300 (the dead count in the divisor)');
  }

  // ---- 3. An alcove hands PerformLocalAction -1, never its wall position.
  {
    const { actuators } = makeParty(0);
    const seen: number[] = [];
    (actuators as any).performLocalAction = (_type: number, _x: number, _y: number, _z: number, mapPos: number) => seen.push(mapPos);
    // Wall actuator type 1 (any object), local-action only, local type 10, action SET.
    const rec = { nextObject: 0xfffe, word2: 1, word4: 0x800, word6: 10 << 4 };
    const rnMaps = (actuators as any).dungeon.rnMaps;
    const rn = rnMaps.setPos(rnMaps.rn(DBType.ACTUATOR, 0), 2);
    const context = {
      objectDB5To13Present: false, monstersPresent: false, sameTypeObjectPresent: false,
      differentTypeObjectPresent: false, movedObjectDBNum: DBType.WEAPON, movedObjectNameIndex: 0,
    };
    (actuators as any).pressurePadOrAlcove(rn, rec, new Position(5, 5, 0), true, false, 0x1400, 2, 0, context);
    console.log(`3. alcove at wall position 2: PerformLocalAction mapPos = ${seen.join(', ') || '(not called)'}`);
    check(seen.length === 1, 'the alcove actuator fires its local action');
    check(seen[0] === -1, 'PressurePadOrAlcove passes -1, not the alcove\'s wall position');
  }

  finish();
}

void main();
