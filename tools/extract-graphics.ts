import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { atariToRGBA, type Palette } from '../src/core/types';
import { ImageFormat } from '../src/core/imageDecoder';

type ImageInfo = {
  name?: string;
  palettes?: number[];
  transparency?: number | number[];
};

type MediaIndex = {
  imagesIndex: Record<string, ImageInfo>;
  palettesInterface: number[];
};

const DEFAULT_GRAPHICS_PATH = path.join('static', 'gamefiles', 'dm-atari', 'graphics.dat');
const DEFAULT_OUTPUT_DIR = path.join('static', 'extracted');
const PORTRAIT_GRAPHIC_INDEX = 26;
const PORTRAIT_WIDTH = 32;
const PORTRAIT_HEIGHT = 29;
const PORTRAIT_COLUMNS = 8;
const PORTRAIT_ROWS = 3;
const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 200;

function readMediaIndex(rootDir: string): MediaIndex {
  const mediaIndexPath = path.join(rootDir, 'static', 'js', 'mediaindex.js');
  if (!fs.existsSync(mediaIndexPath)) {
    return { imagesIndex: {}, palettesInterface: [0] };
  }

  const code = fs.readFileSync(mediaIndexPath, 'utf8');
  const exportsObj: MediaIndex = { imagesIndex: {}, palettesInterface: [0] };
  const wrapped = `${code}\nexports.imagesIndex = imagesIndex;\nexports.palettesInterface = palettesInterface;`;
  const loader = new Function('exports', wrapped);
  loader(exportsObj);
  return exportsObj;
}

function normalizeTransparency(transparency?: number | number[]): Set<number> {
  if (transparency === undefined) return new Set();
  if (Array.isArray(transparency)) return new Set(transparency);
  return new Set([transparency]);
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
}

function buildPaletteRGBA(palette: Palette): { r: number; g: number; b: number; a: number }[] {
  return palette.map((color) => atariToRGBA(color));
}

function buildRGBA(
  pixels: Uint8Array | number[],
  width: number,
  height: number,
  paletteRGBA: { r: number; g: number; b: number; a: number }[],
  transparency: Set<number>
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    const colorIndex = pixels[i] ?? 0;
    const color = paletteRGBA[colorIndex] ?? paletteRGBA[0];
    const alpha = transparency.has(colorIndex) ? 0 : color.a;
    const offset = i * 4;
    rgba[offset] = color.r;
    rgba[offset + 1] = color.g;
    rgba[offset + 2] = color.b;
    rgba[offset + 3] = alpha;
  }
  return rgba;
}

