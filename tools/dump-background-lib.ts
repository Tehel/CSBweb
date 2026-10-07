/**
 * `BACKGROUND_LIB` (`src/data/BackgroundLib.ts`,
 * `doc/CSBwin-src/Viewport.cpp:5333-5899`): the `CGT_Backgrounds` sections of
 * `CSBgraphics.dat`, and what a skin reads from them.
 *
 * 1. **The skin index**, graphic 1, of Conflux 3.5's and The Towers of Chaos 3.3's files:
 *    every skin's definition through `GetSkinDef` and its nine IDs through the getters,
 *    against the index's words decoded here. The canary is the byte order: read
 *    little-endian, Conflux has 51 skins and The Towers 38; big-endian, 0x3300 and
 *    0x2600. The Towers' skins 34 to 37 point at the index's end or past it, and
 *    `GetSkinDef` refuses them, as it refuses skin 0, whose offset is 0.
 * 2. **The programs**, through `GetCode`: every skin names one of sections 61 to 64, or
 *    none, and each program's start address, word 0, puts its 168 cell addresses just
 *    before the section's last word, a `Return`.
 * 3. **The masks**, through `GetMask` and `MaskExists`: in every mask section a skin
 *    names, each mask's twelve-byte header and `(width + 15) / 16 * height` words of mask
 *    end where the next mask starts, and the last mask within the section.
 * 4. **The bitmaps**, through `GetBitmap`: every graphic a skin names is there, its size
 *    in `i32` units, its first word a width of whole sixteen-pixel groups.
 * 5. **The cache**, on a reader that counts its reads: a graphic `GetBackgroundGraphic`
 *    finds missing is read once and refused after, where `BackgroundGraphicExists` reads
 *    it every time; `mustExist` as each reader passes it; a graphic created with the id
 *    of a missing one is never found; `Cleanup` reads again; and `GetDecorationBitmap`,
 *    `GetWallDecorationID` and `GetCode`'s refusals, on sections made here, since no
 *    skin of these files has a decoration.
 *
 * Run: `npx tsx tools/dump-background-lib.ts`
 */
import { readFileSync } from 'node:fs';

import { BackgroundLib } from '../src/data/BackgroundLib';
import { CSBGraphicsLoader, CSBGraphicType } from '../src/data/CSBGraphicsLoader';
import { readU16LE, readU32LE } from '../src/core/bytes';
import { check, finish } from './lib/check';

const SETS = [
  { name: 'Conflux 3.5', dir: 'conflux-3.5-b8', skins: 51, codes: [61, 62, 63, 64], print: true },
  { name: 'The Towers of Chaos 3.3', dir: 'towers-of-chaos-3.3', skins: 38, codes: [64], print: false },
] as const;

const BACKGROUNDS = CSBGraphicType.Backgrounds;
/** `Return` (`doc/CSBwin-src/Viewport.cpp:372`). */
const RETURN = 60000;

function loader(dir: string): CSBGraphicsLoader {
  const csb = new CSBGraphicsLoader();
  csb.loadFromArray(new Uint8Array(readFileSync(`static/gamefiles/${dir}/CSBgraphics.dat`)));
  return csb;
}

