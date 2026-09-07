import type { GraphicsLoader } from '../../data/GraphicsLoader';
import type { SpellDefinition } from '../../data/spellTypes';

export interface Rect {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface WordRect extends Rect {
  name?: string;
}

export interface IconDisplay {
  pixelX: number;
  pixelY: number;
  objectType: number;
}

export interface UIButton extends Rect {
  word0: number;
  button: number;
  name?: string;
}

export interface SoundTableEntry {
  word0: number;
  byte2: number;
  byte3: number;
  byte4: number;
  byte5: number;
  byte6: number;
  byte7: number;
}

export interface UITables {
  graphic230: {
    word20242: WordRect;
    wRectPos20234: WordRect;
    wRectPos20226: WordRect;
    wRectPos20218: WordRect;
    wRectPos20210: WordRect;
    wRectPos20202: WordRect;
    shrinkColorMap: number[];
    /* Attack tables — all indexed by ATTACKTYPE (doc/CSBwin-src/Data.h:638-651). */
    experienceForAttacking: Int8Array; // Byte20178[44] — ATTACKPARAMETERS.experienceGained
    skillNumber: Int8Array; // SkillNumber[44] — which skill the attack trains/requires
    byte20090: Int8Array; // Byte20090[44] — becomes CHARDESC.word64 for the attack
    byte20046: Int8Array; // Byte20046[44] — base stamina cost (+ STRandomBool())
    byte20002: Int8Array; // Byte20002[44] — the "D6W" damage factor
    byte19958: Int8Array; // Byte19958[44] — the "D7W" factor
    byte19914: Int8Array; // Byte19914[44] — ATTACKPARAMETERS.disableTime
    attackNames: string[]; // AttackNames[300] — "KICK", "PUNCH", "BASH", …
    legalAttacks: Uint8Array[]; // legalAttacks[44], 8 bytes each
    spells: SpellDefinition[];
    spellFirstRuneScale: number[];
    spellBaseMana: number[];
  };
  graphic231: {
    rect18600: WordRect;
    rect18592: WordRect;
    rect18584: WordRect;
    rect18576: WordRect;
    moveButtons: WordRect[];
    dropAreas: Rect[];
    buttons: {
      buttons18936: UIButton[];
      buttons18876: UIButton[];
      buttons18828: UIButton[];
      buttons18792: UIButton[];
      buttons18768: UIButton[];
      buttons18708: UIButton[];
      buttons18660: UIButton[];
      buttons18624: UIButton[];
      buttons18372: UIButton[];
      buttons18324: UIButton[];
      buttons18216: UIButton[];
      buttons18060: UIButton[];
      buttons17952: UIButton[];
      buttons17892: UIButton[];
      buttons17832: UIButton[];
      buttons17796: UIButton[];
      buttons17760: UIButton[];
      buttons17304: UIButton[];
      buttons17196: UIButton[];
      buttons16956: UIButton[];
      buttons16932: UIButton[];
    };
  };
  graphic232: {
    long1828: number[];
    long1812: number[];
    wRectPos1796: WordRect;
    wRectPos1788: WordRect;
    wRectPos1780: WordRect;
    soundTable: SoundTableEntry[];
    byte1596: number[];
    /** `d.uByte590[4]` — wound-location bitmasks for monster attacks. */
    uByte590: number[];
    /** `d.Byte586[8][4]` — the order an attack from a given side reaches the party. */
    byte586: number[][];
    word1526: number[][];
    word1502: number[][];
    wRectPos1454: WordRect[];
    word1406: WordRect;
    word1398: WordRect;
    byte1390: number[];
    byte1386: number[];
    cursorColorMapLight: number[];
    cursorColorMapDark: number[];
    cursorHand: Uint8Array;
    cursorArrow: Uint8Array;
    byte640: number[];
    paletteBrightness: number[];
    word1074: number[];
    carryLocation: number[];
    byte1094: WordRect;
    palette552: number[][];
    palette360: number[];
    palette328: number[];
    defaultGraphicList: number[];
    identityColorMap: number[];
    wRectPos966: WordRect;
    wRectPos958: WordRect;
    wRectPos950: WordRect;
    wRectPos942: WordRect;
    wRectPos934: WordRect;
    wRectPos926: WordRect;
    iconDisplay: IconDisplay[];
    word612: number[];
    word28: WordRect;
    word20: WordRect;
    word12: WordRect;
  };
}

const GRAPHIC_230_INDEX = 0x230;
const GRAPHIC_231_INDEX = 0x231;
const GRAPHIC_232_INDEX = 0x232;

function requireSize(raw: Uint8Array, off: number, size: number, label: string): void {
  if (off + size > raw.length) {
    throw new Error(`UI table ${label} exceeds graphic size (${off + size} > ${raw.length})`);
  }
}

function makeView(raw: Uint8Array): DataView {
  return new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
}

function readWordRect(view: DataView, off: number, name: string = '?'): WordRect {
  return {
    x1: view.getInt16(off + 0, false),
    x2: view.getInt16(off + 2, false),
    y1: view.getInt16(off + 4, false),
    y2: view.getInt16(off + 6, false),
    name,
  };
}

function readWordRectArray(view: DataView, off: number, count: number, basename: string = '?'): WordRect[] {
  const out: WordRect[] = [];
  for (let i = 0; i < count; i++) {
    out.push(readWordRect(view, off + i * 8, `${basename}-${i}`));
  }
  return out;
}

function readI16Array(view: DataView, off: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(view.getInt16(off + i * 2, false));
  }
  return out;
}

