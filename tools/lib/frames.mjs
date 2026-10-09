/**
 * A golden frame on disk: the screen as `GameScreen.presentedFrame` hands it over
 * (`src/renderer/csbwin/PresentedFrame.ts`), written by `probe-frames.mjs` and read by
 * `compare-frames.mjs`.
 *
 * It is a paletted PNG. A pixel is a code: 0-15 a slot of the interface palette, 16-31 a
 * slot of the viewport's, 32 on a colour the viewport shows through an overlay. Its `tEXt`
 * chunk `csbweb-frame` gives what the codes stood for, one line each:
 *
 *   ui 0000 0777 …          the interface palette, sixteen Atari `0RGB` words
 *   viewport 0000 … | none  the viewport's, or none where nothing went through it
 *   overlay 7fff …          the overlay's colours, RGB555, code 32 on
 *
 * Its `PLTE` is the colour the canvas showed for each code, so the file can be looked at.
 * Nothing compares it: a change to how an Atari colour is shown on the canvas moves no
 * frame, and a slot drawn for another of the same colour does.
 */
import { decodePng, encodeIndexedPng } from './png.mjs';

const KEYWORD = 'csbweb-frame';
const hex4 = (v) => v.toString(16).padStart(4, '0');

/** `frame` is `presentedFrame()`'s, `colours[code]` the canvas's `[r, g, b]` for a code. */
export function encodeFrame(frame, colours) {
  const plte = Array.from({ length: 32 + frame.overlayColours.length }, (_, code) => colours[code] ?? [0, 0, 0]);
  const text = [
    `ui ${frame.uiPalette.map(hex4).join(' ')}`,
    `viewport ${frame.viewportPalette ? frame.viewportPalette.map(hex4).join(' ') : 'none'}`,
    `overlay ${frame.overlayColours.map(hex4).join(' ')}`.trimEnd(),
  ].join('\n');
  return encodeIndexedPng(frame.width, frame.height, frame.codes, plte, { [KEYWORD]: text });
}

/**
 * A frame read back, each pixel as what it showed: `values[i]` one number for the palette
 * and the slot and the word in it, or for the overlay's colour, so that two frames are
 * the same exactly where their values are; `describe(i)` says it in words.
 */
export function decodeFrame(path) {
  const png = decodePng(path);
  const text = png.text[KEYWORD];
  if (!png.indices || text === undefined)
    throw new Error(`${path}: not a golden frame (a paletted PNG with a ${KEYWORD} chunk)`);
  const lines = Object.fromEntries(text.split('\n').map((line) => {
    const [key, ...words] = line.split(' ');
    return [key, words.filter(Boolean)];
  }));
  const words = (key) => (lines[key] ?? []).map((w) => parseInt(w, 16));
  const ui = words('ui');
  const viewport = lines.viewport?.[0] === 'none' ? null : words('viewport');
  const overlay = words('overlay');
  const meaning = (code) => {
    if (code < 16) return { kind: 1, slot: code, word: ui[code] };
    if (code < 32) return { kind: 2, slot: code - 16, word: viewport?.[code - 16] };
    return { kind: 3, slot: 0, word: overlay[code - 32] };
  };
  const values = new Float64Array(png.width * png.height);
  for (let i = 0; i < values.length; i++) {
    const { kind, slot, word } = meaning(png.indices[i]);
    if (word === undefined) throw new Error(`${path}: code ${png.indices[i]} at pixel ${i} stands for nothing`);
    values[i] = kind * 2 ** 24 + slot * 2 ** 16 + word;
  }
  const describe = (i) => {
    const { kind, slot, word } = meaning(png.indices[i]);
    return kind === 3 ? `overlay RGB555 ${hex4(word)}` : `${kind === 1 ? 'ui' : 'viewport'} slot ${slot} (${hex4(word)})`;
  };
  return { width: png.width, height: png.height, values, describe };
}
