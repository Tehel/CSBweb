/**
 * The page's `?dev` move down and up (`Game.devChangeLevel`, `GameInputHost.onDevLevel`),
 * a debugging aid that is not CSBWin's: the move down and up keys take the party to the
 * map numbered one more or one less, on the same square of the dungeon when that map holds
 * it, else on its nearest square, whatever is there; nowhere above map 0 or below the last.
 *
 * 1. On DM's level 0, from a square whose square below is a wall on level 1: down puts the
 *    party in that wall once the next tick has loaded the level, with no pit; up takes it
 *    back to the same square of level 0. From a square of level 0 that level 1 does not
 *    reach, where `IncrementLevel` finds nothing, down puts it on level 1's nearest
 *    square. Nothing happens up from map 0 or down from map 13, the last.
 * 2. The keys: with the hook, Minus and Equal (`move.down`, `move.up`) call it with 1 and
 *    -1 and queue no button; without it, in a dungeon that does not set
 *    `bThreeDMovements`, they are nothing (`translateKey`).
 *
 * Run: `npm test -- --only=dump-dev-level.ts`
 */
import { Position, RoomType } from '../src/core/types';
import type { Game } from '../src/engine/Game';
import { GameInput, type KeyPress } from '../src/renderer/GameInput';
import type { GameScreen } from '../src/renderer/GameScreen';
import { tableKeyButton } from '../src/renderer/ui/Keyboard';
import { check, finish } from './lib/check';
import { testChampion } from './lib/champion';
import { newGame, runVbl, stockDungeon, stockGraphics, TICK_DUE } from './lib/game';
import { newUIState } from './lib/ui';

function party(game: Game): string {
  const p = game.ctx.party.state.position;
  return `${p.z}:(${p.x},${p.y})`;
}

function levels(): void {
  console.log('=== 1. a level down and up ===');
  const game = newGame(stockDungeon(), stockGraphics());
  game.systems.hallOfChampions.addChampion(testChampion(0));
  const dungeon = game.ctx.dungeon;
  const map0 = dungeon.getMap(0)!.descriptor;
  // A square of level 0 that is no pit, whose square below is a wall.
  let from: Position | null = null;
  let below: Position | null = null;
  for (let x = 0; x < map0.width && !from; x++) {
    for (let y = 0; y < map0.height && !from; y++) {
      const here = new Position(x, y, 0);
      const next = dungeon.incrementLevel(here, 1);
      if (!next || dungeon.getCellFlag(here) >> 5 === RoomType.PIT) continue;
      if (dungeon.getCellFlag(next) >> 5 !== RoomType.STONE) continue;
      from = here;
      below = next;
    }
  }
  if (!from || !below) throw new Error('no square of level 0 above a wall');
  game.ctx.party.state.position = from;
  const went = game.devChangeLevel(1);
  runVbl(game, TICK_DUE);
  console.log(`from 0:(${from.x},${from.y}) down: ${went}, ${party(game)}, the wall ${below.z}:(${below.x},${below.y})`);
  const down = party(game);
  check(went && down === `${below.z}:(${below.x},${below.y})`, 'down puts the party on the square below, in a wall, after the tick');
  const back = game.devChangeLevel(-1);
  runVbl(game, TICK_DUE);
  console.log(`up: ${back}, ${party(game)}`);
  check(back && party(game) === `0:(${from.x},${from.y})`, 'and up takes it back to its square of level 0');

  // A square of level 0 off level 1, which `IncrementLevel` leaves where it is.
  const map1 = dungeon.getMap(1)!.descriptor;
  let off: Position | null = null;
  for (let x = 0; x < map0.width && !off; x++) {
    for (let y = 0; y < map0.height && !off; y++) {
      if (dungeon.incrementLevel(new Position(x, y, 0), 1) === null) off = new Position(x, y, 0);
    }
  }
  if (!off) throw new Error('every square of level 0 is over level 1');
  const clamp = (v: number, size: number): number => Math.min(Math.max(v, 0), size - 1);
  const nearest = `1:(${clamp(map0.offsetX + off.x - map1.offsetX, map1.width)},${clamp(map0.offsetY + off.y - map1.offsetY, map1.height)})`;
  game.ctx.party.state.position = off;
  const fell = game.devChangeLevel(1);
  runVbl(game, TICK_DUE);
  console.log(`from 0:(${off.x},${off.y}), off level 1 (${map1.width}x${map1.height} at (${map1.offsetX},${map1.offsetY})), down: ${party(game)}`);
  check(fell && party(game) === nearest, 'off the level below, down puts the party on its nearest square');

  game.ctx.party.state.position = new Position(off.x, off.y, 0);
  const above = game.devChangeLevel(-1);
  game.ctx.party.state.position = new Position(0, 0, 13);
  const pastLast = game.devChangeLevel(1);
  runVbl(game, TICK_DUE);
  console.log(`up from map 0: ${above}; down from map 13: ${pastLast}, ${party(game)}`);
  check(!above && !pastLast && party(game) === '13:(0,0)', 'nothing above map 0, nothing below the last map');
  console.log('');
}

function keys(): void {
  console.log('=== 2. the keys ===');
  const game = newGame(stockDungeon(), stockGraphics());
  game.systems.hallOfChampions.addChampion(testChampion(0));
  const ui = newUIState(stockGraphics(), game.ctx);
  const screen = {
    isDialogOpen: () => false,
    isReincarnateScreenOpen: () => false,
    isHintOracleUp: () => false,
    translateKey: (code: string) => tableKeyButton(ui, code),
    handleUIKey: () => false,
  } as unknown as GameScreen;
  const press = (code: string): KeyPress => ({ key: code, code, ctrlKey: false, metaKey: false, altKey: false });
  const buttons: number[] = [];
  const enqueue = game.enqueueKeyButton.bind(game);
  game.enqueueKeyButton = (button: number) => { buttons.push(button); return enqueue(button); };

  const asked: number[] = [];
  const dev = new GameInput({
    game, screen, refreshScreen: () => {}, onQuickSave: () => {}, onQuickLoad: () => {},
    onDevLevel: (delta) => { asked.push(delta); },
  });
  const minus = dev.keyDown(press('Minus'));
  const equal = dev.keyDown(press('Equal'));
  console.log(`with ?dev: Minus ${minus}, Equal ${equal}, asked ${asked.join(' ')}, buttons ${buttons.join(' ') || 'none'}`);
  check(minus && equal && asked.join(' ') === '1 -1' && buttons.length === 0, 'with ?dev, Minus goes down and Equal up, and no button is queued');

  const plain = new GameInput({ game, screen, refreshScreen: () => {}, onQuickSave: () => {}, onQuickLoad: () => {} });
  plain.keyDown(press('Minus'));
  plain.keyDown(press('Equal'));
  console.log(`without: buttons ${buttons.join(' ') || 'none'}, bThreeDMovements ${game.ctx.rules.bThreeDMovements}`);
  check(buttons.length === 0 && !game.ctx.rules.bThreeDMovements, 'without it, in DM, they are nothing');
}

levels();
keys();
finish();
