/**
 * Prove that **our own** save file gives the game back unchanged.
 *
 * Nothing exercised `buildSavePayload` / `applySavePayload` at all. `dump-savegame.ts`
 * drives `getRuntimeSaveState` directly and `dump-csbwin-*.ts` drive the CSBWin reader,
 * so the layer in between — the JSON payload that F5, F9 and both stores of the disk
 * menu actually write and read — had no evidence of any kind behind it. It is also the
 * layer where a field is easiest to lose: the payload is built from a live `Game`,
 * `JSON.stringify`d and rebuilt in a fresh one, so anything that is not a plain value on
 * the snapshot (a `Uint8Array`, a `Map`, a getter) silently becomes something else.
 *
 * The scenario is deliberately the hard one: start from a **genuine CSBWin save**, not
 * from a game this port set up. A party this engine created carries `portraitGraphic`, a
 * graphic-26 index, and would round-trip as a single number; a party out of a file
 * carries 928 bytes of `CHARDESC.portrait` pixels instead
 * (`doc/PROVEN_FACTS.md` → "`CHARDESC` carries the champion's portrait as pixels"), and
 * that is the case a JSON round trip can actually break.
 *
 * Three things are asserted, in rising order of how much they cost to get wrong:
 *
 *  1. **Equality.** Party, world snapshot, ITEM16, missiles, the timer table and its
 *     queue, and every champion's portrait, possessions and `charFlags`.
 *  2. **The world still moves.** `csbgame4-door-{opening,closing}.dat` are two fresh
 *     games whose door timers differ in one byte. Restored through the payload and given
 *     40 ticks, one door must open and the other shut, exactly as
 *     `dump-csbwin-timers.ts` shows them doing when loaded straight from the file.
 *  3. **The table does not grow.** Five save/load cycles in a row on a save with live
 *     monsters must leave the timer table its 467 slots, with the live timers still in
 *     the lowest ones. `LoadGame` is followed by `reloadAfterSaveGame`, whose
 *     `processMonstersOnLevel` deletes and re-creates the movement timers of every
 *     monster group on the party's level (`LoadPartyLevel`,
 *     `doc/CSBwin-src/CSBCode.cpp:10491`), so a restore that numbered new timers above the
 *     restored ones would abandon two slots a cycle on `csbgame7.dat`.
 *     3b. A table filled to `SetTimer`'s jump (`Timer.cpp:999-1008`) is written with its
 *     new size and its cursor, and read back with both.
 *
 * And a save carries its world: one of CSB's eleven levels, loaded into a game built over
 * DM's fourteen, installs the world of its `raw` file (`applySavePayload`), and the game
 * saved and the game loaded play on alike.
 * A save from an older build, whose `runtime` this build does not read, loads through
 * `raw` as a genuine CSBWin save of it does.
 *
 * What is deliberately **not** asserted, because CSBWin does it too: that load is a
 * no-op. `processMonstersOnLevel` really does create new timers, so their `sequence`
 * numbers advance and the random stream moves on; `NextMonsterUpdateTime` really does
 * re-roll each member's `singleMonsterStatus` walk offsets
 * (`doc/CSBwin-src/CSBCode.cpp:5842`), so a monster's sprite may sit a pixel further
 * left after a load. Those are the three fields excluded below, one at a time and by
 * name, rather than by comparing less.
 *
 * The save does the same to the game it leaves, once the file is closed
 * (`doc/CSBwin-src/SaveGame.cpp:1237-1245`, `Game.saveWritten`), so section 6 plays on
 * after a save beside a load of it and asserts that the two never part.
 *
 * Run: `npx tsx tools/dump-save-roundtrip.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { applyCsbwinSave, buildCsbwinRuntimeState } from '../src/engine/CsbwinSaveGame';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { Game } from '../src/engine/Game';
import type { RuntimeSaveState } from '../src/engine/RuntimeSave';
import { TimerFunction } from '../src/engine/TimerQueue';
import { buildSavePayload, decodeBase64ToBytes, encodeSavePayload, applySaveBytes, SAVE_PAYLOAD_VERSION } from '../src/engine/SaveGamePayload';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { readCsbwinCharacter } from '../src/data/CsbwinCharacters';
import { CHARFLAG_ATTACK_DISABLE, type Champion } from '../src/engine/gameTypes';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';

const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const GRAPHICS = 'static/gamefiles/dm-atari/graphics.dat';
const SAVES = 'static/gamefiles/saves';
const CSB = 'static/gamefiles/csb';

/** `CHARDESC.portrait` unpacked: 32x29 palette indices, one byte each. */
const PORTRAIT_PIXELS = 32 * 29;

