/**
 * Pack block 4 and hold it up against the real thing, byte for byte.
 *
 * The save *writer* used to emit 3328 zero bytes here — nothing of the champions or the
 * party state (`doc/CSBWIN_SAVEGAME_REFERENCE.md`, "How much of this the port writes
 * today"). This is the check that the packer put back is CSBWin's own layout and not a
 * self-consistent invention: for every committed save, read block 4, write it again
 * from the champions that came out, and compare with the bytes the file actually holds.
 *
 * It is the same argument `tools/dump-savegame-blocks.ts` makes for blocks 2, 3, 5 and
 * 6 — except sharper, because nothing here is symmetrical between our reader and our
 * writer: the file was written by CSBWin. A field packed at the wrong offset, in the
 * wrong width or the wrong byte order shows up as a diff, and so does a field the
 * reader silently drops on the way through.
 *
 * The champions are read **without** a `CsbwinObjectIndex`, so their thirty possession
 * slots stay the indirect slot numbers the file holds rather than being resolved into
 * this port's packed object ids. That is deliberate: re-encoding them needs the
 * `dataTypeMap`/`dataIndexMap` that come with the dungeon image, which the writer does
 * not produce yet. Everything else is compared exactly as it stands.
 *
 * Run: `npm test -- --only=dump-character-block.ts [path-or-directory]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CHARACTER_BLOCK_SIZE,
  buildCsbwinCharacterBlock,
  readCsbwinCharacter,
  readCsbwinPartyTail,
} from '../src/data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../src/data/CsbwinSaveInfo';
import { loadSaveGameState, saveSaveGameState } from '../src/data/SaveGameLoader';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { applyCsbwinSave, buildCsbwinRuntimeState } from '../src/engine/CsbwinSaveGame';
import type { Champion } from '../src/engine/gameTypes';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { newGame, stockGraphics, stockDungeon } from './lib/game';
import { check, finish } from './lib/check';
import { genuineSaves, savePath } from './lib/saves';

/** The one save the live-game cases below are built from. */
const FIXTURE = savePath('csbgame7.dat');

/** Which `CHARDESC` field an offset falls in, for a diff a human can read. */
const FIELDS: Array<[number, number, string]> = [
  [0, 8, 'name'], [8, 28, 'title'], [28, 29, 'facing'], [29, 30, 'charPosition'],
  [30, 31, 'byte30'], [31, 32, 'byte31'], [32, 33, 'attackType'], [33, 34, 'byte33'],
  [34, 38, 'incantation'], [38, 40, 'FILL38'], [40, 41, 'facing3'],
  [41, 42, 'maxRecentDamage'], [42, 43, 'poisonCount'], [43, 44, 'uByte43'],
  [44, 46, 'busyTimer'], [46, 48, 'timerIndex'], [48, 50, 'charFlags'], [50, 52, 'ouches'],
  [52, 54, 'HP'], [54, 56, 'MaxHP'], [56, 58, 'Stamina'], [58, 60, 'MaxStamina'],
  [60, 62, 'Mana'], [62, 64, 'MaxMana'], [64, 66, 'word64'], [66, 68, 'food'],
  [68, 70, 'water'], [70, 91, 'Attributes'], [91, 92, 'FILL91'], [92, 212, 'skills'],
  [212, 272, 'possessions'], [272, 274, 'load'], [274, 276, 'shieldStrength'],
  [276, 280, 'talents'], [280, 282, 'fingerPrint'], [282, 284, 'causeOfDamage'],
  [284, 286, 'monsterCausingDamage'], [286, 336, 'FILL286'], [336, 800, 'portrait'],
];

function fieldAt(offset: number): string {
  if (offset >= 4 * CHARDESC_SIZE) {
    const tail = offset - 4 * CHARDESC_SIZE;
    if (tail < 14) return `tail+${tail}`;
    if (tail < 62) return 'footprints';
    if (tail < 86) return 'footprintAges';
    if (tail === 86) return 'invisible';
    return 'Byte13195';
  }
  const within = offset % CHARDESC_SIZE;
  const champion = Math.floor(offset / CHARDESC_SIZE);
  const field = FIELDS.find(([from, to]) => within >= from && within < to);
  return `champion ${champion} ${field ? field[2] : `+${within}`}`;
}

