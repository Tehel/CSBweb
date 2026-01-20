import type { GraphicsLoader } from '../../data/GraphicsLoader';

export interface WordRect {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface IconDisplay {
  pixelX: number;
  pixelY: number;
  objectType: number;
}

export interface UIButton {
  word0: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  button: number;
}

export interface MoveButton {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
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
    spellFirstRuneScale: number[];
    spellBaseMana: number[];
  };
  graphic231: {
    rect18600: WordRect;
    rect18592: WordRect;
    rect18584: WordRect;
    rect18576: WordRect;
    moveButtons: MoveButton[];
    buttons: {
      Buttons18936: UIButton[];
      Buttons18876: UIButton[];
      Buttons18828: UIButton[];
      Buttons18792: UIButton[];
      Buttons18768: UIButton[];
      Buttons18708: UIButton[];
      Buttons18660: UIButton[];
      Buttons18624: UIButton[];
      Buttons18372: UIButton[];
      Buttons18324: UIButton[];
      Buttons18216: UIButton[];
      Buttons18060: UIButton[];
      Buttons17952: UIButton[];
      Buttons17892: UIButton[];
      Buttons17832: UIButton[];
      Buttons17796: UIButton[];
      Buttons17760: UIButton[];
      Buttons17304: UIButton[];
      Buttons17196: UIButton[];
      Buttons16956: UIButton[];
      Buttons16932: UIButton[];
    };
  };
  graphic232: {
    long1828: number[];
    long1812: number[];
    wRectPos1796: WordRect;
    wRectPos1788: WordRect;
    wRectPos1780: WordRect;
    word1526: number[][];
    word1502: number[][];
    wRectPos1454: WordRect[];
    word1406: WordRect;
    word1398: WordRect;
    byte1390: number[];
    byte1386: number[];
    byte1094: WordRect;
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

function readWordRect(view: DataView, off: number): WordRect {
  return {
    x1: view.getInt16(off + 0, false),
    x2: view.getInt16(off + 2, false),
    y1: view.getInt16(off + 4, false),
    y2: view.getInt16(off + 6, false),
  };
}

function readWordRectArray(view: DataView, off: number, count: number): WordRect[] {
  const out: WordRect[] = [];
  for (let i = 0; i < count; i++) {
    out.push(readWordRect(view, off + i * 8));
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

function readI32Array(view: DataView, off: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(view.getInt32(off + i * 4, false));
  }
  return out;
}

function readButtons(view: DataView, off: number, count: number): UIButton[] {
  const out: UIButton[] = [];
  for (let i = 0; i < count; i++) {
    const base = off + i * 12;
    out.push({
      word0: view.getInt16(base + 0, false),
      xMin: view.getInt16(base + 2, false),
      xMax: view.getInt16(base + 4, false),
      yMin: view.getInt16(base + 6, false),
      yMax: view.getInt16(base + 8, false),
      button: view.getInt16(base + 10, false),
    });
  }
  return out;
}

function readMoveButtons(view: DataView, off: number, count: number): MoveButton[] {
  const out: MoveButton[] = [];
  for (let i = 0; i < count; i++) {
    const base = off + i * 8;
    out.push({
      x1: view.getUint16(base + 0, false),
      x2: view.getUint16(base + 2, false),
      y1: view.getUint16(base + 4, false),
      y2: view.getUint16(base + 6, false),
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
  const word20242 = readWordRect(view, off);
  off += 8;

  requireSize(raw, off, 5 * 8, '0x230 wRectPos20234..20202');
  const wRectPos20234 = readWordRect(view, off);
  off += 8;
  const wRectPos20226 = readWordRect(view, off);
  off += 8;
  const wRectPos20218 = readWordRect(view, off);
  off += 8;
  const wRectPos20210 = readWordRect(view, off);
  off += 8;
  const wRectPos20202 = readWordRect(view, off);
  off += 8;

  requireSize(raw, off, 16, '0x230 Byte20194');
  const shrinkColorMap = Array.from(raw.slice(off, off + 16));
  off += 16;

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
    spellFirstRuneScale,
    spellBaseMana,
  };
}

function parseGraphic231(raw: Uint8Array): UITables['graphic231'] {
  const view = makeView(raw);
  let off = 0;

  // CSBWin loads graphic 0x231 at d.Byte18938+2 (Byte18938 is not part of the graphic).
  const buttons18936 = readButtons(view, off, 5);
  off += 5 * 12;
  const buttons18876 = readButtons(view, off, 4);
  off += 4 * 12;
  const buttons18828 = readButtons(view, off, 3);
  off += 3 * 12;
  const buttons18792 = readButtons(view, off, 2);
  off += 2 * 12;
  const buttons18768 = readButtons(view, off, 5);
  off += 5 * 12;
  const buttons18708 = readButtons(view, off, 4);
  off += 4 * 12;
  const buttons18660 = readButtons(view, off, 3);
  off += 3 * 12;
  const buttons18624 = readButtons(view, off, 2);
  off += 2 * 12;

  requireSize(raw, off, 4 * 8, '0x231 Byte18600..Byte18576');
  const rect18600 = readWordRect(view, off);
  off += 8;
  const rect18592 = readWordRect(view, off);
  off += 8;
  const rect18584 = readWordRect(view, off);
  off += 8;
  const rect18576 = readWordRect(view, off);
  off += 8;

  // Word18568[4], Word18560[4], Word18552[28]
  off += 4 * 2;
  off += 4 * 2;
  off += 28 * 2;

  const moveButtons = readMoveButtons(view, off, 4);
  off += 4 * 8;

  // DropAreas[16], Byte18448[8], Byte18440[12], Byte18428[7], Byte18400[28]
  off += 16;
  off += 8;
  off += 12;
  off += 7 * 4;
  off += 28;

  const buttons18372 = readButtons(view, off, 4);
  off += 4 * 12;
  const buttons18324 = readButtons(view, off, 9);
  off += 9 * 12;
  const buttons18216 = readButtons(view, off, 13);
  off += 13 * 12;
  const buttons18060 = readButtons(view, off, 9);
  off += 9 * 12;
  const buttons17952 = readButtons(view, off, 5);
  off += 5 * 12;
  const buttons17892 = readButtons(view, off, 5);
  off += 5 * 12;
  const buttons17832 = readButtons(view, off, 3);
  off += 3 * 12;
  const buttons17796 = readButtons(view, off, 3);
  off += 3 * 12;
  const buttons17760 = readButtons(view, off, 38);
  off += 38 * 12;
  const buttons17304 = readButtons(view, off, 9);
  off += 9 * 12;
  const buttons17196 = readButtons(view, off, 20);
  off += 20 * 12;
  const buttons16956 = readButtons(view, off, 2);
  off += 2 * 12;
  const buttons16932 = off + 4 * 12 <= raw.length ? readButtons(view, off, 4) : [];

  return {
    rect18600,
    rect18592,
    rect18584,
    rect18576,
    moveButtons,
    buttons: {
      Buttons18936: buttons18936,
      Buttons18876: buttons18876,
      Buttons18828: buttons18828,
      Buttons18792: buttons18792,
      Buttons18768: buttons18768,
      Buttons18708: buttons18708,
      Buttons18660: buttons18660,
      Buttons18624: buttons18624,
      Buttons18372: buttons18372,
      Buttons18324: buttons18324,
      Buttons18216: buttons18216,
      Buttons18060: buttons18060,
      Buttons17952: buttons17952,
      Buttons17892: buttons17892,
      Buttons17832: buttons17832,
      Buttons17796: buttons17796,
      Buttons17760: buttons17760,
      Buttons17304: buttons17304,
      Buttons17196: buttons17196,
      Buttons16956: buttons16956,
      Buttons16932: buttons16932,
    },
  };
}

function parseGraphic232(raw: Uint8Array): UITables['graphic232'] {
  const view = makeView(raw);
  let off = 0;

  // Byte1830[2]
  requireSize(raw, off, 2, '0x232 Byte1830');
  off += 2;

  const long1828 = readI32Array(view, off, 4);
  off += 4 * 4;
  const long1812 = readI32Array(view, off, 4);
  off += 4 * 4;

  const wRectPos1796 = readWordRect(view, off);
  off += 8;
  const wRectPos1788 = readWordRect(view, off);
  off += 8;
  const wRectPos1780 = readWordRect(view, off);
  off += 8;

  // SOUND[22] (8 bytes each), Byte1596[8], Word1588
  off += 22 * 8;
  off += 8;
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

  const wRectPos1454 = readWordRectArray(view, off, 4);
  off += 4 * 8;

  // SpecialChars[6], Byte1416[2], Byte1414[2], Byte1412[6]
  off += 6;
  off += 2;
  off += 2;
  off += 6;

  const word1406 = readWordRect(view, off);
  off += 8;
  const word1398 = readWordRect(view, off);
  off += 8;

  const byte1390 = Array.from(raw.slice(off, off + 4));
  off += 4;
  const byte1386 = Array.from(raw.slice(off, off + 4));
  off += 4;

  // Byte1382[16], Byte1366[16], Byte1350[128], Byte1222[128]
  off += 16;
  off += 16;
  off += 128;
  off += 128;

  const byte1094 = readWordRect(view, off);
  off += 8;

  // PaletteBrightness[6], Word1074[16], CarryLocation[38]
  off += 6 * 2;
  off += 16 * 2;
  off += 38 * 2;

  // wRectPos966..wRectPos926 (6 rects)
  off += 6 * 8;

  // Unused918
  off += 2;

  const iconDisplay = readIconDisplay(view, off, 46);
  off += 46 * 6;

  // Byte640[1], FILL(639,624) length 15
  off += 1;
  off += 15;

  // wRectPos624, FILL(616,612) length 4
  off += 8;
  off += 4;

  const word612 = readI16Array(view, off, 7);
  off += 7 * 2;

  // FILL(598,590) length 8, uByte590[4], Byte586[8][4], unused554
  off += 8;
  off += 4;
  off += 8 * 4;
  off += 2;

  // Palette552[6], Palette360, Palette328, DefaultGraphicList[70], IdentityColorMap[16]
  off += 6 * 32;
  off += 32;
  off += 32;
  off += 70 * 2;
  off += 16;

  const wordRects = readWordRectArray(view, off, 17);
  const word28 = wordRects[14];
  const word20 = wordRects[15];
  const word12 = wordRects[16];

  return {
    long1828,
    long1812,
    wRectPos1796,
    wRectPos1788,
    wRectPos1780,
    word1526,
    word1502,
    wRectPos1454,
    word1406,
    word1398,
    byte1390,
    byte1386,
    byte1094,
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