function readU16Array(view: DataView, off: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(view.getUint16(off + i * 2, false));
  }
  return out;
}

function readI32Array(view: DataView, off: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(view.getInt32(off + i * 4, false));
  }
  return out;
}

function readButtons(view: DataView, off: number, count: number, basename: string): UIButton[] {
  const out: UIButton[] = [];
  for (let i = 0; i < count; i++) {
    const base = off + i * 12;
    out.push({
      word0: view.getInt16(base + 0, false),
      x1: view.getInt16(base + 2, false),
      x2: view.getInt16(base + 4, false),
      y1: view.getInt16(base + 6, false),
      y2: view.getInt16(base + 8, false),
      button: view.getInt16(base + 10, false),
      name: `${basename}.${i}`,
    });
  }
  return out;
}

function readMoveButtons(view: DataView, off: number, count: number): WordRect[] {
  const out: WordRect[] = [];
  for (let i = 0; i < count; i++) {
    const base = off + i * 8;
    out.push({
      x1: view.getUint16(base + 0, false),
      x2: view.getUint16(base + 2, false),
      y1: view.getUint16(base + 4, false),
      y2: view.getUint16(base + 6, false),
      name: `moveBtn-${i}`,
    });
  }
  return out;
}

function readIconDisplay(view: DataView, off: number, count: number): IconDisplay[] {
  const out: IconDisplay[] = [];
  for (let i = 0; i < count; i++) {
    const base = off + i * 6;
    out.push({
      pixelX: view.getInt16(base + 0, false),
      pixelY: view.getInt16(base + 2, false),
      objectType: view.getInt16(base + 4, false),
    });
  }
  return out;
}

