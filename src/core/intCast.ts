/**
 * CSBWin's integer casts (`doc/CSBwin-src/CSBTypes.h:139-142`), for the places the C++
 * relies on 8- or 16-bit wrap-around.
 */

/** C's integer division: truncates toward zero, where `Math.floor` would not. */
export const div = (a: number, b: number): number => Math.trunc(a / b);

/** `sb(x)` — `(i8)(x)`: truncate to 8 bits and sign-extend. */
export const sb = (v: number): number => (v << 24) >> 24;

/** `sw(x)` — `(i16)(x)`: truncate to 16 bits and sign-extend. */
export const sw = (v: number): number => (v << 16) >> 16;

/**
 * `ApplyLimits(min, x, max)` (`doc/CSBwin-src/CSBCode.cpp:1183`). `min` is tested first,
 * so it wins when `min > max`; `LIMIT` (`CSB.h:3168`) is the macro where `max` wins.
 */
export function applyLimits(min: number, x: number, max: number): number {
  if (x <= min) x = min;
  else if (x > max) x = max;
  return sw(x);
}
