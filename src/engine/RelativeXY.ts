/**
 * `RelativeXY` (`doc/CSBwin-src/CSBCode.cpp:4636-4659`): a square counted from another in
 * steps forward along `facing` and steps right along `facing + 1`, through `d.DeltaX` and
 * `d.DeltaY`, graphic `0x22f`'s direction steps.
 */
import { sw } from '../core/intCast';
import type { GameTables } from './GameTables';

/** `d.DeltaX` and `d.DeltaY`: what a step in a direction adds to x and to y. */
export type DirectionTables = Pick<GameTables, 'deltaX' | 'deltaY'>;

export function RelativeXY(
  tables: DirectionTables,
  facing: number,
  stepsForward: number,
  stepsRight: number,
  mapX: number,
  mapY: number,
): { x: number; y: number } {
  const forward = facing & 3;
  const right = (facing + 1) & 3;
  let x = sw(mapX + sw(stepsForward * tables.deltaX[forward]!));
  let y = sw(mapY + sw(stepsForward * tables.deltaY[forward]!));
  x = sw(x + sw(stepsRight * tables.deltaX[right]!));
  y = sw(y + sw(stepsRight * tables.deltaY[right]!));
  return { x, y };
}
