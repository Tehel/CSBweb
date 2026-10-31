/**
 * The lines of a CSBWin `playfile.log` that change the game and are no input, applied as
 * `PLAYFILE::Play` applies them (doc/CSBwin-src/Recording.cpp:650-761): the draws CSBWin's
 * recorder made of its own, and the save a run's author cut out of the log. A CSBWin run
 * played into the port records each as a change of its own (`InputChange`'s `playfile`,
 * `tools/lib/csbwinRun.ts`), so that the port's player plays them where the run did; the
 * page makes none.
 */
import { drawLegalAttackTypes } from './AttackMenu';
import type { GameContext } from './GameContext';
import { smartDiscard } from './SmartDiscard';

/**
 * `0x2221`, `RECORDFILE::CycleRandom`'s line: `y + 1` draws (`Recording.cpp:650-653`,
 * `:1033-1041`), which the recorder made at an entry taken when
 * `(d.RandomNumber & 0x3651) == 0` (`:1229-1233`).
 */
export const PLAYFILE_CYCLE_RANDOM = 0x2221;

/**
 * A file's signature, `RECORDFILE::Signature`'s line: one draw (`Recording.cpp:656-722`,
 * `:1043-1055`). The version's, `graphics.dat`'s, `dungeon.dat`'s and `CSBgraphics.dat`'s.
 */
export const PLAYFILE_SIGNATURES: readonly number[] = [0x6665, 0x6666, 0x6667, 0x666a];

/**
 * `0x2223` stands in for a save cut out of the log, `0x2224` splices two recordings at
 * one: what the save did to the game (`Recording.cpp:734-761`).
 */
export const PLAYFILE_SAVE_CUT = 0x2223;
export const PLAYFILE_SPLICE = 0x2224;

/** Every line `applyPlayfileLine` applies. */
export const PLAYFILE_LINES: ReadonlySet<number> = new Set([PLAYFILE_CYCLE_RANDOM, ...PLAYFILE_SIGNATURES, PLAYFILE_SAVE_CUT, PLAYFILE_SPLICE]);

/** The line `num`, its `y` field as the file holds it, applied to the game. */
export function applyPlayfileLine(ctx: GameContext, num: number, y: number): void {
  if (num === PLAYFILE_CYCLE_RANDOM) {
    for (let i = 0; i <= y; i++) ctx.random.next();
    return;
  }
  if (PLAYFILE_SIGNATURES.includes(num)) {
    ctx.random.next();
    return;
  }
  if (num !== PLAYFILE_SAVE_CUT && num !== PLAYFILE_SPLICE) throw new Error(`no playfile line 0x${num.toString(16)}`);
  // `TAG00bd40(); ProcessMonstersOnLevel(); SmartDiscard(true);`
  ctx.systems.monsters.reattachAfterSave();
  smartDiscard(ctx, true);
  if (num === PLAYFILE_SPLICE) {
    // The four entries of the save cut out, and the attack menu its disk icon closed.
    // `checkDungeonSignature = false` is the player's warning alone.
    ctx.state.block1.totalMoveCount += 4;
    if (ctx.interface.attackingCharacterOrdinal !== 0) {
      ctx.interface.attackingCharacterOrdinal = 0;
      ctx.interface.word20252 = 1;
      drawLegalAttackTypes(ctx);
    }
  }
}
