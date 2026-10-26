/**
 * A group drawn from its alternate graphic: CSBWin's second `DrawMonster`
 * (`doc/CSBwin-src/Code51a4.cpp:1139-1751`), called where `ProcessOnePosition` finds a
 * `CSBgraphics.dat` section for the group (`:2259-2295`), through `DrawRoomObjects`.
 *
 * 1. **The pictures are CSBWin's in memory, big-endian bitplanes.** The canary: fifteen
 *    of Conflux's sections draw their type's front view at the size of `graphics.dat`'s,
 *    in other colours, and are transparent exactly where it is. Read with each word's bytes
 *    swapped, none is.
 * 2. **Graphic 0 is the type's own**, from `graphics.dat`; graphic 1 of the mummy is section
 *    30, front, back, side and attack in `graphicNum0`'s order, keyed by its `ITEM12`'s
 *    transparent colour. A group is placed by its section's `ITEM110`: section 10's, type
 *    3's graphic 2, differs from the type's `d.s6982` set in every cell ahead.
 * 3. **The rows further away draw a derived graphic** (`:1620-1638`), shrunk with the
 *    distance's palette, numbered by `graphicNumFBSAE` and kept in the group's slot of the
 *    cache: a second frame shrinks nothing, and `CleanupAltMonCache` empties it.
 * 4. **A front view with a mirror, beside the party, is `die(0x3334)`** (`:1544`),
 *    CSBWin's ask for a derived graphic of no width. No section of the files here sets
 *    `NonAttackingMirrorOK()`, so the tool sets it. Further away the view is drawn as is.
 * 5. **The default dungeon draws as before**: no group of DM's names an alternate graphic,
 *    no generator makes one, and no level maps one.
 *
 * Run: `npm test -- --only=alt-mon-draw.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyLimits } from '../../src/core/intCast';
import { DBType, OBJECT_ID_EOF } from '../../src/core/types';
import { RnMaps } from '../../src/core/RnMaps';
import { getActuatorType, getActuatorValue } from '../../src/data/actuatorHelpers';
import { AltGraphicMapping, AltMonCache, readAltMonGraph, type AltMonGraph } from '../../src/data/AltMonGraphics';
import { CSBGraphicType, CSBGraphicsLoader, decodePlanar, type IndexedBitmap } from '../../src/data/CSBGraphicsLoader';
import type { CreatureRecord, DungeonData, DungeonHeader } from '../../src/data/dungeonTypes';
import { Die } from '../../src/core/Die';
import { DrawRoomObjects, mapColorValue } from '../../src/renderer/bytecode/DrawRoomObjects';
import { ViewportDraw } from '../../src/renderer/bytecode/ViewportDraw';
import { createPaletteIndexViewportBuffer, mirrorBitmap, shrinkBlt } from '../../src/renderer/csbwin/CanvasBlitter';
import type { DungeonState } from '../../src/engine/DungeonState';
import { check, finish } from '../lib/check';
import { wrapMember, standInOf } from '../lib/standIn';
import { viewportContextOf } from '../lib/viewportContext';
import { graphicsTablesOf, stockGraphics, stockDungeon } from '../lib/game';

const graphics = stockGraphics();
const tables = graphicsTablesOf(graphics).objects;
const csbGraphics = new CSBGraphicsLoader();
csbGraphics.loadFromArray(new Uint8Array(readFileSync(resolve('tools/fixtures/gamefiles/conflux-3.5-b8/CSBgraphics.dat'))));
/** A pool without records: every graphic is the section `3 * mt + n - 1`. */
const NO_POOL = standInOf<DungeonData>({ header: standInOf<DungeonHeader>({ objectCounts: new Array(16).fill(0) }) });

const MUMMY = 10; // one corner; section 30 has a side, a back and an attack view
const TYPE_3 = 3; // one corner; section 10, its graphic 2, has an ITEM110 of its own
const F1 = 6;
const F2 = 3;
const F3 = 0;
const ORDER = 0x3421;
const rnMaps = new RnMaps(() => undefined);
const monsterRn = rnMaps.rn(DBType.CREATURE, 0);

const same = (a: IndexedBitmap, b: IndexedBitmap): boolean =>
  a.width === b.width && a.height === b.height && a.pixels.every((p, i) => p === b.pixels[i]);

