/**
 * Prove `CastSpell` honours a spell filter's overrides where CSBWin does, and only there.
 *
 * A DSA spell filter (`DsaSystem.processSpellFilter`) can rewrite the `SPELL_PARAMETERS`
 * `CastSpell` receives (`doc/CSBwin-src/Magic.cpp:1092`). No dungeon this port loads defines
 * one, so this calls `MagicSystem.castSpell` with the parameters directly:
 *
 * - the difficulty is `D4W = pSpell->skillRequired + spellPower` — the spell's own skill,
 *   not the filter's — while the filter's `skillRequired` feeds only the experience's
 *   middle term `8 * (spellPower - 1) * skillRequired` (`:1201-1213`);
 * - a filter's `missileType` replaces `BITS4_9(pSpell->word6)` (`:1203-1207`), so it
 *   changes what a class-3 spell does;
 * - `action` is handled first, before `chIdx >= d.NumCharacter` and `HP() == 0`
 *   (`:1112-1155`): a filter's abort message prints for a dead caster, and an action with
 *   no message (8) casts normally.
 * - Zokathra (missile type 7) goes into the first empty hand, and with both hands full is
 *   dropped in the party's cell with `MoveObject(obj_2, -1, 0, d.partyX, d.partyY)`
 *   (`:1362-1389`), so the pads there see it placed, with `unchangedRoom` true.
 *
 * Run: `npx tsx tools/dump-cast-spell.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, type ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import type { SpellParameters } from '../src/engine/magicTypes';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';
import { CHARFLAG_PORTRAIT_CHANGED, emptyPossessions } from '../src/engine/gameTypes';

/** Rune 0x69 alone: class 3, missile type 5, skill 1, `byte5` 16 in the Atari table. */
const SPELL_RUNE = 0x69;
/** Power rune 0x61: `spellPower = 0x61 - 95 = 2`, so the middle term is not zero. */
const POWER_RUNE = 0x61;

