/**
 * The files of an Atari ST floppy, read from a Pasti image (`.stx`): its sector records,
 * then its FAT12 filesystem (`doc/ATARI_ST_DISK_REFERENCE.md` → "The disks").
 *
 * A Pasti image is a 16-byte header (`RSY\0`, the track count at byte 10), then one record
 * a track, each a 16-byte header: its size, the size of its fuzzy mask, its sector count,
 * its flags, its length in MFM bytes, its number (bit 7 the side) and its type. With flag
 * `0x01` (`TRK_SECT`), sector descriptors follow, 16 bytes each: the offset of the
 * sector's data from the track's data, its bit position, its read time, its ID field
 * (track, side, number, size, CRC), its FDC flags and a reserved byte; then the fuzzy
 * mask, then the track's data. Without it, the record holds its sectors, numbered from 1,
 * 512 bytes each, straight after its header. A sector whose FDC flags say "record not
 * found" (`0x10`) has no data. Everything is little-endian.
 *
 * The disk is rebuilt as a raw image, track by track, its sectors in number order, from
 * sector 1 to the BPB's sectors a track: the protection's extra sectors (247 on DM's disks,
 * in place of track 0's sector 8) are left out, and its fuzzy sector 7 is read as stored.
 * A sector the image lacks is zeros in the image, and a file that holds one is left out of
 * the files. The filesystem is TOS's FAT12, read from the boot sector's BPB.
 *
 * Usage:
 *
 *   import { stxFiles } from './lib/stx';
 *   stxFiles(readFileSync('DM 1.2.stx')).get('DUNGEON.DAT')
 */

const TRK_SECT = 0x01;
const RECORD_NOT_FOUND = 0x10;

/** The image's sectors, by `track:side:number`. */
export function stxSectors(stx: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(stx.buffer, stx.byteOffset, stx.byteLength);
  if (String.fromCharCode(...stx.subarray(0, 4)) !== 'RSY\0') throw new Error('not a Pasti image (no RSY header)');
  const tracks = stx[10]!;
  const sectors = new Map<string, Uint8Array>();
  let at = 16;
  for (let t = 0; t < tracks; t++) {
    const recordSize = view.getUint32(at, true);
    const fuzzyCount = view.getUint32(at + 4, true);
    const sectorCount = view.getUint16(at + 8, true);
    const flags = view.getUint16(at + 10, true);
    const track = stx[at + 14]! & 0x7f;
    const side = stx[at + 14]! >> 7;
    if (flags & TRK_SECT) {
      const data = at + 16 + sectorCount * 16 + fuzzyCount;
      for (let s = 0; s < sectorCount; s++) {
        const d = at + 16 + s * 16;
        if (stx[d + 14]! & RECORD_NOT_FOUND) continue;
        const offset = view.getUint32(d, true);
        const size = 128 << (stx[d + 11]! & 3);
        sectors.set(`${track}:${side}:${stx[d + 10]}`, stx.subarray(data + offset, data + offset + size));
      }
    } else {
      for (let s = 0; s < sectorCount; s++) {
        sectors.set(`${track}:${side}:${s + 1}`, stx.subarray(at + 16 + s * 512, at + 16 + (s + 1) * 512));
      }
    }
    at += recordSize;
  }
  return sectors;
}

/** The disk as a raw image, its sectors in TOS's order (track by track, side by side), and the sectors it lacks. */
export function stxImage(stx: Uint8Array): { image: Uint8Array; missing: Set<number> } {
  const sectors = stxSectors(stx);
  const boot = sectors.get('0:0:1') ?? (() => { throw new Error('the image has no boot sector'); })();
  const word = (o: number): number => boot[o]! | (boot[o + 1]! << 8);
  const bytesPerSector = word(11);
  const total = word(19);
  const perTrack = word(24);
  const sides = word(26);
  const image = new Uint8Array(total * bytesPerSector);
  const missing = new Set<number>();
  for (let n = 0; n < total; n++) {
    const track = Math.floor(n / (perTrack * sides));
    const side = Math.floor(n / perTrack) % sides;
    const sector = sectors.get(`${track}:${side}:${(n % perTrack) + 1}`);
    if (sector) image.set(sector.subarray(0, bytesPerSector), n * bytesPerSector);
    else missing.add(n);
  }
  return { image, missing };
}

/** A raw FAT12 image's files, by their path (`PORTRAIT/HALK.CMP`), every folder walked, but those holding a `missing` sector. */
export function fat12Files(image: Uint8Array, missing: ReadonlySet<number> = new Set()): Map<string, Uint8Array> {
  const word = (o: number): number => image[o]! | (image[o + 1]! << 8);
  const bytesPerSector = word(11);
  const clusterSize = image[13]! * bytesPerSector;
  const fat = word(14) * bytesPerSector;
  const rootDir = fat + image[16]! * word(22) * bytesPerSector;
  const rootSize = word(17) * 32;
  const dataStart = rootDir + rootSize;
  const next = (cluster: number): number => {
    const o = fat + Math.floor(cluster * 3 / 2);
    return cluster & 1 ? word(o) >> 4 : word(o) & 0xfff;
  };
  const sectorsPerCluster = image[13]!;
  const chain = (first: number, size: number | null): Uint8Array | null => {
    const parts: Uint8Array[] = [];
    for (let c = first; c >= 2 && c < 0xff0; c = next(c)) {
      const sector = (dataStart + (c - 2) * clusterSize) / bytesPerSector;
      for (let s = 0; s < sectorsPerCluster; s++) if (missing.has(sector + s)) return null;
      parts.push(image.subarray(dataStart + (c - 2) * clusterSize, dataStart + (c - 1) * clusterSize));
    }
    const bytes = new Uint8Array(parts.length * clusterSize);
    parts.forEach((part, i) => bytes.set(part, i * clusterSize));
    return size === null ? bytes : bytes.subarray(0, size);
  };
  const files = new Map<string, Uint8Array>();
  const walk = (dir: Uint8Array, path: string): void => {
    for (let e = 0; e + 32 <= dir.length && dir[e] !== 0; e += 32) {
      if (dir[e] === 0xe5 || dir[e] === 0x2e) continue;
      const attributes = dir[e + 11]!;
      if (attributes & 0x08) continue;
      const base = String.fromCharCode(...dir.subarray(e, e + 8)).trimEnd();
      const ext = String.fromCharCode(...dir.subarray(e + 8, e + 11)).trimEnd();
      const name = `${path}${base}${ext ? `.${ext}` : ''}`;
      const first = dir[e + 26]! | (dir[e + 27]! << 8);
      const size = (dir[e + 28]! | (dir[e + 29]! << 8) | (dir[e + 30]! << 16)) + dir[e + 31]! * 0x1000000;
      const bytes = chain(first, attributes & 0x10 ? null : size);
      if (bytes === null) continue;
      if (attributes & 0x10) walk(bytes, `${name}/`);
      else files.set(name, bytes);
    }
  };
  walk(image.subarray(rootDir, rootDir + rootSize), '');
  return files;
}

/** A Pasti image's files, by their path. */
export function stxFiles(stx: Uint8Array): Map<string, Uint8Array> {
  const { image, missing } = stxImage(stx);
  return fat12Files(image, missing);
}