function parseGraphic230(raw: Uint8Array): UITables['graphic230'] {
  const view = makeView(raw);
  let off = 0;

  // Word20242[4] (word rect). CSBWin loads graphic 0x230 at d.Byte20244+2.
  requireSize(raw, off, 8, '0x230 Word20242');
  // magic caster selection tabs zone
  const word20242 = readWordRect(view, off, 'caster selection'); off += 8;

  requireSize(raw, off, 5 * 8, '0x230 wRectPos20234..20202');
  const wRectPos20234 = readWordRect(view, off); off += 8;
  const wRectPos20226 = readWordRect(view, off); off += 8;
  const wRectPos20218 = readWordRect(view, off); off += 8;
  const wRectPos20210 = readWordRect(view, off); off += 8;
  const wRectPos20202 = readWordRect(view, off); off += 8;

  requireSize(raw, off, 16, '0x230 Byte20194');
  const shrinkColorMap = Array.from(raw.slice(off, off + 16));
  off += 16;

  // Seven parallel 44-entry tables indexed by ATTACKTYPE, then the attack names,
  // then the per-attack-class legal-attack lists (doc/CSBwin-src/Data.h:638-651).
  // These are signed bytes in CSBWin; `PossibleAttackTypes` relies on -1 meaning
  // "no such option", so keep the sign.
  const attackTableOffset = off;
  requireSize(raw, attackTableOffset, 44 * 7, '0x230 attack tables');
  const readI8Table = (index: number): Int8Array =>
    new Int8Array(raw.slice(attackTableOffset + index * 44, attackTableOffset + (index + 1) * 44));
  const experienceForAttacking = readI8Table(0);
  const skillNumber = readI8Table(1);
  const byte20090 = readI8Table(2);
  const byte20046 = readI8Table(3);
  const byte20002 = readI8Table(4);
  const byte19958 = readI8Table(5);
  const byte19914 = readI8Table(6);
  off = attackTableOffset + 44 * 7;

  // NUL-separated, indexed by attack type — CSBWin walks the list counting
  // terminators (`GetAttackTypeName`, doc/CSBwin-src/CSBCode.cpp:8609).
  requireSize(raw, off, 300, '0x230 AttackNames');
  const attackNames = readNulSeparatedNames(raw.subarray(off, off + 300));
  off += 300;

  // LEGALATTACKS.byte0[8] (doc/CSBwin-src/Data.h:225). Byte 0 is the always-legal
  // attack; bytes 1-2 are the two optional attacks (255 = absent) and bytes 4-5 the
  // mastery each needs, with bit 7 meaning "the item must have charges left"
  // (`GetLegalAttackTypes`, doc/CSBwin-src/Character.cpp:4769-4808).
  requireSize(raw, off, 44 * 8, '0x230 legalAttacks');
  const legalAttacks: Uint8Array[] = [];
  for (let i = 0; i < 44; i++) {
    legalAttacks.push(raw.slice(off + i * 8, off + (i + 1) * 8));
  }
  off += 44 * 8;

  // Spell table lives near the end of graphic 0x230 (Data.h: SPELL Spells[25]).
  const spellTableOffset = off + 2;
  requireSize(raw, spellTableOffset, 25 * 8, '0x230 Spells');
  const spells: SpellDefinition[] = [];
  let spellOff = spellTableOffset;
  for (let i = 0; i < 25; i++) {
    const spellId = view.getUint32(spellOff, false);
    const skillRequired = raw[spellOff + 4] ?? 0;
    const byte5 = raw[spellOff + 5] ?? 0;
    const word6 = view.getUint16(spellOff + 6, false);
    spells.push({
      spellId: spellId >>> 0,
      skillRequired,
      byte5,
      word6,
    });
    spellOff += 8;
  }

  // Byte19016[6] and Byte19010[24] live at the tail of graphic 0x230 (Data.h:680-681).
  const tailOffset = raw.length - 30;
  requireSize(raw, tailOffset, 30, '0x230 Byte19016/Byte19010');
  const spellFirstRuneScale = Array.from(raw.slice(tailOffset, tailOffset + 6));
  const spellBaseMana = Array.from(raw.slice(tailOffset + 6, tailOffset + 30));

  return {
    word20242,
    wRectPos20234,
    wRectPos20226,
    wRectPos20218,
    wRectPos20210,
    wRectPos20202,
    shrinkColorMap,
    experienceForAttacking,
    skillNumber,
    byte20090,
    byte20046,
    byte20002,
    byte19958,
    byte19914,
    attackNames,
    legalAttacks,
    spells,
    spellFirstRuneScale,
    spellBaseMana,
  };
}

/**
 * Split a fixed-size blob into NUL-terminated strings.
 *
 * CSBWin never counts these — it walks forward over `n` terminators to reach the
 * nth name (doc/CSBwin-src/CSBCode.cpp:8609) — so a trailing run of padding zeroes
 * simply yields no further entries.
 */
