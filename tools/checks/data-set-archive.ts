/**
 * A published set's archive, `<name>.zip` (`src/data/DataSetArchive.ts`), which the
 * welcome page's book makes from the files the server serves, written by the page's own
 * zip (`src/core/zip.ts`).
 *
 * Asserts:
 *   - the zip, read back by a reader of this tool's from its end of central directory, its
 *     central directory and each entry's local header (APPNOTE.TXT 4.3): every entry
 *     stored, its name UTF-8 and flagged so, its CRC Node's own (`zlib.crc32`), its sizes
 *     and its bytes those given, its date the given one's to the even second, and one
 *     before 1980 1980's first day; an empty entry; two entries of one name refused;
 *   - and read by Info-ZIP's `unzip`, which tests it and extracts every byte;
 *   - `archiveName`: a set's name, a character Windows refuses in a file's name a `_`, its
 *     spaces and dots at either end dropped, its id where nothing is left;
 *   - for every set of the repository's manifest: the files `archiveFiles` names, its
 *     `dungeon.dat` and `graphics.dat` and those its flags promise, each in its folder, the
 *     thumbnail too, and the folder's files it leaves out said; its archive, every file in
 *     one folder of its name, byte for byte, which `unzip` tests;
 *   - a set's documents are in its archive; a set without a thumbnail has none in it; and
 *     one whose file it is not whole without cannot be read is refused, naming the file.
 *
 * Usage: npm test -- --only=data-set-archive.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

import { zip, type ZipEntry } from '../../src/core/zip';
import { archiveFiles, archiveName, dataSetArchive, type ReadArchiveFile } from '../../src/data/DataSetArchive';
import type { DataSet } from '../../src/data/DataSets';
import { check, finish } from '../lib/check';
import { DATA_SETS } from '../lib/dataSets';

/** An entry as this tool reads it back. */
interface ReadEntry {
    name: string;
    bytes: Uint8Array;
    /** Its MS-DOS date and time, as `YYYY-MM-DD hh:mm:ss`. */
    stamp: string;
}

/**
 * `archive` read from its end: the end of central directory record, the central directory,
 * and each entry's local header and bytes, every field the page's zip writes checked
 * against the other copy; throws, saying what, where one is not as a stored zip's.
 */
function readZip(archive: Uint8Array): ReadEntry[] {
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const u16 = (at: number) => view.getUint16(at, true);
    const u32 = (at: number) => view.getUint32(at, true);
    const end = archive.length - 22;
    if (u32(end) !== 0x06054b50) throw new Error('no end of central directory record in the last 22 bytes');
    const count = u16(end + 10);
    if (u16(end + 4) !== 0 || u16(end + 6) !== 0 || u16(end + 8) !== count || u16(end + 20) !== 0) throw new Error('the end record is not one disk\'s, with no comment');
    const centralSize = u32(end + 12), centralAt = u32(end + 16);
    if (centralAt + centralSize !== end) throw new Error('the central directory does not end where the end record starts');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries: ReadEntry[] = [];
    let at = centralAt;
    for (let i = 0; i < count; i++) {
        if (u32(at) !== 0x02014b50) throw new Error(`central header ${i} has no signature`);
        const [flags, method, time, date, crc, size, stored, nameLength] = [u16(at + 8), u16(at + 10), u16(at + 12), u16(at + 14), u32(at + 16), u32(at + 20), u32(at + 24), u16(at + 28)];
        if (flags !== 0x0800 || method !== 0 || size !== stored || u16(at + 30) !== 0 || u16(at + 32) !== 0) throw new Error(`central header ${i} is not a stored entry with a UTF-8 name and nothing else`);
        const name = decoder.decode(archive.subarray(at + 46, at + 46 + nameLength));
        const local = u32(at + 42);
        if (u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method || u16(local + 10) !== time || u16(local + 12) !== date
            || u32(local + 14) !== crc || u32(local + 18) !== stored || u32(local + 22) !== size || u16(local + 26) !== nameLength || u16(local + 28) !== 0
            || decoder.decode(archive.subarray(local + 30, local + 30 + nameLength)) !== name) {
            throw new Error(`the local header of ${name} is not its central header's`);
        }
        const bytes = archive.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
        if (crc32(bytes) !== crc) throw new Error(`the CRC of ${name} is not its bytes'`);
        const two = (value: number) => String(value).padStart(2, '0');
        const stamp = `${(date >> 9) + 1980}-${two((date >> 5) & 15)}-${two(date & 31)} ${two(time >> 11)}:${two((time >> 5) & 63)}:${two((time & 31) * 2)}`;
        entries.push({ name, bytes, stamp });
        at += 46 + nameLength;
    }
    return entries;
}

