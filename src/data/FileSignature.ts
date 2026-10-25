/**
 * A game file's signature, CSBWin's check that `graphics.dat` and `CSBgraphics.dat` are
 * the files a game was made with (`openGraphicsFile`, `OpenCSBgraphicsFile`,
 * `doc/CSBwin-src/Graphics.cpp:1788-1843`, `:1864-1920`; `src/engine/FileSignatures.ts`).
 */
import { readU32LE } from '../core/bytes';
import { md5 } from '../core/md5';

/** `graphicSignature1/2` or `CSBgraphicSignature1/2` (`doc/CSBwin-src/data.cpp:46-48`). */
export interface FileSignature {
    signature1: number;
    signature2: number;
}

/**
 * `Signature(fileHandle, …)` (`doc/CSBwin-src/data.cpp:1956-1979`): the file's MD5, its
 * first eight bytes as two longwords, little-endian. A first longword of 0 is 1.
 */
export function Signature(bytes: Uint8Array): FileSignature {
    const result = md5(bytes);
    const word = (at: number): number => readU32LE(result, at);
    const signature1 = word(0);
    return { signature1: signature1 === 0 ? 1 : signature1, signature2: word(4) };
}

/**
 * `o = (n | (n>>16)) & 0xffff` over `n = signature1 | signature2`
 * (`doc/CSBwin-src/Graphics.cpp:1808-1809`, `:1873-1875`): the sixteen bits a dungeon's
 * `EDBT_RuntimeFileSignatures` record names a file by.
 */
export function foldedSignature(signature: FileSignature): number {
    const n = (signature.signature1 | signature.signature2) >>> 0;
    return ((n | (n >>> 16)) & 0xffff) >>> 0;
}

/**
 * `EDBT_Debuging_data`, `EDBT_CSBGraphicsSignature_data` and `EDBT_GraphicsSignature_data`
 * (`doc/CSBwin-src/data.cpp:50-53`): what the last world read named of the two graphics
 * files, in its `EXPOOL` (`readRuntimeFileSignatures`, `src/data/CsbwinExpool.ts`).
 */
export interface RuntimeFileSignatures {
    debuging: number;
    csbGraphicsSignature: number;
    graphicsSignature: number;
}

/** The three as they are before any world is read: `0xffffffff` (`doc/CSBwin-src/data.cpp:50-53`). */
export function noRuntimeFileSignatures(): RuntimeFileSignatures {
    return { debuging: 0xffffffff, csbGraphicsSignature: 0xffffffff, graphicsSignature: 0xffffffff };
}

/**
 * `openGraphicsFile`'s check of `graphics.dat` (`doc/CSBwin-src/Graphics.cpp:1830-1840`):
 * the file's folded signature where the world `runtime` names another, which CSBWin dies
 * of (`die(0x3c6c)`); `null` where it passes, as it does for a world naming none (0, or
 * `0xffffffff`).
 */
export function graphicsSignatureRefused(runtime: RuntimeFileSignatures, signature: FileSignature): number | null {
    const named = runtime.graphicsSignature;
    if (named === 0xffffffff || named === 0) return null;
    const o = foldedSignature(signature);
    return named !== o ? o : null;
}

/**
 * `OpenCSBgraphicsFile`'s check of `CSBgraphics.dat` (`doc/CSBwin-src/Graphics.cpp:1889-1895`,
 * `:1909-1918`): the file's folded signature, a fold of 0 counting as 1, where the world
 * `runtime` names another and `EDBT_Debuging_data` is 0, which CSBWin dies of
 * (`die(0x3c6c)`); `null` where it passes.
 */
export function csbGraphicsSignatureRefused(runtime: RuntimeFileSignatures, signature: FileSignature): number | null {
    const { csbGraphicsSignature, debuging } = runtime;
    if (csbGraphicsSignature === 0 || debuging !== 0) return null;
    const o = foldedSignature(signature) || 1;
    return o !== csbGraphicsSignature ? o : null;
}