function champion(i: number): Champion {
  // Wizard base (3) and subskill 16 at 2000 each: mastery 3, enough for D4W = 1 + 2.
  const skills = Array.from({ length: 20 }, () => ({ experience: 0, tempAdjust: 0 }));
  skills[3].experience = 2000;
  skills[16].experience = 2000;
  return {
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    skills,
    possessions: emptyPossessions(),
    partyPosition: i,
  } as unknown as Champion;
}

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

  const printed: string[] = [];
  const portraits: number[] = [];
  const game = newGame(data, graphics, {
    drawCharacterState: (chIdx, charFlags) => { if ((charFlags & CHARFLAG_PORTRAIT_CHANGED) !== 0) portraits.push(chIdx); },
    messages: {
      printLinefeed: () => {},
      quePrintLines: (_color, text) => { printed.push(text); },
      printLines: () => {},
      setNewSpeed: () => {},
      resetTime: () => {},
      clockTick: () => {},
      printNextQueued: () => {},
      vblInterrupt: () => {},
      discardText: () => {},
    },
  });
  game.ctx.party.state.position = new Position(2, 2, 0);

  const magic = game.systems.magic;

  /** One cast from a fresh party with the same seed, under `overrides`. */
  const cast = (overrides: Partial<SpellParameters>, setup?: (c: Champion) => void) => {
    game.setRandomSeed(0x12345678);
    game.ctx.party.state.champions = [champion(0)];
    game.ctx.party.state.seeThruWalls = 0;
    const c = game.ctx.party.state.champions[0];
    c.incantation = [POWER_RUNE, SPELL_RUNE];
    setup?.(c);
    printed.length = 0;
    const params = { ...magic.fillSpellParameters(0, c.incantation, game.ctx.party.state), ...overrides };
    const result = magic.castSpell(0, params);
    const skills = c.skills as unknown as Array<{ experience: number }>;
    return {
      result,
      experience: skills[16].experience - 2000,
      seeThruWalls: game.ctx.party.state.seeThruWalls,
      printed: printed.join(' '),
    };
  };

  const plain = cast({});
  const hardSkill = cast({ skillRequired: 60 });
  const seeThru = cast({ missileType: 2 });
  // Ya Ir, the party shield: `MarkAllPortraitsChanged` (`doc/CSBwin-src/Magic.cpp:1331`).
  game.ctx.party.state.partyShield = 0;
  portraits.length = 0;
  const partyShield = cast({ missileType: 4 });
  const partyShieldUp = game.ctx.party.state.partyShield;
  const partyShieldPortraits = portraits.join(',');
  const deadAbort = cast({ action: 3 }, (c) => { c.attributes.health = 0; });
  const silentAbort = cast({ action: 1 });
  const unknownAction = cast({ action: 8 });

  // Zokathra, through a filter's missile type 7, with the hands full or not. Every pad call
  // for a misc object is recorded.
  const actuators = game.systems.actuators;
  const realTrigger = actuators.triggerObjectMove.bind(actuators);
  const padCalls: string[] = [];
  actuators.triggerObjectMove = (position, object, place, unchangedRoom, facing) => {
    if (game.ctx.dungeon.rnMaps.dbType(object) === DBType.MISC) {
      padCalls.push(`(${position.x},${position.y},${position.z}) ${place ? 'place' : 'lift'} unchanged ${unchangedRoom}`);
    }
    return realTrigger(position, object, place, unchangedRoom, facing);
  };
  const party = game.ctx.party.state.position;
  const miscAtParty = (): ObjectID[] => {
    const found: ObjectID[] = [];
    for (let rn = game.ctx.dungeon.findFirstObject(party); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
      if (game.ctx.dungeon.rnMaps.dbType(rn) === DBType.MISC) found.push(rn);
    }
    return found;
  };
  const zokathra = (hands: number) => {
    const before = miscAtParty().length;
    padCalls.length = 0;
    const r = cast({ missileType: 7 }, (c) => {
      for (let slot = 0; slot < hands; slot++) c.possessions[slot] = game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, slot);
    });
    const [hand0, hand1] = game.ctx.party.state.champions[0].possessions;
    const inCell = miscAtParty();
    return { result: r.result, hand0, hand1, dropped: inCell.length - before, last: inCell[inCell.length - 1], pads: [...padCalls] };
  };
  const zokEmpty = zokathra(0);
  const zokFull = zokathra(2);
  actuators.triggerObjectMove = realTrigger;

  const row = (label: string, r: ReturnType<typeof cast>): void =>
    console.log(`${label.padEnd(28)} result ${r.result}  exp +${r.experience}  seeThru ${r.seeThruWalls}  printed ${JSON.stringify(r.printed)}`);
  row('unfiltered', plain);
  row('skillRequired 60', hardSkill);
  row('missileType 2', seeThru);
  row('missileType 4', partyShield);
  console.log(`${''.padEnd(28)} d.PartyShield ${partyShieldUp}  portraits changed [${partyShieldPortraits}]`);
  row('action 3, dead caster', deadAbort);
  row('action 1', silentAbort);
  row('action 8', unknownAction);
  const hex = (v: number | undefined): string => (v === undefined ? '-' : `0x${v.toString(16)}`);
  for (const [label, z] of [['zokathra, hands empty', zokEmpty], ['zokathra, both hands full', zokFull]] as const) {
    console.log(`${label.padEnd(28)} result ${z.result}  hands ${hex(z.hand0)} ${hex(z.hand1)}  dropped ${z.dropped}  `
      + `pads ${JSON.stringify(z.pads)}`);
  }
  console.log('');

  check(plain.result === 1, 'the unfiltered spell should succeed (mastery 3 >= D4W 3)');
  check(plain.seeThruWalls === 0, 'type 5 is not see-through-walls');
  check(hardSkill.result === 1,
    "a filter's skillRequired should not make the spell harder: D4W is the spell's own skill + power");
  // Same seed, same `STRandom() & 7`, same D4W: only `8 * (spellPower - 1) * skillRequired`
  // differs, by 8 * 1 * (60 - 1). AdjustSkills adds it unscaled on level 0.
  check(hardSkill.experience - plain.experience === 8 * 1 * (60 - 1),
    `a filter's skillRequired should enter only the experience's middle term (+${hardSkill.experience} vs +${plain.experience})`);
  check(seeThru.result === 1 && seeThru.seeThruWalls === 1,
    "a filter's missileType 2 should make the class-3 spell see-through-walls");
  check(partyShield.result === 1 && partyShieldUp > 0 && partyShieldPortraits === '0',
    "the party shield draws every champion's box afresh (Magic.cpp:1331)");
  check(deadAbort.result === 0 && deadAbort.printed === 'THE SPELL FIZZLES.',
    `a filter's abort should print for a dead caster, as CSBWin checks the action first (${JSON.stringify(deadAbort.printed)})`);
  check(silentAbort.result === 0 && silentAbort.printed === '', 'action 1 should abort silently');
  check(unknownAction.result === 1, 'an action with no message (8) should cast normally');
  check(zokEmpty.result === 1 && game.ctx.dungeon.rnMaps.dbType(zokEmpty.hand0) === DBType.MISC
    && zokEmpty.dropped === 0 && zokEmpty.pads.length === 0,
    'Zokathra with a hand empty goes into hand 0, and nothing is dropped');
  check(zokFull.result === 1 && zokFull.dropped === 1 && zokFull.last !== undefined
    && game.ctx.dungeon.rnMaps.pos(zokFull.last) === 0,
    'Zokathra with both hands full lies in the party\'s cell, at corner 0');
  check(zokFull.pads.length === 1 && zokFull.pads[0] === `(${party.x},${party.y},${party.z}) place unchanged true`,
    `Zokathra with both hands full is placed through MoveObject, so the pads see it (Magic.cpp:1382-1389): ${JSON.stringify(zokFull.pads)}`);

  finish();
}

main();
