/**
 * `SelectPaletteForLightLevel` (`doc/CSBwin-src/CSBCode.cpp:7301-7395`): `d.CurrentPalette`
 * set by the engine where the light changes, and a monster's sight shortened by it in the
 * dark (`Monster.cpp:577-581`).
 *
 *   npx tsx tools/dump-light-level.ts
 *
 * One champion, on the Atari DM dungeon. The palette a light should give is the first
 * `d.PaletteBrightness` entry at or below the total, 5 with no light at all, read from the
 * tables rather than written here.
 *
 * 1. **A level loaded** (`LoadPartyLevel`, `CSBCode.cpp:829`): level 0, whose experience multiplier
 *    is 0, is palette 0 however dark; level 2 with no light is 5.
 * 2. **A torch into a hand** (`AddCharacterPossession`, `Character.cpp:1997`): one of
 *    charge 3 gives `Word1074[3]`; a second in the other hand adds half of its own
 *    (the second brightest is shifted one place less); out of the hand again
 *    (`RemoveCharacterPossession`, `:1908`), dark.
 * 3. **An Illumulet round the neck** (`:2022`, `:1872`): `Word1074[2]` on, and off.
 * 4. **A light timer** (`SetBrightnessTimer`, `Magic.cpp:842`, as `atk_LIGHT` sets it,
 *    `Attack.cpp`): the light at once, then each `TT_LIGHT` step (`CSBCode.cpp:6576`) back
 *    to the dark.
 * 5. **The torches burning down** (`NinetySecondUpdate`, `:7443`): a torch of charge 1
 *    burns out, and the level goes dark.
 * 6. **A monster's sight**: on level 2, dark, every monster that cannot see in the dark
 *    and sees the party in full light is checked against `d.CurrentPalette`, as the AI
 *    reads it: at least one loses sight of it, none gains it, and a torch gives it back.
 */
import { OBJNI_ILLUMULET_A, OBJNI_TORCH_A } from '../src/core/objectNameIndex';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../src/core/types';
import { monsterCanSeeInDark } from '../src/data/tables/MonsterDesc';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Game } from '../src/engine/Game';
import { distanceBetweenPoints } from '../src/engine/MonsterPerception';
import { MonsterType } from '../src/engine/monsterTypes';
import { GetBasicObjectType } from '../src/engine/objectIndex';
import { ninetySecondUpdate } from '../src/engine/PeriodicUpdates';
import { newGame, processTimersAt, stockGraphics, stockDungeon } from './lib/game';
import { check, finish } from './lib/check';
import { testChampion } from './lib/champion';

const graphics = stockGraphics();
const data = stockDungeon();

const game: Game = newGame(data, graphics);
game.setRandomSeed(0x12345678);
const ctx = game.ctx;
const party = ctx.party.state;
const { word1074, paletteBrightness } = ctx.tables;

const hero = testChampion(0, {
  name: 'HERO',
  attributes: {
    health: 50, maxHealth: 50, stamina: 50, maxStamina: 50, mana: 10, maxMana: 10,
    stats: makeAddCharacterAttributes([40, 40, 40, 40, 40, 40, 40]),
  },
});
party.champions = [hero];

/** The palette CSBWin's search gives for `totalLight`. */
function paletteFor(totalLight: number): number {
  if (totalLight <= 0) return 5;
  let i = 0;
  while (paletteBrightness[i]! > totalLight) i++;
  return i;
}

/** A fresh copy of the dungeon's first record of `objNI`'s category whose basic type is `objNI`. */
function copyOf(category: DBType.WEAPON | DBType.MISC, objNI: number): ObjectID {
  const db = category === DBType.WEAPON ? data!.databases.weapons : data!.databases.misc;
  const count = db.records.length;
  for (let i = 0; i < count; i++) {
    if (GetBasicObjectType(ctx.dungeon, ctx.tables.objDescObjectType, game.ctx.dungeon.rnMaps.rn(category, i)) !== objNI) continue;
    (db.records as object[]).push({ ...db.records[i]!, nextObject: OBJECT_ID_EOF });
    db.count++;
    return game.ctx.dungeon.rnMaps.rn(category, db.records.length - 1);
  }
  throw new Error(`no object ${objNI} in the dungeon`);
}

function torch(charges: number): ObjectID {
  const rn = copyOf(DBType.WEAPON, OBJNI_TORCH_A);
  const weapon = ctx.dungeon.getWeaponRecord(rn)!;
  weapon.charges = charges;
  weapon.litTorch = false;
  return rn;
}

function goTo(level: number, x: number, y: number): void {
  party.position = new Position(x, y, level);
  game.systems.monsters.loadPartyLevel(level);
}

function expect(what: string, want: number): void {
  const got = ctx.state.currentPalette;
  console.log(`${what.padEnd(58)} palette ${got}`);
  check(got === want, `${what}: palette ${want} (got ${got})`);
}

