/**
 * A zip archive, written: a published set's files as one download from the welcome page
 * (`src/data/DataSetArchive.ts`). Each entry is stored, not compressed: a set's files are
 * a few megabytes, its `graphics.dat` and its PDFs compressed already, and any unzipper
 * reads a stored entry. A name is UTF-8, which the entry's flag 11 says; no entry carries
 * an extra field, a comment or a data descriptor, and there is no Zip64, so an archive
 * holds at most 65,535 entries and 4 GiB (APPNOTE.TXT 4.3, 4.4).
 */

import { crc32 } from './crc32';

/** An entry: its path in the archive, `/` between folders, its bytes, and its date. */
export interface ZipEntry {
    name: string;
    bytes: Uint8Array;
    modified: Date;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** 2.0, the version that reads a folder's name in a path; as made by MS-DOS, whose attributes are none. */
const VERSION = 20;
/** General purpose flag 11: the name is UTF-8. */
const UTF8_NAME = 0x0800;
/** Compression method 0: stored. */
const STORED = 0;

/** `entries` as a zip archive, in their order. Throws where it would need Zip64, or two entries have one name. */
export function zip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
    if (entries.length > 0xffff) throw new Error(`${entries.length} entries: a zip without Zip64 holds at most 65535`);
    const encoder = new TextEncoder();
    const names = entries.map((entry) => encoder.encode(entry.name));
    if (new Set(entries.map((entry) => entry.name)).size !== entries.length) throw new Error('two entries of a zip have one name');
    const locals = entries.reduce((size, entry, i) => size + 30 + names[i]!.length + entry.bytes.length, 0);
    const central = names.reduce((size, name) => size + 46 + name.length, 0);
    if (locals + central + 22 > 0xffffffff) throw new Error('a zip without Zip64 holds at most 4 GiB');

    const out = new Uint8Array(locals + central + 22);
    const view = new DataView(out.buffer);
    let at = 0;
    const u16 = (value: number) => { view.setUint16(at, value, true); at += 2; };
    const u32 = (value: number) => { view.setUint32(at, value, true); at += 4; };
    const bytes = (value: Uint8Array) => { out.set(value, at); at += value.length; };

    const offsets: number[] = [];
    const crcs = entries.map((entry) => crc32(entry.bytes));
    entries.forEach((entry, i) => {
        offsets.push(at);
        u32(LOCAL_HEADER);
        u16(VERSION); u16(UTF8_NAME); u16(STORED);
        u16(dosTime(entry.modified)); u16(dosDate(entry.modified));
        u32(crcs[i]!); u32(entry.bytes.length); u32(entry.bytes.length);
        u16(names[i]!.length); u16(0);
        bytes(names[i]!);
        bytes(entry.bytes);
    });
    const centralAt = at;
    entries.forEach((entry, i) => {
        u32(CENTRAL_HEADER);
        u16(VERSION); u16(VERSION); u16(UTF8_NAME); u16(STORED);
        u16(dosTime(entry.modified)); u16(dosDate(entry.modified));
        u32(crcs[i]!); u32(entry.bytes.length); u32(entry.bytes.length);
        u16(names[i]!.length); u16(0); u16(0);  // the name's length, no extra field, no comment
        u16(0); u16(0); u32(0);                  // its disk, its internal and external attributes
        u32(offsets[i]!);
        bytes(names[i]!);
    });
    u32(END_OF_CENTRAL_DIRECTORY);
    u16(0); u16(0);                              // this disk, the central directory's
    u16(entries.length); u16(entries.length);
    u32(central); u32(centralAt);                // the central directory's size, and where it starts
    u16(0);                                      // no comment
    return out;
}

/** `date`'s time of day, local, in MS-DOS's word: its hour, minute and seconds halved. */
function dosTime(date: Date): number {
    return (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
}

/** `date`'s day, local, in MS-DOS's word, which starts in 1980: an earlier day is 1980's first. */
function dosDate(date: Date): number {
    if (date.getFullYear() < 1980) return (1 << 5) | 1;
    return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}
