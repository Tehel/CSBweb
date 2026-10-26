/**
 * What a custom data set's indices can do to the draw and the DSA (`DEBT.md` R → "A file
 * the player drops on the page and a custom dungeon are untrusted"): an index past its
 * table draws or does nothing, where it would otherwise throw and end the game.
 *
 * 1. **`TAG0088b2` clips to its destination** (`tag0088b2Index`): a rectangle partly off
 *    the left or the top draws the source's columns and rows that fall on it, one wholly
 *    off the right or the bottom draws nothing, and so does a fill. CSBWin's callers clip
 *    first (`DrawSingleObject`, `doc/CSBwin-src/Code51a4.cpp:1943-1962`), and the port's
 *    with them, so no shipped frame moves.
 * 2. **A door ornament whose position set is past `d.Byte4122`'s four** (`TAG004b26`,
 *    `doc/CSBwin-src/CSBCode.cpp:4058-4124`), as a custom level's `DoorDecorationTOC`
 *    naming ornament 12 or more gives (`Code390e.cpp:275-284`), is not drawn; the door is.
 * 3. **A DSA slot that names a record past its database** reads as no record:
 *    `&MONSTER@` reads zeros and -1 (`DSA.cpp:3993-4057`), `&MONSTER!` writes nothing,
 *    `&MONPOSS` gives 0xffff, `&CURSE!` curses nothing, and `&DESCRIBE` skips the text.
 *
 * Run: `npm test -- --only=hostile-indices.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, RoomType, locationRelToInteger, type ObjectID } from '../../src/core/types';
import type { DoorRecord } from '../../src/data/dungeonTypes';
import { StkOp, ViewingFilterSite } from '../../src/engine/dsa/DsaTypes';
import type { DungeonState } from '../../src/engine/DungeonState';
import { DrawDoor } from '../../src/renderer/bytecode/DrawDoor';
import type { ViewportDraw } from '../../src/renderer/bytecode/ViewportDraw';
import type { InterpreterContext } from '../../src/renderer/bytecode/BytecodeInterpreter';
import {
  createPaletteIndexViewportBuffer, fillRectIndex, tag0088b2Index, type IndexedBitmap,
} from '../../src/renderer/csbwin/CanvasBlitter';
import { check, finish } from '../lib/check';
import { freshGame, globalStore, int, op, placeFilterDsas, report, run } from '../lib/dsa';
import { graphicsTablesOf, stockGraphics } from '../lib/game';
import { standInOf } from '../lib/standIn';

/** What `run` threw, or `null`. */
function thrown(run: () => unknown): Error | null {
  try {
    run();
    return null;
  } catch (error) {
    return error as Error;
  }
}

/* ------------------------------------------ 1. TAG0088b2 clips ------------------ */
{
  // Every pixel its own value, so a wrong column or row shows.
  const src: IndexedBitmap = { width: 4, height: 2, pixels: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) };
  const blit = (x1: number, x2: number, y1: number, y2: number): string => {
    const dst = createPaletteIndexViewportBuffer(6, 3, 0);
    tag0088b2Index(src, dst, { x1, x2, y1, y2 }, -1);
    return Array.from({ length: 3 }, (_, y) => Array.from(dst.pixels.subarray(y * 6, y * 6 + 6)).join('')).join('/');
  };
  const left = blit(-2, 1, 0, 1);
  const top = blit(0, 3, -1, 0);
  const right = blit(6, 9, 0, 1);
  const bottom = blit(0, 3, 3, 4);
  console.log(`1. a 4x2 source on a 6x3 buffer: at x -2 ${left}; at y -1 ${top}; at x 6 ${right}; at y 3 ${bottom}`);
  check(left === '340000/780000/000000', 'a rectangle partly off the left draws the source\'s last columns');
  check(top === '567800/000000/000000', 'a rectangle partly off the top draws the source\'s last row');
  check(right === '000000/000000/000000' && bottom === '000000/000000/000000',
    'a rectangle wholly off the right or the bottom draws nothing');
  const fill = createPaletteIndexViewportBuffer(6, 3, 0);
  fillRectIndex(fill, { x1: 6, x2: 9, y1: 0, y2: 2 }, 5);
  check(fill.pixels.every((v) => v === 0), 'a fill wholly off the right fills nothing');
}

