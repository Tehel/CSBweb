/**
 * Three alcoves, not four: `d.Byte4038[4]` (`doc/CSBwin-src/Data.h:1190`) holds the three
 * wall decorations that are alcoves and a pad byte, 0. `ReadGraphicsForLevel` reads three
 * (`for (LOCAL_16=0; LOCAL_16<3; ...)`, `Code390e.cpp:209-221`) into the level's
 * `d.AlcoveGraphicIndices[3]`, which `IsAlcove` searches (`CSBCode.cpp:4621-4632`) for the
 * front wall's `d.FacingAlcove` (`:3279`, `:3359-3361`) and a false wall's random
 * decorations (`:5817`). Decoration 0 is no alcove. Before level 6 the port read the pad
 * byte too (`alcovePadByte`), and a click on a wall whose decoration is 0 touched nothing:
 * Conflux's partial game (`DEBT.md` F24) drifted at line 44479 when the switch below did
 * not run its DSA.
 *
 * Conflux 3.5's map 4 lists decoration 0 third, ordinal 3, the ornament of the two
 * switches on the west face of (15,9), under the text "FURS TRADER". The first sends
 * its message to the DSA at (12,8), which teleports the party to 34(5,15).
 *
 *   1. the table is [1, 2, 3, 0], and map 4's third decoration is decoration 0;
 *   2. drawn from (14,9) facing east, the face is no alcove, and button 5 is its rectangle;
 *   3. a click at (111,96), where the run clicked, empty-handed, through
 *      `handleMouseButton`, presses the switch: a tick later the party is on 34(5,15);
 *   4. at level 5 the face is an alcove, and the same click leaves the party where it is;
 *   5. a false wall or a square past a map's edge keeps a random decoration 0 that level 5
 *      dropped, on every map of the set, and nothing else changes.
 *
 * Run: `npm test -- --only=alcove-indices.ts`
 */
import { readFileSync } from 'node:fs';

import { OBJECT_ID_EOF, Position } from '../../src/core/types';
import { CSBGraphicsLoader } from '../../src/data/CSBGraphicsLoader';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { behaviourAt, ENGINE_LEVEL } from '../../src/engine/Behaviour';
import type { SummarizeRoomData } from '../../src/renderer/bytecode/Types';
import { summarizeRoomInfoCsbwin } from '../../src/renderer/csbwin/SummarizeRoomInfo';
import { handleMouseButton } from '../../src/renderer/ui/Mouse';
import { ViewportRenderer } from '../../src/renderer/ViewportRenderer';
import { check, finish } from '../lib/check';
import { graphicsStoreOf, graphicsTablesOf, newGame } from '../lib/game';
import { newUIState } from '../lib/ui';

const DIR = 'tools/fixtures/gamefiles/conflux-3.5-b8';
const EAST = 1;
const SWITCH = new Position(15, 9, 4);
const STAND = new Position(14, 9, 4);
const CLICK = { x: 111, y: 96 };

const dungeonBytes = new Uint8Array(readFileSync(`${DIR}/dungeon.dat`));
const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(`${DIR}/graphics.dat`)));
const csbGraphics = new CSBGraphicsLoader();
csbGraphics.loadFromArray(new Uint8Array(readFileSync(`${DIR}/CSBgraphics.dat`)));
const tables = graphicsTablesOf(graphics);
const store = graphicsStoreOf(graphics);

const alcoves = Array.from(tables.objects.alcoveDecorationIndices);
console.log(`d.Byte4038: [${alcoves.join(', ')}]`);
check(alcoves.join(',') === '1,2,3,0', '1. the table is three alcoves and a pad byte of 0');

