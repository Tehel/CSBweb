/**
 * The boot's start takes a new game's party onto its square: `_ShowPrisonDoor` ends in
 * `MoveObject(RN(RNnul), -1, 0, d.partyX, d.partyY)` unless the game was resumed
 * (doc/CSBwin-src/CSBCode.cpp:10803-10806), as a step onto the square would (`Game.start`).
 * A dungeon can be built on it: Theron's Quest's conversions start the party on a stone
 * square whose active teleporter sends it into the first room, and Conflux's start square
 * holds pads. The restart after a lost game (`Code1f9e6.cpp:310-318`) and a resumed game
 * move nothing.
 *
 *   - Conflux: the start square's pads (type 1, "set … once") are pressed: actuator timers
 *     are queued on the boot's start, none on a plain one or a resumed game's.
 *   - DM, its start square's teleporter made active: the boot's start takes the party to
 *     its target, (9,1); a plain start leaves it on (1,3). DM as shipped, its teleporter
 *     inactive, stays on (1,3).
 *
 * Run: `npm test -- --only=dump-enter-dungeon.ts`
 */

import { readFileSync } from 'node:fs';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { DungeonData } from '../src/data/dungeonTypes';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { Game } from '../src/engine/Game';
import { newGame, stockDungeon, stockGraphics } from './lib/game';
import { GAMEFILES_DIR } from './lib/dataSets';

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
}

const CONFLUX = `${GAMEFILES_DIR}/conflux-3.5-b8`;
const confluxGraphics = new GraphicsLoader();
confluxGraphics.loadFromArray(new Uint8Array(readFileSync(`${CONFLUX}/graphics.dat`)));
const confluxDungeon = (): DungeonData =>
  new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(`${CONFLUX}/dungeon.dat`)));

/** `game` started as `start(enterDungeon)` starts it, the loop stopped before any VBL runs. */
function started(game: Game, enterDungeon: boolean, resumed = false): Game {
  if (resumed) game.savedGameRead();
  game.start(enterDungeon);
  game.stop();
  return game;
}

const where = (game: Game): string => {
  const { x, y, z } = game.ctx.party.state.position;
  return `map ${z} (${x},${y})`;
};

// Conflux: pads on the start square (13,24).
{
  const plain = started(newGame(confluxDungeon(), confluxGraphics), false);
  const boot = started(newGame(confluxDungeon(), confluxGraphics), true);
  const resumed = started(newGame(confluxDungeon(), confluxGraphics), true, true);
  const plainTimers = plain.ctx.timers.getTimers().length;
  const bootTimers = boot.ctx.timers.getTimers().length;
  const resumedTimers = resumed.ctx.timers.getTimers().length;
  console.log(`Conflux: timers ${plainTimers} on a plain start, ${bootTimers} on the boot's, ${resumedTimers} on a resumed game's`);
  check(bootTimers > plainTimers, "Conflux: the boot's start presses the start square's pads");
  check(resumedTimers === plainTimers, 'Conflux: a resumed game presses nothing');
  check(where(boot) === 'map 0 (13,24)', `Conflux: the party stays on its square (${where(boot)})`);
}

// DM: the start square (1,3) holds a teleporter to (9,1), shipped inactive.
{
  const shipped = started(newGame(stockDungeon(), stockGraphics()), true);
  check(where(shipped) === 'map 0 (1,3)', `DM as shipped: the inactive teleporter leaves the party on (1,3) (${where(shipped)})`);

  const active = (): Game => {
    const game = newGame(stockDungeon(), stockGraphics());
    const map = game.ctx.dungeon.getMap(0);
    if (!map) throw new Error('DM has no map 0');
    map.cellFlags[1][3] |= 0x08; // `TELEPORTER` active (`CSBTypes.h`)
    return game;
  };
  const plain = started(active(), false);
  const boot = started(active(), true);
  const resumed = started(active(), true, true);
  check(where(plain) === 'map 0 (1,3)', `active teleporter, plain start: the party stays on (1,3) (${where(plain)})`);
  check(where(boot) === 'map 0 (9,1)', `active teleporter, the boot's start: the party is sent to (9,1) (${where(boot)})`);
  check(where(resumed) === 'map 0 (1,3)', `active teleporter, a resumed game: the party stays on (1,3) (${where(resumed)})`);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