/* ------------------------------------------ 2. a door ornament past the sets ---- */
{
  const objectTables = graphicsTablesOf(stockGraphics()).objects;
  const door: IndexedBitmap = { width: 8, height: 8, pixels: new Uint8Array(64).fill(3) };
  const draw = (ornament: [number, number]): { error: Error | null; drawn: number } => {
    const viewport = createPaletteIndexViewportBuffer(224, 136, 0);
    const context = standInOf<InterpreterContext>({
      viewportIndexBuffer: viewport,
      objectTables,
      doorOrnaments: [ornament],
      doorTOC: [0, 0],
      graphicCache: new Map(),
      getGraphicBitmap: () => door,
      dungeonState: standInOf<DungeonState>({
        getDoorRecordByIndex: () => standInOf<DoorRecord>({ doorType: 0, vertical: false, ornateNumber: 1 }),
      }),
    });
    const rect = { x1: 100, x2: 107, y1: 50, y2: 57 };
    const error = thrown(() => DrawDoor(standInOf<ViewportDraw>({ context }), 0, 4, [0, 0], 1, [rect]));
    return { error, drawn: viewport.pixels.filter((v) => v === 3).length };
  };
  const four = draw([303, 4]);
  const none = draw([303, undefined as unknown as number]);
  console.log(`2. a closed door at F2 whose ornament is in set 4: ${four.error?.message ?? `${four.drawn} door pixels`}; `
    + `in no set: ${none.error?.message ?? `${none.drawn} door pixels`}`);
  check(!four.error && !none.error, 'an ornament past Byte4122\'s four sets draws nothing and throws nothing');
  check(four.drawn === 64 && none.drawn === 64, 'the door itself is drawn');
}

/* ------------------------------------------ 3. a DSA slot past its database ----- */
{
  /** `program` of a slot of `db` whose record is ten past the last of its database. */
  const onSlotPast = (db: DBType, program: (rn: ObjectID) => number[]): { error: Error | null; g: number[] } => {
    let rn = OBJECT_ID_EOF as ObjectID;
    let g: number[] = [];
    const error = thrown(() => {
      g = run(() => program(rn), (game) => {
        const length = game.ctx.dungeon.getData().databases[db === DBType.CREATURE ? 'creatures' : 'weapons'].records.length;
        rn = game.ctx.dungeon.rnMaps.rn(db, length + 10);
      }).g;
    });
    return { error, g };
  };
  const fetch = onSlotPast(DBType.CREATURE, (rn) => [...int(rn), ...int(0), ...int(8), op(StkOp.MONSTER_FETCH), ...report(0, 8)]);
  const store = onSlotPast(DBType.CREATURE, (rn) => [...int(rn), ...int(0), ...int(8), op(StkOp.MONSTER_STORE)]);
  const poss = onSlotPast(DBType.CREATURE, (rn) => [...int(rn), ...int(0), op(StkOp.MON_POSS), globalStore(0)]);
  const curse = onSlotPast(DBType.WEAPON, (rn) => [...int(rn), ...int(1), op(StkOp.SET_CURSE)]);
  const said = (r: { error: Error | null }, what: string): string => r.error?.message ?? what;
  console.log(`3. on a slot past its database: &MONSTER@ ${said(fetch, fetch.g.slice(0, 8).join(' '))}; `
    + `&MONSTER! ${said(store, 'nothing thrown')}; &MONPOSS ${said(poss, `${poss.g[0]}`)}; `
    + `&CURSE! ${said(curse, 'nothing thrown')}`);
  check(!fetch.error && fetch.g.slice(0, 8).join() === '0,-1,0,0,0,0,0,0', '&MONSTER@ reads zeros and -1 for the type');
  check(!store.error, '&MONSTER! writes nothing, and throws nothing');
  check(!poss.error && poss.g[0] === 0xffff, '&MONPOSS gives no object');
  check(!curse.error, '&CURSE! curses nothing, and throws nothing');

  // `&DESCRIBE` at a square whose text names a record past the texts: the last empty
  // open square of the party's level, the filter's being the first.
  let at: Position | null = null;
  const describe = freshGame();
  const target = describe.ctx.dungeon;
  const z = describe.ctx.party.state.position.z;
  const map = target.getMap(z)!;
  for (let x = map.descriptor.width - 1; x >= 0 && !at; x--) {
    for (let y = map.descriptor.height - 1; y >= 0 && !at; y--) {
      const p = new Position(x, y, z);
      if (((target.getCellFlag(p) >> 5) & 7) !== RoomType.OPEN) continue;
      if (target.findFirstObject(p) !== OBJECT_ID_EOF) continue;
      at = p;
    }
  }
  if (!at) throw new Error('no empty open square');
  const locr = locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 1 });
  const texts = target.getData().databases.texts.records;
  texts.push({ nextObject: OBJECT_ID_EOF, textOffset: 0, visible: true });
  target.addObjectToCell(at, target.rnMaps.setPos(target.rnMaps.rn(DBType.TEXT, texts.length - 1), 1));
  texts.pop();
  placeFilterDsas(describe, 3, [[...int(locr), ...int(2), ...int(9), op(StkOp.DESCRIBE)]]);
  let phrase: string | null | undefined;
  const described = thrown(() => {
    const result = describe.systems.dsa.filters.processViewingFilter({
      site: ViewingFilterSite.DESCRIPTION, phraseMask: 0, objectId: target.rnMaps.rn(DBType.WEAPON, 0), selectedCharacter: 0,
    });
    phrase = result?.phraseTextOverrides[2];
  });
  console.log(`   &DESCRIBE at a text past the texts: ${described?.message ?? `phrase 2 ${JSON.stringify(phrase)}`}`);
  check(!described && (phrase ?? null) === null, '&DESCRIBE skips a text whose record is past the texts');
}

finish();