for (const set of SETS) {
  const csb = loader(set.dir);
  const lib = new BackgroundLib(csb);
  const index = csb.readSection(BACKGROUNDS, 1, 0)!;
  const numSkins = readU16LE(index, 0);
  const wordsAt = (offset: number, n: number): number[] => Array.from({ length: n }, (_, i) => readU16LE(index, offset + 2 * i));

  console.log(`1. The skin index: ${set.name}, ${index.length} bytes`);
  check(numSkins === set.skins && ((index[0]! << 8) | index[1]!) === set.skins << 8,
    `${set.name}: ${numSkins} skins, read little-endian`);
  const live: number[] = [];
  let agree = true;
  for (let skin = 0; skin <= numSkins; skin++) {
    const offset = skin < numSkins ? readU16LE(index, 2 * (skin + 1)) : 0;
    const expected = skin < numSkins && offset !== 0 && offset + 18 < index.length;
    const def = lib.GetSkinDef(skin, 18);
    if ((def !== null) !== expected || (def && (def.offset !== offset || def.size !== index.length - offset))) agree = false;
    if (!def) {
      if (set.print || skin >= 34) console.log(`  skin ${skin}: none (offset ${offset})`);
      continue;
    }
    live.push(skin);
    const ids = wordsAt(offset, 9);
    const read = [
      lib.GetFloorGraphicID(skin), lib.GetMiddleGraphicID(skin), lib.GetCeilingGraphicID(skin), lib.GetWallGraphicID(skin),
      lib.GetFloorMaskID(skin), lib.GetMiddleMaskID(skin), lib.GetCeilingMaskID(skin), lib.GetWallMaskID(skin),
      lib.GetSkinID(skin, 8),
    ];
    if (read.join() !== ids.join()) agree = false;
    if (set.print) {
      console.log(`  skin ${skin}: floor ${ids[0]}, middle ${ids[1]}, ceiling ${ids[2]}, wall ${ids[3]};`
        + ` masks ${ids.slice(4, 8).join('/')}; program ${ids[8]}`);
    }
  }
  check(agree, `${set.name}: GetSkinDef and the nine getters read the index's words, and refuse what it does not hold`);
  if (set.dir === 'towers-of-chaos-3.3') {
    check([34, 35, 36, 37].every((skin) => lib.GetSkinDef(skin, 18) === null && readU16LE(index, 2 * (skin + 1)) + 18 >= index.length),
      'The Towers: skins 34 to 37 point at the index\'s end or past it, and are refused');
  }
  check(lib.GetSkinDef(0, 18) === null && lib.GetSkinID(numSkins, 0) === 0, `${set.name}: no skin 0, and none past the count`);

  console.log(`2. The programs: ${set.name}`);
  const codes = new Map<number, number[]>();
  for (const skin of live) {
    const id = lib.GetSkinID(skin, 8);
    const code = lib.GetCode(skin);
    if (id === 0) {
      check(code === null, `skin ${skin}: no program`);
      continue;
    }
    codes.set(id, [...(codes.get(id) ?? []), skin]);
    check(code !== null && code.length === csb.readSection(BACKGROUNDS, id, 0)!.length, `skin ${skin}: program ${id} read`);
  }
  check([...codes.keys()].sort().join() === set.codes.join(), `${set.name}: the skins run programs ${[...codes.keys()].sort().join(', ')}`);
  for (const [id, skins] of codes) {
    const code = lib.GetCode(skins[0]!)!;
    const main = readU16LE(code, 0);
    const end = 2 * (main + 8 * 21);
    console.log(`  program ${id}: ${code.length} bytes, start address ${main}, its cell table ending at byte ${end}; skins ${skins.join(', ')}`);
    check(end === code.length - 2 && readU16LE(code, end) === RETURN && skins.every((skin) => lib.GetCode(skin) === code),
      `program ${id}: the 168 cell addresses, then the section's last word, Return; every skin naming it shares one copy`);
  }

  console.log(`3. The masks: ${set.name}`);
  const maskIds = new Set(live.flatMap((skin) => [4, 5, 6, 7].map((n) => lib.GetSkinID(skin, n))).filter((id) => id !== 0));
  for (const id of [...maskIds].sort((a, b) => a - b)) {
    const section = csb.readSection(BACKGROUNDS, id, 0)!;
    const count = readU32LE(section, 0);
    let tiled = true;
    let sameRead = true;
    for (let n = 0; n < count; n++) {
      const offset = readU32LE(section, 4 * (n + 1));
      const mask = lib.GetMask(id, n, 0);
      if (mask?.offset !== offset || lib.MaskExists(id, n)?.offset !== offset) sameRead = false;
      const width = readU16LE(section, offset + 8);
      const height = readU16LE(section, offset + 10);
      const next = n + 1 < count ? readU32LE(section, 4 * (n + 2)) : section.length;
      const end = offset + 12 + 2 * Math.trunc((width + 15) / 16) * height;
      if (n + 1 < count ? end !== next : end > next) tiled = false;
    }
    console.log(`  mask section ${id}: ${count} masks, ${section.length} bytes`);
    check(sameRead && lib.GetMask(id, count, 0) === null, `mask section ${id}: GetMask and MaskExists give each mask's offset, and none past the count`);
    check(tiled, `mask section ${id}: each mask's header and bits end where the next begins, the last within the section`);
  }

  console.log(`4. The bitmaps: ${set.name}`);
  const bitmapIds = new Set(live.flatMap((skin) => [0, 1, 2, 3].map((n) => lib.GetSkinID(skin, n))).filter((id) => id !== 0));
  const widths = new Map<number, number>();
  let read = true;
  for (const id of bitmapIds) {
    const bitmap = lib.GetBitmap(id, 4);
    const section = csb.readSection(BACKGROUNDS, id, 0);
    if (!bitmap || !section || bitmap.bitmapSize !== section.length >> 2) {
      read = false;
      continue;
    }
    widths.set(id, readU32LE(bitmap.data, 0));
  }
  console.log(`  ${bitmapIds.size} bitmaps; widths ${[...new Set(widths.values())].sort((a, b) => a - b).join(', ')}`);
  check(read, `${set.name}: every graphic a skin names is there, its size in i32 units`);
  check([...widths.values()].every((width) => width > 0 && (width & 15) === 0),
    `${set.name}: each bitmap's first word is a width of whole sixteen-pixel groups`);
}

