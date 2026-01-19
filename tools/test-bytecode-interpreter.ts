/**
 * Bytecode Interpreter Test
 *
 * This validates that our bytecode interpreter executes programs correctly
 * by comparing execution traces against expected behavior from CSBWin.
 */

import { BytecodeInterpreter, InterpreterContext, RectPos } from '../src/renderer/bytecode/BytecodeInterpreter';
import { BytecodePrograms, StdDrawF3Stone, StdDrawF0R1Stone } from '../src/renderer/bytecode/BytecodePrograms';
import { RoomType } from '../src/renderer/bytecode/Types';

// ANSI color codes for pretty output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function log(message: string) {
  console.log(message);
}

function success(message: string) {
  console.log(`${GREEN}✓${RESET} ${message}`);
}

function error(message: string) {
  console.log(`${RED}✗${RESET} ${message}`);
}

function info(message: string) {
  console.log(`${BLUE}ℹ${RESET} ${message}`);
}

function section(title: string) {
  console.log(`\n${YELLOW}═══ ${title} ═══${RESET}\n`);
}

/**
 * Create a mock interpreter context for testing
 */
function createMockContext(): InterpreterContext {
  // Create mock bitmaps (7 wall bitmaps as per CSBWin)
  // Note: In Node.js, we create mock ImageData objects
  const wallBitmaps: any[] = [];
  for (let i = 0; i < 7; i++) {
    wallBitmaps.push({
      width: 32,
      height: 136,
      pixels: new Uint8Array(32 * 136)
    });
  }

  // Create mock rectangles (14 wall rectangles as per CSBWin)
  const wallRectangles: RectPos[] = [
    // F3 rectangles (indices 0-2, 12-13)
    { x1: 64, x2: 160, y1: 20, y2: 71 },   // 0: F3
    { x1: 0, x2: 96, y1: 20, y2: 71 },     // 1: F3L1
    { x1: 128, x2: 224, y1: 20, y2: 71 },  // 2: F3R1
    // F2 rectangles (indices 3-5)
    { x1: 64, x2: 160, y1: 30, y2: 101 },  // 3: F2
    { x1: 0, x2: 80, y1: 30, y2: 101 },    // 4: F2L1
    { x1: 144, x2: 224, y1: 30, y2: 101 }, // 5: F2R1
    // F1 rectangles (indices 6-8)
    { x1: 48, x2: 176, y1: 20, y2: 131 },  // 6: F1
    { x1: 0, x2: 64, y1: 20, y2: 131 },    // 7: F1L1
    { x1: 160, x2: 224, y1: 20, y2: 131 }, // 8: F1R1
    // F0 rectangles (indices 9-11)
    { x1: 32, x2: 192, y1: 0, y2: 136 },   // 9: F0 (not used for side walls)
    { x1: 0, x2: 32, y1: 0, y2: 136 },     // 10: F0L1
    { x1: 192, x2: 224, y1: 0, y2: 136 },  // 11: F0R1
    // Corners
    { x1: 0, x2: 32, y1: 20, y2: 71 },     // 12: F3R2
    { x1: 192, x2: 224, y1: 20, y2: 71 },  // 13: F3L2
  ];

  // Create mock canvas context
  const canvas = {
    putImageData: () => {},
    getImageData: () => ({
      width: 224,
      height: 136,
      data: new Uint8ClampedArray(224 * 136 * 4)
    }),
  } as any;

  return {
    wallBitmaps,
    wallRectangles,
    viewportContext: canvas,
    viewportIndexBuffer: { width: 224, height: 136, pixels: new Uint8Array(224 * 136) },
    roomData: [],
    executionLog: [],
  };
}

/**
 * Test 1: Simplest program - F0R1Stone
 * Expected: Push bitmap[0], push rect[11], blit, return
 */
