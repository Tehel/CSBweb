/**
 * `GameTables` — every table the engine reads from `graphics.dat`, in one read-only set.
 *
 * CSBWin keeps them all in the one global `d.` (`doc/CSBwin-src/Data.h`), filled from
 * graphics `0x22e`, `0x22f`, `0x230` and `0x232` when the game starts. This is the one
 * set, grouped by content. Every field is required: `buildGameTables` fills them all, for
 * the game and for the tools alike.
 *
 * A table has CSBWin's name, here and in the extractors (`src/data/tables/`), even where
 * CSBWin names it after its address (`byte1596`); what it holds is in the comment. The
 * fields of a struct array (`d.weapons[].weight`, `d.ClothingDesc[].uByte1`) keep the
 * port's names, since CSBWin gives them none worth keeping.
 */
import type { SpellDefinition } from '../data/spellTypes';
import type { FileSignature } from '../data/FileSignature';
import type { GraphicsTables } from '../data/tables/GraphicsTables';
import type { TextDecodeTables, WeaponDesc } from '../data/tables/ObjectTables';
import { type MonsterDesc } from '../data/tables/MonsterDesc';
import type { Rect, SoundTableEntry } from '../data/tables/UITables';

export interface GameTables {
  // --- Objects: `d.ObjDesc`, where a possession may go, and in what order it drops ---

  /** `d.ObjDesc[180].objectType()` — an object's name index (`Data.h:1100`). */
  readonly objDescObjectType: ArrayLike<number>;
  /** `d.ObjDesc[180].word4` — the carry-location mask. */
  readonly objDescWord4: ArrayLike<number>;
  /** `d.CarryLocation[38]` (`Data.h:1442`). */
  readonly carryLocation: ArrayLike<number>;
  /** `d.Byte640` — a lit torch's charge to its name-index offset (`Data.h:1465`). */
  readonly byte640: ArrayLike<number>;
  /** `d.DropOrder[30]` — the order `DropAllPossessions` empties the slots (`Data.h:1420`). */
  readonly dropOrder: ArrayLike<number>;

  // --- Object descriptors: weapons, clothing, miscellaneous ---

  /** `d.weapons[46]`, the whole `WEAPONDESC` (`Data.h:1097`). */
  readonly weaponDesc: ArrayLike<WeaponDesc>;
  /** `d.weapons[46].weight`. */
  readonly weaponWeights: ArrayLike<number>;
  /** `d.ClothingDesc[58].weight` (`Data.h:1096`). */
  readonly clothingWeights: ArrayLike<number>;
  /** `d.ClothingDesc[58].uByte1` — the armour strength a garment gives. */
  readonly clothingArmour: ArrayLike<number>;
  /** `d.ClothingDesc[58].uByte2` — flags; bit 7 marks a shield. */
  readonly clothingFlags: ArrayLike<number>;
  /** `d.Byte8946[54]` — the miscellaneous objects' weights. */
  readonly byte8946: ArrayLike<number>;

  // --- Monsters ---

  /** `d.MonsterDescriptor[27]` (`Data.h:1091`). */
  readonly monsterDesc: ArrayLike<MonsterDesc>;
  /** `d.MonsterDroppings[40]` — what a dying monster leaves behind (`Data.h:1089`). */
  readonly monsterDroppings: ArrayLike<number>;
  /** `d.Byte10340[4]` — a group's facing byte without an `ITEM16`. */
  readonly byte10340: ArrayLike<number>;
  /** `d.uByte9672[8]` — the monster attack sounds. */
  readonly uByte9672: ArrayLike<number>;

  // --- The dungeon ---

  /** `d.DoorCharacteristics[4]`, which each level indexes twice to form `DoorTOC` (`Data.h:1088`). */
  readonly doorCharacteristics: ArrayLike<number>;
  /** `d.Byte1596[8]` — the room-type timer functions. */
  readonly byte1596: ArrayLike<number>;
  /** `d.Byte7302[16]` — the extra records a new game gives each database (`Data.h:1114`). */
  readonly byte7302: ArrayLike<number>;
  /** `d.DeltaX[4]` — the step along x for each direction, north, east, south and west (`Data.h:1118`). */
  readonly deltaX: ArrayLike<number>;
  /** `d.DeltaY[4]` — the step along y for each direction (`Data.h:1117`). */
  readonly deltaY: ArrayLike<number>;
  /** `d.Word1074[16]` — the light table; entry 2 is an Illumulet's brightness and the LIGHT attack's step (`Data.h:1439`). */
  readonly word1074: number[];
  /** `d.PaletteBrightness[6]` — the least light each viewport palette needs, brightest first (`Data.h:1437`). */
  readonly paletteBrightness: ArrayLike<number>;
  /** `d.Byte10080`, `d.Byte10336` and `d.Byte10016`, `DecodeText`'s escape strings. */
  readonly textDecode: TextDecodeTables;