console.log('5. The cache');
{
  const sections = new Map<number, Uint8Array>();
  const reads: string[] = [];
  const reader = {
    readSection(type: number, id: number, minimumSize: number, mustExist = true): Uint8Array | null {
      reads.push(`${type}:${id}:${minimumSize}:${mustExist}`);
      return sections.get(id)?.slice() ?? null;
    },
  };
  const words = (...values: number[]): Uint8Array => {
    const bytes = new Uint8Array(2 * values.length);
    values.forEach((v, i) => { bytes[2 * i] = v & 0xff; bytes[2 * i + 1] = v >> 8; });
    return bytes;
  };
  const lib = new BackgroundLib(reader);

  check(lib.GetSkinDef(1, 18) === null && lib.GetSkinDef(2, 18) === null && reads.join() === '3:1:0:false',
    `no skin index: read once, mustExist false (${reads.join()}), and refused after`);
  reads.length = 0;
  check(lib.GetBitmap(500, 4) === null && lib.GetBitmap(500, 4) === null && reads.join() === '3:500:0:true',
    `a missing bitmap: read once, mustExist true (${reads.join()})`);
  reads.length = 0;
  lib.BackgroundGraphicExists(501, 0, false);
  lib.BackgroundGraphicExists(501, 0, false);
  check(reads.join() === '3:501:0:false,3:501:0:false', 'BackgroundGraphicExists records no miss, and reads again');
  reads.length = 0;
  const created = lib.CreateBackgroundGraphic(501, 8);
  check(created >= 0 && lib.CreateBackgroundGraphic(501, 8) === -1 && lib.BackgroundGraphicExists(501, 0, false) === created,
    'CreateBackgroundGraphic makes a graphic once, and it is found');
  reads.length = 0;
  check(lib.CreateBackgroundGraphic(500, 8) >= 0 && lib.BackgroundGraphicExists(500, 0, false) === -1 && reads.length === 0,
    "a graphic created with a missing graphic's id is never found: the missing entry comes first");
  lib.Cleanup();
  reads.length = 0;
  lib.GetBitmap(500, 4);
  check(reads.join() === '3:500:0:true', 'Cleanup forgets: the bitmap is read again');

  // A skin index of three: skin 1 a program too small and two wall decorations after
  // two floor ones, skin 2 no program.
  const skinDef1 = words(1, 2, 3, 4, 5, 6, 7, 8, 600, 2, 70, 71, 3, 80, 81, 82);
  const skinDef2 = words(1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0);
  const indexHead = 2 * 4;
  sections.set(1, new Uint8Array([...words(3, 0, indexHead, indexHead + skinDef1.length), ...skinDef1, ...skinDef2]));
  sections.set(600, new Uint8Array(2 * (1 + 8 * 21) - 2));
  lib.Cleanup();
  check([0, 1, 2, 3].map((n) => lib.GetWallDecorationID(1, n)).join() === '80,81,82,0',
    'GetWallDecorationID: the wall decorations after the floor ones, 0 past their count');
  check(lib.GetCode(1) === null && lib.GetCode(2) === null && lib.GetSkinID(1, 8) === 600,
    'GetCode: nothing for a program too small for its 168 cell addresses, nor for no program');

  // Two decorations at bytes 12 and 16, and three locations.
  sections.set(700, new Uint8Array([...words(2, 12, 16, 3, 0x0102, 0x0304, 0x0506), 0xaa, 0xbb, 0xcc, 0xdd]));
  sections.set(701, words(1, 20, 1, 0));
  const decoration = lib.GetDecorationBitmap(700, 1, 2);
  check(decoration?.bitmap.offset === 16 && decoration.location.offset === 12 && decoration.bitmapSize === 2
    && decoration.location.data[decoration.location.offset] === 0x06,
    'GetDecorationBitmap: the bitmap at its offset, the location its word, the size to the section\'s end');
  check(lib.GetDecorationBitmap(700, 2, 0) === null && lib.GetDecorationBitmap(700, 0, 3) === null
    && lib.GetDecorationBitmap(701, 0, 0) === null,
    'and nothing past either count, nor for an offset past the section');
}

finish();
