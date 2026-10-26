/**
 * The "lightning door" energy shimmer — a random mirror and a random vertical flip
 * applied to the door bitmap on every redraw it isn't bashed
 * (`doc/CSBwin-src/CSBCode.cpp:4221-4231`).
 *
 * This was never ported at all: `opStdDrawDoor` drew the same bitmap every time,
 * with no notion of `d.DoorTOC`'s bit 10 or the `STRandomBool()` calls CSBWin makes
 * for it. The shipped `dungeon.dat` actually uses this — `doorCharacteristics[3] ==
 * 0x5ff` has the bit set — so any level whose `doorType0Index`/`doorType1Index`
 * selects entry 3 has doors that should visibly shimmer and did not.
 *
 * `ViewportRenderer.drawViewportFrame` now resolves `context.doorTOC` from the
 * level's door characteristics the same way it already resolved `doorGraphics`, and
 * `DrawDoor` (`DrawDoor.ts`) rolls two `viewportRandom.bool()` draws (`ViewportDrawState.ts`) — a
 * dedicated `CsbRandom` instance, never the game's own, exactly as CSBWin swaps in a
 * viewport-only stream for `DrawViewport` so rendering can't perturb monster AI or
 * combat — when the resolved `DoorTOC` entry has bit 0x400 set.
 *
 * This confirms the real dungeon data has the bit, then runs `StdDrawDoor` (bypassing
 * only rectangle-pointer resolution, which is proven elsewhere) across many redraws of the same closed door and checks the drawn bitmap doesn't
 * sit at a single, frozen identity.
 *
 * Run: `npm test -- --only=door-lightning.ts`
 */
import { BytecodeInterpreter } from '../../src/renderer/bytecode/BytecodeInterpreter';
import { Opcode } from '../../src/renderer/bytecode/Opcodes';
import { createPaletteIndexViewportBuffer } from '../../src/renderer/csbwin/CanvasBlitter';
import type { DoorRecord } from '../../src/data/dungeonTypes';
import type { DungeonState } from '../../src/engine/DungeonState';
import { check, finish } from '../lib/check';
import { graphicsTablesOf, stockGraphics } from '../lib/game';
import { standIn, standInOf } from '../lib/standIn';
import { viewportContextOf } from '../lib/viewportContext';

const graphics = stockGraphics();
const objectTables = graphicsTablesOf(graphics).objects;

console.log('doorCharacteristics:', Array.from(objectTables.doorCharacteristics).map((v) => `0x${(v & 0xffff).toString(16)}`));
const lightningIndex = Array.from(objectTables.doorCharacteristics).findIndex((v) => (v & 0x400) !== 0);
check(lightningIndex >= 0, 'the shipped dungeon.dat defines at least one lightning-door characteristic (bit 0x400)');

// Non-uniform on purpose: mirroring or flipping a solid-color bitmap is a no-op,
// which would make this test pass or fail by accident rather than on the mechanism.
const doorGraphicBitmap = { width: 8, height: 8, pixels: new Uint8Array(64).map((_, i) => (i % 8) + Math.floor(i / 8)) };
const viewportIndexBuffer = createPaletteIndexViewportBuffer(320, 200, 0);

const context = viewportContextOf({
  viewportIndexBuffer,
  roomData: [],
  doorGraphics: [[0, 0], [0, 0], [0, 0]],
  doorTOC: [objectTables.doorCharacteristics[lightningIndex] ?? 0, 0],
  getGraphicBitmap: () => doorGraphicBitmap,
  dungeonState: standInOf<DungeonState>({
    getDoorRecordByIndex: () => standInOf<DoorRecord>({ doorType: 0, vertical: false }),
  }),
});

const interp = new BytecodeInterpreter(context);
// Rectangle-pointer resolution is proven by the other opcode tools; here it would
// only need real `graphics.dat` geometry to reach the code this tool cares about,
// so it is stubbed to a fixed door rect set.
const fakeRect = { x1: 100, x2: 107, y1: 50, y2: 57 };
standIn(interp, 'resolveStdRectanglePointer', () => [fakeRect, fakeRect, fakeRect, fakeRect, fakeRect, fakeRect, fakeRect, fakeRect, fakeRect, fakeRect]);

function drawClosedDoorOnce(): string {
  interp.interpret([
    Opcode.Literal, 0, // doorRecordIndex
    Opcode.Literal, 4, // doorState: closed
    Opcode.Literal, 0, // doorGraphicIndex
    Opcode.Literal, 0, // rectPtr, ignored
    Opcode.StdDrawDoor,
    Opcode.Return,
  ], 0, 0);
  return Buffer.from(viewportIndexBuffer.pixels).toString('hex');
}

const snapshots = Array.from({ length: 40 }, () => drawClosedDoorOnce());
const distinct = new Set(snapshots).size;
console.log(`40 redraws of the same closed lightning door: ${distinct} distinct pixel patterns`);
check(distinct > 1, 'a closed lightning door does not always redraw identically (the exact pre-fix symptom)');

finish();
