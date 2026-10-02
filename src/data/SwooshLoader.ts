/**
 * `SWOOSH.IMG`, the FTL logo the Atari ST disk boots into before the game's own title.
 *
 * Not CSBWin's: the logo lives in the disk's boot chain, not in the game program.
 * `doc/ATARI_ST_DISK_REFERENCE.md` → "`SWOOSH.IMG`" is the specification, and a citation
 * `swoosh.img:$0070` is a byte offset into the file, 68000 code with its data:
 *
 * ```
 *   $0000  bra.b $0070
 *   $0002  after the picture: Dosound, the palette script's interpreter, the Pexec
 *   $0070  set-up and the picture's decoder
 *   $01d8  16 solid-colour patterns, four plane words each
 *   $0258  the compressed picture
 *   $0b92  the palette script, words up to a 0
 * ```
 *
 * The picture, the patterns and the script are read from the file. What is transcribed
 * here is the code that decodes them: `$0070`–`$01d4` for the picture, into ST low
 * resolution screen memory as the code writes it, and then one palette index a pixel.
 * `showSwoosh` (`src/renderer/intro/Swoosh.ts`) runs the script.
 */
import { readU16BE } from '../core/bytes';

/** `bra.b $0070`, the file's first word. */
const SWOOSH_ENTRY = 0x606e;
/** `lea $010a(pc),a6` at `swoosh.img:$00cc`. */
const PATTERNS_OFFSET = 0x01d8;
/** `lea $01d8(pc),a0` at `swoosh.img:$007e`. */
const PICTURE_OFFSET = 0x0258;
/** `lea $0b84(pc),a6` at `swoosh.img:$000c`. */
const SCRIPT_OFFSET = 0x0b92;

export const SWOOSH_WIDTH = 320;
export const SWOOSH_HEIGHT = 200;
/** A group is 16 pixels: four plane words. `addq.l #8,a1` (`swoosh.img:$0158`). */
const GROUP_WORDS = 4;
/** `move.w #160,d7`, a line's bytes (`swoosh.img:$0082`), in words. */
const LINE_WORDS = 80;
/** `move.w #200,d6 / mulu d7,d6`, the screen's 32000 bytes (`swoosh.img:$0086`), in words. */
const SCREEN_WORDS = LINE_WORDS * SWOOSH_HEIGHT;

export interface Swoosh {
    /** The picture, 320x200, one palette index a pixel. */
    pixels: Uint8Array;
    /** The palette script's words, without the 0 that ends it. */
    script: number[];
    /** The offset after the picture's last code. */
    pictureEnd: number;
}

/** Read `SWOOSH.IMG`. Throws on a file that is not it. */
export function loadSwoosh(file: Uint8Array): Swoosh {
    if (file.length < PICTURE_OFFSET || readU16BE(file, 0) !== SWOOSH_ENTRY) throw new Error('swoosh.img: not the FTL logo');
    const { screen, end } = decodePicture(file);
    return { pixels: planesToIndices(screen), script: readScript(file), pictureEnd: end };
}

/**
 * The set-up and the decoder, `swoosh.img:$0070`–`$01d4`. The registers keep their names:
 * `a0` the next code, `a1` the current group, `d0` the bit of its next pixel (15 is the
 * leftmost), `d1` the pixels left in the run, `a4` and `a5` the two mask tables.
 *
 * The code compares counts as signed words (`cmp.w d1,d0`, `$0128`); no count of the
 * picture reaches 32768 (`tools/dump-swoosh.ts`), so plain numbers do here.
 */