function main(): void {
  const saves = genuineSaves(process.argv[2]);
  check(saves.length > 0, 'there should be save files to read');

  for (const path of saves) {
    const name = path.split('/').pop() ?? path;
    const state = loadSaveGameState(new Uint8Array(readFileSync(path)));
    const original = state.characterBlock;
    const numCharacter = state.block2?.numCharacter ?? 0;
    if (!original) { check(false, `${name}: should carry a character block`); continue; }
    check(original.length === CHARACTER_BLOCK_SIZE, `${name}: block 4 is 3328 bytes`);

    // Read exactly what the file holds — no object index, so the possession slots stay
    // the file's own indirect indices.
    const champions: Champion[] = [];
    for (let i = 0; i < numCharacter; i++) {
      const character = readCsbwinCharacter(original, i);
      if (character.occupied) champions.push(character.champion);
    }
    const tail = readCsbwinPartyTail(original);
    const written = buildCsbwinCharacterBlock(champions, tail);

    const diffs = new Map<string, number>();
    for (let i = 0; i < CHARACTER_BLOCK_SIZE; i++) {
      if (written[i] !== original[i]) {
        const field = fieldAt(i);
        diffs.set(field, (diffs.get(field) ?? 0) + 1);
      }
    }
    const summary = [...diffs].map(([field, count]) => `${field} (${count})`).join(', ');
    console.log(`${name.padEnd(32)} ${champions.length} champions — ` +
      (diffs.size === 0 ? 'byte-identical' : `DIFFERS: ${summary}`));
    check(diffs.size === 0, `${name}: the packed block 4 is the file's own bytes${summary ? ` — ${summary}` : ''}`);

    // And the semantic round trip, which catches a field both halves get wrong the
    // same way only if it also moved: read the block we wrote and compare champions.
    for (let i = 0; i < champions.length; i++) {
      const back = readCsbwinCharacter(written, i).champion;
      check(
        JSON.stringify(back) === JSON.stringify(champions[i]),
        `${name}/${champions[i].name}: survives a pack/unpack round trip`,
      );
    }
    check(
      JSON.stringify(readCsbwinPartyTail(written)) === JSON.stringify(tail),
      `${name}: and so does the party tail`,
    );
  }

  /* ---- the paths a live game takes, which no committed save can exercise ---- */

  const state = loadSaveGameState(new Uint8Array(readFileSync(resolve(FIXTURE))));
  const original = state.characterBlock!;
  const tail = readCsbwinPartyTail(original);
  const champion = readCsbwinCharacter(original, 0).champion;

  // 1. A champion the *engine* created carries `portraitGraphic` and no pixels, so the
  //    writer asks for them. `AddCharacter` does this blit at the moment the champion
  //    joins (`doc/CSBwin-src/Character.cpp:487-496`); the port does it here instead.
  const indexed: Champion = { ...champion, portrait: undefined, portraitGraphic: 7 };
  const fromIndex = buildCsbwinCharacterBlock([indexed], tail, {
    portraitOf: (c) => (c.portraitGraphic === 7 ? champion.portrait : undefined),
  });
  check(
    Array.from(fromIndex.subarray(336, 800)).join(',') ===
      Array.from(original.subarray(336, 800)).join(','),
    'a champion with only a portrait index is written with the pixels the caller resolves',
  );
  const blank = buildCsbwinCharacterBlock([indexed], tail);
  check(
    blank.subarray(336, 800).every((b) => b === 0),
    'and with a blank portrait when nothing resolves it, as ClearMemory leaves it',
  );

  // 2. `CHARDESC.load` is CSBWin's incremental total; this port re-sums it, so the
  //    writer takes a function. Without one the champion's own carries.
  const weighed = buildCsbwinCharacterBlock([champion], tail, { load: () => 1234 });
  check(
    ((weighed[272] << 8) | weighed[273]) === 1234,
    'the load callback wins over the field the save was read with',
  );

  // 3. The two byte-preservation fields must never outlive the values they mirror.
  //    A champion renamed on the reincarnate screen, or one who has typed a rune since
  //    the save was read, has to be written from the *string* and the *array*.
  const renamed: Champion = { ...champion, title: 'THE NEW TITLE' };
  const afterRename = buildCsbwinCharacterBlock([renamed], tail);
  check(
    readCsbwinCharacter(afterRename, 0).champion.title === 'THE NEW TITLE',
    'a renamed champion is written from the title, not from the raw bytes it was read with',
  );
  const cast: Champion = { ...champion, incantation: [0x60, 0x6f] };
  const afterCast = buildCsbwinCharacterBlock([cast], tail);
  check(
    readCsbwinCharacter(afterCast, 0).champion.incantation.join(',') === '96,111',
    'and a champion who has typed a rune since, from the incantation',
  );
  // `byte33` is CSBWin's index for the next rune. Each of its five writers keeps it at
  // `strlen(incantation) & 3` (`CSBCode.cpp:9089-9093`, `Magic.cpp:817-820`, `:954-955`,
  // `Character.cpp:2653-2654`, `:5318-5319`), so after two runes it is 2, whatever the
  // save said. A stale one would have CSBWin write the third rune over the first.
  check(
    afterCast[33] === 2,
    `and its byte33 is 2, the length of those runes (got ${afterCast[33]}, the save had ${original[33]})`,
  );

  // 4. And through the file: block 4 packed, scrambled, checksummed, written, read back.
  //    `saveSaveGameState` used to put 3328 zeros here whatever it was given.
  const champions = [champion, readCsbwinCharacter(original, 1).champion];
  const file = saveSaveGameState({
    item16: [], timers: [], maxItem16: 0, maxTimers: 0,
    sequencedTimers: false, extendedTimers: false,
    characterBlock: buildCsbwinCharacterBlock(champions, tail),
  });
  const reread = loadSaveGameState(file);
  check(
    reread.characterBlock !== undefined &&
      champions.every((c, i) =>
        JSON.stringify(readCsbwinCharacter(reread.characterBlock!, i).champion) === JSON.stringify(c)),
    'the champions survive scramble, checksum and unscramble in a written file',
  );
  check(
    JSON.stringify(readCsbwinPartyTail(reread.characterBlock!)) === JSON.stringify(tail),
    'and so does the party state beside them',
  );

  // 5. The slots past the party, which only `&CHPOSS` reads (`DSA.cpp:3346-3348`). A
  //    champion left there by a Cancel is packed as a champion is, and a slot read from a
  //    file goes back as it came, through a game: loaded, played from, saved.
  const left = buildCsbwinCharacterBlock([], tail, {}, [champion]);
  check(
    left.subarray(0, CHARDESC_SIZE).join() === buildCsbwinCharacterBlock([champion], tail).subarray(0, CHARDESC_SIZE).join(),
    'a champion left past the party is packed as one in it',
  );
  const oneHero = new Uint8Array(readFileSync(savePath('csbgame-early-1hero.dat')));
  const game = newGame(stockDungeon(), stockGraphics());
  applyCsbwinSave(game, oneHero);
  // The same file again, with champion 0's record in slot 2 as a Cancel would leave it.
  const world = loadCsbwinWorld(oneHero);
  const record = world.save.characterBlock!.slice(0, CHARDESC_SIZE);
  world.save.characterBlock!.set(record, 2 * CHARDESC_SIZE);
  game.applyRuntimeSaveState(buildCsbwinRuntimeState(world));
  const written = loadSaveGameState(buildSaveFile(game)).characterBlock!;
  check(
    written.subarray(2 * CHARDESC_SIZE, 3 * CHARDESC_SIZE).join() === record.join()
      && written.subarray(CHARDESC_SIZE, 2 * CHARDESC_SIZE).every((b) => b === 0),
    "a save's slots past the party come back in the game's own save, byte for byte",
  );

  finish();
}

main();
