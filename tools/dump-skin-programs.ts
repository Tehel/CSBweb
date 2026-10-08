/**
 * A skin's program run: `DrawViewport` runs a skinned cell's own
 * program from `CSBgraphics.dat`, on CSBWin's two stacks, through subroutine calls
 * (`doc/CSBwin-src/Viewport.cpp:6772-6825`, `:2215-2247`, `:2473-2474`, `:3024-3028`, `:3299-3308`).
 *
 * 1. **The machine.** Hand-written code through `Interpret`: every stack word against
 *    CSBWin's C (`:3123-3193`), whose `LESS` and `GREATER` compare the top with the word
 *    under it, a subroutine call and its `Return`, a jump back, `ToR` and `RTo`, a word
 *    `pop` reads signed, the data stack kept from one `Interpret` to the next, and
 *    `FloorDecorationID`, which has no case in `Interpret`: it ends the program, its
 *    sentinel left on the return stack.
 * 2. **The skin's reads** (`:3035-3069`, `:3194-3215`, `:3285-3297`), on Conflux 3.5's
 *    files: the cell's skin, another cell's and the cell's number; the nine IDs of each
 *    skin's definition, and none for a skin popped as -1; a mask's header, read off its
 *    bytes, and nothing pushed for a mask past the section's count; whether a mask is
 *    missing; a bitmap's width and height.
 * 3. **The cell tables.** In every program of both files, the code `skinProgramStart`
 *    finds for each of the 168 cells and room types draws the objects of its own cell:
 *    every `…Contents` opcode it reaches before its `Return` names that cell. The canary
 *    for `pCode[pCode[0] + 8 * cell + graphicRoomType]`: a table read by type then cell,
 *    or off by a word, sends a cell to another cell's code. The code before the tables
 *    holds 33 of the skin opcodes (60302 to 60362): the three virtual graphics, and not
 *    `DrawCustomDecoration`, `WallDecorationID` or `FloorDecorationID`.
 * 4. **Views**, in Conflux 3.5 and The Towers of Chaos 3.3: from every square of the
 *    party's starting level, in each facing (every level with `--all`, minutes), the
 *    cells `DrawViewport` runs a skin's program for are exactly those whose skin, the
 *    cell's or else the level's default, names a program, in cell order. No program
 *    reaches an opcode the port lacks, every one comes back through its `Return` to the
 *    sentinel, and none leaves more than one word on the data stack: the programs push a
 *    flag on some paths they never pop, which CSBWin's ring absorbs as the port's does.
 *    What the programs ask to draw, through `DrawCustomGraphic` and the three virtual
 *    graphics, is counted from CSBWin's graphic trace, and the starting view's is
 *    printed. `tools/dump-custom-graphics.ts` checks what `DrawCustomGraphic` draws, and
 *    `tools/dump-virtual-graphics.ts` what the virtual graphics make.
 *
 * Run: `npx tsx tools/dump-skin-programs.ts [--all]`.
 */
import { readFileSync } from 'node:fs';

import { readU16LE, readU32LE } from '../src/core/bytes';
import { Position } from '../src/core/types';
import { BackgroundLib } from '../src/data/BackgroundLib';
import { CSBGraphicsLoader, CSBGraphicType } from '../src/data/CSBGraphicsLoader';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import {
  BytecodeInterpreter,
  interpreterStackPointers,
  interpreterStackTop,
  type InterpreterContext,
} from '../src/renderer/bytecode/BytecodeInterpreter';
import { Opcode } from '../src/renderer/bytecode/Opcodes';
import { GraphicRoomType, RoomType, type SummarizeRoomData } from '../src/renderer/bytecode/Types';
import type { IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { RelativeXY, cellNames, relativeX, relativeY, skinProgramStart } from '../src/renderer/DrawViewport';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { ViewportRenderer } from '../src/renderer/ViewportRenderer';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame } from './lib/game';

const all = process.argv.includes('--all');
const SETS = [
  { name: 'Conflux 3.5', dir: 'conflux-3.5-b8', print: true },
  { name: 'The Towers of Chaos 3.3', dir: 'towers-of-chaos-3.3', print: false },
];

