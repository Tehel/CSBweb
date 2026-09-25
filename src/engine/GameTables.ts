/**
 * `GameTables` — every table the engine reads from `graphics.dat`, in one read-only set.
 *
 * CSBWin keeps them all in the one global `d.` (`doc/CSBwin-src/Data.h`), filled from
 * graphics `0x22e`, `0x22f`, `0x230` and `0x232` when the game starts. The port used to
 * hand each subsystem a bag of its own (`ActuatorTables`, `TimerTables`, …), grouped by
 * whoever read a table first and with every field optional; a tool built only the ones
 * it thought it needed. This is the one set, grouped by content and named as CSBWin names
 * them. Every field is required: `buildGameTables` fills them all, for the game and for
 * the tools alike (`DEBT.md` E1a).
 *
 * Fields the port had renamed keep CSBWin's name here (`byte1596`, not
 * `roomTimerFunctions`); the port's name is in the comment. The fields of a struct array
 * (`d.weapons[].weight`, `d.ClothingDesc[].uByte1`) keep the port's names, since CSBWin
 * gives them none worth keeping.
 */
import type { GraphicsLoader } from '../data/GraphicsLoader';
import type { SpellDefinition } from '../data/spellTypes';
import {
  extractObjectTables,
  type MonsterDesc,
  type WeaponDesc,
} from '../renderer/csbwin/ObjectTables';
import { extractUITables, type SoundTableEntry } from '../renderer/csbwin/UITables';
import { extractViewportTables } from '../renderer/csbwin/ViewportTables';

export interface GameTables {
  // --- Objects: `d.ObjDesc`, where a possession may go, and in what order it drops ---

  /** `d.ObjDesc[180].objectType()` — an object's name index (`Data.h:1085`). */
  readonly objDescObjectType: ArrayLike<number>;
  /** `d.ObjDesc[180].word4` — the carry-location mask (the port's `objDescCarryMask`). */
  readonly objDescWord4: ArrayLike<number>;
  /** `d.CarryLocation[38]` (`Data.h:1427`). */
  readonly carryLocation: ArrayLike<number>;
  /** `d.Byte640` — a lit torch's charge to its name-index offset (`Data.h:1450`). */
  readonly byte640: ArrayLike<number>;
  /** `d.DropOrder[30]` — the order `DropAllPossessions` empties the slots (`Data.h:1405`). */
  readonly dropOrder: ArrayLike<number>;

  // --- Object descriptors: weapons, clothing, miscellaneous ---

  /** `d.weapons[46]`, the whole `WEAPONDESC` (`Data.h:1082`). */
  readonly weaponDesc: ArrayLike<WeaponDesc>;
  /** `d.weapons[46].weight`. */
  readonly weaponWeights: ArrayLike<number>;
  /** `d.ClothingDesc[58].weight` (`Data.h:1081`). */
  readonly clothingWeights: ArrayLike<number>;
  /** `d.ClothingDesc[58].uByte1` — the armour strength a garment gives. */
  readonly clothingArmour: ArrayLike<number>;
  /** `d.ClothingDesc[58].uByte2` — flags; bit 7 marks a shield. */
  readonly clothingFlags: ArrayLike<number>;
  /** `d.Byte8946[54]` — the miscellaneous objects' weights (the port's `miscWeights`). */
  readonly byte8946: ArrayLike<number>;

  // --- Monsters ---

  /** `d.MonsterDescriptor[27]` (`Data.h:1076`). */
  readonly monsterDesc: ArrayLike<MonsterDesc>;
  /** `d.MonsterDroppings[40]` — what a dying monster leaves behind (`Data.h:1074`). */
  readonly monsterDroppings: ArrayLike<number>;
  /** `d.Byte10340[4]` — a group's facing byte without an `ITEM16` (the port's `facingReplication`). */
  readonly byte10340: ArrayLike<number>;
  /** `d.uByte9672[8]` — the monster attack sounds (the port's `monsterAttackSounds`). */
  readonly uByte9672: ArrayLike<number>;

  // --- The dungeon ---