function decodePicture(file: Uint8Array): { screen: Uint16Array; end: number } {
    // `clr.l (a1)` on entering a group (`$0092`, `$0174`): the screen is zeroed as it goes.
    const screen = new Uint16Array(SCREEN_WORDS);

    // `$00b0`–`$00c6`: `move.w #$ffff,d3`, then sixteen times `lsl.l #1,d3`, the low word
    // to `a5` and the high word to `a4`. `a4[i]` is bits i..0, from bit i to the group's
    // right edge; `a5[i]` is bits 15..i+1, everything left of bit i.
    const a4 = new Uint16Array(16);
    const a5 = new Uint16Array(16);
    for (let i = 0, d3 = 0xffff; i < 16; i++) {
        d3 = (d3 << 1) >>> 0;
        a5[i] = d3 & 0xffff;
        a4[i] = d3 >>> 16;
    }

    // `$01d8`: entry c is four plane words, plane p `$ffff` if bit p of c is set.
    const patterns = new Uint16Array(16 * GROUP_WORDS);
    for (let i = 0; i < patterns.length; i++) patterns[i] = readU16BE(file, PATTERNS_OFFSET + i * 2);

    let a0 = PICTURE_OFFSET;
    let a1 = 0;
    let d0 = 15;
    let d1 = 0;
    // `beq $0002` at `$0160`: the screen is full, and the decoder is left from wherever it is.
    let done = false;

    const nextByte = (): number => {
        if (a0 >= file.length) throw new Error('swoosh.img: the picture runs past the end of the file');
        return file[a0++];
    };

    // `$0154`–`$017a`: once the group's last pixel is drawn, the next group is entered.
    const endOfGroup = (): void => {
        if (d0 >= 0) return;
        a1 += GROUP_WORDS;
        if (a1 === SCREEN_WORDS) {
            done = true;
            return;
        }
        d0 = 15;
        screen.fill(0, a1, a1 + GROUP_WORDS);
    };

    // `$0120`–`$0152`: as much of the run as the current group holds, from `src[at]`, four
    // plane words ANDed with the mask and ORed into the screen.
    const drawRun = (src: Uint16Array, at: number): void => {
        let mask = a4[d0];
        if (d0 >= d1) {
            d0 -= d1;
            mask &= a5[d0];
            d1 = 0;
        } else {
            d1 -= d0 + 1;
            d0 = -1;
        }
        for (let plane = 0; plane < GROUP_WORDS; plane++) screen[a1 + plane] |= src[at + plane] & mask;
        endOfGroup();
    };

    // `$017c`–`$01d4`: one pixel of colour c. The code sets bit `d0 & 7` of each plane
    // word's high byte (`d0` 8..15) or low byte (`d0` 0..7), which is the word's bit `d0`.
    const drawPixel = (c: number): void => {
        for (let plane = 0; plane < GROUP_WORDS; plane++) {
            if (c & (1 << plane)) screen[a1 + plane] |= 1 << d0;
        }
        d0 -= 1;
        endOfGroup();
    };

    // `$00d0`–`$011e`: one code a turn.
    while (!done) {
        const b = nextByte();
        const c = b & 15;
        if ((b & 0x80) === 0) {
            // `0nnn cccc`: a run of nnn + 1 pixels.
            d1 = (b >> 4) + 1;
        } else {
            // `1L?? cccc`: the count is the next byte, or with L the next two.
            d1 = nextByte();
            if (b & 0x40) d1 = (d1 << 8) | nextByte();
            d1 += 1;
            if (b & 0x10) {
                // `1L?1 cccc`: copy from the line above, then one pixel of colour c. The
                // source moves on a group after every call, whether or not the
                // destination did (`addq.l #8,a2`, `$0116`).
                let a2 = a1 - LINE_WORDS;
                do {
                    drawRun(screen, a2);
                    a2 += GROUP_WORDS;
                } while (d1 !== 0 && !done);
                if (!done) drawPixel(c);
                continue;
            }
        }
        do drawRun(patterns, c * GROUP_WORDS);
        while (d1 !== 0 && !done);
    }

    return { screen, end: a0 };
}

/** ST low resolution to one index a pixel: bit 15 of a group's plane words is its leftmost pixel. */
function planesToIndices(screen: Uint16Array): Uint8Array {
    const pixels = new Uint8Array(SWOOSH_WIDTH * SWOOSH_HEIGHT);
    for (let i = 0; i < pixels.length; i++) {
        const group = (i >> 4) * GROUP_WORDS;
        const bit = 15 - (i & 15);
        let index = 0;
        for (let plane = 0; plane < GROUP_WORDS; plane++) index |= ((screen[group + plane] >> bit) & 1) << plane;
        pixels[i] = index;
    }
    return pixels;
}

/** `move.w (a6)+,d7 / tst.w d7 / beq` (`swoosh.img:$0010`): the script's words, up to the 0. */
function readScript(file: Uint8Array): number[] {
    const script: number[] = [];
    for (let at = SCRIPT_OFFSET; ; at += 2) {
        if (at + 2 > file.length) throw new Error('swoosh.img: the palette script has no end');
        const word = readU16BE(file, at);
        if (word === 0) return script;
        script.push(word);
    }
}