const O = Opcode;
/** `Literal v`, the word as a `ui16` of the code. */
const L = (v: number): number[] => [O.Literal, v & 0xffff];

function csbGraphics(dir: string): CSBGraphicsLoader {
  const csb = new CSBGraphicsLoader();
  csb.loadFromArray(new Uint8Array(readFileSync(`static/gamefiles/${dir}/CSBgraphics.dat`)));
  return csb;
}

function cell(n: number, skinNumber: number): SummarizeRoomData {
  return {
    x: 0, y: 0, relativeCellNumber: n, skinNumber, roomType: RoomType.OPEN, championPortraitOrdinal: 0,
    graphicRoomType: GraphicRoomType.OPEN, rn2: 0xfffe, decorations: [0, 0, 0], text: [0xfffe, 0xfffe, 0xfffe],
  };
}

/** A context with nothing to draw with: enough for the words that only read and compute. */
function bareContext(backgroundLib?: BackgroundLib): InterpreterContext {
  return {
    wallBitmaps: [], wallRectangles: [], backgroundLib,
    roomData: Array.from({ length: 21 }, (_, n) => cell(n, 0)),
  };
}

/**
 * `code` run from 0 on cell `cellNum`: the words it left on the data stack, the top first,
 * and how far it moved the return stack.
 */
function run(ctx: InterpreterContext, code: number[], cellNum = 0): { left: number[]; rsp: number } {
  const before = interpreterStackPointers();
  new BytecodeInterpreter(ctx).interpret(code, 0, cellNum);
  const after = interpreterStackPointers();
  return { left: interpreterStackTop((before.sp - after.sp) & 0xff), rsp: (before.rsp - after.rsp) & 0xff };
}

function machine(): void {
  console.log('1. The machine');
  const ctx = bareContext();
  const cases: Array<[string, number[], number[]]> = [
    ['7 3 MINUS', [...L(7), ...L(3), O.MINUS], [4]],
    ['-7 2 SLASH, toward zero', [...L(-7), ...L(2), O.SLASH], [-3]],
    ['3 2 LESS: 2 < 3', [...L(3), ...L(2), O.LESS], [1]],
    ['2 3 LESS: 3 < 2', [...L(2), ...L(3), O.LESS], [0]],
    ['2 3 GREATER: 3 > 2', [...L(2), ...L(3), O.GREATER], [1]],
    ['-1 1 ULESS: 1 < 0xffffffff', [...L(-1), ...L(1), O.ULESS], [1]],
    ['-1 1 LESS: 1 < -1', [...L(-1), ...L(1), O.LESS], [0]],
    ['300 300 GEAR, its low sixteen bits', [...L(300), ...L(300), O.GEAR], [90000 - 65536]],
    ['-1 1 PLUS', [...L(-1), ...L(1), O.PLUS], [0]],
    ['1 15 LSHIFT, read back signed', [...L(1), ...L(15), O.LSHIFT], [-32768]],
    ['5 5 EQUAL', [...L(5), ...L(5), O.EQUAL], [1]],
    ['6 3 AND', [...L(6), ...L(3), O.AND], [2]],
    ['6 3 OR', [...L(6), ...L(3), O.OR], [7]],
    ['0 NOT', [...L(0), O.NOT], [1]],
    ['4 ZEROEQUAL', [...L(4), O.ZEROEQUAL], [0]],
    ['-2 ZEROLESS', [...L(-2), O.ZEROLESS], [1]],
    ['-2 ZEROGREATER', [...L(-2), O.ZEROGREATER], [0]],
    ['1 2 SWAP', [...L(1), ...L(2), O.SWAP], [1, 2]],
    ['1 2 3 ROT', [...L(1), ...L(2), ...L(3), O.ROT], [1, 3, 2]],
    ['1 2 OVER', [...L(1), ...L(2), O.OVER], [1, 2, 1]],
    ['4 DUP', [...L(4), O.DUP], [4, 4]],
    ['1 2 TwoDup', [...L(1), ...L(2), O.TwoDup], [2, 1, 2, 1]],
    ['0 QuestionDUP', [...L(0), O.QuestionDUP], [0]],
    ['5 QuestionDUP', [...L(5), O.QuestionDUP], [5, 5]],
    ['10 20 30 2 PICK', [...L(10), ...L(20), ...L(30), ...L(2), O.PICK], [20, 30, 20, 10]],
    ['10 20 30 3 ROLL', [...L(10), ...L(20), ...L(30), ...L(3), O.ROLL], [10, 30, 20]],
    ['1 2 DROP', [...L(1), ...L(2), O.DROP], [1]],
    ['1 2 3 TwoDrop', [...L(1), ...L(2), ...L(3), O.TwoDrop], [1]],
    ['9 ToR 1 RTo', [...L(9), O.ToR, ...L(1), O.RTo], [9, 1]],
    ['Literal 0xffff, popped signed', [...L(0xffff)], [-1]],
    // 3, then 1 MINUS DUP JumpNZ back to the 1 until the copy is 0.
    ['a jump back', [...L(3), ...L(1), O.MINUS, O.DUP, O.JumpNZ, 0xfffa], [0]],
    // 5, a call to word 6, which adds 1, and back.
    ['a subroutine', [...L(5), 6, O.Return, 0, 0, ...L(1), O.PLUS, O.Return], [6]],
  ];
  let same = true;
  for (const [name, body, expected] of cases) {
    const { left, rsp } = run(ctx, [...body, O.Return]);
    const ok = left.join() === expected.join() && rsp === 0;
    if (!ok) console.log(`  ${name}: left ${left.join(' ')}, return stack moved ${rsp}; CSBWin leaves ${expected.join(' ')}`);
    same &&= ok;
  }
  check(same, `${cases.length} programs leave what CSBWin's words leave, and the return stack where it was`);

  run(ctx, [...L(42), O.Return]);
  const kept = run(ctx, [...L(1), O.PLUS, O.Return]);
  check(kept.left.length === 0 && interpreterStackTop(1)[0] === 43,
    'the data stack is kept from one Interpret to the next: a PLUS adds the 42 an earlier program left');

  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
  const stopped = run(ctx, [...L(1), O.FloorDecorationID, ...L(2), O.Return]);
  console.warn = warn;
  check(stopped.left.join() === '1' && stopped.rsp === 1 && warnings.length === 1,
    `FloorDecorationID, which Interpret has no case for, ends the program, its sentinel left on the return stack (${warnings[0]})`);
}

