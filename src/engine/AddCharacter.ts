/**
 * `AddCharacter` (`doc/CSBwin-src/Character.cpp:456`) — the Hall of Champions.
 *
 * The engine half: the fingerprint, the champion's corner of the cell, the possession
 * slot chosen for each object lying in the mirror, and the champion record built out of
 * a hero text. `Game.addCharacter` drives it; `Game.resurrectReincarnateCancel` is the
 * other end (`doc/CSBwin-src/CSBCode.cpp:6615`).
 */

import { DescIndexOfRecord } from './objectIndex';
import { DBType, OBJECT_ID_NULL, type Direction, type ObjectID } from '../core/types';
import type { DatabaseRecord, HeroInventoryItem, PresetHero } from '../data/dungeonTypes';
import { CHARFLAG_MALE } from '../data/CsbwinCharacters';
import { emptyPossessions, type Champion } from './gameTypes';
import { makeAddCharacterAttributes } from './attributes';
import { createSkillsFromSubskillLevels } from './skills';

const FIGHTER_SUBSKILLS = ['Swing', 'Thrust', 'Club', 'Parry'];
const NINJA_SUBSKILLS = ['Steal', 'Fight', 'Throw', 'Shoot'];
const PRIEST_SUBSKILLS = ['Identify', 'Heal', 'Influence', 'Defend'];
const WIZARD_SUBSKILLS = ['Fire', 'Air', 'Earth', 'Water'];

export interface AddCharacterTables {
  carryLocation: ArrayLike<number>;
  objDescCarryMask: ArrayLike<number>;
}

/** One object lying in the mirror's cell, as the slot chooser needs to see it. */
export interface AddCharacterItem {
  rn: ObjectID;
  category: DBType;
  record: DatabaseRecord | null;
}

/**
 * `FingerprintExists` (`doc/CSBwin-src/Character.cpp:437-450`).
 *
 * ⚠️ CSBWin also searches the wings (`character.GetFromWings`), the pool of champions
 * who have left the party. We have no wings, so only the live party is scanned.
 */
export function fingerprintExists(champions: Champion[], fingerprint: number): boolean {
  return champions.some((champ) => (champ.fingerprint ?? 0) === (fingerprint & 0xffff));
}

/**
 * `AddCharacter`'s fingerprint (`doc/CSBwin-src/Character.cpp:514-518`) —
 * `(partyLevel<<10)|(partyX<<5)|partyY`, bumped until unused. This is the key the
 * champion's bones record resolves through, so it must be derived, not invented.
 */
export function computeChampionFingerprint(
  champions: Champion[],
  level: number,
  x: number,
  y: number,
): number {
  let fingerprint = ((level << 10) | (x << 5) | y) & 0xffff;
  while (fingerprintExists(champions, fingerprint)) {
    fingerprint = (fingerprint + 1) & 0xffff;
  }
  return fingerprint;
}

/**
 * `doc/CSBwin-src/Character.cpp:522-528` — the new champion takes the first corner of
 * the cell nobody stands in, counting round from the party's facing.
 */
export function findFreeCharPosition(champions: Champion[], partyFacing: number): number {
  let step = 0;
  while (step < 4 && characterAtPosition(champions, (step + partyFacing) & 3) !== -1) {
    step++;
  }
  return (step + partyFacing) & 3;
}

/**
 * `CharacterAtPosition` (`doc/CSBwin-src/Code11f52.cpp:4046`) — the champion standing
 * in a given corner, or -1.
 *
 * A corner held by a **dead** champion counts as free: CSBWin returns `i` only inside
 * `if (d.CH16482[i].HP() != 0)` and otherwise keeps looking (`:4062-4066`). That is
 * load-bearing in both callers. A new champion may take a corpse's corner; and
 * `BringCharacterToLife` asks this about the champion it is *about to* revive, who is
 * still dead — were they to match themselves, every resurrection would relocate, and
 * a full party of four would send the free-corner search below off the end.
 */
export function characterAtPosition(champions: Champion[], position: number): number {
  for (let i = 0; i < champions.length; i++) {
    const champ = champions[i];
    if (!champ) continue;
    if ((champ.partyPosition | 0) !== position) continue;
    if (champ.alive === false) continue;
    if ((champ.attributes?.health | 0) !== 0) return i;
  }
  return -1;
}