/** The click on the switch's face at `level`: what the face is, and where the party is a tick later. */
function clickSwitch(level: number): { alcove: boolean; button: string; ordinal: number; party: string } {
  const data = new DungeonLoader().loadDungeonDat(dungeonBytes);
  if (!data) throw new Error('Conflux 3.5 dungeon.dat did not load');
  const game = newGame(data, graphics, { trace: () => {} });
  game.ctx.behaviour = behaviourAt(level);
  const dungeon = game.ctx.dungeon;
  const party = game.ctx.party.state;
  party.cursorOwner = 0;
  party.position = STAND;
  party.facing = EAST;
  game.systems.monsters.loadPartyLevelIfChanged();

  const rslt: SummarizeRoomData = {
    x: SWITCH.x, y: SWITCH.y, relativeCellNumber: 17, skinNumber: 0, roomType: 0, championPortraitOrdinal: 0,
    graphicRoomType: 0, rn2: OBJECT_ID_EOF, decorations: [0, 0, 0], text: [OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF],
  };
  summarizeRoomInfoCsbwin(rslt, dungeon, SWITCH, EAST, tables.objects);

  const renderer = new ViewportRenderer({
    graphicsLoader: graphics,
    csbGraphicsLoader: csbGraphics,
    dungeonState: dungeon,
    behaviour: () => game.ctx.behaviour,
    viewportTables: tables.viewport,
    objectTables: tables.objects,
    palette552: tables.ui.graphic232.palette552,
    graphics: store,
    getGraphicBitmap: (n) => store.basicGraphic(n),
    trace: () => {},
  });
  renderer.selectLevel(STAND.z);
  const ui = newUIState(graphics, game.ctx);
  ui.picking = renderer.draw(STAND, EAST, false, false);
  const b = ui.picking.viewportObjectButtons[5]!;
  const alcove = ui.picking.facingAlcove;
  handleMouseButton(ui, 80, CLICK.x, CLICK.y);
  game.gameTick();
  const at = party.position;
  return {
    alcove, button: `${b.x1}-${b.x2} x ${b.y1}-${b.y2}`, ordinal: rslt.decorations[1]!,
    party: `${at.z}(${at.x},${at.y})`,
  };
}

const toc = new DungeonLoader().loadDungeonDat(dungeonBytes)!.maps[4]!.wallDecorationTOC ?? [];
const now = clickSwitch(ENGINE_LEVEL);
console.log(`map 4's decorations [${Array.from(toc).join(', ')}]; (15,9)'s west face shows ordinal ${now.ordinal}`);
check(now.ordinal === 3 && toc[2] === 0, "1. the switch's face shows ordinal 3, map 4's decoration 0");
console.log(`level ${ENGINE_LEVEL}: alcove ${now.alcove}, button 5 ${now.button}; after the click the party is on ${now.party}`);
check(!now.alcove && now.button !== '255-0 x 0-0', '2. the face is no alcove, and button 5 is its rectangle');
check(now.party === '34(5,15)', '3. the click presses the switch, and its DSA teleports the party to 34(5,15)');
const before = clickSwitch(5);
console.log(`level 5: alcove ${before.alcove}, button 5 ${before.button}; after the click the party is on ${before.party}`);
check(before.alcove && before.party === '4(14,9)', '4. at level 5 the face was an alcove, and the click left the party at 4(14,9)');

// 5. Every square of every map, and a square past each edge, summarised from each side,
// with the pad byte and without.
const data = new DungeonLoader().loadDungeonDat(dungeonBytes)!;
const dungeon = newGame(data, graphics, { trace: () => {} }).ctx.dungeon;
let kept = 0;
let other = 0;
for (let z = 0; z < dungeon.getMapCount(); z++) {
  const map = dungeon.getMap(z)!;
  const decorations = map.wallDecorationTOC ?? [];
  for (let x = -1; x <= map.descriptor.width; x++) {
    for (let y = -1; y <= map.descriptor.height; y++) {
      for (let facing = 0; facing < 4; facing++) {
        const summarize = (pad: boolean): number[] => {
          const rslt: SummarizeRoomData = {
            x, y, relativeCellNumber: 17, skinNumber: 0, roomType: 0, championPortraitOrdinal: 0,
            graphicRoomType: 0, rn2: OBJECT_ID_EOF, decorations: [0, 0, 0], text: [OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF],
          };
          summarizeRoomInfoCsbwin(rslt, dungeon, new Position(x, y, z), facing, tables.objects, undefined, 0, pad);
          return rslt.decorations;
        };
        const three = summarize(false);
        const four = summarize(true);
        for (let i = 0; i < 3; i++) {
          if (three[i] === four[i]) continue;
          if (four[i] === 0 && decorations[three[i]! - 1] === 0) kept++;
          else other++;
        }
      }
    }
  }
}
console.log(`random decorations 0 kept that level 5 dropped: ${kept}; other differences: ${other}`);
check(kept > 0 && other === 0, '5. a false wall or a square past the edge keeps its random decoration 0, and nothing else changes');

finish();