function reads(): void {
  console.log('2. The skin\'s reads: Conflux 3.5');
  const lib = new BackgroundLib(csbGraphics('conflux-3.5-b8'));
  const ctx = bareContext(lib);
  ctx.roomData[7] = cell(7, 14);
  ctx.roomData[9] = cell(9, 3);
  const cellRead = run(ctx, [O.CurrentSkin, O.CurrentCell, ...L(9), O.SkinNumber, O.Return], 7);
  check(cellRead.left.join() === '3,7,14', `CurrentSkin, CurrentCell and 9 SkinNumber on cell 7: ${cellRead.left.reverse().join(', ')}`);

  const idOps = [O.FloorGraphicID, O.MiddleGraphicID, O.CeilingGraphicID, O.WallGraphicID,
    O.FloorMaskID, O.MiddleMaskID, O.CeilingMaskID, O.WallMaskID];
  let idsRead = true;
  for (let skin = 1; skin < 51; skin++) {
    const left = run(ctx, [...idOps.flatMap((op) => [...L(skin), op]), ...L(skin), ...L(0), O.WallDecorationID, O.Return]).left.reverse();
    const expected = [...idOps.map((_, n) => lib.GetSkinID(skin, n)), lib.GetWallDecorationID(skin, 0)];
    if (left.join() !== expected.join()) idsRead = false;
  }
  check(idsRead, 'the eight ID opcodes and WallDecorationID read each skin\'s definition, as BACKGROUND_LIB does');
  const negative = run(ctx, [...L(-1), O.WallGraphicID, O.Return]).left;
  check(negative.join() === '0', 'a skin popped as -1 is a ui32 past the index\'s count: WallGraphicID 0');

  const maskID = lib.GetWallMaskID(1);
  const section = csbGraphics('conflux-3.5-b8').readSection(CSBGraphicType.Backgrounds, maskID, 0)!;
  const count = readU32LE(section, 0);
  const offset = readU32LE(section, 4 * 3);
  const header = Array.from({ length: 6 }, (_, i) => (readU16LE(section, offset + 2 * i) << 16) >> 16);
  const got = run(ctx, [...L(maskID), ...L(2), O.GetMaskHeader, O.Return]).left.reverse();
  check(got.join() === header.join(), `GetMaskHeader of mask 2 of section ${maskID}: srcX, srcY, dstX, dstY, width, height ${got.join(' ')}`);
  check(run(ctx, [...L(maskID), ...L(count), O.GetMaskHeader, O.Return]).left.length === 0,
    `GetMaskHeader of mask ${count}, past the section's ${count}, pushes nothing`);
  const need = run(ctx, [...L(maskID), ...L(2), O.NeedVirtualMaskQ, ...L(maskID), ...L(count), O.NeedVirtualMaskQ, O.Return]).left.reverse();
  check(need.join() === '0,1', `NeedVirtualMaskQ: 0 for mask 2, 1 for mask ${count}, which is missing`);

  const bitmapID = lib.GetWallGraphicID(1);
  const bitmap = csbGraphics('conflux-3.5-b8').readSection(CSBGraphicType.Backgrounds, bitmapID, 0)!;
  const width = readU32LE(bitmap, 0);
  const height = Math.floor(((bitmap.length / 4 - 1) * 8) / width);
  const info = run(ctx, [...L(bitmapID), O.BitmapInfo, O.Return]).left.reverse();
  check(info.join() === `${width},${height}`, `BitmapInfo of bitmap ${bitmapID}, ${bitmap.length} bytes: width ${info[0]}, height ${info[1]}`);
}

