/**
 * How a flying object is drawn: `GetGraphicClass` and the missile half of
 * `DrawRoomObjects` (`doc/CSBwin-src/Code51a4.cpp:2303-2562`).
 *
 * `GetGraphicClass` (`Code51a4.cpp:2838-2870`) gives a spell a missile graphic, and a
 * weapon one too when its `WEAPONDESC.word4` holds it in `BITS8_12`. Such a weapon flies
 * as `d.struct5688[n-1]`, drawn from graphic `316 + uByte0` (+1 or +2 for its side and
 * back views), not as the object lying on the floor (`360 + objectGraphicIndex`). The
 * port used to skip the weapon branch, so a thrown dagger, arrow or sword flew as its
 * floor picture. This prints the class of all 46 weapon types, then draws a thrown
 * dagger and asserts which graphic it asked for, and where it put it:
 *
 *  1. a weapon with a missile graphic has class `-BITS8_12(word4)`; one without has its
 *     `d.ObjDesc` class; a spell keeps its fixed class;
 *  2. the dagger is drawn from `316 + uByte0 + w_128`, never from the floor graphics;
 *  3. its rectangle is CSBWin's: `y1 = 47 - h/2 + (h even)`, `y2 = 47 + h/2`
 *     (`:2536-2541`);
 *  4. in the party's own cell (`RelativeCellNumber == 9`) a missile whose size does not
 *     follow its range is drawn at full size, not through `d.Byte5752` (`:2327-2336`);
 *  5. an object that flies as its floor picture is drawn where its viewport position
 *     says, without the small offsets an object on the floor takes (`DrawSingleObject`
 *     adds them `if (!drawingMissiles)`, `:1907`), and is mirrored on the right side of
 *     the cell when its class's `byte4 & 1` says so, `LOCAL_34` being 0 (`:1810-1816`,
 *     `:2572-2578`).
 *
 * Run: `npm test -- --only=missile-draw.ts`
 */
import { DBType, OBJECT_ID_EOF, type ObjectID } from '../../src/core/types';
import { RN_FIREBALL, RN_LIGHTNING } from '../../src/core/spellRn';
import type { MissileRecord } from '../../src/data/dungeonTypes';
import { DungeonState } from '../../src/engine/DungeonState';
import { GetBasicObjectType } from '../../src/engine/objectIndex';
import type { InterpreterContext } from '../../src/renderer/bytecode/BytecodeInterpreter';
import { drawMissilesAtPosition, GetGraphicClass } from '../../src/renderer/bytecode/DrawRoomObjects';
import { ViewportDraw } from '../../src/renderer/bytecode/ViewportDraw';
import { createPaletteIndexViewportBuffer } from '../../src/renderer/csbwin/CanvasBlitter';
import { check, finish } from '../lib/check';
import { standIn, standInOf } from '../lib/standIn';
import { graphicsTablesOf, stockGraphics, stockDungeon } from '../lib/game';

