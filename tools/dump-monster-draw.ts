/**
 * Where in a cell a monster group is drawn: `DrawMonster`'s choice of
 * `positionWithinCell` (`doc/CSBwin-src/Code51a4.cpp:352-961`), called once per
 * position of the drawing order by `ProcessOnePosition` (`:2259-2295`).
 *
 * `positionWithinCell` indexes the monster's `d.s6982` set, and for a two-corner monster
 * (`horizontalSize() == 1`: the rat, the worm, the ruster) it is not a corner. Set 1
 * holds 0/1 = the left/right half, 2 = the far middle, 3 = the middle, 4 = the near
 * middle. So:
 *
 *  1. a pair seen from the front or back is drawn at the order's last position, both
 *     at once: the member there in its half, then the other member in the other half
 *     (`w_94`, `:946-958`);
 *  2. a pair seen from the side is drawn at the last far position (the far middle, 2)
 *     and at the end (the near middle, 4);
 *  3. a lone one (positions 255) is drawn in the middle, at 3 when seen from the side;
 *  4. one left of a pair (positions not 255) is drawn in its half, once;
 *  5. a one-corner monster is drawn at its corner, and a group of cell-fillers not at all;
 *  6. a monster in the cells beside the party (10, 11) is drawn, one set entry down;
 *  7. a front view is mirrored in the first row when `NonAttackingMirrorOK()` and the
 *     member's mirror bit say so, never beyond it; two rows ahead, a front view with
 *     word4 bits 7 and 8 is always mirrored (`b_102`, `:797-800`, `:859-864`).
 *
 * Every drawn sprite's centre and bottom are read back from the blit rectangle and
 * matched against the real `d.s6982` entries.
 *
 * Run: `npx tsx tools/dump-monster-draw.ts`
 */
import { applyLimits } from '../src/core/intCast';
import { DBType, OBJECT_ID_EOF } from '../src/core/types';
import { BytecodeInterpreter } from '../src/renderer/bytecode/BytecodeInterpreter';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { check, finish } from './lib/check';
import { graphicsTablesOf, stockGraphics } from './lib/game';

const graphics = stockGraphics();
const tables = graphicsTablesOf(graphics).objects;

const RAT = 4;
const WORM = 15;
const MUMMY = 10; // one corner
const DRAGON = 24; // the whole cell
check((tables.monsterDesc[RAT]!.word2 & 3) === 1 && (tables.monsterDesc[WORM]!.word2 & 3) === 1,
  'the rat and the worm are two-corner monsters (horizontalSize 1)');
check((tables.monsterDesc[MUMMY]!.word2 & 3) === 0 && (tables.monsterDesc[DRAGON]!.word2 & 3) === 2,
  'the mummy fills one corner, the dragon the whole cell');

/** `ITEM16.singleMonsterStatus`: member 1 attacking, so its sprite is the attack graphic. */
const STATUSES = new Uint8Array([0, 0x80, 0, 0]);
const attackGraphicOf = (type: number): number => {
  const d = tables.monsterDesc[type]!;
  return 446 + tables.monsterGraphics[type]!.word0 + 1 + ((d.word4 & 8) ? 1 : 0) + ((d.word4 & 0x10) ? 1 : 0);
};

interface Group {
  type: number;
  numMonM1: number;
  /** Absolute corner of each member, or 255 for "centred". */
  corners: number[] | 255;
  /** Absolute facing of the whole group. */
  facing: number;
}
interface Sprite { entry: number; member: 0 | 1 }

