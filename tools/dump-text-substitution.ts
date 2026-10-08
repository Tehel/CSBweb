/**
 * `SubstituteCharacterNames`, the end of every `DecodeText`
 * (`doc/CSBwin-src/CSBCode.cpp:5432-5547`, called at `:5731`).
 *
 * 1. **The rules**, on texts built here: `.Q.A` is the champion holding the cursor,
 *    `.Q.B` to `.Q.E` the first to fourth, `.Q.F` to `.Q.K` nothing; `.R.` and four
 *    digits from `A` to `P` a global text, read from its `EXPOOL` record's bytes in
 *    memory order; `.N.` and two a global variable in decimal. A failed substitution ends
 *    the text there, which is `DecodeText`'s -1. A wall text is looked at only when it
 *    has a `.Q.`, and is substituted in codes.
 * 2. **Conflux** names its companion `.R.AAHL`, global text 123, in 224 decodings of its
 *    texts. Through a `Game`: with the record, its scroll reads the name; without it,
 *    the text stops before it, and the floor message, which checks for -1, is not queued.
 * 3. **The default dungeon** has no such text: every text decodes the same with the
 *    substitution as without it, at every type.
 *
 * Run: `npx tsx tools/dump-text-substitution.ts`
 */
import { readFileSync } from 'node:fs';

import { DecodeText, EDT_GLOBAL_TEXT, SubstituteCharacterNames, type TextSubstitution } from '../src/data/DecodeText';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { Expool } from '../src/data/CsbwinExpool';
import { check, finish } from './lib/check';
import { gameTablesOf, newGame, stockGraphics, stockDungeon } from './lib/game';

const ascii = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)).concat(0));
const text = (b: Uint8Array): string => String.fromCharCode(...b.slice(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)));
/** A global text's record: its bytes four to a longword, the first in the low byte. */
const record = (s: string): number[] => {
  const bytes = [...s].map((c) => c.charCodeAt(0)).concat(0);
  return Array.from({ length: Math.floor((s.length + 4) / 4) }, (_, w) =>
    [0, 1, 2, 3].reduce((v, k) => v | ((bytes[w * 4 + k] ?? 0) << (8 * k)), 0) >>> 0);
};

const world: TextSubstitution = {
  handChar: () => 1,
  characterName: (i) => ['HALK', 'SYRA', 'WUUF'][i] ?? null,
  globalText: (i) => (i === 0x7b ? record('RAAHL') : i === 0x0100 ? record('LONGER THAN FOUR') : null),
  globalVariable: (i) => (i < 100 ? [7, -42][i] ?? 0 : null),
};

function sub(s: string, w: TextSubstitution = world, max = 990): { text: string; ok: boolean } {
  const r = SubstituteCharacterNames(ascii(s), max, false, w);
  return { text: text(r.text), ok: r.ok };
}

