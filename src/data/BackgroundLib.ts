/**
 * `BACKGROUND_LIB` (`doc/CSBwin-src/CSB.h:364-419`, `doc/CSBwin-src/Viewport.cpp:5333-5899`):
 * the `CGT_Backgrounds` sections of `CSBgraphics.dat` a skin draws with, read once and kept,
 * and the readers of the skin index, the masks, the bitmaps and the decorations in them.
 *
 * A section is CSBWin's native memory, so its words are little-endian
 * (`doc/CSBWIN_RENDERING_REFERENCE.md` → "Background library"). Where CSBWin hands out a
 * pointer into one, the port hands out the section's bytes and a byte offset.
 *
 * The cache is CSBWin's array, searched by id from its start. A graphic that
 * `GetBackgroundGraphic` finds missing gets an entry of size -1, which every later search
 * finds first and every size check refuses: the section is not read again, and a graphic
 * `CreateBackgroundGraphic` makes with that id afterwards is never found.
 * `BackgroundGraphicExists` records no miss, and reads the file again each time.
 *
 * `Cleanup` empties it, from `CleanupGraphics` (`doc/CSBwin-src/Graphics.cpp:2204`) before
 * every game CSBWin reads.
 */
import { readU16LE, readU32LE, writeU16LE, writeU32LE } from '../core/bytes';
import { CSBGraphicType, type CSBGraphicsLoader } from './CSBGraphicsLoader';
import {
  AFFINEMASK_SIZE, AffineTransform1, AffineTransform4, CUSTOMBITMAP, readAffineMask, writeAffineMask, type AFFINEMASK,
} from './CustomBitmap';

/** `BACKGROUND_GRAPHIC` (`CSB.h:357-362`). `data` is `null` in a missing graphic's entry. */
interface BackgroundGraphic {
  id: number;
  size: number;
  data: Uint8Array | null;
}

/**
 * `BACKGROUND_MASK`'s header (`CSB.h:330-337`), as `CreateVirtualMask` fills one from the
 * stack: `ui16`s but `dstX`, an `i16`.
 */
export interface BackgroundMaskHeader {
  srcX: number;
  srcY: number;
  dstX: number;
  dstY: number;
  width: number;
  height: number;
}

/** A pointer into a background graphic: its bytes, and a byte offset into them. */
export interface BackgroundPointer {
  data: Uint8Array;
  offset: number;
}

/** `GetSkinDef`'s answer: the skin's definition, and `skinDefSize`, the bytes from it to the section's end. */
export interface SkinDef extends BackgroundPointer {
  size: number;
}

/** `GetDecorationBitmap`'s answer, where it returns 0. */
export interface DecorationBitmap {
  /** `*pBitmap`, a `ui16` pointer. */
  bitmap: BackgroundPointer;
  /** `*pLocation`, the location's `ui16` entry, read as bytes. */
  location: BackgroundPointer;
  /** `*pBitmapSize`, in bytes: from the bitmap to the section's end. */
  bitmapSize: number;
}

/** `GetCode`'s minimum size: the start address and 21 cells of eight room types (`Viewport.cpp:5705`). */
const CODE_MINIMUM_SIZE = 2 * (1 + 8 * 21);

// The `static bool errorMsg` of `CreateNewMask` and `CreateNewAffineMask`, by their
// messages: each is shown once per process.
const designErrorShown = new Set<string>();

export class BackgroundLib {
  private backgroundGraphics: BackgroundGraphic[] = [];
  /**
   * `UI_MessageBox`'s "Design Error", which a virtual mask made twice raises; a tool
   * reads it, and the page shows nothing.
   */
  messageBox: (line: string) => void = () => {};

  /** `reader` is the data set's `CSBgraphics.dat`; without one, every section is missing. */
  constructor(private readonly reader: Pick<CSBGraphicsLoader, 'readSection'> | null | undefined) {}

  /** `BACKGROUND_LIB::Cleanup` (`Viewport.cpp:5341-5359`). */
  Cleanup(): void {
    this.backgroundGraphics = [];
  }

  /**
   * `BACKGROUND_LIB::GetMask` (`Viewport.cpp:5367-5382`): mask `masknum` of a mask section,
   * a `ui32` count and as many byte offsets. `null` past the count, for an offset of 0 or
   * past the section, or an index that does not fit. Its `minimumSize` is unused.
   */
  GetMask(graphicID: number, masknum: number, _minimumSize: number): BackgroundPointer | null {
    return this.MaskExists(graphicID, masknum);
  }

