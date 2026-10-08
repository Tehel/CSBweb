/**
 * The Reincarnate name-entry screen's keyboard, letter grid and rules.
 *
 * `_ReIncarnate` (`doc/CSBwin-src/Code13ea4.cpp:20`) is one blocking loop in CSBWin and
 * a state machine here, and none of what it decides is visible on a golden frame: the
 * frames cannot type. So this drives the state machine directly — the same functions
 * `Mouse.ts` and the host's key handler call — over the real `d.SpecialChars` table
 * out of `graphics.dat`.
 *
 * The letter grid is where a port goes wrong quietly, because its arithmetic has three
 * oddities that all look like mistakes (`:192-222`):
 *
 *   - the pixel rows and columns *between* the keys are dead, `(x+4)%10` and
 *     `(y+5)%10`, except where the tall carriage-return key crosses one;
 *   - that key answers to two different computed codes, 86 and 97;
 *   - and every code above it shifts down by one to close the gap it leaves, which is
 *     what keeps 'W' where the player expects it rather than one key to the left.
 *
 * Get any of those wrong and the keyboard still "works" — it just types the wrong
 * letter for half the alphabet. The grid walk below is the check that matters: every
 * key centre in all three rows, read out in order, must spell the alphabet and then
 * the punctuation.
 *
 * Run: `npx tsx tools/dump-reincarnate-entry.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { Champion } from '../src/engine/gameTypes';
import type { UITables } from '../src/data/tables/UITables';
import {
  gridCharacterAt,
  openReincarnateScreen,
  reincarnateClick,
  reincarnateKey,
} from '../src/renderer/ui/ReIncarnate';
import type { UIState } from '../src/renderer/ui/UIState';
import { check, finish } from './lib/check';
import { graphicsTablesOf } from './lib/game';

/**
 * Just enough `UIState` for the module: it reads `reincarnate`, `uiTables`,
 * `partyState` and the engine's `HallOfChampions.reincarnateNamed`, and calls `onReincarnated`. Standing up the whole renderer would prove nothing
 * extra and would need a browser.
 */
interface Harness {
  ui: UIState;
  named: { chIdx: number; name: string; title: string } | null;
}

function makeHarness(uiTables: UITables, championNames: string[]): Harness {
  const harness: Harness = { ui: null as unknown as UIState, named: null };
  const champions = championNames.map((name) => ({ name }) as Champion);
  harness.ui = {
    uiTables,
    partyState: { champions },
    reincarnate: null,
    onReincarnated: () => {},
    ctx: {
      systems: {
        hallOfChampions: {
          reincarnateNamed: (chIdx: number, name: string, title: string) => {
            harness.named = { chIdx, name, title };
          },
        },
      },
    },
  } as unknown as UIState;
  return harness;
}

/** Type a string a key at a time, as the host's keydown handler would. */
function type(h: Harness, text: string): void {
  for (const ch of text) reincarnateKey(h.ui, ch);
}

/** The centre of grid cell (col, row) in screen coordinates. */
function cellCentre(col: number, row: number): { x: number; y: number } {
  return { x: 107 + col * 10 + 4, y: 116 + row * 10 + 4 };
}

const OK = { x: 206, y: 151 };
const BACKSPACE = { x: 140, y: 151 };