/** `archive` read back, or why not. */
function readBack(archive: Uint8Array): ReadEntry[] | string {
    try {
        return readZip(archive);
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

const scratch = mkdtempSync(join(tmpdir(), 'csbweb-archive-'));
const hasUnzip = spawnSync('unzip', ['-v'], { encoding: 'utf8' }).status === 0;

/** Whether Info-ZIP's `unzip` tests `archive` and extracts what `expected` says, byte for byte; `true` without `unzip`. */
function unzipped(label: string, archive: Uint8Array, expected: readonly ZipEntry[]): boolean {
    if (!hasUnzip) return true;
    const file = join(scratch, `${label}.zip`);
    const into = join(scratch, label);
    writeFileSync(file, archive);
    const tested = spawnSync('unzip', ['-tq', file], { encoding: 'utf8' });
    const extracted = spawnSync('unzip', ['-q', '-o', file, '-d', into], { encoding: 'utf8' });
    return tested.status === 0 && extracted.status === 0
        && expected.every((entry) => readFileSync(join(into, entry.name)).equals(entry.bytes));
}

/** `entry`'s date, local, as `readZip` gives it, its seconds even. */
function stampOf(date: Date): string {
    const two = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds() & ~1)}`;
}

function checkZip(): void {
    console.log('== the zip ==');
    const when = new Date(2026, 9, 18, 13, 45, 31);
    const entries: ZipEntry[] = [
        { name: 'Set/plain.txt', bytes: new TextEncoder().encode('Hello.'), modified: when },
        { name: 'Set/Kid\'s notes é (2).txt', bytes: new Uint8Array(70_000).map((_, i) => i * 7), modified: when },
        { name: 'Set/empty.pdf', bytes: new Uint8Array(0), modified: new Date(1975, 0, 1) },
    ];
    const archive = zip(entries);
    const read = readBack(archive);
    console.log(`  ${archive.length} bytes: ${typeof read === 'string' ? read : read.map((entry) => `${entry.name} (${entry.bytes.length}, ${entry.stamp})`).join(', ')}`);
    check(typeof read !== 'string' && read.length === 3 && read.every((entry, i) => entry.name === entries[i]!.name && Buffer.from(entry.bytes).equals(entries[i]!.bytes)),
        'every entry is stored, in its order, its UTF-8 name flagged, its CRC Node\'s, its bytes those given, an empty one too');
    check(typeof read !== 'string' && read[0]!.stamp === stampOf(when) && read[2]!.stamp === '1980-01-01 00:00:00',
        'an entry\'s date is the given one\'s to the even second, and one before 1980 is 1980\'s first day');
    check(unzipped('hand', archive, entries), hasUnzip ? 'unzip tests it and extracts every byte' : 'unzip is not installed: not tried');
    let twice = '';
    try {
        zip([entries[0]!, entries[0]!]);
    } catch (error) {
        twice = error instanceof Error ? error.message : String(error);
    }
    check(twice === 'two entries of a zip have one name', 'two entries of one name are refused');
}

/** A set of the manifest's `set`, renamed. */
function named(name: string, set: DataSet = DATA_SETS[0]!): DataSet {
    return { ...set, name };
}

function checkNames(): void {
    console.log('== archiveName ==');
    const cases: [string, string][] = [['Conflux 3.5', 'Conflux 3.5'], ['A/B: c? "d" <e> |f\\g*', 'A_B_ c_ _d_ _e_ _f_g_'], ['  ..Theron\'s Quest.. ', 'Theron\'s Quest'],
        ['tab\there', 'tab_here'], [' ... ', DATA_SETS[0]!.id]];
    const wrong = cases.filter(([name, file]) => archiveName(named(name)) !== file);
    console.log(`  ${cases.map(([name]) => `${JSON.stringify(name)} → ${JSON.stringify(archiveName(named(name)))}`).join(', ')}`);
    check(wrong.length === 0, 'a character Windows refuses in a name is a _, the spaces and dots at either end dropped, the id where nothing is left');
}

/** The files of `set`'s folder on the disk, as the server serves them, each its date its modification time. */
function diskFile(set: DataSet): ReadArchiveFile {
    return async (file) => {
        try {
            const path = join(set.dir, file);
            return { bytes: new Uint8Array(readFileSync(path)), modified: statSync(path).mtime };
        } catch {
            return null;
        }
    };
}

async function checkSets(): Promise<void> {
    for (const set of DATA_SETS) {
        console.log(`== ${set.id}: ${archiveName(set)}.zip ==`);
        const files = archiveFiles(set);
        const folder = readdirSync(set.dir).sort();
        const left = folder.filter((file) => !files.some((one) => one.file === file));
        console.log(`  ${files.map(({ file, required }) => `${file}${required ? '' : ' (if any)'}`).join(', ')}; left out: ${left.join(', ') || 'nothing'}`);
        const game = ['dungeon.dat', 'graphics.dat', ...(set.csbGraphics ? ['CSBgraphics.dat'] : []), ...(set.miniDat ? ['mini.dat'] : []), ...(set.hintOracle ? ['hcsb.hct', 'hcsb.dat'] : [])];
        check(game.every((file) => files.some((one) => one.file === file && one.required)) && files.every(({ file, required }) => !required || folder.includes(file)),
            `${set.id}: it names the dungeon.dat, the graphics.dat and every file its flags promise, each in its folder`);
        check(!left.some((file) => /\.(dat|hct)$/i.test(file) && !/^(csbgame2|utility-portraits)\.dat$/.test(file)),
            `${set.id}: it leaves out no CSBWin file of the folder, but the port's own (csbgame2.dat, utility-portraits.dat)`);
        const archive = await dataSetArchive(set, diskFile(set));
        const read = readBack(archive);
        const expected: ZipEntry[] = files.filter(({ file }) => folder.includes(file))
            .map(({ file }) => ({ name: `${archiveName(set)}/${file}`, bytes: readFileSync(join(set.dir, file)), modified: statSync(join(set.dir, file)).mtime }));
        console.log(`  ${archive.length} bytes: ${typeof read === 'string' ? read : read.map((entry) => entry.name.slice(archiveName(set).length + 1)).join(', ')}`);
        check(typeof read !== 'string' && read.length === expected.length && read.every((entry, i) => entry.name === expected[i]!.name
            && Buffer.from(entry.bytes).equals(expected[i]!.bytes) && entry.stamp === stampOf(expected[i]!.modified)),
            `${set.id}: its archive holds those files, each in one folder of its name, byte for byte, dated as on the disk`);
        check(unzipped(set.id, archive, expected), `${set.id}: ${hasUnzip ? 'unzip tests it and extracts every byte' : 'unzip is not installed: not tried'}`);
    }
}

