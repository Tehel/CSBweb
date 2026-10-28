/**
 * The derived graphics, kept under CSBWin's numbers (`AllocateDerivedGraphic`,
 * `doc/CSBwin-src/CSBCode.cpp:11446`) in the screen's `GraphicsStore`.
 *
 * A number names one picture only if the numbers the drawing asks for never meet. An object
 * class's are `104 + uByte1`, one more at distance 1, two more mirrored (`byte4 & 1`), four
 * more as an alcove's second picture (`byte4 & 0x10`) (`Code51a4.cpp:1848-1877`); a door
 * ornament's `68 + 2*slot + nearness` for its seventeen slots (`CSBCode.cpp:4081`), the
 * door switch's 102 and 103 (`Code390e.cpp:302-321`), and a cloud's
 * `14*type + P2/2 + 436` (`Code51a4.cpp:42`). For every data set's `graphics.dat`, each
 * object number names one picture (graphic, size, distance, mirror), and all of them lie
 * between the door switch's and the clouds'.
 *
 * A door ornament's two pictures go with its slot when a level puts another ornament there
 * (`Code390e.cpp:286-299`), and stay while the slot holds the same one: drawn on levels of
 * `dm-atari`, slot 0's picture is made again only after a level whose slot 0 differs.
 *
 * And the store: a derived graphic is made once, and again after `deleteDerivedGraphic`; a
 * basic graphic that does not decode is `null`, traced once.
 *
 * Run: `npm test -- --only=derived-graphics.ts`
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Position } from '../../src/core/types';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import type { IndexedBitmap } from '../../src/renderer/csbwin/CanvasBlitter';
import { GraphicsStore } from '../../src/renderer/GraphicsStore';
import { ViewportRenderer } from '../../src/renderer/ViewportRenderer';
import { check, finish } from '../lib/check';
import { DATA_SETS } from '../lib/dataSets';
import { graphicsTablesOf, newGame, stockDungeon, stockGraphics } from '../lib/game';

const DOOR_SWITCH_LAST = 103;
const FIRST_CLOUD = 436;

/* ------------------------------------------- 1. the object numbers, set by set ---- */
for (const dir of [...new Set(DATA_SETS.map((s) => s.dir))].sort()) {
  const set = basename(dir);
  const path = `${dir}/graphics.dat`;
  if (!existsSync(path)) continue;
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(path)));
  const classes = graphicsTablesOf(graphics).objects.graphicClasses;
  const pictures = new Map<number, Set<string>>();
  classes.forEach((gc) => {
    const variants: Array<{ add: number; graphicNum: number; mirror: boolean }> = [
      { add: 0, graphicNum: 360 + (gc.objectGraphicIndex & 0xff), mirror: false },
    ];
    if (gc.byte4 & 1) variants.push({ add: 2, graphicNum: 360 + (gc.objectGraphicIndex & 0xff), mirror: true });
    if (gc.byte4 & 0x10) variants.push({ add: 4, graphicNum: 361 + (gc.objectGraphicIndex & 0xff), mirror: false });
    for (const { add, graphicNum, mirror } of variants) {
      for (const distance of [1, 2]) {
        const derivedNum = 104 + gc.uByte1 + add + (distance === 1 ? 1 : 0);
        const seen = pictures.get(derivedNum) ?? new Set<string>();
        seen.add(`${graphicNum} ${gc.widthBytes}x${gc.height} d${distance}${mirror ? ' mirrored' : ''}`);
        pictures.set(derivedNum, seen);
      }
    }
  });
  const shared = [...pictures].filter(([, seen]) => seen.size > 1);
  const numbers = [...pictures.keys()];
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  console.log(`${set}: ${classes.length} classes, ${pictures.size} object numbers, ${low}..${high}`);
  for (const [derivedNum, seen] of shared) console.log(`  ${derivedNum}: ${[...seen].join(', ')}`);
  check(shared.length === 0, `${set}: each object derived number names one picture`);
  check(low > DOOR_SWITCH_LAST && high < FIRST_CLOUD, `${set}: the object numbers lie between the door switch's and the clouds'`);
}

/* ---------------------------------- 2. a door ornament's pictures and its slot ---- */
{
  const graphics = stockGraphics();
  const data = stockDungeon();
  const dungeon = newGame(data, graphics).ctx.dungeon;
  const all = graphicsTablesOf(graphics);
  const store = new GraphicsStore(graphics, (line) => console.log(line));
  const renderer = new ViewportRenderer({
    graphicsLoader: graphics,
    dungeonState: dungeon,
    viewportTables: all.viewport,
    objectTables: all.objects,
    palette552: all.ui.graphic232.palette552,
    graphics: store,
    getGraphicBitmap: (graphicNum) => store.basicGraphic(graphicNum),
    trace: (line) => console.log(line),
  });
  const marker: IndexedBitmap = { width: 1, height: 1, pixels: new Uint8Array(1) };
  const kept = (): boolean => store.derivedGraphic(68, () => ({ ...marker })) === marker;
  const levels = data.maps.map((map, z) => ({ z, first: map.doorDecorationTOC?.[0] })).filter((l) => l.first !== undefined);
  let remade = 0;
  let held = 0;
  let previous: number | undefined;
  for (const { z, first } of levels) {
    store.deleteDerivedGraphic(68);
    store.derivedGraphic(68, () => marker);
    const sameAsBefore = first === previous;
    renderer.selectLevel(z);
    renderer.draw(new Position(0, 0, z), 0, false, false);
    const stays = kept();
    console.log(`level ${z}: slot 0 ornament ${first}${sameAsBefore ? ', as before' : ''}: its picture ${stays ? 'kept' : 'made again'}`);
    if (previous !== undefined) {
      check(stays === sameAsBefore, `level ${z}: slot 0's picture is kept exactly when its ornament is the level before's`);
      if (stays) held++;
      else remade++;
    }
    previous = first;
  }
  check(remade > 0 && held > 0, `the levels both keep (${held}) and make again (${remade}) slot 0's picture`);
}

/* --------------------------------------------------------------- 3. the store ---- */
{
  const traced: string[] = [];
  const store = new GraphicsStore(stockGraphics(), (line) => traced.push(line));
  let made = 0;
  const make = (): IndexedBitmap => { made++; return { width: 1, height: 1, pixels: new Uint8Array(1) }; };
  const first = store.derivedGraphic(500, make);
  const again = store.derivedGraphic(500, make);
  check(first === again && made === 1, 'a derived graphic is made once');
  store.deleteDerivedGraphic(500);
  check(store.derivedGraphic(500, make) !== first && made === 2, 'and made again once deleted');
  check(store.derivedGraphic(501, () => null) === null && store.derivedGraphic(501, make) !== null && made === 3,
    'a derived graphic whose source does not decode is not kept');

  const past = stockGraphics().getItemCount();
  check(store.basicGraphic(past) === null && store.basicGraphic(past) === null, 'a graphic that does not decode is null');
  console.log(`traced: ${traced.join(' / ')}`);
  check(traced.length === 1 && traced[0]!.startsWith(`graphics.dat item ${past} does not decode`), 'and traced once');
  check(store.basicGraphic(-1) === null && traced.length === 1, 'a negative number is null, untraced');
  check(store.basicGraphic(26) === stockGraphics().getImage(26), 'a basic graphic is the loader\'s decode');
}

finish();
