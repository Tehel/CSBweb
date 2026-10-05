/**
 * The DSA operations on texts (`DEBT.md` G1, the text family), each run through
 * `DsaSystem.execute` as a program of a test DSA on a genuine save (`csbgame7.dat`).
 *
 * 1. **`&TEXT@` and `&TEXTSAY`** (`doc/CSBwin-src/DSA.cpp:3168-3193`, `:3239-3252`): a text
 *    record decoded with `DecodeText(…, 0x8002, 999)` into one of the run's ten texts,
 *    and printed. Nothing for an index past 9, an object index out of the map, or an
 *    object that is no text; a text never set prints nothing.
 * 2. **`&CHARNAME@`** (`DSA.cpp:3204-3237`): the name of the first champion with the
 *    fingerprint, "" for nobody (the wings are `dump-wings.ts`'s).
 * 3. **`&GLOBALTEXT!`** (`DSA.cpp:3194-3202`, `SetGlobalText`, `CSBCode.cpp:5295-5307`):
 *    the text as an `EXPOOL` record, four bytes to a longword in memory order, which
 *    `DecodeText`'s `.R.` reads back.
 * 4. **`&SAY`** (`DSA.cpp:3137-3160`): the first text of a square, at any corner, printed;
 *    nothing for a location off the dungeon.
 * 5. **`PrintWithSubstitution`** (`Graphics.cpp:1540-1596`), which both print through:
 *    a linefeed first, one queue entry, `@p`, `@N` and "HUH???", the colour as a word.
 * 6. **`&DISCARDTEXT`** (`DSA.cpp:3161-3167`) empties the strip.
 *
 * Run: `npx tsx tools/dump-dsa-text.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, locationRelToInteger, type ObjectID } from '../src/core/types';
import { EDT_GLOBAL_TEXT } from '../src/data/DecodeText';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { printWithSubstitution } from '../src/engine/PrintWithSubstitution';
import { int, op, run } from './lib/dsa';
import { check, finish } from './lib/check';

let queued: Array<{ color: number; text: string }> = [];
let discarded = 0;

/** Catch what the game prints, and give it an attack menu open on the second champion. */
function listen(game: Game): void {
  queued = [];
  discarded = 0;
  game.ctx.host.messages.quePrintLines = (color, text) => { queued.push({ color, text }); };
  game.ctx.host.messages.discardText = () => { discarded++; };
  game.ctx.host.attackingCharacterOrdinal = () => 2;
}

function texts(game: Game): Array<{ rn: ObjectID; at: Position }> {
  const out: Array<{ rn: ObjectID; at: Position }> = [];
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getData().maps.length; z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const at = new Position(x, y, z);
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (dungeon.rnMaps.dbType(rn) === DBType.TEXT) out.push({ rn, at });
        }
      }
    }
  }
  return out;
}

/** The first object of the dungeon that is no text. */
function firstNonText(game: Game): ObjectID {
  const dungeon = game.ctx.dungeon;
  const map = dungeon.getMap(0)!;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      for (let rn = dungeon.findFirstObject(new Position(x, y, 0)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
        if (dungeon.rnMaps.dbType(rn) !== DBType.TEXT) return rn;
      }
    }
  }
  return OBJECT_ID_EOF;
}

const decoded = (game: Game, rn: ObjectID): string =>
  game.ctx.dungeon.decodeTextString(game.ctx.dungeon.getTextRecord(rn)!, 0x8002, game.ctx.tables.textDecode, 999)!;
const show = (): string => queued.map((q) => `${q.color}:${JSON.stringify(q.text)}`).join(' ') || '-';

console.log('1. &TEXT@ and &TEXTSAY');
{
  let first: { rn: ObjectID; at: Position } | null = null;
  let notText: ObjectID = OBJECT_ID_EOF;
  const { game } = run((g) => {
    first = texts(g)[0]!;
    notText = firstNonText(g);
    return [
      ...int(first.rn), ...int(3), op(StkOp.TEXT_FETCH),
      ...int(3), ...int(9), op(StkOp.TEXT_SAY),
      ...int(first.rn), ...int(10), op(StkOp.TEXT_FETCH),
      ...int(0), ...int(4), op(StkOp.TEXT_FETCH),
      ...int(notText), ...int(5), op(StkOp.TEXT_FETCH),
      ...int(4), ...int(9), op(StkOp.TEXT_SAY),
      ...int(5), ...int(9), op(StkOp.TEXT_SAY),
      ...int(10), ...int(9), op(StkOp.TEXT_SAY),
      ...int(-1), ...int(9), op(StkOp.TEXT_SAY),
    ];
  }, listen);
  console.log(`  text ${first!.rn} at L${first!.at.z} (${first!.at.x},${first!.at.y}): ${show()}`);
  check(queued.length === 1 && queued[0]!.color === 9 && queued[0]!.text === `\n${decoded(game, first!.rn)}`,
    'TEXT@ then TEXTSAY prints the decoded text once, a linefeed first, in colour 9');
  check(notText !== OBJECT_ID_EOF && game.ctx.dungeon.rnMaps.dbType(notText) !== DBType.TEXT, 'the third object is no text');
  check(queued.length === 1, 'index 10, object 0, an object that is no text, and texts 4, 5, 10 and -1 print nothing');
}
{
  run([...int(0), ...int(9), op(StkOp.TEXT_SAY)], listen);
  check(queued.length === 0, 'a run that set no text prints nothing for TEXTSAY 0');
}

