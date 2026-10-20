/**
 * Read genuine CSBWin save files and prove the reader understands them.
 *
 * Every other save-game tool in this directory tests the port against itself:
 * `dump-savegame.ts` round-trips the runtime JSON snapshot, and
 * `dump-savegame-blocks.ts` round-trips our own binary writer through our own binary
 * reader. Neither can catch the failure that matters for a save CSBWin must open — a
 * self-consistent format that no CSBWin would recognise. That is not hypothetical: the
 * blocks were once written little-endian, round-tripped perfectly, and were wrong (see
 * the header of `dump-savegame-blocks.ts`).
 *
 * This tool is the other kind of evidence. It reads real files, produced by the real
 * program, that this project did not write. It cannot be satisfied by a bug that is
 * symmetrical between our reader and our writer.
 *
 * What a pass actually proves, because every scrambled block is checksum-verified as
 * it is unscrambled (`unscrambleStream`, and `readUnscrambleBlock` for GAMEBLOCK1):
 * the scramble keystream, the hash arithmetic, the big-endian word order and every
 * block offset and size are all right. A single wrong byte anywhere in a block fails
 * its checksum and throws.
 *
 * The files live in `tools/fixtures/` (`tools/lib/saves.ts`), with Chaos Strikes Back's
 * two in its own folder, and are read-only inputs — the tool never writes to them.
 *
 * Run: `npm test -- --only=dump-csbwin-save.ts [path-or-directory]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { specialLocationsFromExpool } from '../src/data/CsbwinExpool';
// The CHARDESC offsets and the name decode are shared with the save/load menu, which
// lists genuine saves the same way; `src/data/CsbwinSaveInfo.ts` carries their proof.
import {
  CHARDESC_SIZE,
  CHARDESC_NAME_OFFSET as NAME_OFFSET,
  CHARDESC_NAME_SIZE as NAME_SIZE,
  CHARDESC_TITLE_OFFSET as TITLE_OFFSET,
  CHARDESC_TITLE_SIZE as TITLE_SIZE,
  decodeCharField,
} from '../src/data/CsbwinSaveInfo';
import { check, finish } from './lib/check';
import { SAVE_DIR, collectSaves, genuineSaves } from './lib/saves';
import { readU16BE } from '../src/core/bytes';
import { OBJECT_ID_NULL } from '../src/core/types';

const DB_NAMES = ['door', 'telep', 'text', 'actuator', 'creature', 'weapon', 'clothing',
  'scroll', 'potion', 'container', 'misc', 'EXPOOL', 'db12', 'db13', 'missile', 'cloud'];

/**
 * Chaos Strikes Back's own files, read beside DM's by default: Atari-era saves with no
 * Extended Features block (`tools/dump-atari-saves.ts`).
 */
const CSB_SAVES = ['mini.dat', 'csbgame2.dat'].map((n) => `static/gamefiles/csb/${n}`);