async function checkEdges(): Promise<void> {
    console.log('== a set\'s documents, a missing thumbnail, a missing file ==');
    const towers = DATA_SETS.find((set) => set.id === 'towers-of-chaos')!;
    const documented: DataSet = { ...towers, documents: [{ file: 'Readme.txt', size: statSync(join(towers.dir, 'Readme.txt')).size }] };
    const withDocuments = readBack(await dataSetArchive(documented, diskFile(documented)));
    check(typeof withDocuments !== 'string' && withDocuments.at(-1)?.name === `${archiveName(towers)}/Readme.txt`
        && Buffer.from(withDocuments.at(-1)!.bytes).equals(readFileSync(join(towers.dir, 'Readme.txt'))), 'a set\'s documents are in its archive, after its game files');
    const read = diskFile(towers);
    const noThumbnail = readBack(await dataSetArchive(towers, (file) => (file.endsWith('-thumbnail.png') ? Promise.resolve(null) : read(file))));
    check(typeof noThumbnail !== 'string' && !noThumbnail.some((entry) => entry.name.endsWith('.png')) && noThumbnail.some((entry) => entry.name.endsWith('/dungeon.dat')),
        'a set without a thumbnail is archived all the same, without one');
    let refusal = '';
    try {
        await dataSetArchive(documented, (file) => (file === 'Readme.txt' ? Promise.resolve(null) : read(file)));
    } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
    }
    check(refusal === 'Readme.txt cannot be read.', `a set whose document cannot be read is refused, naming it (${refusal})`);
}

try {
    checkZip();
    checkNames();
    await checkSets();
    await checkEdges();
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
finish();
