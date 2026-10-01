/**
 * Point-in-rectangle tests against CSBWin's UI button lists.
 *
 * `searchButtonList` is CSBWin's own scan over a `UIButton[]`: the first entry whose
 * rectangle contains the point *and* whose `button` mask matches the pressed buttons wins,
 * and its `word0` is the button id the click dispatcher switches on
 * (`doc/CSBwin-src/Mouse.cpp`).
 */
import { UIButton } from '../../data/tables/UITables';

export function searchButtonList(list: UIButton[] | null, x: number, y: number, buttons: number): number {
  if (!list || list.length === 0) return 0;
  for (const entry of list) {
    if (entry.word0 === 0) break;
    if (x >= entry.x1 && x < entry.x2 && y >= entry.y1 && y < entry.y2) {
      if ((buttons & entry.button) !== 0) return entry.word0;
    }
  }
  return 0;
}