function testSimplestProgram(): boolean {
  section('Test 1: Simplest Program (F0R1Stone)');

  const context = createMockContext();
  const interpreter = new BytecodeInterpreter(context);

  log('Program: StdDrawF0R1Stone (4 opcodes)');
  log('Expected execution:');
  log('  1. Push WallBitmap[0] (graphic 84)');
  log('  2. Push WallRectanglePtr[13] (RECT_StdWallRectangleF0R1)');
  log('  3. StdBltShape (blit bitmap[0] to rect[11])');
  log('  4. Return\n');

  interpreter.interpret(StdDrawF0R1Stone, 19);  // Cell 19 = RF0R1

  log('Actual execution log:');
  context.executionLog.forEach(line => log(`  ${line}`));

  // Validate execution
  const executionLog = context.executionLog.join('\n');

  const checks = [
    { test: () => executionLog.includes('WallBitmapPtr[1012]'), desc: 'Pushed correct StdBitmapPtr (F0R1)' },
    { test: () => executionLog.includes('WallRectanglePtr[13]'), desc: 'Pushed correct rectangle pointer (13 = RECT_StdWallRectangleF0R1)' },
    { test: () => executionLog.includes('StdBltShape(bitmapPtr=1012, rectPtr=13)'), desc: 'Called StdBltShape correctly' },
    { test: () => executionLog.includes('Blitting bitmap 32x136 to rect (192, 0, 224, 136)'), desc: 'Draws to correct position' },
    { test: () => executionLog.includes('RETURN'), desc: 'Returned from program' },
  ];

  let allPassed = true;
  for (const check of checks) {
    if (check.test()) {
      success(check.desc);
    } else {
      error(check.desc);
      allPassed = false;
    }
  }

  return allPassed;
}

/**
 * Test 2: Program with conditional jump - F3Stone
 * Expected: Blit wall, check alcove, conditionally draw objects
 */
function testConditionalProgram(): boolean {
  section('Test 2: Conditional Program (F3Stone)');

  const context = createMockContext();
  const interpreter = new BytecodeInterpreter(context);

  log('Program: StdDrawF3Stone (20 opcodes)');
  log('Expected execution:');
  log('  1. Blit wall graphic');
  log('  2. Draw wall decorations (text, decorations)');
  log('  3. Check if alcove present (should be 0/false)');
  log('  4. JumpZ should skip object drawing');
  log('  5. Return\n');

  interpreter.interpret(StdDrawF3Stone, 9);  // Cell 9 = RF3

  log('Actual execution log:');
  context.executionLog.forEach(line => log(`  ${line}`));

  const executionLog = context.executionLog.join('\n');

  const checks = [
    { test: () => executionLog.includes('WallBitmapPtr[1002]'), desc: 'Pushed correct StdBitmapPtr (F3)' },
    { test: () => executionLog.includes('WallRectanglePtr[2]'), desc: 'Pushed correct rectangle pointer (2 = RECT_StdWallRectangleF3)' },
    { test: () => executionLog.includes('StdBltShape'), desc: 'Called StdBltShape to draw wall' },
    { test: () => executionLog.includes('Condition(Alcove) -> 0'), desc: 'Checked alcove condition (returned 0)' },
    { test: () => executionLog.includes('JumpZ(condition=0, offset=5)'), desc: 'Called JumpZ with correct offset' },
    { test: () => executionLog.includes('-> Jumping 5 instructions'), desc: 'Actually jumped (skipped object drawing)' },
    { test: () => !executionLog.includes('StdDrawRoomObjects'), desc: 'Did NOT draw room objects (correctly skipped)' },
    { test: () => executionLog.includes('RETURN'), desc: 'Returned from program' },
  ];

  let allPassed = true;
  for (const check of checks) {
    if (check.test()) {
      success(check.desc);
    } else {
      error(check.desc);
      allPassed = false;
    }
  }

  return allPassed;
}

/**
 * Test 3: Stack operations
 * Validate that push/pop works correctly
 */
function testStackOperations(): boolean {
  section('Test 3: Stack Operations');

  const context = createMockContext();
  const interpreter = new BytecodeInterpreter(context);

  log('Testing stack-based execution model');
  log('Program pushes values, then StdBltShape pops them\n');

  // Simple program: push bitmap, push rect, blit
  interpreter.interpret(StdDrawF0R1Stone, 19);

  const executionLog = context.executionLog.join('\n');

  // The key test: StdBltShape should have popped the correct values
  const blitCall = executionLog.match(/StdBltShape\(bitmapPtr=(\d+), rectPtr=(\d+)\)/);

  if (blitCall) {
    const bitmap = parseInt(blitCall[1]);
    const rectPtr = parseInt(blitCall[2]);

    if (bitmap === 1012 && rectPtr === 13) {
      success('Stack operations work correctly (popped in reverse order)');
      return true;
    } else {
      error(`Stack operations failed: got bitmapPtr=${bitmap}, rectPtr=${rectPtr}, expected bitmapPtr=1012, rectPtr=13`);
      return false;
    }
  } else {
    error('Could not find StdBltShape call in execution log');
    return false;
  }
}