async function main(): Promise<void> {
  const data = stockDungeon();
  const dungeon = new DungeonState(data);
  const graphics = stockGraphics();
  const tables = graphicsTablesOf(graphics).objects;

  // A real weapon record, retyped in memory to each of the 46 weapon types.
  const weaponRn = dungeon.rnMaps.rn(DBType.WEAPON, 0);
  const weapon = dungeon.getWeaponRecord(weaponRn);
  if (!weapon) throw new Error('dungeon.dat has no weapon 0');
  const savedType = weapon.weaponType;
  const nameOf = (): string => tables.objectNames[GetBasicObjectType(dungeon, tables.objDescObjectType, weaponRn)] ?? '?';

  // --- 1. the class of every weapon type -----------------------------------------
  console.log(['type', 'name', 'BITS8_12(word4)', 'graphic class'].join('\t'));
  const classOf = new Map<string, number | null>();
  for (let type = 0; type < tables.weaponDesc.length; type++) {
    weapon.weaponType = type;
    const bits = ((tables.weaponDesc[type]!.word4) >> 8) & 0x1f;
    const gc = GetGraphicClass(dungeon, tables, weaponRn);
    const name = nameOf();
    classOf.set(name, gc);
    console.log([type, name, bits, gc].join('\t'));
    if (bits !== 0) check(gc === -bits, `${name}: flies as missile graphic ${bits - 1} (got class ${gc})`);
    else check(gc !== null && gc >= 0, `${name}: flies as its floor graphic (got class ${gc})`);
  }
  // Canary: the objects seen flying as their floor picture. The arrow is class -1, which
  // the port once also used for "not an object".
  for (const name of ['DAGGER', 'SWORD', 'ARROW', 'SLAYER', 'THROWING STAR']) {
    const gc = classOf.get(name);
    check(gc !== undefined && gc !== null && gc < 0, `a thrown ${name} has a missile graphic (got ${gc})`);
  }
  check(classOf.get('TORCH') !== undefined && (classOf.get('TORCH') ?? -1) >= 0, 'a thrown TORCH flies as its floor graphic');
  check(GetGraphicClass(dungeon, tables, RN_FIREBALL) === -11, 'a fireball is class -11');
  check(GetGraphicClass(dungeon, tables, RN_LIGHTNING) === -4, 'a lightning bolt is class -4');
  check(GetGraphicClass(dungeon, tables, dungeon.rnMaps.rn(DBType.DOOR, 0)) === null, 'a door is not an object, and is not drawn');

  // --- 2-4. a thrown dagger, drawn ---------------------------------------------------
  let dagger = -1;
  for (let type = 0; type < tables.weaponDesc.length; type++) {
    weapon.weaponType = type;
    if (nameOf() === 'DAGGER') dagger = type;
  }
  weapon.weaponType = dagger;
  const md = tables.missileGraphics[-GetGraphicClass(dungeon, tables, weaponRn)! - 1]!;
  const w130 = (md.word4 & 0x100) === 0;
  console.log(`dagger: struct5688 uByte0=${md.uByte0} half-width=${md.widthBytes} height=${md.height} word4=0x${md.word4.toString(16)}`);

  const view: DungeonState = Object.create(dungeon);
  standIn(view, 'getDBRecordLink', () => OBJECT_ID_EOF);
  standIn(view, 'getTimerWord8', () => 0); // flying north, as the party faces
  const missile = standInOf<MissileRecord>({ projectileObject: weaponRn as ObjectID, timerIndex: 0, rangeRemaining: 255 });
  standIn(view, 'getMissileRecord', () => missile);

  // Solid synthetic graphics of each requested graphic's real size; the viewport starts at 0.
  interface Drawn { asked: number[]; x1: number; y1: number; x2: number; y2: number }
  const draw = (relativeCell: number, relativeLocation: number): Drawn => {
    const asked: number[] = [];
    const viewportIndexBuffer = createPaletteIndexViewportBuffer(224, 136, 0);
    const context = standInOf<InterpreterContext>({
      viewportIndexBuffer,
      objectTables: tables,
      dungeonState: view,
      getGraphicBitmap: (n: number) => {
        asked.push(n);
        const w = md.widthBytes * 2;
        return { width: w, height: md.height, pixels: new Uint8Array(w * md.height).fill(5) };
      },
    });
    drawMissilesAtPosition(
      new ViewportDraw(context), view, tables, dungeon.rnMaps.setPos(dungeon.rnMaps.rn(DBType.MISSILE, 0), relativeLocation), relativeLocation, 0, 0, 0, relativeCell, relativeLocation, 1,
    );
    const { width, pixels } = viewportIndexBuffer;
    let x1 = 999, y1 = 999, x2 = -1, y2 = -1;
    for (let y = 0; y < 136; y++) {
      for (let x = 0; x < 224; x++) {
        if (pixels[y * width + x] === 0) continue;
        x1 = Math.min(x1, x); x2 = Math.max(x2, x);
        y1 = Math.min(y1, y); y2 = Math.max(y2, y);
      }
    }
    return { asked, x1, y1, x2, y2 };
  };

  // Cell 3, the square straight ahead; its near-left position.
  const scaled = draw(3, 2);
  const distance = 2 * Math.floor(3 / 3) + 1;
  const scale = tables.missileScale[distance]!;
  const h = (md.height * scale + (scale >> 1)) >> 5;
  console.log(`cell 3 pos 2: asked ${scaled.asked.join(',')}; drawn (${scaled.x1},${scaled.y1})-(${scaled.x2},${scaled.y2}); scaled height ${h}`);
  check(scaled.asked.length === 1, 'one graphic is fetched for the dagger');
  check(scaled.asked.every((n) => n >= 316 && n <= 318 + 13), `the dagger is drawn from the missile graphics 316.., not the floor ones 360.. (asked ${scaled.asked})`);
  check(scaled.asked[0] === 316 + md.uByte0 || scaled.asked[0] === 316 + md.uByte0 + 1 || scaled.asked[0] === 316 + md.uByte0 + 2,
    `the dagger is graphic 316 + uByte0 + w_128 (asked ${scaled.asked})`);
  check(scaled.y2 === 47 + (h >> 1), `y2 is 47 + h/2 (got ${scaled.y2})`);
  check(scaled.y1 === 47 - (h >> 1) + ((h & 1) === 0 ? 1 : 0), `y1 is 47 - h/2 + (h even) (got ${scaled.y1})`);

  // The party's own cell: full size when the size ignores the range, or on launch.
  const vp9 = tables.viewportPosition[0]![9]!;
  const location9 = [0, 1, 2, 3].find((l) => (vp9[l]?.x ?? 0) !== 0);
  check(location9 !== undefined, 'the party cell has a position a missile is drawn at');
  if (location9 !== undefined) {
    const full = draw(9, location9);
    console.log(`cell 9 pos ${location9}: drawn (${full.x1},${full.y1})-(${full.x2},${full.y2}), w_130=${w130}`);
    check(full.y2 - full.y1 + 1 === md.height,
      `a launched dagger in the party cell is full height ${md.height} (got ${full.y2 - full.y1 + 1})`);
  }

  // --- 5. an object flying as its floor picture ---------------------------------------
  // The first object of the dungeon whose class has `byte4 & 1`, in the party's own cell.
  let object: ObjectID | null = null;
  for (const db of [DBType.WEAPON, DBType.CLOTHING, DBType.POTION, DBType.MISC]) {
    const count = data.header.objectCounts[db] ?? 0;
    for (let i = 0; i < count && object === null; i++) {
      const rn = dungeon.rnMaps.rn(db, i);
      const gc = GetGraphicClass(dungeon, tables, rn);
      if (gc !== null && gc >= 0 && ((tables.graphicClasses[gc]?.byte4 ?? 0) & 1) !== 0) object = rn as ObjectID;
    }
  }
  check(object !== null, 'an object whose graphic class mirrors');
  if (object !== null) {
    const gc = tables.graphicClasses[GetGraphicClass(dungeon, tables, object)!]!;
    const flying = standInOf<MissileRecord>({ projectileObject: object, timerIndex: 0, rangeRemaining: 255 });
    standIn(view, 'getMissileRecord', () => flying);
    const location = [1, 2].find((l) => (tables.viewportPosition[gc.byte5]?.[9]?.[l]?.y ?? 0) !== 0)!;
    // Its left half colour 5, its right half 6: mirrored, the left edge is 6.
    const w = gc.widthBytes * 2;
    const viewportIndexBuffer = createPaletteIndexViewportBuffer(224, 136, 0);
    const context = standInOf<InterpreterContext>({
      viewportIndexBuffer, objectTables: tables, dungeonState: view, graphicCache: new Map(),
      getGraphicBitmap: () => ({ width: w, height: gc.height, pixels: Uint8Array.from({ length: w * gc.height }, (_, i) => (i % w < w / 2 ? 5 : 6)) }),
    });
    const vp = tables.viewportPosition[0]![9]![location]!;
    drawMissilesAtPosition(new ViewportDraw(context), view, tables,
      dungeon.rnMaps.setPos(dungeon.rnMaps.rn(DBType.MISSILE, 0), location), location, 0, 0, 0, 9, location, 0);
    const { pixels, width } = viewportIndexBuffer;
    let x1 = 999, y2 = -1, edge = 0;
    for (let y = 0; y < 136; y++) {
      for (let x = 0; x < 224; x++) {
        const c = pixels[y * width + x]!;
        if (c === 0) continue;
        if (x < x1) { x1 = x; edge = c; }
        y2 = Math.max(y2, y);
      }
    }
    console.log(`flying ${object} (class byte4 0x${gc.byte4.toString(16)}) at cell 9 pos ${location}: ` +
      `x1 ${x1} y2 ${y2}, viewport x ${vp.x}, left edge colour ${edge}`);
    check(y2 === Math.min(135, 47) && x1 === Math.max(0, vp.x - gc.widthBytes + 1), 'it lies where its position says, no small offset added');
    check(edge === 6, 'and on the right side of the cell it is mirrored');
  }

  weapon.weaponType = savedType;
  finish();
}

void main();