function buildSubRGBA(
  pixels: Uint8Array | number[],
  baseWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
  paletteRGBA: { r: number; g: number; b: number; a: number }[],
  transparency: Set<number>
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  let dst = 0;
  for (let row = 0; row < height; row++) {
    const srcRow = (y + row) * baseWidth + x;
    for (let col = 0; col < width; col++) {
      const colorIndex = pixels[srcRow + col] ?? 0;
      const color = paletteRGBA[colorIndex] ?? paletteRGBA[0];
      const alpha = transparency.has(colorIndex) ? 0 : color.a;
      rgba[dst++] = color.r;
      rgba[dst++] = color.g;
      rgba[dst++] = color.b;
      rgba[dst++] = alpha;
    }
  }
  return rgba;
}

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i] ?? 0;
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function writePng(filePath: string, width: number, height: number, rgba: Uint8Array): void {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    const rowStart = y * stride;
    raw.set(rgba.subarray(rowStart, rowStart + stride), offset);
    offset += stride;
  }

  const idat = zlib.deflateSync(raw);

  const chunks = [
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ];

  fs.writeFileSync(filePath, Buffer.concat([signature, ...chunks]));
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  const inputPath = process.argv[2] ?? DEFAULT_GRAPHICS_PATH;
  const outputDir = process.argv[3] ?? DEFAULT_OUTPUT_DIR;
  const fullInputPath = path.resolve(rootDir, inputPath);
  const fullOutputDir = path.resolve(rootDir, outputDir);

  if (!fs.existsSync(fullInputPath)) {
    throw new Error(`graphics.dat not found: ${fullInputPath}`);
  }

  const mediaIndex = readMediaIndex(rootDir);

  const loader = new GraphicsLoader();
  const data = fs.readFileSync(fullInputPath);
  loader.loadFromArray(new Uint8Array(data));

  const portraitDir = path.join(fullOutputDir, 'portraits');
  const largeDir = path.join(fullOutputDir, 'large-images');
  fs.rmSync(portraitDir, { recursive: true, force: true });
  fs.rmSync(largeDir, { recursive: true, force: true });
  fs.mkdirSync(portraitDir, { recursive: true });
  fs.mkdirSync(largeDir, { recursive: true });

  const areaThreshold = Math.floor((SCREEN_WIDTH * SCREEN_HEIGHT) / 20);
  const largeExports: { index: number; width: number; height: number; name: string }[] = [];

  const portraitInfo = mediaIndex.imagesIndex[String(PORTRAIT_GRAPHIC_INDEX)];
  const portraitPaletteIndex = portraitInfo?.palettes?.[0] ?? mediaIndex.palettesInterface[0] ?? 0;
  const portraitPalette = loader.getPalette(portraitPaletteIndex);
  const portraitPaletteRGBA = buildPaletteRGBA(portraitPalette);
  const portraitTransparency = normalizeTransparency(portraitInfo?.transparency);
  const portraitSheet = loader.getImage(PORTRAIT_GRAPHIC_INDEX, ImageFormat.IMG1);

  // let portraitIndex = 1;
  // for (let row = 0; row < PORTRAIT_ROWS; row++) {
  //   for (let col = 0; col < PORTRAIT_COLUMNS; col++) {
  //     const x = col * PORTRAIT_WIDTH;
  //     const y = row * PORTRAIT_HEIGHT;
  //     const rgba = buildSubRGBA(
  //       portraitSheet.pixels,
  //       portraitSheet.width,
  //       x,
  //       y,
  //       PORTRAIT_WIDTH,
  //       PORTRAIT_HEIGHT,
  //       portraitPaletteRGBA,
  //       portraitTransparency
  //     );
  //     const fileName = `portrait-${String(portraitIndex).padStart(2, '0')}.png`;
  //     writePng(path.join(portraitDir, fileName), PORTRAIT_WIDTH, PORTRAIT_HEIGHT, rgba);
  //     portraitIndex++;
  //   }
  // }

  const itemCount = loader.getItemCount();
  for (let index = 0; index < itemCount; index++) {
    let image;
    try {
      image = loader.getImage(index, ImageFormat.IMG1);
    } catch (error) {
      console.warn(`Skipping graphic ${index}: ${error}`);
      continue;
    }

    if (image.width <= 0 || image.height <= 0) continue;
    if (image.width > SCREEN_WIDTH || image.height > SCREEN_HEIGHT) continue;
    const area = image.width * image.height;
    if (area <= areaThreshold) continue;

    const info = mediaIndex.imagesIndex[String(index)];
    const paletteIndex = info?.palettes?.[0] ?? mediaIndex.palettesInterface[0] ?? 0;
    const palette = loader.getPalette(paletteIndex);
    const paletteRGBA = buildPaletteRGBA(palette);
    const transparency = normalizeTransparency(info?.transparency);
    const rgba = buildRGBA(image.pixels, image.width, image.height, paletteRGBA, transparency);

    const baseName = info?.name ? sanitizeName(info.name) : `graphic_${index}`;
    const fileName = `${String(index).padStart(3, '0')}_${baseName}_${image.width}x${image.height}.png`;
    writePng(path.join(largeDir, fileName), image.width, image.height, rgba);
    largeExports.push({
      index,
      width: image.width,
      height: image.height,
      name: info?.name ?? baseName,
    });
  }

  // console.log(`Exported ${portraitIndex - 1} portraits to ${portraitDir}`);
  console.log(`Exported ${largeExports.length} large images (> ${areaThreshold} px) to ${largeDir}`);
  if (largeExports.length > 0) {
    for (const entry of largeExports) {
      console.log(`  ${entry.index}: ${entry.name} (${entry.width}x${entry.height})`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