/** The code's words, as `DrawViewport` reads a program's section. */
function words(section: Uint8Array): number[] {
  return Array.from({ length: section.length >> 1 }, (_, i) => readU16LE(section, 2 * i));
}

function cellTables(): void {
  console.log('3. The cell tables');
  const skinOpcodes = new Set<number>();
  for (const set of SETS) {
    const csb = csbGraphics(set.dir);
    const lib = new BackgroundLib(csb);
    const ids = new Set<number>();
    for (let skin = 1; skin < 64; skin++) {
      const id = lib.GetSkinID(skin, 8);
      if (id !== 0) ids.add(id);
    }
    let contents = 0;
    let own = true;
    for (const id of [...ids].sort((a, b) => a - b)) {
      const code = words(csb.readSection(CSBGraphicType.Backgrounds, id, 0)!);
      for (let p = 1; p < code[0]!; p++) {
        const op = code[p]!;
        if (op === O.Literal || op === O.Jump || op === O.JumpZ || op === O.JumpNZ) p++;
        else if (op >= 60302 && op <= 60362) skinOpcodes.add(op);
      }
      for (let c = 0; c < 21; c++) {
        for (let type = 0; type < 8; type++) {
          for (let p = skinProgramStart(code, c, type); p < code.length && code[p] !== O.Return; p++) {
            const op = code[p]!;
            if (op === O.Literal || op === O.Jump || op === O.JumpZ || op === O.JumpNZ) {
              p++;
              continue;
            }
            const name = Opcode[op];
            if (name === undefined || !name.endsWith('Contents')) continue;
            contents++;
            if (name !== `${cellNames[c]}Contents`) own = false;
          }
        }
      }
    }
    check(own && contents > 0,
      `${set.name}: programs ${[...ids].sort((a, b) => a - b).join(', ')}, each cell's code draws its own cell's objects (${contents} Contents opcodes)`);
  }
  const has = (op: number): boolean => skinOpcodes.has(op);
  console.log(`  the skin opcodes (60302 to 60362) the programs' code holds: ${skinOpcodes.size}`);
  check(skinOpcodes.size === 33 && has(O.CreateVirtualBitmap) && has(O.CreateVirtualMask) && has(O.CreateVirtualAffineMask)
    && !has(O.DrawCustomDecoration) && !has(O.WallDecorationID) && !has(O.FloorDecorationID),
    'the programs use 33 skin opcodes, the three virtual graphics among them, and not DrawCustomDecoration, WallDecorationID or FloorDecorationID');
}