  /** `BACKGROUND_LIB::MaskExists` (`Viewport.cpp:5384-5399`), the same reading as `GetMask`'s. */
  MaskExists(graphicID: number, masknum: number): BackgroundPointer | null {
    const idx = this.BackgroundGraphicExists(graphicID, 4, false);
    if (idx < 0) return null;
    const { data: pGraphic, size: actualSize } = this.backgroundGraphics[idx]!;
    if (readU32LE(pGraphic!, 0) <= masknum) return null;
    if (((4 * masknum + 8) >>> 0) > actualSize) return null; // No room for the offset!
    const offset = readU32LE(pGraphic!, 4 * (masknum + 1));
    if (offset === 0) return null;
    if (offset >= actualSize) return null; // No room for the mask itself!
    return { data: pGraphic!, offset };
  }

  /**
   * `BACKGROUND_LIB::GetBitmap` (`Viewport.cpp:5402-5413`): a bitmap section, and
   * `bitmapSize`, its size in `i32` units.
   */
  GetBitmap(graphicID: number, minimumSize: number): { data: Uint8Array; bitmapSize: number } | null {
    const idx = this.GetBackgroundGraphic(graphicID, minimumSize, true);
    if (idx < 0) return null;
    const { data, size: actualSize } = this.backgroundGraphics[idx]!;
    if (actualSize < minimumSize) return null;
    return { data: data!, bitmapSize: actualSize >>> 2 };
  }

  /**
   * `BACKGROUND_LIB::CreateVirtualBitmap` (`Viewport.cpp:5445-5481`): graphic
   * `virtualGraphicID`, `pMask`'s transform of the bitmap `pGraphic` (`srcSize` `i32`s),
   * unless a graphic of 2 bytes or more has that id. Its size is `4 * (dstSize + 1)` for a
   * `dstSize` that already counts bytes: four times what its pixels need, which
   * `GetBitmap`'s `bitmapSize` and `ApplyBackground`'s size check then read. A negative
   * `dstHeight` makes a size no `UI_malloc` gives, and throws here.
   */
  CreateVirtualBitmap(pGraphic: Uint8Array, srcSize: number, virtualGraphicID: number, pMask: BackgroundPointer): void {
    const pxform = readAffineMask(pMask);
    if ((pxform.dstWidth & 15) !== 0) return;
    let idx = this.BackgroundGraphicExists(virtualGraphicID, 2, false);
    if (idx >= 0) return;
    const dstSize = (Math.trunc(Math.imul(pxform.dstWidth, pxform.dstHeight) / 2) >>> 0); // bytes
    this.CreateBackgroundGraphic(virtualGraphicID, (4 * (dstSize + 1)) >>> 0);
    idx = this.GetBackgroundGraphic(virtualGraphicID, (4 * (dstSize + 1)) | 0, true);
    if (idx < 0) return;
    const pV = this.backgroundGraphics[idx]!.data!; // The virtual graphic.
    writeU32LE(pV, 0, pxform.dstWidth >>> 0);
    if (pxform.dstWidth <= 0) return;
    const cSrcBitmap = new CUSTOMBITMAP();
    const cDstBitmap = new CUSTOMBITMAP();
    cSrcBitmap.Initialize(pGraphic, 4, srcSize - 1);
    cDstBitmap.Initialize(pV, 4, dstSize);
    AffineTransform4(cSrcBitmap, cDstBitmap, pxform);
  }

  /**
   * `BACKGROUND_LIB::CreateNewMask` (`Viewport.cpp:5484-5540`): room for mask `number` in
   * mask section `id`, made if there is none, and `pMask`'s header copied into it. The
   * section's index grows to take `number`, its masks moving up behind it; `null`, and
   * CSBWin's "Design Error" once, when the mask is there already.
   *
   * CSBWin copies `sizeof (BACKGROUND_MASK)`, fourteen bytes, the header and a first mask
   * word from its caller's stack; the port's word is 0, as is the rest of the new room,
   * which `UI_realloc` leaves as it finds it.
   */
  CreateNewMask(id: number, number: number, pMask: BackgroundMaskHeader): BackgroundPointer | null {
    const gsize = (((pMask.width + 15) >> 4) * pMask.height * 2 + 12) >>> 0;
    const p = this.newMaskRoom(id, number, gsize, false, 'Creating a Virtual Mask\nthat already exists.');
    if (p === null) return null;
    const header = [pMask.srcX, pMask.srcY, pMask.dstX, pMask.dstY, pMask.width, pMask.height];
    header.forEach((word, i) => writeU16LE(p.data, p.offset + 2 * i, word & 0xffff));
    return p;
  }