/**
 * `AddCharacter`'s possession loop (`doc/CSBwin-src/Character.cpp:730-790`), slot
 * choice only — the caller does the `AddCharacterPossession` half.
 *
 * The control flow is CSBWin's `switch` with two `goto case9`s and a `switchbreak`
 * label, kept shape-for-shape because the fall-throughs are the behaviour: a scroll or
 * potion whose slot 11 is taken sets slot 6 and then *jumps past it*, so slot 6 is
 * never actually used, and clothing that matches no body slot lands on the neck only if
 * the neck is both legal and free.
 */
export function assignAddCharacterPossessions(
  items: Iterable<AddCharacterItem>,
  tables: AddCharacterTables,
  possessions: ObjectID[],
): void {
  let nextBackpackSlot = 13;

  for (const item of items) {
    // CSBWin filters on `dbType() > dbACTUATOR` and then falls off the end of the
    // switch for dbCREATURE/dbMISSILE/dbCLOUD, leaving `LOCAL_6` at whatever the
    // previous iteration left it. That is undefined behaviour, not behaviour: we skip
    // those categories instead.
    if (item.category < DBType.WEAPON || item.category > DBType.MISC) continue;

    const carryMask = getCarryMask(item, tables.objDescCarryMask) ?? 0;
    const neckLegal = (carryMask & getCarryLocation(tables.carryLocation, 10)) !== 0;
    let slot = -1;
    let toCase9 = false;

    switch (item.category) {
      case DBType.CLOTHING: {
        let matched = false;
        for (slot = 2; slot <= 5; slot++) {
          if ((carryMask & getCarryLocation(tables.carryLocation, slot)) !== 0) {
            matched = true;
            break;
          }
        }
        if (matched) break;
        if (neckLegal && possessions[10] === OBJECT_ID_NULL) {
          slot = 10;
          break;
        }
        toCase9 = true;
        break;
      }
      case DBType.WEAPON:
        if (possessions[1] !== OBJECT_ID_NULL) {
          toCase9 = true;
          break;
        }
        slot = 1;
        break;
      case DBType.SCROLL:
      case DBType.POTION:
        if (possessions[11] === OBJECT_ID_NULL) {
          slot = 11;
          break;
        }
        if (possessions[6] === OBJECT_ID_NULL) slot = 6;
        toCase9 = true;
        break;
      default:
        // dbCHEST and dbMISC enter at `case9:` directly.
        toCase9 = true;
        break;
    }

    // `case9:` — neck if it will take the object, otherwise the next backpack slot.
    // Reached again from `switchbreak:` when the chosen slot turns out to be full.
    for (;;) {
      if (toCase9) {
        if (neckLegal && possessions[10] === OBJECT_ID_NULL) {
          slot = 10;
        } else {
          slot = nextBackpackSlot++;
        }
      }
      // `switchbreak:`
      if (slot >= 0 && slot < possessions.length && possessions[slot] !== OBJECT_ID_NULL) {
        toCase9 = true;
        continue;
      }
      break;
    }

    if (slot >= 0 && slot < 30) {
      possessions[slot] = item.rn;
    }
  }
}

/**
 * The same slot choice over a `PresetHero`'s pre-scanned inventory, for the debug
 * random party in `src/dev.ts` and for the tools. The real Hall of Champions flow goes
 * through `assignAddCharacterPossessions` over the live cell.
 */
export function assignPresetHeroPossessions(
  items: HeroInventoryItem[],
  tables: AddCharacterTables,
): ObjectID[] {
  const possessions = emptyPossessions();
  assignAddCharacterPossessions(items, tables, possessions);
  return possessions;
}

/** The `Champion` fields `addCharacterDefaults` initializes. */
export type ChampionDefaults = Pick<
  Champion,
  | 'actionDisabledUntil' | 'busyTimerIndex' | 'attackType' | 'attackStatModifier'
  | 'wounds' | 'poisonCount' | 'maxRecentDamage' | 'damageFromDirection' | 'shieldStrength'
>;