function views(): void {
  console.log(`4. Views${all ? ', every level' : ', the starting level'}`);
  for (const set of SETS) {
    const base = `static/gamefiles/${set.dir}`;
    const data = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(`${base}/dungeon.dat`)));
    const graphics = new GraphicsLoader();
    graphics.loadFromArray(new Uint8Array(readFileSync(`${base}/graphics.dat`)));
    const csb = csbGraphics(set.dir);
    const game = newGame(data, graphics);
    const dungeon = game.ctx.dungeon;
    const tables = graphicsTablesOf(graphics);
    const graphicCache = new Map<string, IndexedBitmap>();
    const renderer = new ViewportRenderer({
      graphicsLoader: graphics,
      dungeonState: dungeon,
      viewportTables: tables.viewport,
      objectTables: tables.objects,
      palette552: tables.ui.graphic232.palette552,
      graphicCache,
      getGraphicBitmap: (graphicNum) => getCachedGraphicBitmap(graphics, graphicCache, graphicNum),
      csbGraphicsLoader: csb,
    });
    const lib = renderer.context.backgroundLib!;
    const trace: string[] = [];
    renderer.context.graphicTrace = (line) => trace.push(line);
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };

    const start = game.ctx.party.state.position;
    const levels = all ? data.maps.map((_, z) => z) : [start.z];
    let viewCount = 0;
    let skinnedCells = 0;
    let cellsAsCached = true;
    let returned = true;
    let leftOver = true;
    const calls = new Map<string, number>();
    for (const z of levels) {
      renderer.selectLevel(z);
      const { width, height } = data.maps[z]!.descriptor;
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          for (let facing = 0; facing < 4; facing++) {
            const expected: string[] = [];
            for (let c = 0; c < 21; c++) {
              const pos = RelativeXY(facing, relativeY[c], relativeX[c], x, y);
              let skin = dungeon.skinCache.GetSkin(z, pos.x, pos.y);
              if (skin === 0) skin = dungeon.skinCache.GetDefaultSkin(z);
              if (skin !== 0 && lib.GetCode(skin) !== null) expected.push(`  Draw Cell ${c} skin ${skin}`);
            }
            trace.length = 0;
            const before = interpreterStackPointers();
            renderer.draw(new Position(x, y, z), facing, false, false);
            const after = interpreterStackPointers();
            viewCount++;
            skinnedCells += expected.length;
            const drawn = trace.filter((line) => line.startsWith('  Draw Cell'));
            if (drawn.join('\n') !== expected.join('\n')) cellsAsCached = false;
            if (after.rsp !== before.rsp) returned = false;
            if (((before.sp - after.sp) & 0xff) > expected.length) leftOver = false;
            for (const line of trace) {
              const name = /^\s*(\w+)/.exec(line)![1]!;
              if (name !== 'Draw' && name !== 'bMask' && name !== 'aMask' && name !== 'dstX') calls.set(name, (calls.get(name) ?? 0) + 1);
            }
          }
        }
      }
    }
    console.warn = warn;
    console.log(`  ${set.name}: ${viewCount} views, ${skinnedCells} cells drawn by a skin's program;`
      + ` ${[...calls].map(([name, n]) => `${name} ${n}`).join(', ')}`);
    check(skinnedCells > 0 && cellsAsCached,
      `${set.name}: each view runs a skin's program for exactly the cells whose skin, or the level's default, has one`);
    check(warnings.length === 0, `${set.name}: no program reaches an opcode the port lacks (${warnings.slice(0, 3).join('; ')})`);
    check(returned, `${set.name}: every program comes back to its sentinel, the return stack where it was`);
    check(leftOver, `${set.name}: no program leaves more than one word on the data stack`);

    if (set.print) {
      renderer.selectLevel(start.z);
      trace.length = 0;
      renderer.draw(start, game.ctx.party.state.facing, false, false);
      console.log(`  the starting view, (${start.x},${start.y}) on level ${start.z} facing ${game.ctx.party.state.facing}:`);
      for (const line of trace) console.log(`  ${line}`);
    }
  }
}

machine();
reads();
cellTables();
views();
finish();