  /**
   * `BACKGROUND_LIB::CreateNewAffineMask` (`Viewport.cpp:5543-5600`): `CreateNewMask` for
   * an `AFFINEMASK`, copied whole. Where the index grows by `n` entries, CSBWin moves the
   * offsets already there up by 4, not `4 * n` (`:5577`), so past one new entry they point
   * short of their masks; the port does the same.
   */
  CreateNewAffineMask(id: number, number: number, pMask: AFFINEMASK): BackgroundPointer | null {
    const p = this.newMaskRoom(id, number, AFFINEMASK_SIZE, true, 'Creating a Virtual Affine Mask\nthat already exists.');
    if (p === null) return null;
    writeAffineMask(p.data, p.offset, pMask);
    return p;
  }

  /**
   * `BACKGROUND_LIB::CreateVirtualMask` (`Viewport.cpp:5603-5624`): `pNewMask`'s pixels,
   * `pAffine`'s transform of `pOldMask`'s.
   */
  CreateVirtualMask(pOldMask: BackgroundPointer, pNewMask: BackgroundPointer, pAffine: AFFINEMASK): void {
    const srcBitmap = new CUSTOMBITMAP();
    const dstBitmap = new CUSTOMBITMAP();
    srcBitmap.InitializeMask(pOldMask);
    dstBitmap.InitializeMask(pNewMask);
    const Xform: AFFINEMASK = {
      Cxx: pAffine.Cxx,
      Cxy: pAffine.Cxy,
      Cxc: pAffine.Cxc,
      Cyx: pAffine.Cyx,
      Cyy: pAffine.Cyy,
      Cyc: pAffine.Cyc,
      srcX: 0,
      srcY: 0,
      dstHeight: readU16LE(pNewMask.data, pNewMask.offset + 10),
      dstWidth: readU16LE(pNewMask.data, pNewMask.offset + 8),
      srcHeight: readU16LE(pOldMask.data, pOldMask.offset + 10),
      srcWidth: readU16LE(pOldMask.data, pOldMask.offset + 8),
    };
    AffineTransform1(srcBitmap, dstBitmap, Xform);
  }

  /**
   * What `CreateNewMask` and `CreateNewAffineMask` share: mask section `id`, made with a
   * count of 0 where `BackgroundGraphicExists` finds none, its index grown to take entry
   * `number`, and `gsize` bytes added at its end for that entry. Growing the index by `n`
   * entries moves the offsets already there up by `4 * n`, or by 4 for an affine mask.
   * `null` where the entry is not 0, after the "Design Error" message the first time.
   */
  private newMaskRoom(id: number, number: number, gsize: number, affine: boolean, message: string): BackgroundPointer | null {
    let idx = this.BackgroundGraphicExists(id, 0, false);
    if (idx < 0) {
      idx = this.CreateBackgroundGraphic(id, 4);
      writeU32LE(this.backgroundGraphics[idx]!.data!, 0, 0); // Number of masks
    }
    const graphic = this.backgroundGraphics[idx]!;
    const count = readU32LE(graphic.data!, 0);
    if (count <= number) {
      // We need to make some room for the new index.
      const n = number - count + 1; // # index entries we need to add.
      this.resize(graphic, graphic.size + 4 * n);
      const pbg = graphic.data!;
      const length = graphic.size - 4 * number - 8;
      if (length > 0) pbg.copyWithin(4 * number + 8, 4 * count + 4, 4 * count + 4 + length);
      pbg.fill(0, 4 * count + 4, 4 * count + 4 + 4 * n);
      for (let i = 0; i < count; i++) {
        const offset = readU32LE(pbg, 4 * (i + 1));
        if (offset !== 0) writeU32LE(pbg, 4 * (i + 1), (offset + (affine ? 4 : 4 * n)) >>> 0);
      }
      writeU32LE(pbg, 0, count + n);
    }
    if (readU32LE(graphic.data!, 4 * (number + 1)) !== 0) {
      if (!designErrorShown.has(message)) {
        designErrorShown.add(message);
        this.messageBox(`Design Error: ${message.replace('\n', ' ')}`);
      }
      return null;
    }
    // Now the index entry exists but is zero: it takes the section's size, and the
    // section grows by the new mask.
    const offset = graphic.size;
    writeU32LE(graphic.data!, 4 * (number + 1), offset);
    this.resize(graphic, graphic.size + gsize);
    return { data: graphic.data!, offset };
  }

  /** `UI_realloc` of a graphic: its bytes kept, the new ones 0. */
  private resize(graphic: BackgroundGraphic, size: number): void {
    const data = new Uint8Array(size);
    data.set(graphic.data!.subarray(0, Math.min(size, graphic.data!.length)));
    graphic.data = data;
    graphic.size = size;
  }