/**
 * What `AddCharacter` gives every `CHARDESC` before it reads the hero: the whole record
 * cleared, `ClearMemory((ui8 *)pcA3, 800)` (`doc/CSBwin-src/Character.cpp:481`), then its
 * constant stores (`:510-519`). The one initializer of these fields:
 * `createChampionFromPreset` and the tools' champion builders spread it, and
 * `Party.setState` fills an older save's gaps from it.
 */
export function addCharacterDefaults(): ChampionDefaults {
  return {
    // The port's own tick at which the busy champion is free (0: not busy); CSBWin
    // keeps only the timer, `busyTimer`.
    actionDisabledUntil: 0,
    busyTimerIndex: -1, // `pcA3->busyTimer = -1` (`:518`)
    attackType: -1, // `pcA3->attackType = -1` (`:517`)
    attackStatModifier: 0, // `word64`, cleared
    wounds: 0, // `ouches`, cleared
    poisonCount: 0,
    maxRecentDamage: 0,
    damageFromDirection: 0, // `facing3`, cleared here; `AddCharacter` sets it at `:531`
    shieldStrength: 0,
  };
}

export function createChampionFromPreset(
  hero: PresetHero,
  partyPosition: number,
  possessions?: ObjectID[],
): Champion {
  const maxHealth = hero.health;
  const maxStamina = hero.stamina;
  const maxMana = hero.mana;
  const fighter = maxSkill(hero.fighter);
  const ninja = maxSkill(hero.ninja);
  const priest = maxSkill(hero.priest);
  const wizard = maxSkill(hero.wizard);
  const slots = possessions ?? emptyPossessions();
  const skills = createSkillsFromSubskillLevels(getPresetSubskillLevels(hero));

  return {
    ...addCharacterDefaults(),
    name: hero.name,
    title: hero.title,
    attributes: {
      health: maxHealth,
      maxHealth,
      stamina: maxStamina,
      maxStamina,
      mana: maxMana,
      maxMana,
      // `AddCharacter` reads the seven attributes off the mirror's text in this
      // order and gives each the same Maximum and Current
      // (`doc/CSBwin-src/Character.cpp:640-659`).
      stats: makeAddCharacterAttributes([
        hero.luck,
        hero.strength,
        hero.dexterity,
        hero.wisdom,
        hero.vitality,
        hero.antiMagic,
        hero.antiFire,
      ]),
      experience: 0,
      fighter,
      ninja,
      priest,
      wizard,
    },
    alive: true,
    // `if (D0W == 'M') pcA3->charFlags |= CHARFLAG_male;` — and a hero whose gender
    // letter is neither M nor F is rejected outright (`Character.cpp:591-600`).
    charFlags: hero.gender === 'M' ? CHARFLAG_MALE : 0,
    portraitGraphic: hero.portraitIndex,
    incantation: [],
    food: 1500,
    water: 1500,
    skills,
    possessions: slots,
    partyPosition,
    facing: (partyPosition & 3) as Direction,
  };
}

function maxSkill(skills: Record<string, number>): number {
  let max = 0;
  for (const value of Object.values(skills)) {
    if (value > max) max = value;
  }
  return max;
}

function getPresetSubskillLevels(hero: PresetHero): number[] {
  return [
    ...collectLevels(hero.fighter, FIGHTER_SUBSKILLS),
    ...collectLevels(hero.ninja, NINJA_SUBSKILLS),
    ...collectLevels(hero.priest, PRIEST_SUBSKILLS),
    ...collectLevels(hero.wizard, WIZARD_SUBSKILLS),
  ];
}

function collectLevels(skills: Record<string, number>, names: string[]): number[] {
  return names.map((name) => {
    const value = skills[name];
    return typeof value === 'number' ? value : 0;
  });
}

function getCarryLocation(carryLocation: ArrayLike<number>, slot: number): number {
  const value = carryLocation[slot];
  return typeof value === 'number' ? value : 0;
}

function getCarryMask(item: AddCharacterItem, masks: ArrayLike<number>): number | null {
  const objDescIndex = DescIndexOfRecord(item.category, item.record);
  if (objDescIndex === -1) return null;
  const mask = masks[objDescIndex];
  return typeof mask === 'number' ? mask : null;
}

