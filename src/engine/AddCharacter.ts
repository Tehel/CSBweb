/**
 * `AddCharacter` (`doc/CSBwin-src/Character.cpp:457`) — the Hall of Champions.
 *
 * The engine half: the fingerprint, the champion's corner of the cell, the possession
 * slot chosen for each object lying in the mirror, and the champion record built out of
 * a hero text. `HallOfChampions.addCharacter` drives it;
 * `HallOfChampions.resurrectReincarnateCancel` is the other end
 * (`doc/CSBwin-src/CSBCode.cpp:6674`).
 */

import { DescIndexOfRecord } from './objectIndex';
import { DBType, OBJECT_ID_NULL, type Direction, type ObjectID } from '../core/types';
import type { DatabaseRecord, HeroInventoryItem } from '../data/dungeonTypes';
import { NEOPHYTE_SKILLS, type HeroText, type PresetHero } from '../data/HeroExtractor';
import { CHARFLAG_MALE, emptyPossessions } from '../core/charDesc';
import type { Champion } from './gameTypes';
import { makeAddCharacterAttributes } from './attributes';
import { createSkillsFromSubskillLevels } from './skills';
import { getFromWings, type WingsPool } from './Wings';

export interface AddCharacterTables {
  carryLocation: ArrayLike<number>;
  objDescWord4: ArrayLike<number>;
}

/** One object lying in the mirror's cell, as the slot chooser needs to see it. */
export interface AddCharacterItem {
  rn: ObjectID;
  category: DBType;
  record: DatabaseRecord | null;
}

/**
 * `FingerprintExists` (`doc/CSBwin-src/Character.cpp:438-451`): a champion of the party
 * has it, or one in the wings (`GetFromWings`, testing only).
 */
function fingerprintExists(champions: Champion[], pool: WingsPool, fingerprint: number): boolean {
  if (champions.some((champ) => champ.fingerprint === (fingerprint & 0xffff))) return true;
  return getFromWings(pool, fingerprint, true) !== null;
}

/**
 * `AddCharacter`'s fingerprint (`doc/CSBwin-src/Character.cpp:515-519`) —
 * `(partyLevel<<10)|(partyX<<5)|partyY`, bumped until unused. This is the key the
 * champion's bones record resolves through, so it must be derived, not invented.
 */
export function computeChampionFingerprint(
  champions: Champion[],
  pool: WingsPool,
  level: number,
  x: number,
  y: number,
): number {
  let fingerprint = ((level << 10) | (x << 5) | y) & 0xffff;
  while (fingerprintExists(champions, pool, fingerprint)) {
    fingerprint = (fingerprint + 1) & 0xffff;
  }
  return fingerprint;
}

/**
 * `doc/CSBwin-src/Character.cpp:523-529` — the new champion takes the first corner of
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
 * `CharacterAtPosition` (`doc/CSBwin-src/Code11f52.cpp:4084`) — the champion standing
 * in a given corner, or -1.
 *
 * A corner held by a **dead** champion counts as free: CSBWin returns `i` only inside
 * `if (d.CH16482[i].HP() != 0)` and otherwise keeps looking (`:4100-4104`). That is
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
    if ((champ.attributes?.health | 0) !== 0) return i;
  }
  return -1;
}

/**
 * `AddCharacter`'s possession loop (`doc/CSBwin-src/Character.cpp:731-791`). The slot
 * choice is here; `place` is the `AddCharacterPossession` (`:790`), called for each
 * object as it is chosen, and it must write `possessions`, which the next choice reads.
 * By default it writes the slot and nothing else.
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
  place: (rn: ObjectID, slot: number) => void = (rn, slot) => { possessions[slot] = rn; },
): void {
  let nextBackpackSlot = 13;

  for (const item of items) {
    // CSBWin filters on `dbType() > dbACTUATOR` and then falls off the end of the
    // switch for dbCREATURE/dbMISSILE/dbCLOUD, leaving `LOCAL_6` at whatever the
    // previous iteration left it. That is undefined behaviour, not behaviour: we skip
    // those categories instead.
    if (item.category < DBType.WEAPON || item.category > DBType.MISC) continue;

    const carryMask = getCarryMask(item, tables.objDescWord4) ?? 0;
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
      place(item.rn, slot);
    }
  }
}

/**
 * The same slot choice over a `PresetHero`'s pre-scanned inventory, for the tools. The
 * real Hall of Champions flow goes through `assignAddCharacterPossessions` over the live
 * cell.
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
type ChampionDefaults = Pick<
  Champion,
  | 'busyTimerIndex' | 'attackType' | 'attackStatModifier'
  | 'wounds' | 'poisonCount' | 'maxRecentDamage' | 'damageFromDirection' | 'shieldStrength'
  | 'charFlags' | 'timerIndex' | 'talents' | 'causeOfDamage' | 'monsterCausingDamage' | 'load'
  | 'title' | 'facing' | 'fingerprint'
>;

/**
 * What `AddCharacter` gives every `CHARDESC` before it reads the hero: the whole record
 * cleared, `ClearMemory((ui8 *)pcA3, 800)` (`doc/CSBwin-src/Character.cpp:482`), then its
 * constant stores (`:513-522`). The one initializer of these fields:
 * `createChampionFromPreset` and the tools' champion builders spread it.
 */