  /**
   * `BACKGROUND_LIB::GetDecorationBitmap` (`Viewport.cpp:5626-5659`): a `ui16` count, as
   * many byte offsets, a `ui16` count of locations and the locations, a word each. `null`
   * where it returns -1. Neither count is checked against the section: a word past it
   * reads 0 here, where CSBWin reads what lies past its allocation.
   */
  GetDecorationBitmap(decorationID: number, decorationNumber: number, locationNumber: number): DecorationBitmap | null {
    const idx = this.GetBackgroundGraphic(decorationID, 4, true);
    if (idx < 0) return null;
    const { data: result, size: actualSize } = this.backgroundGraphics[idx]!;
    let pGraphic = 0;
    const numDecoration = readU16LE(result!, pGraphic);
    if (decorationNumber >= numDecoration) return null;
    pGraphic += 2;
    const offset = readU16LE(result!, pGraphic + 2 * decorationNumber);
    if (offset >= actualSize) return null;
    pGraphic += 2 * numDecoration;
    const numLocation = readU16LE(result!, pGraphic);
    if (locationNumber >= numLocation) return null;
    pGraphic += 2;
    const bsize = actualSize - offset;
    if (bsize < 0) return null;
    return {
      bitmap: { data: result!, offset },
      location: { data: result!, offset: pGraphic + 2 * locationNumber },
      bitmapSize: bsize,
    };
  }

  /**
   * `BACKGROUND_LIB::GetSkinDef` (`Viewport.cpp:5662-5691`): skin `skinNum`'s definition in
   * graphic 1, the skin index, a `ui16` count of skins and a byte offset each. `null`
   * without the index, past the count, for an offset of 0, or for a definition that does
   * not leave `minimumSize` bytes and one more before the section's end.
   */
  GetSkinDef(skinNum: number, minimumSize: number): SkinDef | null {
    const idx = this.GetBackgroundGraphic(1, 2, false);
    if (idx < 0) return null;
    const { data: result, size: actualSize } = this.backgroundGraphics[idx]!;
    const numSkins = readU16LE(result!, 0);
    if (skinNum >= numSkins) return null;
    if (actualSize < 2 * (1 + skinNum + 1)) return null;
    const skinDefOffset = readU16LE(result!, 2 * (skinNum + 1));
    if (skinDefOffset === 0) return null;
    if (skinDefOffset + minimumSize >= actualSize) return null;
    return { data: result!, offset: skinDefOffset, size: actualSize - skinDefOffset };
  }

  /**
   * `BACKGROUND_LIB::GetCode` (`Viewport.cpp:5694-5710`): the section of skin `skinNum`'s
   * program, ID 8 of its definition, or `null` for an ID of 0 or a section too small for
   * the start address and the 168 cell programs' addresses.
   */
  GetCode(skinNum: number): Uint8Array | null {
    const codeID = this.GetSkinID(skinNum, 8);
    if (codeID === 0) return null;
    const idx = this.GetBackgroundGraphic(codeID, CODE_MINIMUM_SIZE, false);
    if (idx < 0) return null;
    return this.backgroundGraphics[idx]!.data;
  }

  /** `BACKGROUND_LIB::GetSkinID` (`Viewport.cpp:5712-5723`): word `IDnum` of the skin's definition, or 0. */
  GetSkinID(skinNum: number, IDnum: number): number {
    const pSkinDef = this.GetSkinDef(skinNum, 18);
    if (pSkinDef === null) return 0;
    return readU16LE(pSkinDef.data, pSkinDef.offset + 2 * IDnum);
  }

  /** `BACKGROUND_LIB::GetFloorGraphicID` (`Viewport.cpp:5725-5728`). */
  GetFloorGraphicID(skinNum: number): number {
    return this.GetSkinID(skinNum, 0);
  }

  /** `BACKGROUND_LIB::GetMiddleGraphicID` (`Viewport.cpp:5730-5733`). */
  GetMiddleGraphicID(skinNum: number): number {
    return this.GetSkinID(skinNum, 1);
  }

  /** `BACKGROUND_LIB::GetCeilingGraphicID` (`Viewport.cpp:5735-5738`). */
  GetCeilingGraphicID(skinNum: number): number {
    return this.GetSkinID(skinNum, 2);
  }

  /** `BACKGROUND_LIB::GetWallGraphicID` (`Viewport.cpp:5740-5743`). */
  GetWallGraphicID(skinNum: number): number {
    return this.GetSkinID(skinNum, 3);
  }