function main(): void {
  const saves = process.argv[2]
    ? collectSaves(process.argv[2])
    : [...genuineSaves(), ...CSB_SAVES.flatMap(collectSaves)];
  if (saves.length === 0) {
    // The fixtures are committed, so this should not happen; if someone strips the
    // game files it must say so rather than pass silently on nothing.
    check(false, `no save files found in ${process.argv[2] ?? SAVE_DIR}`);
    finish();
    return;
  }
  /** file name -> the party roster read out of its character block. */
  const rosters = new Map<string, string>();
  /** file name -> the object ids of its in-flight missiles. */
  const liveMissiles = new Map<string, number[]>();
  /** file name -> `gb2.ObjectInHand`, where something is on the cursor. */
  const onCursor = new Map<string, number>();

  for (const path of saves) {
    const bytes = new Uint8Array(readFileSync(path));
    // CSB's `csbgame2.dat` shares a name with DM's, and the rosters are keyed by name.
    const base = path.split('/').pop() ?? path;
    const name = CSB_SAVES.some((p) => resolve(p) === path) ? `CSB ${base}` : base;
    console.log(`\n=== ${name} — ${bytes.length} bytes ===`);

    let state;
    try {
      state = loadSaveGameState(bytes);
    } catch (error) {
      check(false, `${name}: should load — ${(error as Error).message}`);
      continue;
    }
    check(true, `${name}: every block unscrambled and checksummed clean`);
    // The missiles and the special locations are the image's, read by `DungeonLoader`.
    let world;
    try {
      world = loadCsbwinWorld(bytes);
    } catch {
      world = undefined;
    }
    const missiles = world?.dungeon.databases.missiles.records;
    const specialLocations = world?.dungeon.expool ? specialLocationsFromExpool(world.dungeon.expool) ?? undefined : undefined;

    console.log(`  extended features  : sequencedTimers=${state.sequencedTimers} ` +
      `extendedTimers=${state.extendedTimers} bigActuators=${state.bigActuators ?? false} ` +
      `extendedWallDecorations=${state.extendedWallDecorations ?? false}`);
    console.log(`  DSA programs       : ${state.dsaIndex?.entries.filter(Boolean).length ?? 0}`);
    console.log(`  DSA level index    : ${state.dsaLevelIndex ? 'present' : 'absent'}`);
    console.log(`  spellFilterLocation: ${state.spellFilterLocation ?? '—'}`);
    console.log(`  MaxITEM16          : ${state.maxItem16}`);
    console.log(`  MaxTimers          : ${state.maxTimers}`);
    console.log(`  handChar           : ${state.handChar}`);
    console.log(`  magicCaster        : ${state.magicCaster}`);
    console.log(`  missile records    : ${missiles === undefined ? 'unreadable (see below)' : missiles.length}`);
    console.log(`  special locations  : ${specialLocations === undefined ? 'unreadable (see below)' : Object.keys(specialLocations).length}`);

    const gb2 = state.block2;
    if (gb2) {
      console.log(`  party              : (${gb2.partyX},${gb2.partyY}) level ${gb2.partyLevel} ` +
        `facing ${gb2.partyFacing}, ${gb2.numCharacter} champions`);
      console.log(`  clock / seed       : Time=${gb2.time} ranseed=${gb2.ranseed}`);
      console.log(`  objectInHand       : 0x${gb2.objectInHand.toString(16)}` +
        (gb2.objectInHand === 0xffff ? ' (empty hand)' : ''));
      if (gb2.objectInHand !== 0xffff) onCursor.set(name, gb2.objectInHand);
      console.log(`  NumTimer           : ${gb2.numTimer} (firstAvail ${gb2.firstAvailTimer}, ` +
        `sequence ${gb2.timerSequence})`);
      console.log(`  ITEM16QueLen       : ${gb2.item16QueLen}`);
      check(gb2.numCharacter >= 1 && gb2.numCharacter <= 4, `${name}: numcharacter ${gb2.numCharacter} is 1..4`);
      check(gb2.partyLevel >= 0 && gb2.partyLevel < 64, `${name}: partyLevel ${gb2.partyLevel} is plausible`);
      check(gb2.partyFacing >= 0 && gb2.partyFacing <= 3, `${name}: partyFacing ${gb2.partyFacing} is a direction`);
      check(gb2.partyX >= 0 && gb2.partyX < 32, `${name}: partyX ${gb2.partyX} is in range`);
      check(gb2.partyY >= 0 && gb2.partyY < 32, `${name}: partyY ${gb2.partyY} is in range`);
    } else {
      check(false, `${name}: GAMEBLOCK2 should have been parsed`);
    }

    const block = state.characterBlock;
    if (block) {
      check(block.length === 3328, `${name}: the character block is 3328 bytes`);
      const roster: string[] = [];
      for (let i = 0; i < 4; i++) {
        const base = i * CHARDESC_SIZE;
        const champName = decodeCharField(block.subarray(base + NAME_OFFSET, base + NAME_OFFSET + NAME_SIZE));
        const title = decodeCharField(block.subarray(base + TITLE_OFFSET, base + TITLE_OFFSET + TITLE_SIZE));
        roster.push(champName);
        console.log(`  champion ${i}         : ${champName || '(empty)'}${title ? ` — ${title}` : ''}`);
      }
      const named = roster.filter((n) => n.length > 0).length;
      check(
        named === (gb2?.numCharacter ?? named),
        `${name}: ${named} champions have names, GAMEBLOCK2 says ${gb2?.numCharacter}`,
      );
      // A name decoded out of the wrong bytes would be full of '?' substitutions.
      check(
        roster.slice(0, gb2?.numCharacter ?? 0).every((n) => n.length > 0 && !n.includes('?')),
        `${name}: every champion name is printable ASCII`,
      );
      rosters.set(name, roster.slice(0, gb2?.numCharacter ?? 4).join('/'));
    } else {
      check(false, `${name}: the character block should have been kept`);
    }

    // ---- The dungeon image (blocks 7-14) --------------------------------
    //
    // `LoadGame` calls `ReadDatabases()` immediately after the timer queue
    // (`doc/CSBwin-src/SaveGame.cpp:1909`). A save is loaded with
    // `d.gameState == GAMESTATE_ResumeSavedGame`, so that function skips its own
    // extended-features/compression preamble (`:2557-2558`) and streams straight on
    // from the current file position: the image is plain, uncompressed, big-endian.
    const image = state.dungeonImageOffset;
    if (image !== undefined) {
      const seed = readU16BE(bytes, image);
      const numMaps = bytes[image + 4] ?? 0;
      const objectListSize = readU16BE(bytes, image + 10);
      const counts = Array.from({ length: 16 }, (_, i) => readU16BE(bytes, image + 12 + i * 2));
      console.log(`  dungeon image      : offset ${image}, ${bytes.length - image} bytes to EOF`);
      console.log(`    header           : seed=${seed} numMaps=${numMaps} objectListSize=${objectListSize}`);
      console.log(`    record counts    : ${counts.map((c, i) => (c ? `${DB_NAMES[i]}=${c}` : '')).filter(Boolean).join(' ')}`);
      // The header is the proof that the offset is right: a save of DM carries
      // `dungeon.dat`'s own 44-byte DUNGEONDATINDEX, seed and all.
      check(seed === 99 || seed === 13 || seed === 8, `${name}: dungeon image seed ${seed} is a known dungeon`);
      check(numMaps >= 1 && numMaps <= 32, `${name}: dungeon image numMaps ${numMaps} is plausible`);
      check(objectListSize > 0, `${name}: dungeon image has a non-empty object list`);
      check(
        counts.reduce((a, b) => a + b, 0) > 0,
        `${name}: dungeon image has database records`,
      );
    } else {
      check(false, `${name}: the dungeon image offset should have been recorded`);
    }

    // The layout closure check, and the whole point of the exercise: the image's last
    // section is the cell flags, whose length the extended block declares, and after it
    // comes only `WriteAndChecksum`'s final word (`doc/CSBwin-src/SaveGame.cpp:1320`).
    // If every section length from the header to the last database is right, the sum
    // lands exactly on `EOF - 2`. One wrong record size anywhere and it does not.
    const layout = state.imageLayout;
    if (layout && state.cellFlagArraySize) {
      const end = layout.cellFlags + state.cellFlagArraySize;
      console.log(`    cell flags       : ${layout.cellFlags}..${end}, EOF-2 = ${bytes.length - 2}`);
      check(
        end === bytes.length - 2,
        `${name}: the image layout closes on the final checksum word (got ${end}, want ${bytes.length - 2})`,
      );
    } else {
      check(false, `${name}: the dungeon image layout should have been computed`);
    }

    check(missiles !== undefined, `${name}: the missile database should parse`);
    if (missiles) {
      // A record is free when its link is `RNnul`, CSBWin's own test
      // (`doc/CSBwin-src/data.cpp:948`, `:962`). The pool is always allocated at full
      // size, 60 records whatever is happening on screen, and a free record's other
      // words are whatever was left in them, so they say nothing about it.
      const live = missiles.filter((m) => m.nextObject !== OBJECT_ID_NULL);
      console.log(`    missiles in flight: ${live.length} of ${missiles.length} pool slots`);
      for (const m of live) {
        console.log(`      projectile=0x${m.projectileObject.toString(16)} range=${m.rangeRemaining} ` +
          `damage=${m.damageRemaining} timer=${m.timerIndex}`);
      }
      const gb = state.block2;
      if (gb && live.length > 0) {
        check(
          live.every((m) => m.timerIndex < gb.maxTimers),
          `${name}: every in-flight missile points at a timer inside the table`,
        );
      }
      liveMissiles.set(name, live.map((m) => m.projectileObject));
    }

    const liveGroups = state.item16.filter((r) => r.word0 !== 0).length;
    console.log(`  active monster groups: ${liveGroups} of ${state.item16.length}`);
    const liveTimers = (state.timers ?? []).filter((t) => t.timerWord8 !== 0).length;
    console.log(`  timers with word8 set: ${liveTimers} of ${state.timers?.length ?? 0}`);

    // Sanity on the numbers themselves. A block that checksums clean but decodes to
    // nonsense would mean the checksum is being computed over the wrong bytes.
    check(state.maxItem16 > 0 && state.maxItem16 < 4096, `${name}: MaxITEM16 ${state.maxItem16} is plausible`);
    check(state.maxTimers > 0 && state.maxTimers < 4096, `${name}: MaxTimers ${state.maxTimers} is plausible`);
    check(state.item16.length === state.maxItem16, `${name}: the ITEM16 pool is MaxITEM16 records long`);
    check(
      (state.timers?.length ?? 0) === state.maxTimers,
      `${name}: the timer table is MaxTimers records long`,
    );
    check(
      (state.handChar ?? -1) >= -1 && (state.handChar ?? -1) <= 3,
      `${name}: handChar ${state.handChar} is a champion index or -1`,
    );
    check(
      (state.magicCaster ?? -1) >= -1 && (state.magicCaster ?? -1) <= 3,
      `${name}: magicCaster ${state.magicCaster} is a champion index or -1`,
    );
  }

  // The rosters, grouped. Two saves of the same party read as the same roster only if
  // the character block was located and decoded identically in both, which is a
  // stronger statement than either file passing on its own.
  if (rosters.size > 1) {
    console.log('\nparty rosters');
    const byRoster = new Map<string, string[]>();
    for (const [file, roster] of rosters) {
      const list = byRoster.get(roster) ?? [];
      list.push(file);
      byRoster.set(roster, list);
    }
    for (const [roster, files] of byRoster) {
      console.log(`  ${files.join(', ')}\n    ${roster}`);
    }
  }

  // An object held on the cursor in one save and in flight in another is the same
  // object id in `gb2.ObjectInHand` and in a MISSILE record's `projectileObject`.
  // Two files that only differ by "the sword was thrown" prove both fields at once.
  const held = new Set<number>();
  for (const ids of onCursor.values()) held.add(ids);
  const thrown = new Set<number>();
  for (const ids of liveMissiles.values()) for (const id of ids) thrown.add(id);
  const both = [...held].filter((id) => thrown.has(id));
  if (both.length > 0) {
    console.log(`\nheld then thrown: ${both.map((id) => `0x${id.toString(16)}`).join(', ')}`);
    console.log('  (the same object id read out of GAMEBLOCK2 in one save and out of the');
    console.log('   MISSILE database in another — both fields decoded correctly)');
  }

  finish();
}

main();