  // --- The party: where a blow lands, how a shield covers it, the message colours ---

  /** `d.uByte590[4]` — wound-location bitmasks. */
  readonly uByte590: ArrayLike<number>;
  /** `d.Byte586[8][4]` — the order an attack from a given side reaches the party. */
  readonly byte586: ArrayLike<ArrayLike<number>>;
  /** `d.Byte1412[6]` — per-body-part shield weighting. */
  readonly byte1412: ArrayLike<number>;
  /** `d.Byte1386[4]` — each champion's message colour. */
  readonly byte1386: ArrayLike<number>;

  // --- Attacks and spells: graphic `0x230`, indexed by `ATTACKTYPE` (`Data.h:647-660`).
  //     CSBWin names most of them after their addresses, and so do we: nothing in the C++
  //     says what four of them mean. ---

  /** `d.experienceForAttacking[44]` (`Byte20178`). */
  readonly experienceForAttacking: ArrayLike<number>;
  /** `d.SkillNumber[44]`. */
  readonly skillNumber: ArrayLike<number>;
  /** `d.Byte20046[44]` — base stamina cost. */
  readonly byte20046: ArrayLike<number>;
  /** `d.Byte20002[44]` — only ever read as `75 - this`, the second-chance luck threshold. */
  readonly byte20002: ArrayLike<number>;
  /** `d.Byte19958[44]` — scales the throwing distance into damage, over 32. */
  readonly byte19958: ArrayLike<number>;
  /** `d.Byte19914[44]` — how long the attack keeps the champion busy. */
  readonly byte19914: ArrayLike<number>;
  /** `d.Byte20090[44]` — the defence penalty an attack type carries while busy. */
  readonly byte20090: ArrayLike<number>;
  /** `d.AttackNames` — "KICK", "PUNCH", … in `ATTACKTYPE` order. Trace only. */
  readonly attackNames: ArrayLike<string>;
  /** The spell table graphic `0x230` carries, for `CastSpell`. */
  readonly spells: readonly SpellDefinition[];

  // --- Interface ---

  /**
   * `d.MoveButn18496[4]` — the step arrows' screen rectangles, forward, right, backward
   * and left (`doc/CSBwin-src/Data.h:708`), which `FlashButton` flashes.
   */
  readonly moveButtons: readonly Rect[];
  /**
   * `d.Word18568[4]` and `d.Word18560[4]` — the steps right and forward of the four moves,
   * in `moveButtons`' order (`Data.h:705-706`), which `MoveParty` hands `RelativeXY`.
   */
  readonly word18568: ArrayLike<number>;
  readonly word18560: ArrayLike<number>;

  // --- Sound ---

  /** `d.sound1772[22]` — `QueueSound`'s table (`Data.h:1417`). */
  readonly sound1772: SoundTableEntry[];

  // --- The file itself ---

  /** `graphicSignature1/2`: `graphics.dat`'s `Signature` (`src/engine/FileSignatures.ts`). */
  readonly graphicsSignature: FileSignature;
}

/** Every table in `GameTables`, from what `extractGraphicsTables` read of `graphics.dat`. */
export function buildGameTables(graphics: GraphicsTables): GameTables {
  const { ui, objects } = graphics;
  const g230 = ui.graphic230;
  const g232 = ui.graphic232;
  return {
    objDescObjectType: objects.objDescObjectType,
    objDescWord4: objects.objDescWord4,
    carryLocation: g232.carryLocation,
    byte640: g232.byte640,
    dropOrder: g232.dropOrder,

    weaponDesc: objects.weaponDesc,
    weaponWeights: objects.weaponWeights,
    clothingWeights: objects.clothingWeights,
    clothingArmour: objects.clothingArmour,
    clothingFlags: objects.clothingFlags,
    byte8946: objects.byte8946,

    monsterDesc: objects.monsterDesc,
    monsterDroppings: objects.monsterDroppings,
    byte10340: objects.byte10340,
    uByte9672: objects.uByte9672,

    doorCharacteristics: objects.doorCharacteristics,
    byte1596: g232.byte1596,
    byte7302: objects.byte7302,
    deltaX: objects.deltaX,
    deltaY: objects.deltaY,
    word1074: g232.word1074,
    paletteBrightness: g232.paletteBrightness,
    textDecode: objects.textDecode,

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

    moveButtons: ui.graphic231.moveButtons,
    word18568: ui.graphic231.word18568,
    word18560: ui.graphic231.word18560,

    sound1772: g232.sound1772,

    graphicsSignature: graphics.signature,
  };
}
