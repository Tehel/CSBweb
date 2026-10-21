/**
 * CSBWin's checks that `graphics.dat` and `CSBgraphics.dat` are the files the game was
 * made with: `openGraphicsFile` (`doc/CSBwin-src/Graphics.cpp:1788-1843`) and
 * `OpenCSBgraphicsFile` (`:1864-1920`), against a file's `Signature`
 * (`src/data/FileSignature.ts`). Where one fails CSBWin dies, and the page ends its game
 * and uses nothing more of the file (`die`, `src/engine/Die.ts`).
 *
 * Two of their comparisons can never fail, and are not here:
 *
 * - `openGraphicsFile`'s against `expectedGraphicSignature1/2`, an Extended Features
 *   block's, runs only while `graphicSignature1/2` are 0, at its first call. That call is
 *   `ReadGraphicsIndex`'s, before the title (`CSBCode.cpp:11594`), so before any read can
 *   have set them, and they are 0. The port takes the signature as `graphics.dat` loads.
 * - `OpenCSBgraphicsFile`'s against `expectedCSBgraphicSignature1/2` runs only while
 *   `CSBgraphicSignature1/2` are 0 and the expected pair is not, but the line before it
 *   takes the signature whenever the expected pair is not 0, and a signature is never 0.
 *   The expected pair counts only for a file that is not there.
 */
import { readRuntimeFileSignatures, type ExpoolDatabase } from '../data/CsbwinExpool';
import { csbGraphicsExpected } from '../data/CsbwinExtendedFeatures';
import {
    csbGraphicsSignatureRefused, graphicsSignatureRefused, type FileSignature, type RuntimeFileSignatures,
} from '../data/FileSignature';
import { die } from './Die';
import type { GameContext } from './GameContext';

/**
 * The end of `LoadGame` (`doc/CSBwin-src/SaveGame.cpp:1966-2025`) for the world a read
 * gives: its `EDBT_RuntimeFileSignatures` records (`readRuntimeFileSignatures`), then
 * `openGraphicsFile`'s check of `graphics.dat` against the one it names
 * (`Graphics.cpp:1830-1840`), which a world naming none (0, or `0xffffffff`) passes. A
 * read checks before it installs anything, and installs what this returns with the rest
 * (`readGame`).
 */
export function readFileSignatures(ctx: GameContext, world: ExpoolDatabase): RuntimeFileSignatures {
    const runtime = readRuntimeFileSignatures(world);
    const o = graphicsSignatureRefused(runtime, ctx.tables.graphicsSignature);
    // "Actuatl" is CSBWin's spelling.
    if (o !== null) die(ctx.host, 0x3c6c, `Incorrect Graphics File signature\nActuatl Signature = ${o}`);
    return runtime;
}

/**
 * `OpenCSBgraphicsFile` (`doc/CSBwin-src/Graphics.cpp:1864-1920`) for a game, which the
 * file's first section read calls (`CSBGraphicsLoader.opener`), with its signature, or
 * `null` where the data set has no `CSBgraphics.dat`. True when the file opens; CSBWin
 * keeps it open from there, and checks nothing again.
 *
 * - A file that is not there: "Cannot find 'CSBgraphics.dat'" the first time, and
 *   `die(0xbad)` if an Extended Features block expected one (`:1877-1888`). CSBWin's line
 *   is a message box; the port traces it, and tries again at the next read, as CSBWin
 *   does, without a word.
 * - A file whose signature, folded, is not the one the world's
 *   `EDBT_CSBGraphicsSignature_data` names, unless that is 0 or `EDBT_Debuging_data` is
 *   not 0 (`:1889-1895`, `:1909-1918`): `die(0x3c6c)`. A fold of 0 counts as 1. Before any read both are
 *   `0xffffffff`, which skips the check.
 */
export function csbGraphicsOpener(ctx: GameContext): (signature: FileSignature | null) => boolean {
    // `static bool errorMsg`.
    let errorMsg = false;
    return (signature) => {
        if (!signature) {
            if (!errorMsg) {
                ctx.host.trace("Cannot find 'CSBgraphics.dat'");
                if (csbGraphicsExpected(ctx.signatures)) die(ctx.host, 0xbad, "Cannot find 'CSBgraphics.dat'");
                errorMsg = true;
            }
            return false;
        }
        const o = csbGraphicsSignatureRefused(ctx.runtimeFileSignatures, signature);
        if (o !== null) die(ctx.host, 0x3c6c, `Incorrect CSBGraphics File signature\nActual Signature = ${o}`);
        return true;
    };
}
