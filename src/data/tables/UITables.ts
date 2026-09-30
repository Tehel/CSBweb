import type { GraphicsLoader } from '../GraphicsLoader';
import type { IndexedBitmap } from '../CSBGraphicsLoader';
import type { SpellDefinition } from '../spellTypes';

export interface Rect {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface RectPos extends Rect {
  srcX?: number;
  srcY?: number;
  srcStride?: number;
  srcWidth?: number;
  srcHeight?: number;
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

/** CSBWin `KeyXlate` (`doc/CSBwin-src/CSB.h:1379`): a key and the button it queues. */
export interface KeyXlate {
  mouse: number;
  keyscan: number;
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
    /**
     * `d.Word18552[28]`: the rectangles `_MagicSelection` flashes for magic buttons
     * 101-107, the six runes and the take-back, four words each, `x1, x2, y1, y2`
     * (`doc/CSBwin-src/Magic.cpp:568-570`).
     */
    word18552: WordRect[];
    moveButtons: WordRect[];
    dropAreas: Rect[];
    /** The key tables `TAG0196da` reads (`KeyXlate`, `doc/CSBwin-src/CSB.h:1379`). */
    keys: {
      byte18448: KeyXlate[]; // frozen: Esc is 148
      byte18440: KeyXlate[]; // asleep: Return is 146, Esc 147
      byte18428: KeyXlate[]; // adventure, second table: the six movement keys
      byte18400: KeyXlate[]; // adventure, first table: F1-F4, Ctrl-S, Esc
    };
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
    sound1772: SoundTableEntry[];
    byte1596: number[];
    /** `d.uByte590[4]` — wound-location bitmasks for monster attacks. */
    uByte590: number[];
    /** `d.Byte586[8][4]` — the order an attack from a given side reaches the party. */
    byte586: number[][];
    /**
     * `d.DropOrder[30]` (`doc/CSBwin-src/Data.h:1405`) — the order in which
     * `DropAllPossessions` empties a dying champion's slots
     * (`doc/CSBwin-src/Character.cpp:2506-2508`).
     */
    dropOrder: number[];
    word1526: number[][];
    word1502: number[][];
    wRectPos1454: WordRect[];
    word1406: WordRect;
    word1398: WordRect;
    /** `d.Byte1412[6]` — per-body-part shield weighting. */
    byte1412: number[];
    /** `d.SpecialChars[6]` — comma, period, semi-colon, colon, space. */
    specialChars: number[];
    /** `d.Byte1414[2]` — the name-entry screen's one-character cursor string. */
    byte1414: number[];
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
    /** The prison door's right half on the static entrance screen. */
    word100: WordRect;
    /** A champion's portrait on the won screen, the first of them (`doc/CSBwin-src/Code1f9e6.cpp:182`). */
    word140: WordRect;
    /** A champion's frame, graphic 208, on the won screen, the first of them (`Code1f9e6.cpp:181`). */
    word132: WordRect;
    /**
     * The "RESTART THIS GAME" button's border, filled with colour 1, and its face inside
     * it, filled with 0 (`doc/CSBwin-src/Code1f9e6.cpp:243-246`).
     */
    word116: WordRect;
    word124: WordRect;
    /** "THE END", graphic 6, on the end screen (`doc/CSBwin-src/Code1f9e6.cpp:229`). */
    word108: WordRect;
    /** The prison door's left half on the static entrance screen. */
    word92: WordRect;
    /** The entrance interior saved off before the doors go over it. */
    word84: WordRect;
    /** The prison door's right half while the doors slide; `x1` walks right. */
    word76: WordRect;
    /** The prison door's left half while the doors slide; `x2` walks left. */
    word68: WordRect;
    /** The viewport's place inside the door-animation working buffer. */
    word60: WordRect;
    /** The title animation's "Presents" band. */
    word52: WordRect;
    /** Where the title animation stashes the "Master" band out of graphic 1. */
    word44: WordRect;
    /** Where the title animation finally puts "Master". */
    word36: WordRect;
    word28: WordRect;
    word20: WordRect;
    word12: WordRect;
  };
}

/**
 * `d.Byte1222` (the arrow) and `d.Byte1350` (the hand) as pixels.
 *
 * Both are 128 bytes of Atari planar data: sixteen rows of four 16-bit bitplane words, so
 * each row is eight bytes and each pixel a 4-bit index gathered across the planes. Colour
 * 12 is transparent — `CreateCursorBitmap` floods its working buffer with it before
 * blitting the shape in (`doc/CSBwin-src/CSBCode.cpp:2276`).
 *
 * The arrow is drawn straight from this bitmap with no colour mapping, which is why it
 * changes colour with the screen: its body is palette index 4, and that is `0x654` beige
 * under the dungeon entrance's `Palette360` and `0x066` teal under the adventure palette.
 */
export function decodeCursorBitmap(raw: Uint8Array): IndexedBitmap | null {
  if (!raw || raw.length < 128) return null;
  const pixels = new Uint8Array(16 * 16);
  for (let row = 0; row < 16; row++) {
    const base = row * 8;
    const p0 = ((raw[base] ?? 0) << 8) | (raw[base + 1] ?? 0);
    const p1 = ((raw[base + 2] ?? 0) << 8) | (raw[base + 3] ?? 0);
    const p2 = ((raw[base + 4] ?? 0) << 8) | (raw[base + 5] ?? 0);
    const p3 = ((raw[base + 6] ?? 0) << 8) | (raw[base + 7] ?? 0);
    for (let col = 0; col < 16; col++) {
      const bit = 15 - col;
      pixels[row * 16 + col] =
        (((p0 >> bit) & 1) |
          (((p1 >> bit) & 1) << 1) |
          (((p2 >> bit) & 1) << 2) |
          (((p3 >> bit) & 1) << 3)) & 0x0f;
    }
  }
  return { width: 16, height: 16, pixels };
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

/**
 * `count` `KeyXlate` slots, `{ui16 mouse; ui16 keyscan;}` (`doc/CSBwin-src/CSB.h:1379-1383`),
 * up to the terminating `mouse == 0`, which `TAG0196da` stops at (`CSBCode.cpp:8446`).
 */
function readKeyXlate(view: DataView, off: number, count: number): KeyXlate[] {
  const keys: KeyXlate[] = [];
  for (let i = 0; i < count; i++) {
    const mouse = view.getUint16(off + i * 4, false);
    if (mouse === 0) break;
    keys.push({ mouse, keyscan: view.getUint16(off + i * 4 + 2, false) });
  }
  return keys;
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

/** `count` rectangles of four big-endian words, `x1, x2, y1, y2`. */
function readWordRects(view: DataView, off: number, count: number, name: string): WordRect[] {
  const out: WordRect[] = [];
  for (let i = 0; i < count; i++) {
    const base = off + i * 8;
    out.push({
      x1: view.getUint16(base + 0, false),
      x2: view.getUint16(base + 2, false),
      y1: view.getUint16(base + 4, false),
      y2: view.getUint16(base + 6, false),
      name: `${name}-${i}`,
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
  // `AttackNames[300]` in CSBWin's struct, which asserts the graphic is 0x4e8 bytes
  // (doc/CSBwin-src/CSBCode.cpp:10153). The French 1.3 file's names take 400 and its
  // graphic is 100 bytes longer; what follows them is the same 584 bytes in both, so
  // the names are whatever lies between the attack tables and that tail
  // (doc/PROVEN_FACTS.md → "The French 1.3 `graphics.dat`: longer words").
  const attackNamesLength = raw.length - off - (44 * 8 + 2 + 25 * 8 + 30);
  requireSize(raw, off, Math.max(attackNamesLength, 300), '0x230 AttackNames');
  const attackNames = readNulSeparatedNames(raw.subarray(off, off + attackNamesLength));
  off += attackNamesLength;

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

  // Word18568[4], Word18560[4]
  off += 4 * 2;
  off += 4 * 2;
  const word18552 = readWordRects(view, off, 7, 'word18552'); off += 7 * 8;

  const moveButtons = readWordRects(view, off, 4, 'moveBtn'); off += 4 * 8;

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
  requireSize(raw, off, 8 + 12 + 28 + 28, '0x231 Byte18448..Byte18400');
  const keys = {
    byte18448: readKeyXlate(view, off, 2), // off += 8
    byte18440: readKeyXlate(view, off + 8, 3), // off += 12
    byte18428: readKeyXlate(view, off + 20, 7), // off += 28
    byte18400: readKeyXlate(view, off + 48, 7), // off += 28
  };
  off += 8 + 12 + 28 + 28;

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
    word18552,
    moveButtons,
    dropAreas,
    keys,
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
  const sound1772: SoundTableEntry[] = [];
  for (let i = 0; i < 22; i++) {
    sound1772.push({
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
  const dropOrder = readI16Array(view, off, 30); off += 30 * 2;
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

  /**
   * `d.SpecialChars[6]` (`doc/CSBwin-src/Data.h:1422`) — comma, period, semi-colon,
   * colon, space. The name-entry keyboard's letter grid runs 'A'..'Z' and then indexes
   * this table for the punctuation keys past 'Z'
   * (`doc/CSBwin-src/Code13ea4.cpp:203-207`).
   */
  const specialChars = Array.from(raw.slice(off, off + 6)); off += 6;
  // `d.Byte1416[2]` — a one-character C string the name-entry screen fills in to print
  // the letter just typed (`Code13ea4.cpp:249`). The port passes the character instead.
  off += 2;
  /**
   * `d.Byte1414[2]` — the other one-character string, the name-entry screen's cursor.
   * It is drawn in colour 9 to mark where the next letter will go and redrawn in 13 to
   * take the mark away (`Code13ea4.cpp:70-79`, `:283-291`).
   */
  const byte1414 = Array.from(raw.slice(off, off + 2)); off += 2;
  /**
   * `d.Byte1412[6]` (doc/CSBwin-src/Data.h:1412) — per-body-part weighting for how
   * much a shield held in hand protects that part (doc/CSBwin-src/Character.cpp:2419).
   */
  const byte1412 = Array.from(raw.slice(off, off + 6)); off += 6;

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

  // `Word140` down to `Word12`, in the file's own order. The names are the original
  // Atari offsets and they run *downward* through the item, which is why an array read
  // forward indexes them in reverse (`doc/CSBwin-src/Data.h:1475-1487`).
  const wordRects = readWordRectArray(view, off, 17);
  // The title animation and the prison door (`doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`).
  // The end of the game (`_ShowCredits`, `doc/CSBwin-src/Code1f9e6.cpp:66`).
  const word140 = wordRects[0];
  const word132 = wordRects[1];
  const word124 = wordRects[2];
  const word116 = wordRects[3];
  const word108 = wordRects[4];
  const word100 = wordRects[5];
  const word92 = wordRects[6];
  const word84 = wordRects[7];
  const word76 = wordRects[8];
  const word68 = wordRects[9];
  const word60 = wordRects[10];
  const word52 = wordRects[11];
  const word44 = wordRects[12];
  const word36 = wordRects[13];
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
    sound1772,
    byte1596,
    dropOrder,
    word1526,
    word1502,
    wRectPos1454,
    word1406,
    word1398,
    byte1412,
    specialChars,
    byte1414,
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
    word100,
    word140,
    word132,
    word124,
    word116,
    word108,
    word92,
    word84,
    word76,
    word68,
    word60,
    word52,
    word44,
    word36,
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