function readNulSeparatedNames(raw: Uint8Array): string[] {
  const names: string[] = [];
  let current = '';
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i] ?? 0;
    if (value === 0) {
      names.push(current);
      current = '';
      continue;
    }
    current += String.fromCharCode(value & 0x7f);
  }
  if (current.length > 0) names.push(current);
  return names;
}

function parseGraphic231(raw: Uint8Array): UITables['graphic231'] {
  const view = makeView(raw);
  let off = 0;

  // CSBWin loads graphic 0x231 at d.Byte18938+2 (Byte18938 is not part of the graphic).
  const buttons18936 = readButtons(view, off, 5, 'btn18936'); off += 5 * 12;
  const buttons18876 = readButtons(view, off, 4, 'btn18876'); off += 4 * 12;
  const buttons18828 = readButtons(view, off, 3, 'btn18828'); off += 3 * 12;
  const buttons18792 = readButtons(view, off, 2, 'btn18792'); off += 2 * 12;
  const buttons18768 = readButtons(view, off, 5, 'btn18768'); off += 5 * 12;
  const buttons18708 = readButtons(view, off, 4, 'btn18708'); off += 4 * 12;
  const buttons18660 = readButtons(view, off, 3, 'btn18660'); off += 3 * 12;
  const buttons18624 = readButtons(view, off, 2, 'btn18624'); off += 2 * 12;

  requireSize(raw, off, 4 * 8, '0x231 Byte18600..Byte18576');
  const rect18600 = readWordRect(view, off, 'rect18600'); off += 8;
  const rect18592 = readWordRect(view, off, 'rect18592'); off += 8;
  const rect18584 = readWordRect(view, off, 'rect18584'); off += 8;
  const rect18576 = readWordRect(view, off, 'rect18576'); off += 8;

  // Word18568[4], Word18560[4], Word18552[28]
  off += 4 * 2;
  off += 4 * 2;
  off += 28 * 2;

  const moveButtons = readMoveButtons(view, off, 4); off += 4 * 8;

  // DropAreas[16], Byte18448[8], Byte18440[12], Byte18428[7], Byte18400[28]
  requireSize(raw, off, 16, '0x231 DropAreas');
  const dropAreas: Rect[] = [];
  for (let i = 0; i < 4; i++) {
    const base = off + i * 4;
    dropAreas.push({
      x1: raw[base] ?? 0,
      x2: raw[base + 1] ?? 0,
      y1: raw[base + 2] ?? 0,
      y2: raw[base + 3] ?? 0,
    });
  }
  off += 16;
  off += 8;
  off += 12;
  off += 7 * 4;
  off += 28;

  // 0: resurect (160)
  // 1: reincarnate (161)
  const buttons18372 = readButtons(view, off, 4, 'btn18372'); off += 4 * 12;
  const buttons18324 = readButtons(view, off, 9, 'btn18324'); off += 9 * 12;
  // 0-3: party blocks name (16-19)
  // 4-11: party hands (20-27)
  const buttons18216 = readButtons(view, off, 13, 'btn18216'); off += 13 * 12;
  // 0-5: runes (101-106), 6: cast (108), 7: back (107) 
  const buttons18060 = readButtons(view, off, 9, 'btn18060'); off += 9 * 12;
  const buttons17952 = readButtons(view, off, 5, 'btn17952'); off += 5 * 12;
  const buttons17892 = readButtons(view, off, 5, 'btn17892'); off += 5 * 12;
  const buttons17832 = readButtons(view, off, 3, 'btn17832'); off += 3 * 12;
  const buttons17796 = readButtons(view, off, 3, 'btn17796'); off += 3 * 12;
  // keyboard ?
  const buttons17760 = readButtons(view, off, 38, 'btn17760'); off += 38 * 12;
  // 0-5: direction arrows (1-6), 6-9 ??
  // 7: everything below partyw (83)
  const buttons17304 = readButtons(view, off, 9, 'btn17304'); off += 9 * 12;
  // 0-3: party blocks left (12-15)
  // 4-7: party disposition (125-128)
  // 8-11: party blocks complete (7-10)
  // 12: complete magic block (100),
  // 18: "enter" (200)
  // 19: "resume" (201)
  const buttons17196 = readButtons(view, off, 20, 'btn17196'); off += 20 * 12;
  // 0: credits (202)
  const buttons16956 = readButtons(view, off, 2, 'btn16956'); off += 2 * 12;
  const buttons16932 = off + 4 * 12 <= raw.length ? readButtons(view, off, 4, 'buttons16932') : [];

  return {
    rect18600,
    rect18592,
    rect18584,
    rect18576,
    moveButtons,
    dropAreas,
    buttons: {
      buttons18936,
      buttons18876,
      buttons18828,
      buttons18792,
      buttons18768,
      buttons18708,
      buttons18660,
      buttons18624,
      buttons18372,
      buttons18324,
      buttons18216,
      buttons18060,
      buttons17952,
      buttons17892,
      buttons17832,
      buttons17796,
      buttons17760,
      buttons17304,
      buttons17196,
      buttons16956,
      buttons16932,
    },
  };
}