/** The door `csbgame4-door-{opening,closing}.dat` were made around. */
const DOOR = { x: 1, y: 14, level: 0 };

function loadWorld(): Game {
  const data = new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON))));
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(GRAPHICS))));
  return newGame(data, graphics);
}

function fromCsbwinSave(file: string): Game {
  const game = loadWorld();
  applyCsbwinSave(game, new Uint8Array(readFileSync(resolve(SAVES, file))));
  return game;
}

/** Write the payload the disk menu and F5 write, and read it back into a fresh game. */
function roundTrip(game: Game): { next: Game; bytes: Uint8Array } {
  const bytes = encodeSavePayload(buildSavePayload(game));
  const next = loadWorld();
  applySaveBytes(next, bytes);
  return { next, bytes };
}

/** Turn the clock one tick at a time, the way `Game.update` does. */
function advance(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    game.systems.timer.processTimers();
    game.ctx.state.tickCount++;
  }
}

function doorState(game: Game): number {
  return game.ctx.dungeon.getCellFlag(new Position(DOOR.x, DOOR.y, DOOR.level)) & 0x7;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Everything the payload must carry unchanged. The timer table is compared without its
 * `sequence` stamps, for the reason in the header: the two monster movement timers
 * `processMonstersOnLevel` re-creates on load are new timers, and CSBWin stamps new
 * timers with a fresh sequence.
 */
function compareStates(label: string, before: RuntimeSaveState, after: RuntimeSaveState): void {
  check(same(before.party, after.party), `${label}: the party state round-trips`);
  check(same(before.dungeon.snapshot, after.dungeon.snapshot), `${label}: the world snapshot round-trips`);
  check(same(before.dungeon.missiles, after.dungeon.missiles), `${label}: the missile records round-trip`);
  check(same(before.dungeon.timerQueue, after.dungeon.timerQueue), `${label}: the timer queue order round-trips`);
  check(same(before.game.footprints, after.game.footprints), `${label}: the footprint trail round-trips`);
  check(same(before.game.dsaGlobals, after.game.dsaGlobals), `${label}: the DSA globals round-trip`);
  check(before.game.tickCount === after.game.tickCount, `${label}: the tick count round-trips`);
  check(before.game.gameWon === after.game.gameWon, `${label}: gameWon round-trips`);

  const strip = (records: RuntimeSaveState['dungeon']['timers']) =>
    (records ?? []).map((r) => ({ ...r, sequence: 0 }));
  check(same(strip(before.dungeon.timers), strip(after.dungeon.timers)),
    `${label}: the timer table round-trips, field for field`);
}

/** Portraits, possessions and the six fields `Champion` only gained for the writer. */
function compareChampions(label: string, before: Champion[], after: Champion[]): void {
  check(before.length === after.length && before.length > 0,
    `${label}: the same ${before.length} champions come back`);
  before.forEach((was, i) => {
    const now = after[i];
    const name = was.name?.trim() || `#${i}`;
    // The canary: a party out of a CSBWin file must carry *pixels*, not an index. If
    // this fails the scenario has stopped testing the case it was written for, and the
    // portrait check below would pass on two empty arrays.
    check((was.portrait?.length ?? 0) === PORTRAIT_PIXELS,
      `${label}/${name}: starts with a ${PORTRAIT_PIXELS}-pixel CHARDESC portrait`);
    check(same(was.portrait, now?.portrait), `${label}/${name}: the portrait bitmap round-trips`);
    check(same(was.possessions, now?.possessions), `${label}/${name}: all thirty possessions round-trip`);
    check(was.charFlags === now?.charFlags, `${label}/${name}: charFlags — the gender — round-trips`);
    check(same(was.attributes, now?.attributes), `${label}/${name}: the attributes round-trip`);
    check(same(was.skills, now?.skills), `${label}/${name}: the skills round-trip`);
    // The runes a cast leaves behind, and the field that qualifies them: a C string
    // (`doc/PROVEN_FACTS.md` → "`CHARDESC.incantation` is a C string"), so the live
    // prefix and the raw four bytes are separate pieces of state. `byte33` is not: it
    // is derived from the prefix (`tools/dump-character-block.ts`).
    check(same(was.incantation, now?.incantation), `${label}/${name}: the incantation round-trips`);
    check(same(was.incantationField, now?.incantationField),
      `${label}/${name}: the raw incantation bytes round-trip`);
  });
}

/**
 * The four fields that are not runtime state and had to join the snapshot anyway.
 *
 * They are the converted form of an image (`src/data/CsbwinDungeonConversions.ts`), and
 * a restored game is a *fresh* `Game` built on `dungeon.dat` — so before the snapshot
 * carried them, a world restored from a save's payload kept `dungeon.dat`'s. The TEXT
 * records came back from the save holding entry numbers into an index the save did not
 * write, and `expool`, which no code here can regenerate, was simply the wrong bytes.
 *
 * `expool` is the field with teeth, and the only one of the four that can be canaried:
 * `dungeon.dat` has **no** EXPOOL at all — database 11 is empty in it — and every
 * committed save carries blocks of it, so dropping it from the snapshot fails six checks
 * here. Dropping any of the three text fields fails **none**, and that is not a gap in
 * the tool: this port's conversion of `dungeon.dat` reproduces the saves' index and
 * compressed text exactly, entry for entry and word for word, so the fallback happens to
 * be the right answer for this dungeon. `tools/dump-dungeon-conversions.ts` is what
 * proves that equality; carrying the three is what makes it stop mattering, for a
 * dungeon whose text has been edited or a save from another dungeon entirely.
 */
function compareConvertedImage(label: string, source: Game, restored: Game): void {
  const from = source.ctx.state.dungeon;
  const to = restored.ctx.state.dungeon;
  const fresh = loadWorld().ctx.state.dungeon;

  check((from.expool?.length ?? 0) > 0,
    `${label}: the save carries an EXPOOL to lose (${from.expool?.length ?? 0} bytes)`);
  check((fresh.expool?.length ?? 0) !== (from.expool?.length ?? 0),
    `${label}: a fresh dungeon.dat game does not have it, so the check can fail`);
  check(same(Array.from(to.expool ?? []), Array.from(from.expool ?? [])),
    `${label}: EXPOOL survives our own payload byte for byte`);

  check(same(to.indirectTextIndex, from.indirectTextIndex),
    `${label}: the indirect text index survives`);
  check(same(to.compressedText, from.compressedText), `${label}: the compressed text survives`);
  check(same(to.textWords, from.textWords), `${label}: textWords survives`);

  // And the world is still self-consistent: every TEXT record's index word addresses an
  // entry that exists. A hybrid passes the three comparisons above and fails this one.
  const records = to.databases.texts.records;
  const index = to.indirectTextIndex ?? [];
  const live = records.filter((r) => r.nextObject !== 0xffff);
  check(live.length > 0 && live.every((r) => index[r.textOffset] !== undefined),
    `${label}: all ${live.length} live TEXT records address an entry the index has`);
}

function main(): void {
  /* ---- 1. equality, over three saves ---- */

  for (const file of ['csbgame4-door-opening.dat', 'csbgame4-door-closing.dat', 'csbgame7.dat']) {
    const direct = fromCsbwinSave(file);
    const before = direct.getRuntimeSaveState();
    const championsBefore = direct.ctx.party.state.champions.map((c) => ({ ...c }));

    const { next, bytes } = roundTrip(direct);
    const after = next.getRuntimeSaveState();

    console.log(`${file}: ${bytes.length} bytes, ${before.dungeon.timers?.length ?? 0} timer slots, ` +
      `${before.dungeon.timerQueue?.length ?? 0} live, ${championsBefore.length} champions`);
    compareStates(file, before, after);
    compareChampions(file, championsBefore, next.ctx.party.state.champions);
    compareConvertedImage(file, direct, next);
  }

  /* ---- 2. the world still moves after a round trip ---- */

  console.log('\n=== the door, restored through our own payload ===');
  console.log(['file', 'before', 'direct', 'via payload'].join('\t'));
  for (const { file, expected } of [
    { file: 'csbgame4-door-opening.dat', expected: 'open' },
    { file: 'csbgame4-door-closing.dat', expected: 'shut' },
  ]) {
    const direct = fromCsbwinSave(file);
    const { next } = roundTrip(direct);
    const before = doorState(next);
    advance(direct, 40);
    advance(next, 40);
    const viaFile = doorState(direct);
    const viaPayload = doorState(next);
    console.log([file, before, viaFile, viaPayload].join('\t'));

    check(before === 2, `${file}: the door starts half open, as the file has it`);
    check(viaPayload === viaFile, `${file}: the door ends where loading the file directly puts it`);
    // 0 is fully open and 4 fully shut (`doc/CSBwin-src/CSBTypes.h:185-192`).
    check(viaPayload === (expected === 'open' ? 0 : 4),
      `${file}: the door came ${expected} after the round trip`);
  }

  /* ---- 3. the timer table does not grow ---- */

  console.log('\n=== five save/load cycles on a level with live monsters ===');
  let game = fromCsbwinSave('csbgame7.dat');
  const slotsAtStart = game.getRuntimeSaveState().dungeon.timers?.length ?? 0;
  const liveAtStart = game.getRuntimeSaveState().dungeon.timerQueue?.length ?? 0;
  check(liveAtStart > 0, 'csbgame7.dat carries live timers to begin with');
  console.log(['cycle', 'slots', 'live', 'bytes'].join('\t'));
  console.log(['load', slotsAtStart, liveAtStart, '-'].join('\t'));
  for (let cycle = 1; cycle <= 5; cycle++) {
    const { next, bytes } = roundTrip(game);
    game = next;
    const state = game.getRuntimeSaveState();
    const slots = state.dungeon.timers?.length ?? 0;
    const live = state.dungeon.timerQueue?.length ?? 0;
    console.log([cycle, slots, live, bytes.length].join('\t'));
    check(slots === slotsAtStart,
      `cycle ${cycle}: the timer table is still ${slotsAtStart} slots, not ${slots}`);
    check(live === liveAtStart,
      `cycle ${cycle}: ${liveAtStart} timers are still live, not ${live}`);
    // No abandoned slots: the live timers still fill the table from slot 0 up.
    const highest = Math.max(-1, ...(state.dungeon.timerQueue ?? []));
    check(highest + 1 === live, `cycle ${cycle}: the table has no abandoned slots (highest ${highest})`);
  }

  /* ---- 3b. a table that filled keeps its size and its cursor ---- */

  // `SetTimer` jumps `m_firstAvailTimer` to `m_maxTimers` and enlarges the table once it
  // is within five of full (`doc/CSBwin-src/Timer.cpp:999-1008`); `SaveGame` writes both
  // and `LoadGame` reads both back (`SaveGame.cpp:1638-1640`).
  console.log('\n=== csbgame7.dat filled to the jump, then saved and loaded ===');
  {
    const filled = fromCsbwinSave('csbgame7.dat');
    const q = filled.ctx.timers;
    const firstMax = q.getMaxTimers();
    let t = 0;
    while (q.getMaxTimers() === firstMax) {
      q.createTimer(TimerFunction.TT_11, 0, 0, 0, 0, filled.ctx.state.tickCount + 1000 + t++, 0);
    }
    // The timer that found the table within five of full took slot `firstMax`, and left
    // the five below it empty.
    const skipped = [1, 2, 3, 4, 5].map((i) => q.getTimer(firstMax - i));
    const cursor = q.getFirstAvailTimer();
    const max = q.getMaxTimers();
    const raw = decodeBase64ToBytes(buildSavePayload(filled).raw);
    const block2 = loadSaveGameState(raw).block2!;
    // The restore re-creates the monster timers of the party's level
    // (`reloadAfterSaveGame`), and their deletes lower the cursor into the skipped slots,
    // so the cursor is checked on the state the file gives, before that runs.
    const fromFile = buildCsbwinRuntimeState(loadCsbwinWorld(raw));
    const fresh = loadWorld();
    fresh.applyRuntimeSaveState(fromFile);
    console.log(`max ${firstMax} -> ${max}, cursor ${cursor}; written MaxTimers ${block2.maxTimers} ` +
      `FirstAvailTimer ${block2.firstAvailTimer}; read back ${fromFile.dungeon.timers?.length} / ` +
      `${fromFile.dungeon.firstAvailTimer}; restored ${fresh.ctx.timers.getMaxTimers()} / ${fresh.ctx.timers.getFirstAvailTimer()}`);
    check(max === Math.trunc((firstMax + 10) * 5 / 4), `the full table grows to (${firstMax}+10)*5/4 = ${max}`);
    check(skipped.every((timer) => timer === null) && q.getTimer(firstMax) !== null && cursor === firstMax + 1,
      `the timer that filled it took slot ${firstMax}, the five below it stay empty, and the cursor is ${firstMax + 1}`);
    check(block2.maxTimers === max && block2.firstAvailTimer === cursor, 'a save writes the new size and the cursor');
    check(fromFile.dungeon.timers?.length === max && fromFile.dungeon.firstAvailTimer === cursor,
      'and reading the file back gives both');
    check(fresh.ctx.timers.getMaxTimers() === max, `and a game restored from it has ${max} slots`);
  }

  /* ---- 4. GAMEBLOCK2, built from the live game ---- */

  // `dump-save-blocks-vs-file.ts` proves the *packing* against the bytes CSBWin wrote;
  // nothing proved the **wiring** — which live counter feeds which offset. Fifteen of
  // the twenty-one fields were written as zero until now, so a save this port wrote said
  // the party was at (0,0) facing north on level 0 with the clock stopped.
  console.log('\n=== GAMEBLOCK2, out of a live game and back ===');
  for (const file of ['csbgame7.dat', 'csbgame4-door-opening.dat']) {
    const live = fromCsbwinSave(file);
    const state = live.getRuntimeSaveState();
    const block2 = loadSaveGameState(
      decodeBase64ToBytes(buildSavePayload(live).raw),
    ).block2;
    if (!block2) { check(false, `${file}: the written prefix should carry a block 2`); continue; }

    const party = state.party;
    console.log(`${file}: time=${block2.time} party=(${block2.partyX},${block2.partyY}) ` +
      `level=${block2.partyLevel} facing=${block2.partyFacing} n=${block2.numCharacter} ` +
      `firstAvail=${block2.firstAvailTimer} item16QueLen=${block2.item16QueLen} ` +
      `seed=${block2.ranseed} lastAttack=${block2.lastMonsterAttackTime}`);

    check(block2.time === state.game.tickCount, `${file}: gb2.Time is d.Time`);
    check(block2.ranseed === (state.game.randomSeed >>> 0), `${file}: gb2.ranseed is the seed`);
    check(block2.numCharacter === party.champions.length, `${file}: gb2.numcharacter counts the party`);
    check(block2.partyX === party.position.x, `${file}: gb2.partyx is the party's x`);
    check(block2.partyY === party.position.y, `${file}: gb2.partyy is the party's y`);
    check(block2.partyLevel === party.position.z, `${file}: gb2.partyLevel is the party's level`);
    check(block2.partyFacing === party.facing, `${file}: gb2.partyfacing is the party's facing`);
    check(block2.maxItem16 === (state.dungeon.item16?.length ?? 0), `${file}: gb2.MaxITEM16 is the pool size`);
    check(block2.maxTimers === (state.dungeon.timers?.length ?? 0), `${file}: gb2.MaxTimers is the table size`);
    check(block2.maxTimers === live.ctx.timers.getMaxTimers(),
      `${file}: gb2.MaxTimers is m_maxTimers, ${block2.maxTimers}`);
    check(block2.numTimer === (state.dungeon.timerQueue?.length ?? 0), `${file}: gb2.NumTimer is the queue length`);
    check(block2.firstAvailTimer === live.ctx.timers.getFirstAvailTimer(),
      `${file}: gb2.FirstAvailTimer is the free cursor`);
    check(block2.item16QueLen === live.systems.monsters.getItem16QueLen(),
      `${file}: gb2.ITEM16QueLen is the number of slots in use`);
    check(block2.lastMonsterAttackTime === party.lastMonsterAttackTime,
      `${file}: gb2.LastMonsterAttackTime is d.LastMonsterAttackTime`);
    check(block2.lastPartyMoveTime === (state.game.footprints.lastPartyMoveTime >>> 0),
      `${file}: gb2.LastPartyMoveTime is d.LastPartyMoveTime`);
    check(block2.handChar === (party.cursorOwner ?? -1), `${file}: gb2.handChar is the cursor owner`);
    check(block2.magicCaster === (party.magicCasterIndex ?? -1), `${file}: gb2.MagicCaster is the caster`);
    // The party of every committed save is on a level below the first, so a zeroed
    // block would have been indistinguishable from a valid one only at the very start.
    check(block2.partyLevel > 0 || block2.partyX > 0 || block2.partyY > 0,
      `${file}: the position written is not the all-zero one a stub block would give`);
  }

  /* ---- 5. the busy bit, out of a live game and back ---- */

  // A busy champion is `CHARFLAG_attackDisable` in `charFlags`. `DisableCharacterAction`
  // sets it when the champion has no busy timer yet (`doc/CSBwin-src/Magic.cpp:528-531`)
  // and `EnableCharacterAction` clears it (`Timer.cpp:2646`), so a save written while
  // the champion is busy carries bit 3, and one written after the timer fired does not.
  console.log('\n=== CHARFLAG_attackDisable, busy and freed ===');
  {
    const game = fromCsbwinSave('csbgame7.dat');
    const champion = (g: Game): Champion => g.ctx.party.state.champions[0]!;
    /** Champion 0 as the block 4 of a save written now has them. */
    const written = (g: Game): Champion => readCsbwinCharacter(
      loadSaveGameState(decodeBase64ToBytes(buildSavePayload(g).raw)).characterBlock!, 0).champion;
    const busy = (c: Champion): boolean => (c.charFlags & CHARFLAG_ATTACK_DISABLE) !== 0;
    const hex = (n: number): string => `0x${(n & 0xffff).toString(16).padStart(4, '0')}`;
    const report = (label: string, g: Game): void => {
      const w = written(g);
      console.log(`${label}: tick ${g.ctx.state.tickCount} charFlags ${hex(champion(g).charFlags)} ` +
        `busyTimer ${champion(g).busyTimerIndex}, written ${hex(w.charFlags)} / ${w.busyTimerIndex}`);
    };
    const others = champion(game).charFlags & ~CHARFLAG_ATTACK_DISABLE;

    report('loaded', game);
    check(!busy(champion(game)) && champion(game).busyTimerIndex === -1,
      'csbgame7.dat: champion 0 starts idle, bit 3 clear and no busy timer');

    game.ctx.systems.magic.disableCharacterAction(0, 8);
    const timer = champion(game).busyTimerIndex;
    report('busied', game);
    check(busy(champion(game)) && timer >= 0,
      'DisableCharacterAction sets CHARFLAG_attackDisable and queues the busy timer');
    check(busy(written(game)) && written(game).busyTimerIndex === timer,
      'a save written while the champion is busy carries bit 3 and that busy timer');

    const { next } = roundTrip(game);
    check(busy(champion(next)) && champion(next).busyTimerIndex === timer,
      'and so does our own payload, read back into a fresh game');

    // Busied again while busy, the timer is replaced by a later one (`Magic.cpp:517-525`):
    // due at d.Time + 8 + 8/2. The bit is already set and stays.
    game.ctx.systems.magic.disableCharacterAction(0, 8);
    report('busied again', game);
    check(busy(champion(game)) && champion(game).busyTimerIndex >= 0,
      'busied again while busy, the champion keeps the bit and a busy timer');

    // Set between ticks for d.Time + n, as an attack click sets it, the TT_11 fires in the
    // n+1th tick: the first runs its timers on the d.Time it was set from (CSBCode.cpp:626,
    // :660). Live, d.Time + 12; restored, the first timer's d.Time + 8.
    for (const [label, g, ticks] of [['live', game, 13], ['restored', next, 9]] as const) {
      advance(g, ticks - 1);
      check(busy(champion(g)), `${label}: still busy ${ticks - 1} ticks on, one before the timer`);
      advance(g, 1);
      report(`${label}, freed`, g);
      check(!busy(champion(g)) && champion(g).busyTimerIndex === -1,
        `${label}: the TT_11 at ${ticks} ticks clears the bit and the busy timer`);
      check(!busy(written(g)) && written(g).busyTimerIndex === -1,
        `${label}: a save written after the timer fired carries neither`);
      check((champion(g).charFlags & ~CHARFLAG_ATTACK_DISABLE) === others,
        `${label}: the other flags, the gender among them, are untouched`);
    }

    // A genuine CSBWin save of a busy champion: IAIDO, champion 0 of `csbgame6.dat`, has
    // bit 3 and a busy timer. The bit is the file's, and only his TT_11 clears it. The
    // timer is due at the saved d.Time, so the first tick after the load fires it.
    const saved = fromCsbwinSave('csbgame6.dat');
    report('csbgame6.dat', saved);
    check(busy(champion(saved)) && saved.ctx.timers.getTimer(champion(saved).busyTimerIndex)?.function === 11,
      'csbgame6.dat: champion 0 is saved busy, with bit 3 and a TT_11');
    let heldUntilTimer = true;
    let steps = 0;
    for (; steps < 100 && champion(saved).busyTimerIndex >= 0; steps++) {
      heldUntilTimer &&= busy(champion(saved));
      advance(saved, 1);
    }
    report('csbgame6.dat, freed', saved);
    check(heldUntilTimer, 'csbgame6.dat: the bit holds for as long as his TT_11 is queued');
    check(steps === 1, `csbgame6.dat: his TT_11 fires on the first tick after the load (${steps})`);
    check(!busy(champion(saved)) && champion(saved).busyTimerIndex === -1,
      'csbgame6.dat: his TT_11 clears the bit the file set, and the busy timer');
    check(!busy(written(saved)), 'csbgame6.dat: a save written after carries no bit 3');
  }

  /* ---- 6. playing on after a save, beside a load of it ---- */

  // Once the file is closed, CSBWin's save detaches every group and runs
  // `ProcessMonstersOnLevel` (`doc/CSBwin-src/SaveGame.cpp:1237-1245`), as a restore does,
  // so the game played on after a save is the one a load of it gives back. csbgame7.dat's
  // party level has live groups; 30 ticks of play first make their timers the game's own.
  // Stepped side by side, the monsters' ITEM16 slots (their `singleMonsterStatus` among
  // them), the whole timer table and queue, the world and the random seed must agree on
  // every tick. Run without the tail too, which must tell the two apart: the check's teeth.
  console.log('\n=== playing on after a save, beside a load of it ===');
  console.log(['tail', 'tick', 'groups', 'AI timers here', 'seed', 'same'].join('\t'));
  /** The monster AI timers (29-41) of the party's level, the ones the tail re-creates. */
  const monsterTimers = (g: Game): number => (g.getRuntimeSaveState().dungeon.timerQueue ?? [])
    .map((i) => g.ctx.timers.getTimer(i))
    .filter((t) => t && t.function >= 29 && t.function <= 41 && t.level === g.ctx.party.state.position.z).length;
  const monstersOf = (g: Game): string => {
    const { dungeon, game } = g.getRuntimeSaveState();
    return JSON.stringify([dungeon.item16, dungeon.timers, dungeon.timerQueue, dungeon.timerSequence,
      dungeon.missiles, dungeon.snapshot, game.randomSeed, game.tickCount]);
  };
  for (const withTail of [true, false]) {
    const live = fromCsbwinSave('csbgame7.dat');
    advance(live, 30);
    const bytes = encodeSavePayload(buildSavePayload(live));
    if (withTail) live.saveWritten();
    const loaded = loadWorld();
    applySaveBytes(loaded, bytes);
    let firstDiff = -1;
    for (let tick = 0; tick <= 300; tick++) {
      if (tick > 0) { advance(live, 1); advance(loaded, 1); }
      const same = monstersOf(live) === monstersOf(loaded);
      if (!same && firstDiff < 0) firstDiff = tick;
      if (tick % 100 === 0 || (!same && firstDiff === tick)) {
        console.log([withTail ? 'yes' : 'no', live.ctx.state.tickCount, live.systems.monsters.getItem16QueLen(),
          monsterTimers(live), live.ctx.random.getSeed() >>> 0, same].join('\t'));
      }
    }
    if (withTail) {
      check(live.systems.monsters.getItem16QueLen() > 0 && monsterTimers(live) > 0,
        'csbgame7.dat: the party level still has attached groups with movement timers');
      check(firstDiff < 0, 'with the save\'s tail, the game played on and a load of its save agree ' +
        `on every tick for 300 ticks${firstDiff < 0 ? '' : `, not from tick ${firstDiff}`}`);
    } else {
      check(firstDiff === 0, 'without it, they differ from the moment of the save');
    }
  }

  /* ---- 7. a save of another dungeon's world, into a game built over DM's ---- */

  // `raw` carries the whole world, structure and all, and a load installs it in place of
  // the one the game was running (`applySavePayload`), as `_ReadEntireGame` reads a
  // save's (`doc/CSBwin-src/SaveGame.cpp:2324`). CSB's `mini.dat`, eleven levels, is
  // played 30 ticks in a game built over DM's fourteen, saved, and loaded into another
  // game built over DM's; then the two play on side by side.
  console.log('\n=== a save of CSB\'s world, into a game built over DM\'s ===');
  {
    const csbGraphics = new GraphicsLoader();
    csbGraphics.loadFromArray(new Uint8Array(readFileSync(resolve(CSB, 'graphics.dat'))));
    const overDm = (): Game => newGame(new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON)))), csbGraphics);
    const live = overDm();
    applyCsbwinSave(live, new Uint8Array(readFileSync(resolve(CSB, 'mini.dat'))));
    advance(live, 30);
    const bytes = encodeSavePayload(buildSavePayload(live));
    live.saveWritten();
    const loaded = overDm();
    const builtOver = loaded.ctx.dungeon.getMapCount();
    let error = '';
    try {
      applySaveBytes(loaded, bytes);
    } catch (e) {
      error = (e as Error).message;
    }
    const world = loaded.ctx.state.dungeon;
    console.log(`built over ${builtOver} maps, now ${loaded.ctx.dungeon.getMapCount()}${error ? `, refused: ${error}` : ''}`);
    check(!error && builtOver === 14 && loaded.ctx.dungeon.getMapCount() === 11 && world === loaded.ctx.dungeon.getData(),
      'the save\'s eleven-level world replaces DM\'s fourteen, in state and DungeonState both');
    const from = live.ctx.state.dungeon;
    check(!error && same(world.maps.map((m) => [m.descriptor, m.monsterTypes, m.wallDecorationTOC, m.floorDecorationTOC, m.doorDecorationTOC]),
        from.maps.map((m) => [m.descriptor, m.monsterTypes, m.wallDecorationTOC, m.floorDecorationTOC, m.doorDecorationTOC]))
      && same(world.levelIndex, from.levelIndex) && same(world.header, from.header) && same(world.presetHeroes, from.presetHeroes),
      'the levels\' descriptors and tables, levelIndex, the header and the preset heroes are the saved world\'s');
    let firstDiff = -1;
    if (!error) {
      for (let tick = 0; tick <= 100; tick++) {
        if (tick > 0) { advance(live, 1); advance(loaded, 1); }
        const agree = monstersOf(live) === monstersOf(loaded) && same(live.ctx.party.state, loaded.ctx.party.state);
        if (!agree && firstDiff < 0) firstDiff = tick;
      }
    }
    console.log(`played on 100 ticks side by side: ${firstDiff < 0 ? 'agree throughout' : `differ from tick ${firstDiff}`}`);
    check(!error && firstDiff < 0, 'the game saved and the game loaded from it agree for 100 ticks');
  }

  /* ---- 8. a save from an older build loads through its raw file ---- */

  // `runtime` changes shape with the build and is refused at another version; `raw` is a
  // whole CSBWin file, whose format does not change, so `applySaveBytes` loads it as a
  // genuine save. Proved against a load of the same file straight through
  // `applyCsbwinSave`. A `raw` that will not load leaves the version refusal.
  console.log('\n=== a save from an older build ===');
  {
    const source = fromCsbwinSave('csbgame7.dat');
    advance(source, 30);
    const payload = buildSavePayload(source);
    const stale = { ...payload, runtime: { ...payload.runtime, version: SAVE_PAYLOAD_VERSION - 1 } };
    // Not a `SavePayload`, whose version is this build's: the file is written as a store writes it.
    const encodeJson = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
    const viaStale = loadWorld();
    let error = '';
    try {
      applySaveBytes(viaStale, encodeJson(stale));
    } catch (e) {
      error = (e as Error).message;
    }
    const direct = loadWorld();
    applyCsbwinSave(direct, decodeBase64ToBytes(payload.raw));
    direct.savedGameRead();
    const state = (g: Game): string => {
      const { party, dungeon, game } = g.getRuntimeSaveState();
      return JSON.stringify([party, dungeon, game.tickCount, game.randomSeed, game.block1]);
    };
    console.log(`v${SAVE_PAYLOAD_VERSION - 1} with a raw file: ${error || `loaded, level ${viaStale.ctx.party.state.position.z}`}`);
    check(!error && state(viaStale) === state(direct),
      'a save of an older format loads its raw file, as a genuine CSBWin save of it does');
    let refused = '';
    try {
      applySaveBytes(loadWorld(), encodeJson({ ...stale, raw: '' }));
    } catch (e) {
      refused = (e as Error).message;
    }
    console.log(`v${SAVE_PAYLOAD_VERSION - 1} with no usable raw file: ${refused}`);
    check(refused === `SAVE IS FORMAT V${SAVE_PAYLOAD_VERSION - 1}, THIS BUILD READS V${SAVE_PAYLOAD_VERSION}`,
      'one whose raw file will not load is refused by its version');
  }

  finish();
}

main();
