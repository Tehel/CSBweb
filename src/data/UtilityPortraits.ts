/**
 * The Chaos Strikes Back utility disk's redrawn portraits of DM's 24 champions, which
 * RISE puts on the champions it raises (`doc/SAVES.md` → "RISE makes a save of its own").
 *
 * `utility-portraits.dat` (`tools/gen-utility-portraits.ts`) is a `graphics.dat` of two
 * items laid out like DM's graphic 26: item 0 the redrawn faces, item 1 graphic 26
 * itself. A champion is known by their portrait, never their name, which REINCARNATE
 * changes: one whose portrait is cell `charID` of graphic 26, pixel for pixel, gets cell
 * `charID` of item 0 (`newFaceFor`). The prison's champions, whose faces are CSB's own,
 * and a portrait drawn in an editor match no cell.
 */
import type { ui8 } from '../core/types';
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH } from './CsbwinCharacters';
import { GraphicsLoader } from './GraphicsLoader';

/** The file, in a data set's folder beside `mini.dat`. */
export const UTILITY_PORTRAITS_FILE = 'utility-portraits.dat';

/** The redrawn faces, and DM's graphic 26 they are matched through. */
const ITEM_NEW_FACES = 0;
const ITEM_DM_PORTRAITS = 1;
/** Graphic 26's cells: eight a row, three rows (`AddCharacter`, `doc/CSBwin-src/Character.cpp:487-509`). */
const CELLS = 24;

/** Cell `charID` of a sheet laid out like graphic 26, at `(charID & 7) << 5`, `(charID >> 3) * 29`. */
function cellOf(sheet: { width: number; pixels: Uint8Array }, charID: number): ui8[] {
  const ox = (charID & 7) << 5;
  const oy = (charID >> 3) * PORTRAIT_HEIGHT;
  const cell: ui8[] = [];
  for (let y = 0; y < PORTRAIT_HEIGHT; y++) {
    for (let x = 0; x < PORTRAIT_WIDTH; x++) cell.push(sheet.pixels[(oy + y) * sheet.width + ox + x]!);
  }
  return cell;
}

export class UtilityPortraits {
  private readonly dmCells: string[] = [];
  private readonly newFaces: ui8[][] = [];

  constructor(file: GraphicsLoader) {
    const newFaces = file.getImage(ITEM_NEW_FACES);
    const dm = file.getImage(ITEM_DM_PORTRAITS);
    for (let charID = 0; charID < CELLS; charID++) {
      this.newFaces.push(cellOf(newFaces, charID));
      this.dmCells.push(cellOf(dm, charID).join());
    }
  }

  /**
   * The redrawn face of the DM champion whose portrait `portrait` is, or `undefined`
   * when it is no cell of DM's graphic 26.
   */
  newFaceFor(portrait: readonly ui8[] | undefined): ui8[] | undefined {
    if (!portrait) return undefined;
    const charID = this.dmCells.indexOf(portrait.join());
    return charID < 0 ? undefined : this.newFaces[charID]!.slice();
  }
}

/**
 * The portraits of a set's file as `read` gives it: `null` for a set without one, and for
 * one that does not read, whose error goes to `failed`. It never rejects, so RISE's
 * question whether the set has them (`UIState.onHasNewFaces`) never empties its list.
 */
export async function readUtilityPortraits(
  read: () => Promise<Uint8Array | null>, failed: (error: unknown) => void,
): Promise<UtilityPortraits | null> {
  try {
    const bytes = await read();
    if (!bytes) return null;
    const file = new GraphicsLoader();
    file.loadFromArray(bytes);
    return new UtilityPortraits(file);
  } catch (error) {
    failed(error);
    return null;
  }
}