/** Picture `n` of a section, `byteWidth` by `height`, as the planes stand. */
function picture(g: AltMonGraph, n: number, byteWidth: number, height: number): IndexedBitmap {
  return { width: 2 * byteWidth, height, pixels: decodePlanar(g.graphic.subarray(g.graphicOffsets[n]), 2 * byteWidth, height) };
}

interface Blit { src: IndexedBitmap; x1: number; x2: number; y2: number; transparent: number }
interface Scene {
  /** The mummy unless said. */
  type?: number;
  alternateGraphics: number;
  /** The group's absolute facing; the party faces north. */
  facing: number;
  status?: number;
  cell: number;
}

/** The sprites `DrawRoomObjects` blits for one monster on the far left corner of `cell`. */
function drawScene(scene: Scene, cache: AltMonCache, files: Pick<CSBGraphicsLoader, 'readSection'> = csbGraphics): { blits: Blit[]; ownGraphics: number[] } {
  const record = standInOf<CreatureRecord>({ creatureType: scene.type ?? MUMMY, numMonM1: 0, alternateGraphics: scene.alternateGraphics });
  const blits: Blit[] = [];
  const ownGraphics: number[] = [];
  const context = viewportContextOf({
    viewportIndexBuffer: createPaletteIndexViewportBuffer(224, 136, 0),
    objectTables: tables,
    getGraphicBitmap: (n: number) => {
      ownGraphics.push(n);
      const img = graphics.getImage(n);
      return { width: img.width, height: img.height, pixels: img.pixels };
    },
    csbGraphics: standInOf<CSBGraphicsLoader>(files),
    altMonCache: cache,
    frameMapIndex: 1,
    dungeonState: standInOf<DungeonState>({
      rnMaps,
      getData: () => NO_POOL,
      getDBRecordLink: () => OBJECT_ID_EOF,
      getCreatureRecord: () => record,
      getMonsterRenderState: () => ({ positions: 0, facings: scene.facing * 0x55, statuses: new Uint8Array([scene.status ?? 0, 0, 0, 0]) }),
    }),
  });
  const draw = new ViewportDraw(context);
  wrapMember(draw, 'blitShapeToViewportIndexWithTransparent', (blit) => (src, rect, t) => {
    blits.push({ src, x1: rect.x1, x2: rect.x2, y2: rect.y2, transparent: t });
    blit(src, rect, t);
  });
  DrawRoomObjects(draw, monsterRn, 0, 0, 0, scene.cell, ORDER);
  return { blits, ownGraphics };
}

function format(): void {
  console.log('=== the pictures are big-endian bitplanes ===');
  const exact: number[] = [];
  const swappedExact: number[] = [];
  for (let mt = 0; mt < 27; mt++) {
    const own = tables.monsterGraphics[mt]!;
    const ownPicture = graphics.getImage(446 + own.word0).pixels;
    for (let n = 1; n <= 3; n++) {
      const g = readAltMonGraph(csbGraphics, 3 * mt + n - 1)?.graphic;
      if (!g || g.item12.frontRearByteWidth !== own.frontRearByteWidth || g.item12.frontRearHeight !== own.frontRearHeight) continue;
      const { frontRearByteWidth: bw, frontRearHeight: h } = g.item12;
      const front = g.graphic.subarray(g.graphicOffsets[0]);
      const swapped = front.map((_, i) => front[i ^ 1] ?? 0);
      const transparentAsOwn = (pixels: Uint8Array): boolean =>
        pixels.every((p, i) => (p === (g.item12.uByte10 & 15)) === (ownPicture[i] === (own.uByte10 & 15)));
      if (transparentAsOwn(decodePlanar(front, 2 * bw, h))) exact.push(3 * mt + n - 1);
      if (transparentAsOwn(decodePlanar(swapped, 2 * bw, h))) swappedExact.push(3 * mt + n - 1);
    }
  }
  console.log(`  transparent exactly where the type's own is: sections ${exact.join(', ')}; with the bytes swapped: ${swappedExact.join(', ') || 'none'}`);
  check(exact.length === 15 && swappedExact.length === 0, 'fifteen sections are their type\'s front view in other colours, read big-endian only');
}