function main(): void {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const uiTables = graphicsTablesOf(graphics).ui;
  const special = uiTables.graphic232.specialChars;

  /* ---------------------------------------- the tables it needs ------------------ */

  console.log('=== d.SpecialChars, from graphics.dat item 0x232 ===');
  console.log(special.map((c) => `${c} ${c ? JSON.stringify(String.fromCharCode(c)) : '(nul)'}`).join('  '));
  console.log('');
  // CSBWin's own comment: "comma,period,semi-colon,colon,space" (Data.h:1437). Getting
  // this offset wrong would put arbitrary bytes on the punctuation keys.
  check(special[0] === 44, 'SpecialChars[0] is a comma');
  check(special[1] === 46, 'SpecialChars[1] is a period');
  check(special[2] === 59, 'SpecialChars[2] is a semi-colon');
  check(special[3] === 58, 'SpecialChars[3] is a colon');
  check(special[4] === 32, 'SpecialChars[4] is a space');
  check(uiTables.graphic232.byte1414[0] === 0x5f, 'Byte1414 is the underscore cursor');

  /* ---------------------------------------- the whole grid ----------------------- */

  console.log('=== every key centre, read out of the grid ===');
  const expected = 'ABCDEFGHIJKLMNOPQRSTUVW'.split('');
  const readOut: string[] = [];
  for (let row = 0; row < 3; row++) {
    const cells: string[] = [];
    for (let col = 0; col < 11; col++) {
      const { x, y } = cellCentre(col, row);
      const code = gridCharacterAt({ uiTables } as unknown as UIState, x, y);
      const label = code === null ? '·' : code === 13 ? 'CR' : JSON.stringify(String.fromCharCode(code));
      cells.push(label);
      if (code !== null) readOut.push(code === 13 ? '\n' : String.fromCharCode(code));
    }
    console.log(`row ${row}\t${cells.join(' ')}`);
  }
  console.log('');

  // The alphabet must come out in order, unbroken, across the three rows.
  const letters = readOut.filter((c) => c >= 'A' && c <= 'Z');
  console.log(`letters read: ${letters.join('')}`);
  check(letters.join('') === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'the 26 letters come out in order');
  check(expected.every((c, i) => letters[i] === c), 'and start at A in the top-left cell');
  // The carriage-return key is *tall*: it occupies the last cell of both the second
  // and third rows, which is why CSBWin tests for two codes, 86 and 97, and why it
  // also owns the grid line between them (`Code13ea4.cpp:208-213`, `:221-223`).
  check(readOut.filter((c) => c === '\n').length === 2,
    'the carriage-return key answers from both of the rows it spans');
  const punctuation = readOut.filter((c) => ',.;: '.includes(c));
  console.log(`punctuation read: ${JSON.stringify(punctuation.join(''))}`);
  check(punctuation.join('') === ',.;: ', 'and the five SpecialChars follow the alphabet');

  // The dead lines between the keys.
  check(gridCharacterAt({ uiTables } as unknown as UIState, 116, 120) === null,
    'a click on a vertical grid line hits nothing');
  check(gridCharacterAt({ uiTables } as unknown as UIState, 120, 125) === null,
    'and one on a horizontal grid line hits nothing');
  // ...except where the tall carriage-return key crosses one.
  check(gridCharacterAt({ uiTables } as unknown as UIState, 210, 135) === 13,
    'except at x>=207, y=135, which is the carriage-return key');

  /* ---------------------------------------- typing a name ------------------------ */

  console.log('');
  console.log('=== typing ===');
  console.log(['what', 'stage', 'name', 'title'].join('\t'));
  const show = (h: Harness, what: string): void => {
    const s = h.ui.reincarnate;
    console.log([what, s?.stage ?? '-', JSON.stringify(s?.name ?? ''), JSON.stringify(s?.title ?? '')].join('\t'));
  };

  {
    const h = makeHarness(uiTables, ['HALK', 'BORIS']);
    openReincarnateScreen(h.ui, 1);
    show(h, 'opened');
    // CSBWin blanks both fields before the loop (`:55-56`), so nothing is inherited.
    check(h.ui.reincarnate?.name === '' && h.ui.reincarnate?.title === '',
      'the screen opens with both fields blank, not with the hero text\'s name');

    type(h, 'zed');
    show(h, "typed 'zed'");
    check(h.ui.reincarnate?.name === 'ZED', 'lower case is folded to upper (`:246-249`)');

    // A leading space is refused in either field (`:259-262`).
    const h2 = makeHarness(uiTables, ['HALK', 'BORIS']);
    openReincarnateScreen(h2.ui, 1);
    type(h2, ' ');
    check(h2.ui.reincarnate?.name === '', 'a leading space is refused');

    // Seven characters fill the name and move to the title with no return needed.
    const h3 = makeHarness(uiTables, ['HALK', 'BORIS']);
    openReincarnateScreen(h3.ui, 1);
    type(h3, 'ABCDEFG');
    show(h3, "typed 'ABCDEFG'");
    check(h3.ui.reincarnate?.stage === 2, 'a full seven-character name advances by itself');
    check(h3.ui.reincarnate?.name === 'ABCDEFG', 'and keeps all seven');
    type(h3, 'HI');
    check(h3.ui.reincarnate?.name === 'ABCDEFG', 'further keys go to the title, not the name');
    check(h3.ui.reincarnate?.title === 'HI', 'which takes them');

    // Return also ends the name — but only a non-empty one, and never the title.
    reincarnateKey(h.ui, 'Enter');
    show(h, 'Enter');
    check(h.ui.reincarnate?.stage === 2, 'Return moves from the name to the title');
    type(h, 'THE RENAMED');
    show(h, 'typed a title');
    reincarnateKey(h.ui, 'Enter');
    check(h.ui.reincarnate?.stage === 2 && h.ui.reincarnate?.title === 'THE RENAMED',
      'Return in the title does nothing at all (`:286-288`)');

    // The title stops at nineteen.
    const h4 = makeHarness(uiTables, ['HALK', 'BORIS']);
    openReincarnateScreen(h4.ui, 1);
    type(h4, 'ZED');
    reincarnateKey(h4.ui, 'Enter');
    type(h4, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    console.log(`title after 26 keys: ${JSON.stringify(h4.ui.reincarnate?.title)}`);
    check(h4.ui.reincarnate?.title.length === 19, 'the title takes nineteen characters and no more');
  }

  /* ---------------------------------------- backspace ---------------------------- */

  console.log('');
  console.log('=== backspace ===');
  {
    const h = makeHarness(uiTables, ['HALK', 'BORIS']);
    openReincarnateScreen(h.ui, 1);
    reincarnateKey(h.ui, 'Backspace');
    check(h.ui.reincarnate?.name === '' && h.ui.reincarnate?.stage === 1,
      'backspace on an empty name does nothing (`:311-312`)');

    type(h, 'ZED');
    reincarnateKey(h.ui, 'Backspace');
    show(h, 'ZED, backspace');
    check(h.ui.reincarnate?.name === 'ZE', 'backspace rubs out the last letter');

    reincarnateKey(h.ui, 'Enter');
    check(h.ui.reincarnate?.stage === 2, 'now in the title');
    reincarnateKey(h.ui, 'Backspace');
    show(h, 'empty title, backspace');
    // `:327-334`: it steps back into the name and lands **on** its last character,
    // ready to replace it — so one letter is lost, not none.
    check(h.ui.reincarnate?.stage === 1, 'backspace off the front of the title returns to the name');
    check(h.ui.reincarnate?.name === 'Z', 'and takes the name\'s last character with it');
  }

  /* ---------------------------------------- the OK button ------------------------ */

  console.log('');
  console.log('=== OK, and the duplicate-name rule ===');
  {
    // An empty name refuses OK; the title may be empty (`:135-139`).
    const h = makeHarness(uiTables, ['HALK', 'BORIS']);
    openReincarnateScreen(h.ui, 1);
    reincarnateClick(h.ui, OK.x, OK.y);
    check(h.named === null && h.ui.reincarnate !== null, 'OK is refused while the name is empty');

    type(h, 'ZED');
    reincarnateClick(h.ui, OK.x, OK.y);
    console.log(`OK with name only -> ${JSON.stringify(h.named)}`);
    check(h.named?.name === 'ZED', 'OK on a non-empty name is accepted');
    check(h.named?.title === '', 'with an empty title');
    check(h.ui.reincarnate === null, 'and the screen closes');
  }
  {
    // The comparison runs against every champion but the last — the last is the one
    // being named, so it can never collide with itself (`:149-155`).
    const h = makeHarness(uiTables, ['HALK', 'BORIS']);
    openReincarnateScreen(h.ui, 1);
    type(h, 'HALK');
    reincarnateClick(h.ui, OK.x, OK.y);
    console.log(`OK with a duplicate name -> ${h.named === null ? 'refused' : 'accepted'}`);
    check(h.named === null, 'a name another champion already wears is refused');
    check(h.ui.reincarnate !== null, 'and the screen stays up, with no message');
    check(h.ui.reincarnate?.name === 'HALK', 'the typed name is left intact to be edited');

    reincarnateClick(h.ui, BACKSPACE.x, BACKSPACE.y);
    check(h.ui.reincarnate?.name === 'HAL', 'the backspace button rubs out a letter too');
    reincarnateClick(h.ui, OK.x, OK.y);
    check(h.named?.name === 'HAL', 'and then OK is accepted');
  }
  {
    // Trailing spaces are trimmed before the comparison and before the name is kept
    // (`:143-148`), so "HALK  " is the same name as "HALK".
    const h = makeHarness(uiTables, ['HALK', 'BORIS']);
    openReincarnateScreen(h.ui, 1);
    type(h, 'HALK  ');
    reincarnateClick(h.ui, OK.x, OK.y);
    check(h.named === null, 'trailing spaces do not sneak a duplicate name past the check');

    const h2 = makeHarness(uiTables, ['HALK', 'BORIS']);
    openReincarnateScreen(h2.ui, 1);
    type(h2, 'ZED  ');
    reincarnateClick(h2.ui, OK.x, OK.y);
    console.log(`"ZED  " accepted as ${JSON.stringify(h2.named?.name)}`);
    check(h2.named?.name === 'ZED', 'and are trimmed off the name that is kept');
  }
  {
    // The letter grid must reach the same state machine the keyboard does.
    const h = makeHarness(uiTables, ['HALK', 'BORIS']);
    openReincarnateScreen(h.ui, 1);
    // Z is row 2 col 4 (the third row starts at V), E and D are row 0 cols 4 and 3.
    for (const [col, row] of [[4, 2], [4, 0], [3, 0]] as const) {
      const { x, y } = cellCentre(col, row);
      reincarnateClick(h.ui, x, y);
    }
    console.log(`typed on the grid: ${JSON.stringify(h.ui.reincarnate?.name)}`);
    check(h.ui.reincarnate?.name === 'ZED', 'clicking Z, E, D on the grid types ZED');
  }

  finish();
}

main();