function parseGraphic232(raw: Uint8Array): UITables['graphic232'] {
  const view = makeView(raw);
  let off = 0;

  // Byte1830[2]
  requireSize(raw, off, 2, '0x232 Byte1830');
  off += 2;

  const long1828 = readI32Array(view, off, 4); off += 4 * 4;
  const long1812 = readI32Array(view, off, 4); off += 4 * 4;

  const wRectPos1796 = readWordRect(view, off); off += 8;
  const wRectPos1788 = readWordRect(view, off); off += 8;
  const wRectPos1780 = readWordRect(view, off); off += 8;

  // SOUND[22] (8 bytes each), Byte1596[8], Word1588
  const soundTable: SoundTableEntry[] = [];
  for (let i = 0; i < 22; i++) {
    soundTable.push({
      word0: view.getInt16(off + 0, false),
      byte2: raw[off + 2] ?? 0,
      byte3: raw[off + 3] ?? 0,
      byte4: raw[off + 4] ?? 0,
      byte5: raw[off + 5] ?? 0,
      byte6: raw[off + 6] ?? 0,
      byte7: raw[off + 7] ?? 0,
    });
    off += 8;
  }
  const byte1596 = Array.from(raw.slice(off, off + 8)); off += 8;
  off += 2;

  // DropOrder[30], Word1526[4][3], Word1502[4][6]
  off += 30 * 2;
  const word1526: number[][] = [];
  for (let i = 0; i < 4; i++) {
    word1526.push(readI16Array(view, off + i * 3 * 2, 3));
  }
  off += 4 * 3 * 2;
  const word1502: number[][] = [];
  for (let i = 0; i < 4; i++) {
    word1502.push(readI16Array(view, off + i * 6 * 2, 6));
  }
  off += 4 * 6 * 2;

  const wRectPos1454 = readWordRectArray(view, off, 4); off += 4 * 8;

  // SpecialChars[6], Byte1416[2], Byte1414[2], Byte1412[6]
  off += 6;
  off += 2;
  off += 2;
  off += 6;

  const word1406 = readWordRect(view, off); off += 8;
  const word1398 = readWordRect(view, off); off += 8;
  const byte1390 = Array.from(raw.slice(off, off + 4)); off += 4;
  const byte1386 = Array.from(raw.slice(off, off + 4)); off += 4;

  const cursorColorMapLight = Array.from(raw.slice(off, off + 16)); off += 16;
  const cursorColorMapDark = Array.from(raw.slice(off, off + 16)); off += 16;
  const cursorHand = raw.slice(off, off + 128); off += 128;
  const cursorArrow = raw.slice(off, off + 128); off += 128;

  const byte1094 = readWordRect(view, off); off += 8;

  // PaletteBrightness[6], Word1074[16], CarryLocation[38]
  const paletteBrightness = readI16Array(view, off, 6); off += 6 * 2;
  const word1074 = readI16Array(view, off, 16); off += 16 * 2;
  const carryLocation = readI16Array(view, off, 38);
  off += 38 * 2;

  const wRectPos966 = readWordRect(view, off); off += 8;
  const wRectPos958 = readWordRect(view, off); off += 8;
  const wRectPos950 = readWordRect(view, off); off += 8;
  const wRectPos942 = readWordRect(view, off); off += 8;
  const wRectPos934 = readWordRect(view, off); off += 8;
  const wRectPos926 = readWordRect(view, off); off += 8;

  // Unused918
  off += 2;

  const iconDisplay = readIconDisplay(view, off, 46); off += 46 * 6;

  // Byte640[16] (torch charge to frame mapping)
  const byte640 = Array.from(raw.slice(off, off + 16)); off += 16;

  // wRectPos624, FILL(616,612) length 4
  off += 8;
  off += 4;

  const word612 = readI16Array(view, off, 7); off += 7 * 2;

  // FILL(598,590) length 8, then two tables the monster attack code needs.
  off += 8;
  /**
   * `d.uByte590[4]` (doc/CSBwin-src/Data.h:1461) — the wound-location bitmasks a
   * monster's attack picks from, indexed by how far down `MONSTERDESC.word22`'s
   * nibbles the roll fell (doc/CSBwin-src/Monster.cpp:4548-4556).
   */
  const uByte590 = Array.from(raw.slice(off, off + 4)); off += 4;
  /**
   * `d.Byte586[8][4]` (doc/CSBwin-src/Data.h:1462) — for each of eight
   * direction/side combinations, the party positions in the order an attack from
   * there reaches them (`DetermineAttackOrder`, doc/CSBwin-src/Character.cpp:384).
   */
  const byte586: number[][] = [];
  for (let i = 0; i < 8; i++) byte586.push(Array.from(raw.slice(off + i * 4, off + i * 4 + 4)));
  off += 8 * 4;
  off += 2; // unused554

  // Palette552[6], Palette360, Palette328, DefaultGraphicList[70], IdentityColorMap[16]
  const palette552: number[][] = [];
  for (let i = 0; i < 6; i++) {
    palette552.push(readU16Array(view, off + i * 32, 16));
  }
  off += 6 * 32;
  const palette360 = readU16Array(view, off, 16); off += 32;
  const palette328 = readU16Array(view, off, 16); off += 32;
  const defaultGraphicList = readU16Array(view, off, 70); off += 70 * 2;
  const identityColorMap = Array.from(raw.slice(off, off + 16)); off += 16;

  const wordRects = readWordRectArray(view, off, 17);
  const word28 = wordRects[14];
  const word20 = wordRects[15];
  const word12 = wordRects[16];

  return {
    uByte590,
    byte586,
    long1828,
    long1812,
    wRectPos1796,
    wRectPos1788,
    wRectPos1780,
    soundTable,
    byte1596,
    word1526,
    word1502,
    wRectPos1454,
    word1406,
    word1398,
    byte1390,
    byte1386,
    cursorColorMapLight,
    cursorColorMapDark,
    cursorHand,
    cursorArrow,
    byte640,
    paletteBrightness,
    word1074,
    carryLocation,
    byte1094,
    palette552,
    palette360,
    palette328,
    defaultGraphicList,
    identityColorMap,
    wRectPos966,
    wRectPos958,
    wRectPos950,
    wRectPos942,
    wRectPos934,
    wRectPos926,
    iconDisplay,
    word612,
    word28,
    word20,
    word12,
  };
}

export function extractUITables(graphicsLoader: GraphicsLoader): UITables {
  const raw230 = graphicsLoader.getRawGraphic(GRAPHIC_230_INDEX);
  const raw231 = graphicsLoader.getRawGraphic(GRAPHIC_231_INDEX);
  const raw232 = graphicsLoader.getRawGraphic(GRAPHIC_232_INDEX);

  return {
    graphic230: parseGraphic230(raw230),
    graphic231: parseGraphic231(raw231),
    graphic232: parseGraphic232(raw232),
  };
}
