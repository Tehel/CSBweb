/**
 * CSBWin's integer casts (`doc/CSBwin-src/CSBTypes.h:134-137`), for the places the C++
 * relies on 16-bit wrap-around.
 */

/** `sw(x)` — `(i16)(x)`: truncate to 16 bits and sign-extend. */
export const sw = (v: number): number => (v << 16) >> 16;