/**
 * Test 4: Bitmap and rectangle mapping
 * Validate that opcodes map to correct array indices
 */
function testMappings(): boolean {
  section('Test 4: Bitmap and Rectangle Mappings');

  const context = createMockContext();
  const interpreter = new BytecodeInterpreter(context);

  log('Testing that opcodes map to correct CSBWin array indices\n');

  const tests = [
    { program: StdDrawF0R1Stone, cell: 19, expectedBitmapPtr: 1012, expectedRectPtr: 13, desc: 'F0R1 (close right)' },
    { program: BytecodePrograms['F0L1_Stone'], cell: 18, expectedBitmapPtr: 1011, expectedRectPtr: 11, desc: 'F0L1 (close left)' },
    { program: BytecodePrograms['F3_Stone'], cell: 9, expectedBitmapPtr: 1002, expectedRectPtr: 2, desc: 'F3 (far center)' },
  ];

  let allPassed = true;

  for (const test of tests) {
    context.executionLog = [];  // Clear log
    interpreter.interpret(test.program, test.cell);

    const executionLog = context.executionLog.join('\n');
    const bitmapMatch = executionLog.match(/WallBitmapPtr\[(\d+)\]/);
    const rectMatch = executionLog.match(/WallRectanglePtr\[(\d+)\]/);

    if (bitmapMatch && rectMatch) {
      const bitmap = parseInt(bitmapMatch[1]);
      const rectPtr = parseInt(rectMatch[1]);

      if (bitmap === test.expectedBitmapPtr && rectPtr === test.expectedRectPtr) {
        success(`${test.desc}: bitmap=${bitmap}, rectPtr=${rectPtr}`);
      } else {
        error(
          `${test.desc}: got bitmapPtr=${bitmap}, rectPtr=${rectPtr}, expected bitmapPtr=${test.expectedBitmapPtr}, rectPtr=${test.expectedRectPtr}`
        );
        allPassed = false;
      }
    } else {
      error(`${test.desc}: Could not find bitmap/rectangle in log`);
      allPassed = false;
    }
  }

  return allPassed;
}

/**
 * Run all tests
 */
function runAllTests() {
  console.log(`
${BLUE}╔═══════════════════════════════════════════════════════════╗
║         Bytecode Interpreter Prototype Test Suite        ║
║                                                           ║
║  Validates that our TypeScript port executes bytecode    ║
║  programs exactly as CSBWin does.                        ║
╚═══════════════════════════════════════════════════════════╝${RESET}
`);

  const results: { [key: string]: boolean } = {
    'Simplest Program': testSimplestProgram(),
    'Conditional Program': testConditionalProgram(),
    'Stack Operations': testStackOperations(),
    'Bitmap/Rectangle Mappings': testMappings(),
  };

  section('Test Results Summary');

  let passCount = 0;
  let totalCount = 0;

  for (const [testName, passed] of Object.entries(results)) {
    totalCount++;
    if (passed) {
      passCount++;
      console.log(`${GREEN}✓${RESET} ${testName}`);
    } else {
      console.log(`${RED}✗${RESET} ${testName}`);
    }
  }

  console.log();

  if (passCount === totalCount) {
    console.log(`${GREEN}╔═══════════════════════════════════════════╗
║  ALL TESTS PASSED (${passCount}/${totalCount})                   ║
║  Bytecode interpreter is working correctly! ║
╚═══════════════════════════════════════════╝${RESET}\n`);

    console.log(`${GREEN}Next steps:${RESET}`);
    console.log(`  1. Port remaining bytecode programs (102 total)`);
    console.log(`  2. Implement remaining opcodes (~350 total)`);
    console.log(`  3. Port DrawViewport() main loop`);
    console.log(`  4. Connect to actual game data and canvas`);
    return 0;
  } else {
    console.log(`${RED}╔═══════════════════════════════════════════╗
║  SOME TESTS FAILED (${passCount}/${totalCount})                ║
║  Review execution logs above for details  ║
╚═══════════════════════════════════════════╝${RESET}\n`);
    return 1;
  }
}

// Run tests
process.exit(runAllTests());
