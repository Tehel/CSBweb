/**
 * Fallback for CSBWin `d.Byte1596[8]` (`doc/CSBwin-src/Data.h:1403`), the room-type →
 * timer-function table read at `doc/CSBwin-src/Code11f52.cpp:3599` and
 * `doc/CSBwin-src/DSA.cpp:509`.
 *
 * The authoritative table is extracted at runtime from `graphics.dat` item `0x232`
 * (`UITables.graphic232.byte1596`) and passed in via `roomTimerFunctions`; this literal is
 * only used when the tables have not been wired yet.
 */
const DEFAULT_ROOM_TIMER_FUNCTIONS = [6, 5, 9, 0, 10, 8, 7, 0];

/** `d.Byte1596[roomType]`, from the extracted table when there is one. */
export function roomTimerFunction(table: ArrayLike<number> | null, roomType: number): number {
  return (table ?? DEFAULT_ROOM_TIMER_FUNCTIONS)[roomType] ?? 0;
}