function near(): void {
  console.log('=== beside the party: the section\'s pictures ===');
  const g = readAltMonGraph(csbGraphics, 30)!.graphic;
  const i12 = g.item12;
  const own = drawScene({ alternateGraphics: 0, facing: 2, cell: F1 }, new AltMonCache());
  check(own.blits.length === 1 && own.ownGraphics[0] === 446 + tables.monsterGraphics[MUMMY]!.word0, 'graphic 0: the type\'s own front view, from graphics.dat');

  const views: [string, Scene, IndexedBitmap][] = [
    ['front', { alternateGraphics: 1, facing: 2, cell: F1 }, picture(g, 0, i12.frontRearByteWidth, i12.frontRearHeight)],
    ['side, seen from its right: mirrored', { alternateGraphics: 1, facing: 3, cell: F1 }, mirrorBitmap(picture(g, 1, i12.sideByteWidth, i12.sideHeight))],
    ['side, seen from its left', { alternateGraphics: 1, facing: 1, cell: F1 }, picture(g, 1, i12.sideByteWidth, i12.sideHeight)],
    ['back', { alternateGraphics: 1, facing: 0, cell: F1 }, picture(g, 2, i12.frontRearByteWidth, i12.frontRearHeight)],
    ['attack', { alternateGraphics: 1, facing: 2, status: 0x80, cell: F1 }, picture(g, 3, i12.attackByteWidth, i12.attackHeight)],
  ];
  for (const [view, scene, expected] of views) {
    const { blits, ownGraphics } = drawScene(scene, new AltMonCache());
    console.log(`  ${view}: ${blits.map((b) => `${b.src.width}x${b.src.height} at x ${b.x1}-${b.x2}, bottom ${b.y2}`).join('; ')}`);
    check(blits.length === 1 && same(blits[0]!.src, expected) && ownGraphics.length === 0, `graphic 1, ${view}: section 30's picture, nothing from graphics.dat`);
    check(blits[0]?.transparent === (i12.uByte10 & 15), `${view}: the section's transparent colour, ${i12.uByte10 & 15}`);
  }

  // The front view's place, from the section's `ITEM110` and not `d.s6982`.
  const g10 = readAltMonGraph(csbGraphics, 10)!.graphic;
  const ownSet = tables.monsterPositions[(tables.monsterGraphics[TYPE_3]!.uByte10 >> 4) & 15]!;
  for (const [row, cell, distance] of [['F1', F1, 0], ['F2', F2, 1]] as const) {
    const { blits } = drawScene({ type: TYPE_3, alternateGraphics: 2, facing: 2, cell }, new AltMonCache());
    const entry = g10.item110[cell]![0]!;
    const ownEntry = ownSet[cell]![0]!;
    const bw = distance === 0 ? g10.item12.frontRearByteWidth : (g10.item12.frontRearByteWidth * 20 + 10) >> 5;
    console.log(`  type 3, graphic 2, ${row}: the section's entry (${entry.x},${entry.y}), the type's (${ownEntry.x},${ownEntry.y}); drawn at x ${blits[0]?.x1}-${blits[0]?.x2}, bottom ${blits[0]?.y2}`);
    check((entry.x !== ownEntry.x || entry.y !== ownEntry.y)
      && blits[0]?.y2 === Math.min(entry.y + tables.smallOffsets[0]!, 135)
      && blits[0]?.x2 === applyLimits(0, entry.x + tables.smallOffsets[distance << 3]! + bw, 223), `type 3, graphic 2, ${row}: placed at section 10's entry`);
  }
}