/** The sprites `drawRoomObjects` draws for `group` in `relativeCell`, party facing north. */
function draw(group: Group, relativeCell: number, drawOrder: number): Sprite[] {
  const positions = group.corners === 255 ? 255
    : group.corners.reduce((acc, c, i) => acc | (c << (2 * i)), 0);
  const facings = [0, 1, 2, 3].reduce((acc, i) => acc | (group.facing << (2 * i)), 0);
  const record = { creatureType: group.type, numMonM1: group.numMonM1 };
  const blits: Array<{ x1: number; x2: number; y2: number; w: number; graphic: number }> = [];
  let lastGraphic = -1;
  const context: any = {
    viewportIndexBuffer: createPaletteIndexViewportBuffer(224, 136, 0),
    objectTables: tables,
    getGraphicBitmap: (n: number) => {
      lastGraphic = n;
      const img = graphics.getImage(n);
      return { width: img.width, height: img.height, pixels: new Uint8Array(img.width * img.height).fill(1) };
    },
    dungeonState: {
      getDBRecordLink: () => OBJECT_ID_EOF,
      getCreatureRecord: () => record,
      getMonsterRenderState: () => ({ positions, facings, statuses: STATUSES }),
    },
  };
  const interp = new BytecodeInterpreter(context) as any;
  const blit = interp.blitShapeToViewportIndexWithTransparent.bind(interp);
  interp.blitShapeToViewportIndexWithTransparent = (src: any, rect: any, t: number) => {
    blits.push({ x1: rect.x1, x2: rect.x2, y2: rect.y2, w: src.width >> 1, graphic: lastGraphic });
    blit(src, rect, t);
  };
  interp.drawRoomObjects(DBType.CREATURE << 10, 0, 0, 0, relativeCell, drawOrder);

  // The set entry each sprite was drawn at: x1 = x - w + 1 and x2 = x + w, each within
  // 0..223, and y2 = y, with every status offset zero. The cells beside the party read
  // one entry down, and 100 pixels to the side.
  const set = tables.monsterPositions[(tables.monsterGraphics[group.type]!.uByte10 >> 4) & 15]!;
  const cell = set[relativeCell > 9 ? relativeCell - 1 : relativeCell]!;
  const shift = relativeCell === 10 ? -100 : relativeCell === 11 ? 100 : 0;
  return blits.map((b) => {
    const entry = cell.findIndex((p) => p.y !== 0 && p.y === b.y2
      && b.x1 === applyLimits(0, p.x + shift - b.w + 1, 223) && b.x2 === applyLimits(0, p.x + shift + b.w, 223));
    return { entry, member: b.graphic === attackGraphicOf(group.type) ? 1 : 0 };
  });
}

const F1 = 6;
const ORDER_3421 = 0x3421; // F1's order: far left, far right, near left, near right
const show = (s: Sprite[]) => s.map((x) => `member ${x.member} at entry ${x.entry}`).join(', ') || 'nothing';
function expect(what: string, group: Group, relativeCell: number, drawOrder: number, expected: Sprite[]): void {
  const got = draw(group, relativeCell, drawOrder);
  console.log(`  ${what}: ${show(got)}`);
  check(JSON.stringify(got) === JSON.stringify(expected), `${what}: ${show(expected)}`);
}

// Corners are absolute: 0 = far left, 1 = far right, 2 = near right, 3 = near left with
// the party facing north. A group facing south (2) or north (0) lies along the view, so a
// member at corner c holds c and the one counter-clockwise (0 → {3,0}, 2 → {1,2}); one
// facing east (1) or west (3) lies across it (0 → {0,1}, 2 → {2,3}).
// The member's own sprite shows only in a front view: member 1 is attacking, and a back or
// side view has no attack graphic, so there both read as member 0.
for (const type of [RAT, WORM]) {
  const name = type === RAT ? 'rat' : 'worm';
  console.log(`\na pair of ${name}s in F1 (Code51a4.cpp:410-561):`);
  expect('facing the party, member 0 left', { type, numMonM1: 1, corners: [0, 2], facing: 2 }, F1, ORDER_3421,
    [{ entry: 1, member: 1 }, { entry: 0, member: 0 }]);
  expect('facing the party, member 0 right', { type, numMonM1: 1, corners: [2, 0], facing: 2 }, F1, ORDER_3421,
    [{ entry: 1, member: 0 }, { entry: 0, member: 1 }]);
  expect('facing away', { type, numMonM1: 1, corners: [0, 2], facing: 0 }, F1, ORDER_3421,
    [{ entry: 1, member: 0 }, { entry: 0, member: 0 }]);
  expect('side on, member 0 far', { type, numMonM1: 1, corners: [0, 2], facing: 1 }, F1, ORDER_3421,
    [{ entry: 2, member: 0 }, { entry: 4, member: 0 }]);
  expect('side on, member 0 near', { type, numMonM1: 1, corners: [2, 0], facing: 3 }, F1, ORDER_3421,
    [{ entry: 2, member: 0 }, { entry: 4, member: 0 }]);
  expect('alone, centred, facing the party', { type, numMonM1: 0, corners: 255, facing: 2 }, F1, ORDER_3421,
    [{ entry: 4, member: 0 }]);
  expect('alone, centred, side on', { type, numMonM1: 0, corners: 255, facing: 1 }, F1, ORDER_3421,
    [{ entry: 3, member: 0 }]);
  expect('the survivor of a pair, facing the party, right', { type, numMonM1: 0, corners: [2], facing: 2 }, F1, ORDER_3421,
    [{ entry: 1, member: 0 }]);
  expect('the survivor of a pair, side on, far', { type, numMonM1: 0, corners: [0], facing: 1 }, F1, ORDER_3421,
    [{ entry: 2, member: 0 }]);
}

