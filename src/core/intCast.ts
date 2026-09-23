/**
 * CSBWin's integer casts (`doc/CSBwin-src/CSBTypes.h:134-137`), for the places the C++
 * relies on 16-bit wrap-around.
 */

/** `sw(x)` — `(i16)(x)`: truncate to 16 bits and sign-extend. */
export const sw = (v: number): number => (v << 16) >> 16;

/**
 * `ApplyLimits(min, x, max)` (`doc/CSBwin-src/CSBCode.cpp:1173`). `min` is tested first,
 * so it wins when `min > max`; `LIMIT` (`CSB.h:3109`) is the macro where `max` wins.
 */
export function applyLimits(min: number, x: number, max: number): number {
  if (x <= min) x = min;
  else if (x > max) x = max;
  return sw(x);
}
