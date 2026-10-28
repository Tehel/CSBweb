/**
 * The files of an Amiga floppy, read from an ADF image: its 1760 blocks of 512 bytes,
 * then its OFS filesystem (`doc/AMIGA_DISK_REFERENCE.md` → "The disks").
 *
 * An ADF is the disk's blocks one after the other, nothing else: a double-density disk
 * is 80 cylinders, two sides, 11 blocks a track. Everything in the filesystem is a
 * big-endian long. The root block is block 880, the disk's middle. A header block (the
 * root's, a folder's or a file's) has type 2 at long 0 and its secondary type at its last
 * long: 1 the root, 2 a folder, -3 a file; its name is a length byte and the characters
 * at byte 432. The root and a folder hold a hash table of 72 blocks from byte 24, each
 * the first of a chain of headers whose name hashes there, chained through byte 496. A
 * file header holds the file's size at byte 324 and its first data block at byte 16. An
 * OFS data block has type 8, its sequence number at byte 8, the bytes of the file it
 * holds at byte 12 and the next data block at byte 16; its bytes start at byte 24, 488 at
 * most. The file is read by following that chain, each block checked: its type, its
 * number, and that the chain ends on the size the header gives.
 *
 * A copy-protected disk has tracks that are not blocks; an ADF holds them as whatever
 * its copier read. They hold no file, so the files read whole.
 *
 * Usage:
 *
 *   import { adfFiles } from './lib/adf';
 *   adfFiles(readFileSync('DM 2.2.adf')).get('graphics.dat')
 */

const BLOCK = 512;
const ROOT = 880;
const T_HEADER = 2;
const T_DATA = 8;
const ST_ROOT = 1;
const ST_USERDIR = 2;
const ST_FILE = -3;

/** An ADF's files, by their path (`devs/system-configuration`), every folder walked. */
export function adfFiles(adf: Uint8Array): Map<string, Uint8Array> {
  if (adf.length !== 1760 * BLOCK) throw new Error(`not a double-density ADF (${adf.length} bytes)`);
  if (String.fromCharCode(...adf.subarray(0, 3)) !== 'DOS' || adf[3] !== 0) throw new Error('not an OFS disk (no DOS\\0 boot block)');
  const view = new DataView(adf.buffer, adf.byteOffset, adf.byteLength);
  const long = (block: number, o: number): number => view.getInt32(block * BLOCK + o);
  const header = (block: number): number => {
    if (block <= 0 || block >= 1760 || long(block, 0) !== T_HEADER) throw new Error(`block ${block} is not a header`);
    return long(block, BLOCK - 4);
  };
  const name = (block: number): string => {
    const at = block * BLOCK + 432;
    return String.fromCharCode(...adf.subarray(at + 1, at + 1 + adf[at]!));
  };
  const read = (block: number): Uint8Array => {
    const size = long(block, 324);
    const bytes = new Uint8Array(size);
    let at = 0;
    for (let data = long(block, 16), seq = 1; data !== 0; data = long(data, 16), seq++) {
      if (long(data, 0) !== T_DATA || long(data, 8) !== seq) throw new Error(`${name(block)}: block ${data} is not its data block ${seq}`);
      const count = long(data, 12);
      if (at + count > size) throw new Error(`${name(block)}: its data runs past its ${size} bytes`);
      bytes.set(adf.subarray(data * BLOCK + 24, data * BLOCK + 24 + count), at);
      at += count;
    }
    if (at !== size) throw new Error(`${name(block)}: its data holds ${at} of its ${size} bytes`);
    return bytes;
  };
  const files = new Map<string, Uint8Array>();
  const walk = (folder: number, path: string): void => {
    for (let h = 0; h < 72; h++) {
      for (let block = long(folder, 24 + h * 4); block !== 0; block = long(block, 496)) {
        const type = header(block);
        if (type === ST_FILE) files.set(`${path}${name(block)}`, read(block));
        else if (type === ST_USERDIR) walk(block, `${path}${name(block)}/`);
        else throw new Error(`block ${block}: secondary type ${type}`);
      }
    }
  };
  if (header(ROOT) !== ST_ROOT) throw new Error(`block ${ROOT} is not the root`);
  walk(ROOT, '');
  return files;
}