function far(): void {
  console.log('=== further away: derived graphics, kept ===');
  const g = readAltMonGraph(csbGraphics, 30)!.graphic;
  const i12 = g.item12;
  const front = picture(g, 0, i12.frontRearByteWidth, i12.frontRearHeight);
  const side = picture(g, 1, i12.sideByteWidth, i12.sideHeight);
  const record = { creatureType: MUMMY, alternateGraphics: 1 };
  const scaled = (n: number, scale: number): number => (n * scale + (scale >> 1)) >> 5;
  const cache = new AltMonCache();
  const rows: [string, Scene, number, IndexedBitmap, Uint8Array, boolean][] = [
    ['F2, front', { alternateGraphics: 1, facing: 2, cell: F2 }, 1, front, tables.monsterColorMapMedium, false],
    ['F3, front', { alternateGraphics: 1, facing: 2, cell: F3 }, 0, front, tables.monsterColorMapFar, false],
    ['F2, side mirrored', { alternateGraphics: 1, facing: 3, cell: F2 }, 3, side, tables.monsterColorMapMedium, true],
  ];
  for (const [what, scene, index, basic, palette, mirrored] of rows) {
    const scale = palette === tables.monsterColorMapMedium ? 20 : 16;
    const width = 2 * scaled(basic.width / 2, scale);
    const height = scaled(basic.height, scale);
    const { blits } = drawScene(scene, cache);
    const derived = cache.GetAlternateDerivedGraphicAddress(record, index);
    const shrunk = shrinkBlt(basic, basic.width, basic.height, width, height, palette);
    console.log(`  ${what}: derived graphic ${index}, ${derived?.width}x${derived?.height}`);
    check(derived !== null && same(derived, shrunk), `${what}: derived graphic ${index} is the picture shrunk ${scale}/32 with the distance's palette`);
    check(blits.length === 1 && (mirrored ? same(blits[0]!.src, mirrorBitmap(shrunk)) : blits[0]!.src === derived), `${what}: drawn ${mirrored ? 'mirrored' : 'as kept'}`);
    check(blits[0]?.transparent === mapColorValue(palette, i12.uByte10 & 15), `${what}: the transparent colour through the palette`);
  }
  const kept = cache.GetAlternateDerivedGraphicAddress(record, 1);
  drawScene({ alternateGraphics: 1, facing: 2, cell: F2 }, cache);
  check(cache.GetAlternateDerivedGraphicAddress(record, 1) === kept, 'a second frame draws the graphic kept');
  cache.CleanupAltMonCache();
  check([0, 1, 3].every((i) => cache.GetAlternateDerivedGraphicAddress(record, i) === null), 'CleanupAltMonCache empties the derived graphics');
}

function mirror(): void {
  console.log('=== a front view with a mirror ===');
  // Section 32, the mummy's graphic 3: a side and an attack view, no back.
  const withMirrorOK: Pick<CSBGraphicsLoader, 'readSection'> = {
    readSection: (type, id, minimumSize) => {
      const raw = csbGraphics.readSection(type, id, minimumSize);
      if (raw && type === CSBGraphicType.AlternateMonsterGraphic) raw[4]! |= 4; // `word4`'s NonAttackingMirrorOK
      return raw;
    },
  };
  let died: unknown = null;
  try {
    drawScene({ alternateGraphics: 3, facing: 2, status: 0x40, cell: F1 }, new AltMonCache(), withMirrorOK);
  } catch (error) {
    died = error;
  }
  console.log(`  F1: ${died instanceof Error ? died.message.replace('\n', ' / ') : 'drawn'}`);
  check(died instanceof Die && died.errorNum === 0x3334, 'beside the party: die(0x3334, "Alternate Zero Width")');

  const g = readAltMonGraph(csbGraphics, 32)!.graphic;
  const cache = new AltMonCache();
  const { blits } = drawScene({ alternateGraphics: 3, facing: 2, status: 0x40, cell: F2 }, cache, withMirrorOK);
  // 2 for the mirror, 2 each for the side and the attack view, 1 for the mirror further
  // away, 1 for the row: graphic 8.
  const derived = cache.GetAlternateDerivedGraphicAddress({ creatureType: MUMMY, alternateGraphics: 3 }, 8);
  const front = picture(g, 0, g.item12.frontRearByteWidth, g.item12.frontRearHeight);
  check(derived !== null && blits.length === 1 && blits[0]!.src === derived
    && same(derived, shrinkBlt(front, front.width, front.height, derived.width, derived.height, tables.monsterColorMapMedium)),
  'F2: derived graphic 8, the front view shrunk and not mirrored');
}

function defaultDungeon(): void {
  console.log('=== the default dungeon ===');
  const log = console.log;
  console.log = () => {};
  const dm = stockDungeon();
  console.log = log;
  const groups = dm.databases.creatures.records.filter((r) => r.alternateGraphics !== 0).length;
  const generators = dm.databases.actuators.records.filter((a) => getActuatorType(a) === 6 && ((getActuatorValue(a) >> 5) & 3) !== 0).length;
  let mapped = 0;
  for (let level = 0; level < dm.maps.length; level++) {
    for (let mt = 0; mt < 27; mt++) for (let n = 0; n < 4; n++) if (AltGraphicMapping(dm, level, mt, n) !== -1) mapped++;
  }
  console.log(`  groups with an alternate graphic: ${groups}; generators making one: ${generators}; mappings: ${mapped}`);
  check(groups === 0 && generators === 0 && mapped === 0, 'DM names no alternate graphic: its monsters are graphics.dat\'s');
}

format();
near();
far();
mirror();
defaultDungeon();
finish();