  /**
   * `BACKGROUND_LIB::GetWallDecorationID` (`Viewport.cpp:5745-5763`): after the nine IDs,
   * a count of floor decorations and their IDs, then a count of wall decorations and
   * theirs. CSBWin bounds the word `index` by `skinDefSize`, a count of bytes, so a word
   * up to twice past the section's end passes: it reads 0 here, where CSBWin reads what
   * lies past its allocation.
   */
  GetWallDecorationID(skinNum: number, decorationNum: number): number {
    const pSkinDef = this.GetSkinDef(skinNum, 18);
    if (pSkinDef === null) return 0;
    const word = (index: number): number => readU16LE(pSkinDef.data, pSkinDef.offset + 2 * index);
    let index = 9;
    const numFloorDec = word(index);
    index += numFloorDec + 1;
    if (index >= pSkinDef.size) return 0;
    const numWallDec = word(index);
    if (decorationNum >= numWallDec) return 0;
    index += decorationNum + 1;
    if (index >= pSkinDef.size) return 0;
    return word(index);
  }

  /** `BACKGROUND_LIB::GetFloorMaskID` (`Viewport.cpp:5765-5768`). */
  GetFloorMaskID(skinNum: number): number {
    return this.GetSkinID(skinNum, 4);
  }

  /** `BACKGROUND_LIB::GetMiddleMaskID` (`Viewport.cpp:5770-5773`). */
  GetMiddleMaskID(skinNum: number): number {
    return this.GetSkinID(skinNum, 5);
  }

  /** `BACKGROUND_LIB::GetCeilingMaskID` (`Viewport.cpp:5775-5778`). */
  GetCeilingMaskID(skinNum: number): number {
    return this.GetSkinID(skinNum, 6);
  }

  /** `BACKGROUND_LIB::GetWallMaskID` (`Viewport.cpp:5780-5783`). */
  GetWallMaskID(skinNum: number): number {
    return this.GetSkinID(skinNum, 7);
  }

  /**
   * `BACKGROUND_LIB::FindGraphicInCache` (`Viewport.cpp:5801-5839`): the first entry with
   * the id, else the section read and added, else -1 with nothing added.
   */
  private FindGraphicInCache(graphicID: number, mustExist: boolean): number {
    for (let i = 0; i < this.backgroundGraphics.length; i++) {
      if (this.backgroundGraphics[i]!.id === graphicID) return i;
    }
    const data = this.reader?.readSection(CSBGraphicType.Backgrounds, graphicID, 0, mustExist) ?? null;
    if (data !== null) {
      this.backgroundGraphics.push({ id: graphicID, size: data.length, data });
      return this.backgroundGraphics.length - 1;
    }
    return -1;
  }

  /**
   * `BACKGROUND_LIB::BackgroundGraphicExists` (`Viewport.cpp:5841-5852`): the entry's
   * index, or -1 when there is none or it is smaller than `minimumSize`. CSBWin's
   * `actualSize` is the entry's `size`, which its callers read only for an index it
   * returns; the port's read the entry. Private in CSBWin.
   */
  BackgroundGraphicExists(graphicID: number, minimumSize: number, mustExist: boolean): number {
    const i = this.FindGraphicInCache(graphicID, mustExist);
    if (i < 0) return -1;
    if (this.backgroundGraphics[i]!.size < minimumSize) return -1;
    return i;
  }

  /**
   * `BACKGROUND_LIB::GetBackgroundGraphic` (`Viewport.cpp:5855-5872`): as
   * `BackgroundGraphicExists`, but a graphic not found gets an entry of size -1 and no
   * data. Private in CSBWin.
   */
  GetBackgroundGraphic(graphicID: number, minimumSize: number, mustExist: boolean): number {
    const i = this.FindGraphicInCache(graphicID, mustExist);
    if (i < 0) {
      this.backgroundGraphics.push({ id: graphicID, size: -1, data: null });
      return -1;
    }
    if (this.backgroundGraphics[i]!.size < minimumSize) return -1;
    return i;
  }

  /**
   * `BACKGROUND_LIB::CreateBackgroundGraphic` (`Viewport.cpp:5875-5899`): a new entry of
   * `graphicSize` bytes, or -1 when `BackgroundGraphicExists` finds the id. CSBWin's
   * `UI_malloc` leaves the bytes as they were; the port's are 0, and its callers write
   * them. Private in CSBWin.
   */
  CreateBackgroundGraphic(graphicID: number, graphicSize: number): number {
    const idx = this.BackgroundGraphicExists(graphicID, 0, false);
    if (idx >= 0) return -1;
    this.backgroundGraphics.push({ id: graphicID, size: graphicSize, data: new Uint8Array(graphicSize) });
    return this.backgroundGraphics.length - 1;
  }
}