export function addCharacterDefaults(): ChampionDefaults {
  return {
    busyTimerIndex: -1, // `pcA3->busyTimer = -1` (`:521`)
    attackType: -1, // `pcA3->attackType = -1` (`:520`)
    attackStatModifier: 0, // `word64`, cleared
    wounds: 0, // `ouches`, cleared
    poisonCount: 0,
    maxRecentDamage: 0,
    damageFromDirection: 0, // `facing3`, cleared here; `AddCharacter` sets it at `:532`
    shieldStrength: 0,
    // `CHARFLAG_positionChanged` (`:531`) is a redraw flag, which the port does not model;
    // `createChampionFromPreset` ORs in `CHARFLAG_male` (`:595`).
    charFlags: 0,
    timerIndex: -1, // `pcA3->timerIndex = -1` (`:522`)
    talents: 0, // `pcA3->talents = 0` (`:513`)
    causeOfDamage: 0,
    monsterCausingDamage: 0,
    load: 0,
    title: '', // read off the hero text (`:586-591`); `createChampionFromPreset` sets it
    // Cleared here. `AddCharacter` then sets `d.partyFacing` (`:523`), and so does
    // `HallOfChampions.addCharacter`.
    facing: 0,
    // Cleared here. `AddCharacter` computes it (`:514-517`), and so do
    // `HallOfChampions.addCharacter` and `HallOfChampions.addChampion`.
    fingerprint: 0,
  };
}

/** `createChampionFromHeroText` with the portrait the preset hero's mirror names, for the tools. */
export function createChampionFromPreset(
  hero: PresetHero,
  partyPosition: number,
  possessions?: ObjectID[],
): Champion {
  return createChampionFromHeroText(hero, hero.portraitIndex, partyPosition, possessions);
}

/** The champion record `AddCharacter` fills from a hero text, with portrait `charID`. */
export function createChampionFromHeroText(
  hero: HeroText,
  charID: number,
  partyPosition: number,
  possessions?: ObjectID[],
): Champion {
  const maxHealth = hero.health;
  const maxStamina = hero.stamina;
  const maxMana = hero.mana;
  const slots = possessions ?? emptyPossessions();
  // `:662-701`, with `neophyteSkills` off: a level-0 letter leaves the skill at nothing.
  const skills = createSkillsFromSubskillLevels(hero.skillLevels, NEOPHYTE_SKILLS);

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
      // (`doc/CSBwin-src/Character.cpp:641-660`).
      stats: makeAddCharacterAttributes([
        hero.luck,
        hero.strength,
        hero.dexterity,
        hero.wisdom,
        hero.vitality,
        hero.antiMagic,
        hero.antiFire,
      ]),
    },
    // `if (D0W == 'M') pcA3->charFlags |= CHARFLAG_male;` (`Character.cpp:592-601`).
    charFlags: hero.male ? CHARFLAG_MALE : 0,
    talents: hero.talents, // `:689`
    portraitGraphic: charID,
    incantation: [],
    food: 1500,
    water: 1500,
    skills,
    possessions: slots,
    partyPosition,
    facing: (partyPosition & 3) as Direction,
  };
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