  /** `d.DoorCharacteristics[4]`, which each level indexes twice to form `DoorTOC` (`Data.h:1073`). */
  readonly doorCharacteristics: ArrayLike<number>;
  /** `d.Byte1596[8]` — the room-type timer functions (the port's `roomTimerFunctions`). */
  readonly byte1596: ArrayLike<number>;
  /** `d.Word1074[16]` — the light table; entry 2 is an Illumulet's brightness (`Data.h:1424`). */
  readonly word1074: number[];

  // --- The party: where a blow lands, how a shield covers it, the message colours ---

  /** `d.uByte590[4]` — wound-location bitmasks. */
  readonly uByte590: ArrayLike<number>;
  /** `d.Byte586[8][4]` — the order an attack from a given side reaches the party. */
  readonly byte586: ArrayLike<ArrayLike<number>>;
  /** `d.Byte1412[6]` — per-body-part shield weighting. */
  readonly byte1412: ArrayLike<number>;
  /** `d.Byte1386[4]` — each champion's message colour (the port's `championMessageColors`). */
  readonly byte1386: ArrayLike<number>;

  // --- Attacks and spells: graphic `0x230`, indexed by `ATTACKTYPE` (`Data.h:638-651`) ---

  /** `d.experienceForAttacking[44]` (`Byte20178`). */
  readonly experienceForAttacking: ArrayLike<number>;
  /** `d.SkillNumber[44]`. */
  readonly skillNumber: ArrayLike<number>;
  /** `d.Byte20046[44]` — base stamina cost. */
  readonly byte20046: ArrayLike<number>;
  /** `d.Byte20002[44]`. */
  readonly byte20002: ArrayLike<number>;
  /** `d.Byte19958[44]`. */
  readonly byte19958: ArrayLike<number>;
  /** `d.Byte19914[44]` — how long the attack keeps the champion busy. */
  readonly byte19914: ArrayLike<number>;
  /** `d.Byte20090[44]` — the defence penalty an attack type carries while busy. */
  readonly byte20090: ArrayLike<number>;
  /** `d.AttackNames` — "KICK", "PUNCH", … in `ATTACKTYPE` order. */
  readonly attackNames: ArrayLike<string>;
  /** The spell table graphic `0x230` carries, for `CastSpell`. */
  readonly spells: readonly SpellDefinition[];

  // --- Sound ---

  /** `d.sound1772[22]` — `QueueSound`'s table (the port's `soundTable`, `Data.h:1402`). */
  readonly sound1772: SoundTableEntry[];
}

/** Every table in `GameTables`, extracted from `graphics.dat`. */
export function buildGameTables(graphics: GraphicsLoader): GameTables {
  const ui = extractUITables(graphics);
  const objects = extractObjectTables(graphics, extractViewportTables(graphics).wallRectanglesOffset);
  const g230 = ui.graphic230;
  const g232 = ui.graphic232;
  return {
    objDescObjectType: objects.objDescObjectType,
    objDescWord4: objects.objDescCarryMask,
    carryLocation: g232.carryLocation,
    byte640: g232.byte640,
    dropOrder: g232.dropOrder,

    weaponDesc: objects.weaponDesc,
    weaponWeights: objects.weaponWeights,
    clothingWeights: objects.clothingWeights,
    clothingArmour: objects.clothingArmour,
    clothingFlags: objects.clothingFlags,
    byte8946: objects.miscWeights,

    monsterDesc: objects.monsterDesc,
    monsterDroppings: objects.monsterDroppings,
    byte10340: objects.facingReplication,
    uByte9672: objects.monsterAttackSounds,

    doorCharacteristics: objects.doorCharacteristics,
    byte1596: g232.byte1596,
    word1074: g232.word1074,

    uByte590: g232.uByte590,
    byte586: g232.byte586,
    byte1412: g232.byte1412,
    byte1386: g232.byte1386,

    experienceForAttacking: g230.experienceForAttacking,
    skillNumber: g230.skillNumber,
    byte20046: g230.byte20046,
    byte20002: g230.byte20002,
    byte19958: g230.byte19958,
    byte19914: g230.byte19914,
    byte20090: g230.byte20090,
    attackNames: g230.attackNames,
    spells: g230.spells,

    sound1772: g232.soundTable,
  };
}
