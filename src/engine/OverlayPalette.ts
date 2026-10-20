/**
 * The overlay palette: `overlayPaletteRed`, `overlayPaletteGreen` and `overlayPaletteBlue`
 * (`doc/CSBwin-src/data.cpp:75-77`), globals of CSBWin's and not `d.`'s, through which an
 * overlay is drawn (`doc/CSBwin-src/Graphics.cpp:3024-3085`). It is one array here, laid
 * out as `SaveGame` copies the three into its `palette[3*512]`, red, green, then blue
 * (`doc/CSBwin-src/SaveGame.cpp:1219-1223`), each indexed by an Atari colour word
 * `rrrgggbbb`.
 *
 * `d.Initialize()` clears it to the identity (`ClearOverlayPalette`,
 * `doc/CSBwin-src/CSBCode.cpp:492`), and a game read then takes the one its world's
 * `EXPOOL` holds, if all 24 records are there (`readOverlayPalette`,
 * `doc/CSBwin-src/SaveGame.cpp:1931-1959`). Every read follows a `d.Initialize()`, at the
 * start and at the restart (`CSBCode.cpp:11591`, `Code1f9e6.cpp:309`), so a world
 * without the records reads as the identity. A save writes it back
 * (`Expool.storeOverlayPalette`). Only a DSA's `&PALETTE` changes it in play
 * (`Overlay.SetOverlayPalette`, `doc/CSBwin-src/Bitmaps.cpp:651-686`).
 */

/** `sizeof(palette)` in `SaveGame` and `LoadGame`: three components of 512 entries. */
const OVERLAY_PALETTE_SIZE = 3 * 512;

/**
 * `ClearOverlayPalette` (`doc/CSBwin-src/data.cpp:118-146`): the identity palette, each
 * Atari intensity from 0 to 7 widened to eight bits.
 */
export function identityOverlayPalette(): Uint8Array {
    const palette = new Uint8Array(OVERLAY_PALETTE_SIZE);
    const widen = (intensity: number): number => (intensity << 5) | (intensity << 2) | (intensity >> 1);
    for (let i = 0; i < 512; i++) {
        palette[i] = widen((i >> 6) & 7);
        palette[512 + i] = widen((i >> 3) & 7);
        palette[1024 + i] = widen(i & 7);
    }
    return palette;
}
