/**
 * A paletted PNG, written: the welcome page's thumbnails (`TitleThumbnail.ts`), which the
 * page draws for a player's own set and `tools/gen-thumbnails.ts` for the site's. Eight
 * bits a pixel, no filter, one `IDAT`. The compression is the caller's: the page's is
 * `CompressionStream`, a tool's `zlib`, and either is the zlib stream PNG wants.
 */

/** The PNG file's signature. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

/** A chunk: its length, its type, `data`, and the CRC of the type and the data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    let crc = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) crc = CRC_TABLE[(crc ^ out[i]) & 0xff] ^ (crc >>> 8);
    view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
    return out;
}

/** `indices`' rows as `IDAT` holds them before compression: each its filter byte, 0, first. */
export function indexedPngRows(width: number, height: number, indices: Uint8Array): Uint8Array<ArrayBuffer> {
    if (indices.length !== width * height) throw new Error(`${indices.length} indices for ${width}x${height}`);
    const raw = new Uint8Array(height * (width + 1));
    for (let y = 0; y < height; y++) raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
    return raw;
}

/**
 * The PNG of a `width`x`height` image over `palette`'s `[r, g, b]`, whose rows,
 * `indexedPngRows`, `compressed` holds as a zlib stream.
 */
export function indexedPng(width: number, height: number, palette: readonly (readonly number[])[], compressed: Uint8Array): Uint8Array<ArrayBuffer> {
    if (palette.length === 0 || palette.length > 256) throw new Error(`a palette of ${palette.length} colours`);
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 3;
    const parts = [
        Uint8Array.from(SIGNATURE),
        chunk('IHDR', ihdr),
        chunk('PLTE', Uint8Array.from(palette.flat())),
        chunk('IDAT', compressed),
        chunk('IEND', new Uint8Array(0)),
    ];
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

/** `indexedPng`, its rows compressed by `CompressionStream`, as the page has it. */
export async function encodeIndexedPng(width: number, height: number, indices: Uint8Array, palette: readonly (readonly number[])[]): Promise<Uint8Array<ArrayBuffer>> {
    const rows = new Blob([indexedPngRows(width, height, indices)]).stream().pipeThrough(new CompressionStream('deflate'));
    return indexedPng(width, height, palette, new Uint8Array(await new Response(rows).arrayBuffer()));
}