console.log(`PaletteBrightness ${Array.from(paletteBrightness).join(' ')}  Word1074 ${word1074.join(' ')}`);
console.log('');

// 1. A level loaded.
ctx.state.currentPalette = 3;
goTo(0, 1, 3);
expect('level 0 loaded (experience multiplier 0), no light', 0);
goTo(2, 0, 14);
expect('level 2 loaded, no light', 5);

// 2. A torch into a hand, a second, and out again.
const t1 = torch(3);
game.systems.character.addCharacterPossession(0, t1, 1);
expect(`a torch of charge 3 in the weapon hand (Word1074[3] = ${word1074[3]})`, paletteFor(word1074[3]!));
const t2 = torch(3);
game.systems.character.addCharacterPossession(0, t2, 0);
const two = word1074[3]! + (((word1074[3]! << 5) & 0xffff) >> 6);
expect(`and a second in the other hand (total ${two})`, paletteFor(two));
check(paletteFor(two) !== paletteFor(word1074[3]!), 'the second torch changes the palette');
game.systems.character.removeCharacterPossession(0, 0);
game.systems.character.removeCharacterPossession(0, 1);
expect('both out of the hands', 5);

// 3. An Illumulet round the neck, and off.
const illumulet = copyOf(DBType.MISC, OBJNI_ILLUMULET_A);
game.systems.character.addCharacterPossession(0, illumulet, 10);
expect(`an Illumulet round the neck (Word1074[2] = ${word1074[2]})`, paletteFor(word1074[2]!));
game.systems.character.removeCharacterPossession(0, 10);
expect('and off', 5);

// 4. A light timer, as `atk_LIGHT` sets it, and its steps back to the dark.
const start = ctx.state.tickCount;
party.brightness += word1074[2]!;
game.systems.magic.setBrightnessTimer(-2, 2500);
expect(`atk_LIGHT: brightness ${party.brightness}, the timer set`, paletteFor(party.brightness));
processTimersAt(game, start + 2500);
expect(`the first TT_LIGHT step: brightness ${party.brightness}`, paletteFor(party.brightness));
check(party.brightness > 0, 'the first step leaves some light');
processTimersAt(game, start + 2504);
expect(`the second: brightness ${party.brightness}`, 5);

// 5. The torches burning down.
const dying = torch(1);
game.systems.character.addCharacterPossession(0, dying, 1);
expect(`a torch of charge 1 (Word1074[1] = ${word1074[1]})`, paletteFor(word1074[1]!));
ninetySecondUpdate(ctx);
expect(`the ninety-second update burns it out (charge ${ctx.dungeon.getWeaponRecord(dying)!.charges})`, 5);
game.systems.character.removeCharacterPossession(0, 1);

// 6. A monster's sight, dark and lit.
console.log('');
const perception = game.systems.monsterPerception;
const pool = ctx.dungeon.getItem16Pool();
function seers(currentPalette: number): Map<number, number> {
  const seen = new Map<number, number>();
  pool.forEach((slot) => {
    if (slot.word0 < 0) return;
    const rec = ctx.dungeon.getCreatureRecordByIndex(slot.word0);
    if (!rec) return;
    const desc = ctx.tables.monsterDesc[rec.creatureType];
    if (!desc || monsterCanSeeInDark(desc)) return;
    const dist = distanceBetweenPoints(slot.uByte10, slot.uByte11, party.position.x, party.position.y);
    const sees = perception.blocked(rec, -1, 2, slot.uByte10, slot.uByte11, {
      partyX: party.position.x, partyY: party.position.y, partyInvisible: false,
      currentPalette, orthogonalDistanceToParty: dist,
    });
    if (sees !== 0) seen.set(slot.word0, dist);
  });
  return seen;
}
const lit = seers(0);
const dark = seers(ctx.state.currentPalette);
for (const [db4, dist] of lit) {
  const type = ctx.dungeon.getCreatureRecordByIndex(db4)!.creatureType;
  console.log(`${String(MonsterType[type] ?? type).padEnd(16)} at ${dist}: lit sees, dark ${dark.has(db4) ? 'sees' : 'does not'}`);
}
check(lit.size > 0, `a monster that cannot see in the dark sees the party in full light (${lit.size})`);
check([...dark.keys()].every((db4) => lit.has(db4)), 'no monster sees the party only in the dark');
check(dark.size < lit.size, `the dark hides the party from at least one of them (${lit.size} -> ${dark.size})`);
const bright = torch(15);
game.systems.character.addCharacterPossession(0, bright, 1);
expect('a full torch on level 2', 0);
check(seers(ctx.state.currentPalette).size === lit.size, 'and with it they all see the party again');
check(hero.possessions[1] === bright && hero.possessions[0] === OBJECT_ID_NULL, 'the torch is in the weapon hand');

finish();