console.log('2. &CHARNAME@');
{
  let names: string[] = [];
  run((g) => {
    const champions = g.ctx.party.state.champions;
    names = champions.map((c) => c.name);
    return [
      ...int(champions[1]!.fingerprint), ...int(2), op(StkOp.CHAR_NAME_FETCH),
      ...int(2), ...int(4), op(StkOp.TEXT_SAY),
      ...int(champions[1]!.fingerprint | 0x10000), ...int(0x10003), op(StkOp.CHAR_NAME_FETCH),
      ...int(3), ...int(4), op(StkOp.TEXT_SAY),
      ...int(0xbeef), ...int(2), op(StkOp.CHAR_NAME_FETCH),
      ...int(2), ...int(4), op(StkOp.TEXT_SAY),
    ];
  }, listen);
  console.log(`  party ${names.join(', ')}: ${show()}`);
  check(queued.length === 2 && queued[0]!.text === `\n${names[1]}` && queued[1]!.text === `\n${names[1]}`,
    'the second champion\'s fingerprint names them; both operands are taken as words');
  check(queued.length === 2, 'a fingerprint that is nobody sets "", which prints nothing');
}

console.log('3. &GLOBALTEXT!');
{
  let name = '';
  const { game } = run((g) => {
    name = g.ctx.party.state.champions[0]!.name;
    return [
      ...int(g.ctx.party.state.champions[0]!.fingerprint), ...int(0), op(StkOp.CHAR_NAME_FETCH),
      ...int(0), ...int(0x1007b), op(StkOp.GLOBAL_TEXT_STORE),
      ...int(6), ...int(0x100), op(StkOp.GLOBAL_TEXT_STORE),
    ];
  }, listen);
  const key = (index: number): number => ((EDT_GLOBAL_TEXT << 24) | index) >>> 0;
  const rec = game.ctx.dungeon.locateExpoolRecord(key(0x7b));
  const bytes = rec ? rec.flatMap((w) => [0, 1, 2, 3].map((k) => (w >>> (8 * k)) & 0xff)) : [];
  console.log(`  "${name}" -> ${rec?.map((w) => w.toString(16).padStart(8, '0')).join(' ') ?? 'no record'}`);
  check(rec !== null && rec.length === Math.floor((name.length + 4) / 4), 'the record is (len + 4) / 4 longwords, at the index taken as a word');
  check(String.fromCharCode(...bytes.slice(0, name.length)) === name && bytes[name.length] === 0,
    'its bytes are the name and a zero, the first in the low byte');
  check(game.ctx.dungeon.textSubstitution!.globalText(0x7b)?.join() === rec?.join(), 'DecodeText\'s .R.AAHL reads it');
  check(game.ctx.dungeon.locateExpoolRecord(key(0x100))?.join() === '0', 'a text never set is one longword, 0');
}

console.log('4. &SAY');
{
  let target: { rn: ObjectID; at: Position } | null = null;
  const { game } = run((g) => {
    target = texts(g).find((t) => t.at.z === g.ctx.party.state.position.z) ?? texts(g)[0]!;
    const at = target.at;
    return [
      ...int(locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 3 })), ...int(15), op(StkOp.SAY),
      ...int(locationRelToInteger({ l: 63, x: at.x, y: at.y, p: 0 })), ...int(15), op(StkOp.SAY),
    ];
  }, listen);
  console.log(`  L${target!.at.z} (${target!.at.x},${target!.at.y}): ${show()}`);
  let first = game.ctx.dungeon.findFirstObject(target!.at);
  while (game.ctx.dungeon.rnMaps.dbType(first) !== DBType.TEXT) first = game.ctx.dungeon.getDBRecordLink(first);
  check(queued.length === 1 && queued[0]!.color === 15 && queued[0]!.text === `\n${decoded(game, first)}`,
    'SAY prints the square\'s first text, whatever corner the location names');
  check(queued.length === 1, 'a location off the dungeon prints nothing');
}

console.log('5. PrintWithSubstitution');
{
  const { game } = run([], listen);
  const second = game.ctx.party.state.champions[1]!.name;
  const cases: Array<[string, number, string | null]> = [
    ['@p HITS', 2, `\n${second}  HITS`],
    ['A@NB', 2, '\nA \nHUH??? B'],
    ['@p@N', 2, `\n${second}  \n `],
    ['@x', 2, '\nHUH??? '],
    ['X@', 2, '\nX HUH??? '],
    ['@p', 0, '\n '],
    ['', 2, null],
  ];
  for (const [txt, ordinal, want] of cases) {
    queued = [];
    game.ctx.host.attackingCharacterOrdinal = () => ordinal;
    printWithSubstitution(game.ctx, txt, 0x10009);
    console.log(`  ${JSON.stringify(txt)} (menu ${ordinal}): ${show()}`);
    check(want === null ? queued.length === 0 : queued.length === 1 && queued[0]!.text === want && queued[0]!.color === 9,
      `${JSON.stringify(txt)} gives ${JSON.stringify(want)}, colour 0x10009 as the word 9`);
  }
}

console.log('6. &DISCARDTEXT');
run([op(StkOp.DISCARD_TEXT)], listen);
check(discarded === 1, 'DISCARDTEXT empties the strip once');

finish();
