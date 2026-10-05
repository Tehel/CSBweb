/**
 * MD5 (RFC 1321), as CSBWin carries it: RSA's reference implementation
 * (`doc/CSBwin-src/md5C.cpp`), whose `MD5Transform` reads a block's words in the
 * machine's order, little-endian on the x86 CSBWin runs on, which is the RFC's order.
 * `crypto.subtle` has no MD5, so the port has its own.
 */

/** The per-round shifts, `S11` to `S44` (`md5C.cpp`), four to a round. */
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

/** The 64 additive constants, `floor(abs(sin(i + 1)) * 2^32)`, as the RFC defines them. */
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);

/** The sixteen-byte digest of `bytes`. */
export function md5(bytes: Uint8Array): Uint8Array {
    // The message, the 0x80 byte, zeros to 56 modulo 64, and the length in bits, little-endian.
    const padded = new Uint8Array((((bytes.length + 8) >>> 6) + 1) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, (bytes.length * 8) >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(bytes.length / 0x20000000), true);

    const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    const x = new Uint32Array(16);
    for (let block = 0; block < padded.length; block += 64) {
        for (let i = 0; i < 16; i++) x[i] = view.getUint32(block + 4 * i, true);
        let [a, b, c, d] = state;
        for (let i = 0; i < 64; i++) {
            const round = i >> 4;
            let f: number;
            let g: number;
            if (round === 0) { f = (b & c) | (~b & d); g = i; }
            else if (round === 1) { f = (b & d) | (c & ~d); g = (5 * i + 1) & 15; }
            else if (round === 2) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
            else { f = c ^ (b | ~d); g = (7 * i) & 15; }
            const s = SHIFTS[(round << 2) | (i & 3)];
            const sum = (a + f + K[i] + x[g]) >>> 0;
            a = d;
            d = c;
            c = b;
            b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
        }
        state[0] = (state[0] + a) >>> 0;
        state[1] = (state[1] + b) >>> 0;
        state[2] = (state[2] + c) >>> 0;
        state[3] = (state[3] + d) >>> 0;
    }
    const digest = new Uint8Array(16);
    const out = new DataView(digest.buffer);
    state.forEach((word, i) => out.setUint32(4 * i, word, true));
    return digest;
}
