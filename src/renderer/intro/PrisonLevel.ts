/**
 * The five-by-five level behind the prison doors.
 *
 * `_TAG01f5ea` (`doc/CSBwin-src/CSBCode.cpp:9678-9698`) does not paint the corridor you see
 * through the doorway — it builds a dungeon out of two stack arrays and runs the real
 * viewport renderer over it:
 *
 * ```c
 *   d.partyLevel = 255;  d.Word11684 = 1;  d.width = 5;  d.height = 5;
 *   d.LevelCellFlags = LOCAL_128;
 *   d.pCurLevelDesc = &LOCAL_170;               // a static LEVELDESC: all zeroes
 *   fillWithByte((ui8 *)LOCAL_154[0], 25, 0, 1);
 *   for (D7W=0; D7W<5; D7W++)
 *   {
 *     LOCAL_128[D7W] = LOCAL_154[0] + 5*D7W;
 *     LOCAL_154[2][D7W] = 32;
 *   };
 *   LOCAL_154[1][2] = 32;
 *   …
 *   DrawViewport(2, 2, 0); //facing south, x=2; y=0.
 * ```
 *
 * `LOCAL_154` is indexed `[x][y]`, cell flags are `[roomType:3][hasObjects:1][attr:4]`, and
 * 32 is `0x20` — room type 1, `OPEN`. So every cell is solid stone except the whole of
 * column x=2 and the single cell (1,2): a north-south corridor with one opening off it to
 * the party's right, two cells ahead. The party stands at (2,0) facing south.
 *
 * The zeroed `LEVELDESC` is what makes the rest work: wall style 0, floor/ceiling style 0,
 * no wall decorations and no doors — which matches the bitmaps `_GameSetup` has loaded at
 * that point, `ReadWallBitmaps(0)` and `ReadFloorAndCeilingBitmaps(0)`
 * (`doc/CSBwin-src/CSBCode.cpp:10730-10731`).
 *
 * No cell has the `hasObjects` bit, so `SummarizeRoomInfo` never walks an object chain and
 * the stubs below are never reached. They throw rather than lie: if a future change makes
 * the viewport ask this level for an object, that should be a crash and not a blank wall.
 */
import { OBJECT_ID_EOF, Position, type CellFlag, type ObjectID } from '../../core/types';
import type { DungeonState } from '../../engine/DungeonState';
import type { MapData } from '../../data/dungeonTypes';

/** `d.width` / `d.height`. */
export const PRISON_LEVEL_SIZE = 5;
/** `d.partyLevel = 255`, which is also what tells `DrawViewport` to skip its VBL repaint. */
export const PRISON_LEVEL_INDEX = 255;
/** `DrawViewport(2, 2, 0)` is `(facing, x, y)` — `doc/CSBwin-src/Viewport.cpp:6701`. */
export const PRISON_PARTY_POSITION = { x: 2, y: 0, facing: 2 } as const;
/** `roomOPEN << 5` (`doc/CSBwin-src/CSB.h:561-569`). */
const CELL_OPEN = 32;

/** The `LOCAL_154` array, `[x][y]`. */
export function prisonCellFlags(): CellFlag[][] {
  const flags: CellFlag[][] = [];
  for (let x = 0; x < PRISON_LEVEL_SIZE; x++) flags.push(new Array<CellFlag>(PRISON_LEVEL_SIZE).fill(0));
  for (let y = 0; y < PRISON_LEVEL_SIZE; y++) flags[2][y] = CELL_OPEN;
  flags[1][2] = CELL_OPEN;
  return flags;
}

/** The zeroed `LEVELDESC`, as a `MapData` the viewport can read. */
export function prisonMap(): MapData {
  const cellFlags = prisonCellFlags();
  return {
    descriptor: {
      mapIndex: 0,
      dataOffset: 0,
      fill2: [0, 0, 0, 0],
      offsetX: 0,
      offsetY: 0,
      level: 0,
      width: PRISON_LEVEL_SIZE,
      height: PRISON_LEVEL_SIZE,
      floorDecorationCount: 0,
      floorGraphicsCount: 0,
      wallDecorationCount: 0,
      wallGraphicsCount: 0,
      difficulty: 0,
      creatureTypesAllowed: 0,
      doorDecorationCount: 0,
      word12Bits8_11: 0,
      doorType0Index: 0,
      doorType1Index: 0,
      mapGraphicsStyle: 0,
      floorCeilingStyle: 0,
    },
    cellFlags,
  };
}

function unreachable(what: string): never {
  throw new Error(`prison-door level: the viewport asked for ${what}, which it never should`);
}

/**
 * `d.LevelCellFlags` + `d.pCurLevelDesc` swapped out from under the renderer, as a
 * `DungeonState`. Only the handful of methods `SummarizeRoomInfo` reaches for are real.
 */
export function createPrisonDungeonState(randomSeed: number): DungeonState {
  const map = prisonMap();
  const stub = {
    getMap(index: number): MapData | null {
      return index === PRISON_LEVEL_INDEX ? map : null;
    },
    // `SummarizeRoomInfo` uses the seed for its per-cell decoration randomiser only.
    getData() {
      return { header: { randomSeed } };
    },
    findFirstObject(_position: Position): ObjectID {
      // RN_EOF. No cell here has the `hasObjects` bit, so this is the only honest answer.
      return OBJECT_ID_EOF;
    },
    getDBRecordLink(_rn: ObjectID): ObjectID {
      return OBJECT_ID_EOF;
    },
    findFirstDoor(_position: Position): ObjectID {
      return OBJECT_ID_EOF;
    },
    getTextRecord(): never {
      return unreachable('a text record');
    },
    getActuatorRecord(): never {
      return unreachable('an actuator record');
    },
    getDsaLevelIndex(): never {
      return unreachable('a DSA level index');
    },
    // CSBWin asks the skins of `d.LoadedLevel`, not of the prison, and draws the prison
    // before a game is read or after a read that failed (`doc/CSBwin-src/CSBCode.cpp:10748-10763`),
    // from whatever its pool holds then, which the port does not keep. A placeholder: every
    // cell is skin 0, drawn by the standard programs.
    skinCache: {
      GetSkin: (): number => 0,
      GetDefaultSkin: (): number => 0,
    },
  };
  return stub as unknown as DungeonState;
}

/** `Position` for `DrawViewport`, on the synthetic level. */
export function prisonPartyPosition(): Position {
  return new Position(PRISON_PARTY_POSITION.x, PRISON_PARTY_POSITION.y, PRISON_LEVEL_INDEX);
}
