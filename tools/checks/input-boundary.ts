/**
 * The game's input boundary (`Game.input`, `src/engine/InputBoundary.ts`): every change the
 * page makes to the game goes through it, is applied at once, and is told to its listener
 * first, with the VBLs run before it. What the game changes inside a VBL is its own, and
 * told to nobody.
 *
 * 1. The queue's doors: a click, the button-up and a key are told with the VBLs run, and
 *    queued as before.
 * 2. The count: every VBL, the stopped clock's too, which the play time leaves out.
 * 3. Inside a VBL: a change the game makes there is applied and not told.
 * 4. The other doors: the extras, a save's tail, `TAG0207cc`, the `?dev` moves, and the
 *    interface's dialogs, whose clock is told; a panel key goes to the interface that
 *    applies it, and to nobody headless.
 * 5. A read is told.
 *
 * Run: `npm test -- --only=input-boundary.ts`
 */
import { readFileSync } from 'node:fs';
import { applyCsbwinSave } from '../../src/engine/CsbwinSaveGame';
import { NO_EXTRAS } from '../../src/engine/GameContext';
import type { InputChange } from '../../src/engine/InputBoundary';
import { MOUSEQLEN, LONG_MOUSEQLEN } from '../../src/engine/MouseQueue';
import type { Game } from '../../src/engine/Game';
import { closeSettingsDialog, openSettingsDialog } from '../../src/renderer/ui/SettingsDialog';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';
import { newGame, runVbl, stockDungeon, stockGraphics } from '../lib/game';
import { genuineSaves } from '../lib/saves';
import { newUIState } from '../lib/ui';

/** A game whose boundary's changes are logged as `kind@vbl`. */
function logged(): { game: Game; log: string[] } {
  const game = newGame(stockDungeon(), stockGraphics());
  const log: string[] = [];
  game.input.listen((change: InputChange, vbl) => log.push(`${change.kind}@${vbl}`));
  return { game, log };
}

console.log('=== 1. the queue ===');
{
  const { game, log } = logged();
  check(game.input.vbls === 0, 'a new game has run no VBL');
  check(game.onMouseClick(10, 20, 2), 'a click is queued');
  runVbl(game); runVbl(game); runVbl(game);
  game.onMouseUnClick();
  check(game.enqueueKeyButton(1), 'a key is queued');
  console.log(`  ${log.join(' ')}`);
  check(log.join(' ') === 'click@0 unclick@3 key@3', 'each is told with the VBLs run before it');
}

console.log('\n=== 2. the count ===');
{
  const { game, log } = logged();
  game.input.apply({ kind: 'pause', paused: true });
  const played = game.playTime();
  for (let n = 0; n < 10; n++) runVbl(game);
  game.input.apply({ kind: 'pause', paused: false });
  console.log(`  ${log.join(' ')}, play time ${played} -> ${game.playTime()} ms`);
  check(game.input.vbls === 10 && game.playTime() === played, 'the stopped clock\'s VBLs are counted, and are no play time');
  check(log.join(' ') === 'pause@0 pause@10' && !game.ctx.state.paused, 'and the clock stopped and let run is told');
}

console.log('\n=== 3. inside a VBL ===');
{
  const { game, log } = logged();
  let once = true;
  game.onFrame(() => {
    if (once) game.input.apply({ kind: 'pause', paused: true });
    once = false;
  });
  runVbl(game);
  console.log(`  told: [${log.join(' ')}], paused ${game.ctx.state.paused}`);
  check(game.ctx.state.paused && log.length === 0, 'a change the game makes in a VBL is applied, and told to nobody');
}

console.log('\n=== 4. the other doors ===');
{
  const { game, log } = logged();
  game.systems.hallOfChampions.addChampion(testChampion(0));
  game.input.apply({ kind: 'extras', extras: { ...NO_EXTRAS, unlimitedKeyQueue: true } });
  const long = game.ctx.extras.unlimitedKeyQueue && Array.from({ length: MOUSEQLEN }, () => game.enqueueKeyButton(1)).every(Boolean);
  check(long, `the extras reach the game, and the queue takes ${MOUSEQLEN} keys (${LONG_MOUSEQLEN} long)`);
  game.saveWritten();
  game.input.apply({ kind: 'tag0207cc' });
  const z = game.ctx.party.state.position.z;
  check(!game.devChangeLevel(-1), 'up from map 0, a `?dev` move does nothing, and says so');
  check(game.devMoveParty(z, 1, 2), 'a `?dev` move on the same level goes');
  const p = game.ctx.party.state.position;
  check(p.x === 1 && p.y === 2 && p.z === z, `and the party is there (${p.x},${p.y},${p.z})`);
  const ui = newUIState(stockGraphics(), game.ctx);
  openSettingsDialog(ui);
  check(game.ctx.state.paused, 'a dialog opened holds the clock');
  closeSettingsDialog(ui);
  check(!game.ctx.state.paused, 'and closed lets it run');
  const panel = game.input.apply({ kind: 'panelKey', action: 'pass' });
  const keys = MOUSEQLEN;
  console.log(`  ${log.slice(1 + keys).join(' ')}`);
  check(log.slice(0, 1 + keys).join(' ') === ['extras@0', ...Array<string>(keys).fill('key@0')].join(' '), 'the extras and the keys are told');
  check(log.slice(1 + keys).join(' ') === 'saveWritten@0 tag0207cc@0 devLevel@0 devMove@0 pause@0 pause@0 panelKey@0',
    'and every other door, the dialog\'s clock and a panel key with them');
  check(panel, 'a panel key headless is told, and applied by nobody');
  const applied: string[] = [];
  game.input.setScreen({
    panelKey: (action) => applied.push(action),
    reincarnateKey: (key) => applied.push(`key ${key}`),
    reincarnateClick: (x, y) => applied.push(`click ${x},${y}`),
  });
  game.input.apply({ kind: 'panelKey', action: 'rune.2' });
  game.input.apply({ kind: 'reincarnateKey', key: 'A' });
  game.input.apply({ kind: 'reincarnateClick', x: 3, y: 4 });
  check(applied.join(' / ') === 'rune.2 / key A / click 3,4', 'the interface applies its own changes');
}

console.log('\n=== 5. a read ===');
{
  const { game, log } = logged();
  runVbl(game);
  const save = genuineSaves()[0]!;
  applyCsbwinSave(game, new Uint8Array(readFileSync(save)));
  console.log(`  ${log.join(' ')}`);
  check(log.join(' ') === 'read@1', 'a game read over the running one is told');
}

finish();
