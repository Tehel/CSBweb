/**
 * Every `OBJNI_*` constant, against the name it actually points at.
 *
 * `src/core/objectNameIndex.ts` is a hand-transcription of CSBWin's `OBJ_NAME_INDEX`
 * enum (`doc/CSBwin-src/Objects.h:438-659`), and that enum is commented in **hex**:
 *
 *     objNI_OpenChest,      //91
 *     objNI_Bones_a,        //93
 *
 * Nine of the constants had been read as decimal, or picked up from the wrong line.
 * `OBJNI_BONES_A` was 93 instead of 0x93 = 147, so the Altar of Vi never recognised a
 * champion's bones; `OBJNI_OPEN_CHEST` was 91 instead of 145, so an open chest drew
 * leg mail; and the five talismans that raise a mastery — Ekkhard Cross, Pendant
 * Feral, Moonstone, Gem of Ages, Sceptre of Lyf — were each off by two, as were both
 * Firestaff states by one. None of that is visible in `tsc`, and none of it is visible
 * on a frame: every constant is a plausible index into a table of 256 real names, and
 * the only thing that separates a right one from a wrong one is the **string** it
 * lands on.
 *
 * So that is what this checks. `graphics.dat` is the authority: it carries the name
 * table, the name at the index spells out which object it is, and a constant that
 * reads `LEG MAIL` where it should read `OPEN CHEST` cannot be defended. This is the
 * canary technique applied to a table of one-off constants rather than to an offset.
 *
 * What to look for in the output: every line's name should be recognisable as the
 * constant beside it. Two things read oddly and are correct. The `_A`/`_B` suffixes are
 * consecutive *charge states* of one object, and the name does not change between them
 * — three slots all saying `THE FIRESTAFF`, two saying `ILLUMULET` — so read each as a
 * group. And a few of CSBWin's enumerators are named for the item's powered form while
 * the table holds the plain one: `objNI_Storm_a` is `BOLT BLADE` and `objNI_RABlade_a`
 * is `FURY`, which is the same pairing Dungeon Master's manual prints.
 *
 * Run: `npx tsx tools/dump-object-name-index.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as OBJNI from '../src/core/objectNameIndex';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { check, finish } from './lib/check';
import { graphicsTablesOf } from './lib/game';

/**
 * The name `graphics.dat` must hold at each constant.
 *
 * Transcribed from `doc/CSBwin-src/Objects.h`, which spells every one of these out as
 * an enumerator: the expectation is the enumerator's own name, not a guess at what the
 * item ought to be called. `objNI_NotAnObject` is the one entry with no name behind it
 * — it is `0xff`, past the end of the table — so it is checked as a bound instead.
 */
const EXPECTED: Array<[keyof typeof OBJNI, string]> = [
  ['OBJNI_COMPASS_N', 'COMPASS'],
  ['OBJNI_COMPASS_W', 'COMPASS'],
  ['OBJNI_TORCH_A', 'TORCH'],
  ['OBJNI_TORCH_B', 'TORCH'],
  ['OBJNI_TORCH_C', 'TORCH'],
  ['OBJNI_TORCH_D', 'TORCH'],
  ['OBJNI_WATERSKIN', 'WATERSKIN'],
  ['OBJNI_WATER', 'WATER'],
  ['OBJNI_JEWEL_SYMAL_A', 'JEWEL SYMAL'],
  ['OBJNI_ILLUMULET_A', 'ILLUMULET'],
  ['OBJNI_ILLUMULET_B', 'ILLUMULET'],
  ['OBJNI_FLAMITT_A', 'FLAMITT'],
  ['OBJNI_EYE_OF_TIME_A', 'EYE OF TIME'],
  ['OBJNI_STORM_RING_A', 'STORMRING'],
  ['OBJNI_STAFF_OF_CLAWS_A', 'STAFF OF CLAWS'],
  ['OBJNI_STORM_A', 'BOLT BLADE'],
  ['OBJNI_RA_BLADE_A', 'FURY'],
  ['OBJNI_THE_FIRESTAFF_A', 'THE FIRESTAFF'],
  ['OBJNI_THE_FIRESTAFF_B', 'THE FIRESTAFF'],
  ['OBJNI_OPEN_SCROLL', 'OPEN SCROLL'],
  ['OBJNI_SCROLL', 'SCROLL'],
  ['OBJNI_SCEPTRE_OF_LYF', 'SCEPTRE OF LYF'],
  ['OBJNI_OPEN_CHEST', 'OPEN CHEST'],
  ['OBJNI_BONES_A', 'BONES'],
  ['OBJNI_ELVEN_BOOTS', 'ELVEN BOOTS'],
  ['OBJNI_GEM_OF_AGES', 'GEM OF AGES'],
  ['OBJNI_EKKHARD_CROSS', 'EKKHARD CROSS'],
  ['OBJNI_MOONSTONE', 'MOONSTONE'],
  ['OBJNI_PENDANT_FERAL', 'PENDANT FERAL'],
  ['OBJNI_FIRST_FULL_FLASK', 'MON POTION'],
  ['OBJNI_LAST_FULL_FLASK', 'WATER FLASK'],
  ['OBJNI_WATER_FLASK', 'WATER FLASK'],
  ['OBJNI_APPLE', 'APPLE'],
  ['OBJNI_DRAGON_STEAK', 'DRAGON STEAK'],
  ['OBJNI_EMPTY_FLASK', 'EMPTY FLASK'],
];

