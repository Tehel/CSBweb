/**
 * `d.Byte1596[roomType]` (`doc/CSBwin-src/Data.h:1403`), the room-type → timer-function
 * table read at `doc/CSBwin-src/Code11f52.cpp:3599` and `doc/CSBwin-src/DSA.cpp:509`.
 *
 * The table is extracted from `graphics.dat` item `0x232` into `GameTables.byte1596`,
 * always eight entries, one per 3-bit room type.
 */
export function roomTimerFunction(table: ArrayLike<number>, roomType: number): number {
  return table[roomType];
}