console.log('1. The rules');
const cases: Array<[string, string, boolean, TextSubstitution?]> = [
  ['NO SUBSTITUTION. HERE.', 'NO SUBSTITUTION. HERE.', true],
  ['.Q.A HOLDS IT', 'SYRA HOLDS IT', true],
  ['.Q.A HOLDS IT', '', false, { ...world, handChar: () => -1 }],
  ['.Q.B.Q.C.Q.D', 'HALKSYRAWUUF', true],
  ['X .Q.E Y', 'X ', false],
  ['A.Q.FB.Q.KC', 'ABC', true],
  ['.Q.L STAYS', '.Q.L STAYS', true],
  ['.R.AAHL S VISION', 'RAAHL S VISION', true],
  ['TO .R.AAHL.', 'TO RAAHL.', true],
  ['GO .R.ABAA', 'GO LONGER THAN FOUR', true],
  ['NO .R.AAAA HERE', 'NO ', false],
  ['.R.AAHZ STAYS', '.R.AAHZ STAYS', true],
  ['.N.AA AND .N.AB', '7 AND -42', true],
  ['.N.GE', '', false],
  ['..Q.B.', '.HALK.', true],
];
for (const [input, want, ok, w] of cases) {
  const got = sub(input, w);
  console.log(`  ${JSON.stringify(input)} -> ${JSON.stringify(got.text)}${got.ok ? '' : ' (-1)'}`);
  check(got.text === want && got.ok === ok, `${JSON.stringify(input)} gives ${JSON.stringify(want)}, ok ${ok}`);
}
// The column stops at `max` for a substitution, at `max - 1` for a plain byte.
check(sub('.Q.B.Q.C', world, 6).text === 'HALKSY', 'a name stops at the column limit');
check(sub('ABCDEFGH.Q.B', world, 6).text === 'ABCDEH', 'a plain byte stops one short of the limit, a name at it');
// A wall text: codes, 27 for '.', looked at only with a `.Q.` in it.
const codes = (s: string): Uint8Array =>
  Uint8Array.from([...s].map((c) => (c === '.' ? 27 : c === ' ' ? 26 : c.charCodeAt(0) - 65)).concat(0x81));
const wall = (s: string): number[] => Array.from(SubstituteCharacterNames(codes(s), 990, true, world).text);
check(wall('.R.AAHL WALL').join() === Array.from(codes('.R.AAHL WALL')).join(), 'a wall text with no .Q. is left as it is');
check(wall('.Q.B .R.AAHL').join() === Array.from(codes('HALK RAAHL')).join(), 'a wall text with a .Q. is substituted in codes');

console.log('2. Conflux, through a Game');
const conflux = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync('static/gamefiles/conflux-3.5-b8/dungeon.dat')));
const game = newGame(conflux, stockGraphics());
const dungeon = game.ctx.dungeon;
const tables = game.ctx.tables.textDecode;
const rec = dungeon.getData().databases.texts.records[4]!;
const bare = dungeon.decodeText(rec, 0x8002, 990, tables)!;
console.log(`  without global text 123: ${JSON.stringify(text(bare.text))}${bare.ok ? '' : ' (-1)'}`);
check(text(bare.text) === '' && !bare.ok, 'text 4 stops at .R.AAHL and returns -1');
check(dungeon.decodeMessageText(rec, tables) === null, 'the floor message is not printed when DecodeText returns -1');
new Expool(dungeon.getData()).write(((EDT_GLOBAL_TEXT << 24) | 0x7b) >>> 0, record('RAAHL'));
const full = dungeon.decodeText(rec, 0x8002, 990, tables)!;
console.log(`  with it: ${JSON.stringify(text(full.text))}`);
check(text(full.text) === 'RAAHL S VISION IS VEILED. THE DEPTH OF THE PIT IS A MYSTERY.' && full.ok,
  'text 4 reads the global text');
check(dungeon.decodeMessageText(rec, tables) === '\nRAAHL S VISION IS VEILED. THE DEPTH OF THE PIT IS A MYSTERY.',
  'the floor message carries the name');

console.log('3. The default dungeon');
const dm = newGame(stockDungeon(), stockGraphics());
const dmTables = gameTablesOf(stockGraphics()).textDecode;
const dmData = dm.ctx.dungeon.getData();
let same = 0;
for (const r of dmData.databases.texts.records) {
  for (const type of [0, 1, 0x8001, 0x8002]) {
    const plain = DecodeText(dmData, r, type, 990, dmTables);
    const decoded = dm.ctx.dungeon.decodeText(r, type, 990, dmTables);
    if ((plain === null) !== (decoded === null)) continue;
    if (plain && decoded && (!decoded.ok || plain.join() !== decoded.text.join())) continue;
    same++;
  }
}
console.log(`  ${same} of ${dmData.databases.texts.records.length * 4} decodings unchanged`);
check(same === dmData.databases.texts.records.length * 4, 'every text of dm-atari decodes as it did');

finish();