/**
 * The range markers, which name no object of their own.
 *
 * `objNI_FirstModifiableObject` and `objNI_LastModifiableObject` are aliases of
 * `objNI_Compass_N` and `objNI_Scroll` (`Objects.h:440`, `:472`), and `RN::NameIndex`
 * is one `if` over the pair (`doc/CSBwin-src/data.cpp:618-623`): an index inside it
 * gets the dynamic treatment — the compass turns with the party, a torch reads its
 * burn state — and one outside is returned as it stands. Get either end wrong and the
 * *other* objects misbehave, which is why they are pinned to their aliases rather than
 * to a name.
 */
const ALIASES: Array<[keyof typeof OBJNI, keyof typeof OBJNI]> = [
  ['OBJNI_FIRST_MODIFIABLE', 'OBJNI_COMPASS_N'],
  ['OBJNI_LAST_MODIFIABLE', 'OBJNI_SCROLL'],
];

function main(): void {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(
    new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))),
  );
  const objectTables = graphicsTablesOf(graphics).objects;
  const names = objectTables.objectNames;

  console.log(`graphics.dat holds ${names.length} object names`);
  console.log('');
  console.log(['constant', 'value', 'hex', 'name in graphics.dat', 'expected'].join('\t'));

  for (const [constant, expected] of EXPECTED) {
    const index = OBJNI[constant] as number;
    const actual = names[index] ?? '<out of range>';
    console.log(
      [constant, String(index), '0x' + index.toString(16).padStart(2, '0'), actual, expected].join('\t'),
    );
    check(actual === expected, `${constant} = ${index} should name ${expected}, not ${actual}`);
  }

  console.log('');
  console.log(['alias', 'value', 'aliases', 'value'].join('\t'));
  for (const [constant, target] of ALIASES) {
    const a = OBJNI[constant] as number;
    const b = OBJNI[target] as number;
    console.log([constant, String(a), target, String(b)].join('\t'));
    check(a === b, `${constant} is an alias of ${target} in CSBWin's enum`);
  }

  // `objNI_NotAnObject = 0xff` (`doc/CSBwin-src/Objects.h:659`) is the sentinel
  // `GetBasicObjectType` returns for something that is not an object at all, so it
  // must sit past every real name rather than on one.
  console.log('');
  console.log(`OBJNI_NOT_AN_OBJECT = ${OBJNI.OBJNI_NOT_AN_OBJECT} (names end at ${names.length - 1})`);
  check(OBJNI.OBJNI_NOT_AN_OBJECT === 0xff, 'OBJNI_NOT_AN_OBJECT is the 0xff sentinel');
  check(
    OBJNI.OBJNI_NOT_AN_OBJECT >= names.length,
    'and lands past the end of the name table, not on a real object',
  );

  // The strongest canary here. Every modifiable object owns two or three *consecutive*
  // slots that all carry the same string — the name does not change when the item is
  // charged, only the icon does (`doc/CSBwin-src/data.cpp:628-661`). So an `_a`
  // constant must be the **first** slot of such a run: its name repeats forwards and
  // differs from the slot before it. That is what an off-by-one cannot survive, and it
  // is what catches a slip inside a group, where the shared string alone would not.
  console.log('');
  console.log(['constant', 'value', 'name', 'previous', 'next'].join('\t'));
  const groupStarts: Array<keyof typeof OBJNI> = [
    'OBJNI_TORCH_A',
    'OBJNI_JEWEL_SYMAL_A',
    'OBJNI_ILLUMULET_A',
    'OBJNI_FLAMITT_A',
    'OBJNI_EYE_OF_TIME_A',
    'OBJNI_STORM_RING_A',
    'OBJNI_STAFF_OF_CLAWS_A',
    'OBJNI_STORM_A',
    'OBJNI_RA_BLADE_A',
    'OBJNI_THE_FIRESTAFF_A',
  ];
  for (const constant of groupStarts) {
    const i = OBJNI[constant] as number;
    console.log([constant, String(i), names[i], names[i - 1], names[i + 1]].join('\t'));
    check(names[i] === names[i + 1], `${constant} starts a run of same-named slots`);
    check(names[i] !== names[i - 1], `and ${constant} is the first of that run, not inside it`);
  }

  // The full-flask window is a range test in `RN::NameIndex` (`data.cpp:624-627`), so
  // both ends have to bracket flasks and nothing else.
  const first = OBJNI.OBJNI_FIRST_FULL_FLASK;
  const last = OBJNI.OBJNI_LAST_FULL_FLASK;
  console.log('');
  console.log(`full-flask window ${first}..${last}:`);
  for (let i = first; i <= last; i++) console.log(`  ${i}\t${names[i]}`);
  check(first < last, 'the full-flask window runs forwards');
  check(
    names.slice(first, last + 1).every((n) => /POTION|FLASK/.test(n ?? '')),
    'and every name inside it is a potion or a flask',
  );

  finish();
}

main();