console.log('\nother sizes (Code51a4.cpp:471-484, :556-559):');
expect('three mummies at corners 0, 1, 2', { type: MUMMY, numMonM1: 2, corners: [0, 1, 2], facing: 2 }, F1, ORDER_3421,
  [{ entry: 0, member: 0 }, { entry: 1, member: 1 }, { entry: 2, member: 0 }]);
expect('a lone dragon', { type: DRAGON, numMonM1: 0, corners: 255, facing: 2 }, F1, ORDER_3421,
  [{ entry: 4, member: 0 }]);
expect('a dragon with corners set', { type: DRAGON, numMonM1: 0, corners: [0], facing: 2 }, F1, ORDER_3421, []);

// Beside the party. F0L is cell 10 with order 0x02 (its far right), F0R cell 11 with 0x01
// (its far left); both read `d.s6982` one cell down (`:562-566`), 100 pixels to the side.
// A front view (64 pixels) does not reach into the viewport; a rat's side view (112) does.
console.log('\nbeside the party (Code51a4.cpp:562-566, :2254-2258):');
expect('a pair of rats side on in F0L', { type: RAT, numMonM1: 1, corners: [0, 2], facing: 1 }, 10, 0x02,
  [{ entry: 2, member: 0 }]);
expect('a pair of rats side on in F0R', { type: RAT, numMonM1: 1, corners: [0, 2], facing: 1 }, 11, 0x01,
  [{ entry: 2, member: 0 }]);
expect('a mummy at the far right of F0L', { type: MUMMY, numMonM1: 0, corners: [1], facing: 2 }, 10, 0x02, []);

// 7. The mirror. A lone monster, centred, facing the party: the front view. The fake
// graphic is one colour on its left half and another on its right, so the first pixel of
// the sprite blitted says whether it was mirrored.
function frontMirrored(type: number, relativeCell: number, status: number): boolean | null {
  const record = { creatureType: type, numMonM1: 0 };
  const transparent = tables.monsterGraphics[type]!.uByte10 & 15;
  const [left, right] = [1, 2, 3, 4, 5].filter((c) => c !== transparent);
  let first: number | null = null;
  const context: any = {
    viewportIndexBuffer: createPaletteIndexViewportBuffer(224, 136, 0),
    objectTables: tables,
    getGraphicBitmap: (n: number) => {
      const img = graphics.getImage(n);
      const pixels = new Uint8Array(img.width * img.height).map((_, i) => ((i % img.width) < img.width / 2 ? left! : right!));
      return { width: img.width, height: img.height, pixels };
    },
    dungeonState: {
      getDBRecordLink: () => OBJECT_ID_EOF,
      getCreatureRecord: () => record,
      getMonsterRenderState: () => ({ positions: 255, facings: 0xaa, statuses: new Uint8Array([status, 0, 0, 0]) }),
    },
  };
  const interp = new BytecodeInterpreter(context) as any;
  const unmirroredFirst = (map: Uint8Array | null) => (map ? interp.mapColorValue(map, left) : left);
  interp.blitShapeToViewportIndexWithTransparent = (src: any) => { first = src.pixels[0]; };
  interp.drawRoomObjects(DBType.CREATURE << 10, 0, 0, 0, relativeCell, ORDER_3421);
  if (first === null) return null;
  const map = relativeCell >= 6 ? null : relativeCell >= 3 ? tables.monsterColorMapMedium : tables.monsterColorMapFar;
  return first !== unmirroredFirst(map);
}
console.log('\nthe front view\'s mirror (Code51a4.cpp:693-694, :717-790, :797-810, :859-864):');
const w4 = (type: number) => tables.monsterDesc[type]!.word4;
check((w4(RAT) & 0x184) === 0x180 && (w4(WORM) & 0x184) === 0x004,
  'the rat has word4 bits 7 and 8 and not NonAttackingMirrorOK; the worm the reverse');
for (const [type, name] of [[RAT, 'rat'], [WORM, 'worm']] as const) {
  for (const [cell, row] of [[6, 'F1'], [3, 'F2'], [0, 'F3']] as const) {
    for (const status of [0, 0x40]) {
      const expected = cell >= 6 ? type === WORM && status !== 0 : cell >= 3 ? type === RAT : false;
      const got = frontMirrored(type, cell, status);
      const what = `a ${name} in ${row}, mirror bit ${status ? 1 : 0}`;
      console.log(`  ${what}: ${got === null ? 'not drawn' : got ? 'mirrored' : 'as is'}`);
      check(got === expected, `${what}: ${expected ? 'mirrored' : 'as is'}`);
    }
  }
}

finish();
