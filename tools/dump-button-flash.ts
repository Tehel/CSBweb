/**
 * Prove the button flash: `FlashButton`, the VBL that inverts its rectangle, and
 * `WaitForButtonFlash`, which has the next VBL put it back.
 *
 * - `_FlashButton` stores the rectangle, sets `d.FlashButnActive` and waits a VBL
 *   (doc/CSBwin-src/CSBCode.cpp:7800-7817). The VBL clears `d.FlashButnActive`, toggles
 *   `d.Word11776` and inverts the rectangle (`:1038-1048`). The port's pass does not stop
 *   for the VBL: the rectangle is inverted at once, before the rest of the pass.
 * - `WaitForButtonFlash` sets `d.FlashButnActive` again while `d.Word11776` is set
 *   (`:8666-8706`), so the next VBL puts the rectangle back. The main loop calls it at
 *   `tag000730`, after the tick's `DrawViewport` (`:648`, `:665`), and on a pass without a
 *   tick (`:773`). So the tick after a move draws the arrow inverted, and the next VBL puts
 *   it back: one frame of flash.
 * - `_TurnParty` flashes `(0xea, 0x0105, 0x7d, 0x91)` for a turn left and `(0x123, 0x13e,
 *   0x7d, 0x91)` for a turn right (`:7983-7990`); `HandleMouseEvents` flashes the step
 *   arrow `d.MoveButn18496[button - 3]` that `MoveParty` returns (`Mouse.cpp:1695-1706`,
 *   `CSBCode.cpp:8224-8226`), even a step a wall refuses, which brings no tick (`:8397-8401`).
 * - `TAG01b29a` comes after `d.Time++` and `d.freezeLifeTimer--` (`:670-695`), and after
 *   the put-back `WaitForButtonFlash` waits for: a tick that asked for one paints nothing
 *   more in its VBL (`Game.paintHeld`), and the put-back's redraw paints `TAG01b29a`.
 * - `CastMagic` calls `WaitForButtonFlash` first (`Magic.cpp:942`).
 * - `_MagicSelection` is `RESTARTABLE` and waits (`Magic.cpp:548-584`): the cast flashes
 *   `(0xea, 0x12f, 0x3f, 0x49)`, then `CastMagic` waits the flash out and casts; a rune or
 *   the take-back flashes `d.Word18552[4 * (button - 101)]`, waits a VBL, waits the flash
 *   out, and only then changes the incantation. The port runs it as a script.
 * - `_TAG019fac` flashes the attack menu's PASS `(0x11d, 0x13f, 0x4d, 0x53)` and its three
 *   options `(0xea, 0x13e, 0x56, 0x60)`, `(…, 0x62, 0x6c)`, `(…, 0x6e, 0x78)`, each before its
 *   `ExecuteAttack` (`Character.cpp:4694-4734`). The attack's tick draws the option
 *   inverted, and the next VBL puts it back; a PASS brings no tick, and `CSBCode.cpp:773`'s wait puts
 *   it back. An attack key flashes its row as the click would.
 * - `vblFlashButn` flips bit plane 2 over the rectangle, corners included (`VBL.cpp:60-122`),
 *   which is bit 2 of the pixel's index (`WinScreen.cpp:314-330`).
 *
 * Run: `npm test -- --only=dump-button-flash.ts [level]`
 */
import { OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { emptyPossessions, MovementAction, type Champion } from '../src/engine/gameTypes';
import { flashButton, flashedButton, setClockTick, waitForButtonFlash } from '../src/engine/LoopState';
import { createPaletteIndexViewportBuffer, vblFlashButn } from '../src/renderer/csbwin/CanvasBlitter';
import { handleAttackAreaClick, prepareAttack } from '../src/renderer/ui/Attack';
import { handleMagicClick } from '../src/renderer/ui/MagicPanel';
import type { Rect } from '../src/data/tables/UITables';
import { newGame, runVbl, TICK_DUE, stockDungeon, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { check, finish } from './lib/check';
import { ButtonsAt } from './lib/clicks';
import { standIn, wrapMember } from './lib/standIn';
import { handleUIKey } from '../src/renderer/ui/Keyboard';
import { testChampion } from './lib/champion';

/** The button each queued click is taken as (`ButtonsAt`). */
const clicks = new ButtonsAt();

const TURN_LEFT: Rect = { x1: 0xea, x2: 0x0105, y1: 0x7d, y2: 0x91 };
const TURN_RIGHT: Rect = { x1: 0x123, x2: 0x13e, y1: 0x7d, y2: 0x91 };

const show = (r: Rect | null): string => (r ? `(${r.x1}-${r.x2}, ${r.y1}-${r.y2})` : 'none');
const same = (a: Rect | null, b: Rect): boolean =>
  a !== null && a.x1 === b.x1 && a.x2 === b.x2 && a.y1 === b.y1 && a.y2 === b.y2;

async function main(): Promise<void> {
  const data = stockDungeon();
  const graphics = stockGraphics();

  const level = Number(process.argv[2] ?? 1);
  // The tick's `TAG01b29a` and the paint after it, as the host sees them. The host's
  // `drawViewport` is a script's tick's: the main loop's tick draws its viewport once,
  // through `onTick`, and its paint is no second `DrawViewport`.
  const hostLog: string[] = [];
  const game = newGame(data, graphics, {
    tag01b29a: () => hostLog.push(`TAG01b29a d.Time ${game.ctx.state.tickCount} freezeLifeTimer ${game.ctx.party.state.freezeLifeTimer}`),
    drawViewport: () => hostLog.push('a script tick\'s DrawViewport'),
    paint: () => hostLog.push('paint'),
  });
  game.setRandomSeed(0x12345678);
  game.ctx.party.state.position = new Position(0, 0, level);
  game.systems.monsters.loadPartyLevel(level);
  const loop = game.ctx.loop;

  // ---- vblFlashButn: plane 2, corners included ------------------------------------
  const buffer = createPaletteIndexViewportBuffer(320, 200, 0x0b);
  vblFlashButn(buffer, TURN_LEFT);
  const at = (x: number, y: number): number => buffer.pixels[y * 320 + x]!;
  console.log(`vblFlashButn over index 11: corners ${at(234, 125)}/${at(261, 145)}, ` +
    `outside ${at(233, 125)}/${at(262, 145)}/${at(234, 124)}/${at(261, 146)}`);
  check(at(234, 125) === 0x0f && at(261, 145) === 0x0f && at(248, 135) === 0x0f,
    'vblFlashButn should flip bit 2 of every pixel in the rectangle, corners included');
  check(at(233, 125) === 0x0b && at(262, 145) === 0x0b && at(234, 124) === 0x0b && at(261, 146) === 0x0b,
    'vblFlashButn should leave every pixel outside the rectangle alone');

  // ---- the step arrows' rectangles -------------------------------------------------
  const moveButtons = game.ctx.tables.moveButtons;
  console.log(`d.MoveButn18496: ${moveButtons.map(show).join(' ')}`);
  check(moveButtons.length === 4 && moveButtons.every((b) => b.x1 >= 192 && b.x1 < b.x2 && b.y1 < b.y2),
    'the four step arrows should be rectangles right of x = 192');

  // An open cell with an open, monster-free cell in front. The party is empty, so a step
  // costs no stamina and sets no delay.
  const dungeon = game.ctx.dungeon;
  const map = dungeon.getMap(level);
  if (!map) throw new Error(`level ${level} does not exist`);
  const { width, height } = map.descriptor;
  const open = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height &&
    ((dungeon.getCellFlag(new Position(x, y, level)) >> 5) & 0x7) === RoomType.OPEN &&
    dungeon.findFirstMonster(new Position(x, y, level)) === OBJECT_ID_EOF;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  let scene: { x: number; y: number; dir: number } | null = null;
  for (let x = 0; x < width && !scene; x++) {
    for (let y = 0; y < height && !scene; y++) {
      if (!open(x, y)) continue;
      for (let dir = 0; dir < 4; dir++) {
        if (open(x + DIRS[dir]![0], y + DIRS[dir]![1])) { scene = { x, y, dir }; break; }
      }
    }
  }
  if (!scene) throw new Error(`level ${level} has no open cell with an open neighbour`);
  const party = game.ctx.party.state;
  party.champions = [];
  game.setMouseEventHandlers({ translate: clicks.translate, button: () => {}, unclick: () => {} });

  /** One VBL; `tickDue` makes a game tick run in it, after the queue. */
  const frame = (tickDue = false): void => {
    runVbl(game, tickDue ? TICK_DUE : 1);
  };
  let drawnInTick: Rect | null | undefined;
  game.onTick(() => { drawnInTick = flashedButton(game.ctx); });
  const reset = (): void => {
    game.discardAllInput();
    party.position = new Position(scene!.x, scene!.y, level);
    game.ctx.party.setFacing(scene!.dir);
    party.partyMoveDisableTimer = 0;
    party.word11712 = 0;
    game.lastInputTime = 0;
    frame();
    frame();
    game.takeFlashChanged();
    drawnInTick = undefined;
  };
  frame(true);
  frame(true);

  /**
   * Queue `enqueue`, then three VBLs: the move's (whose tick it brings on at once), the
   * next, and one more. What the tick drew, and what stands inverted after each.
   */
  const flashOf = (what: string, enqueue: () => void): { tick: Rect | null | undefined; after: Array<Rect | null>; changed: boolean[]; active: boolean } => {
    reset();
    enqueue();
    frame();
    const active = loop.flashButnActive;
    const after = [flashedButton(game.ctx)];
    const changed = [game.takeFlashChanged()];
    for (let i = 0; i < 2; i++) {
      frame();
      after.push(flashedButton(game.ctx));
      changed.push(game.takeFlashChanged());
    }
    console.log(`${what}: the tick drew ${show(drawnInTick ?? null)}; inverted after each VBL ` +
      `${after.map(show).join(', ')}; redraw due ${changed.join('/')}`);
    return { tick: drawnInTick, after, changed, active };
  };

  // ---- a turn, from a key ----------------------------------------------------------
  const left = flashOf('turn left', () => game.enqueueMovement(MovementAction.TURN_LEFT));
  check(same(left.tick ?? null, TURN_LEFT), 'the tick after a turn left should draw its arrow inverted');
  check(same(left.after[0]!, TURN_LEFT) && left.active,
    'after the turn\'s pass the arrow should stand inverted, its put-back asked of the next VBL (tag000730)');
  check(left.after[1] === null && left.after[2] === null, 'the next VBL should put the arrow back, and it should stay back');
  check(left.changed[0]! && left.changed[1]! && !left.changed[2]!, 'the inversion and the put-back should each ask for a redraw');
  const right = flashOf('turn right', () => game.enqueueMovement(MovementAction.TURN_RIGHT));
  check(same(right.tick ?? null, TURN_RIGHT) && right.after[1] === null, 'a turn right should flash its own arrow for one frame');

  // ---- a step, from a click on the arrow ---------------------------------------------
  const from = { x: scene.x, y: scene.y };
  const step = flashOf('step forward', () => clicks.click(game, 3, moveButtons[0]!.x1 + 1, moveButtons[0]!.y1 + 1));
  check(party.position.x !== from.x || party.position.y !== from.y, 'the step should have been taken');
  check(same(step.tick ?? null, moveButtons[0]!) && step.after[1] === null,
    'a step forward should flash d.MoveButn18496[0] in its tick, and the next VBL put it back');
  // Next to the map's edge, some of these run into a wall: the step is refused, with
  // `d.clockTick = 0` and no tick (`CSBCode.cpp:8397-8401`), but `MoveParty` has its
  // button by then (`:8226`), and the pass's `WaitForButtonFlash` (`:773`) asks for the
  // put-back as the tick's would.
  let refused = 0;
  for (const [num, action] of [[4, MovementAction.STRAFE_RIGHT], [5, MovementAction.MOVE_BACKWARD], [6, MovementAction.STRAFE_LEFT]] as const) {
    const flash = flashOf(`button ${num}`, () => game.enqueueMovement(action));
    const moved = party.position.x !== scene.x || party.position.y !== scene.y;
    if (!moved) refused++;
    check(same(flash.after[0]!, moveButtons[num - 3]!) && flash.after[1] === null,
      `button ${num} should flash d.MoveButn18496[${num - 3}] for one frame, ${moved ? 'taken' : 'refused'}`);
  }
  check(refused > 0, 'the scene should have a refused step, to cover the flash without a tick');

  // ---- a pass without a tick puts it back too (CSBCode.cpp:773) -----------------------------
  reset();
  flashButton(game.ctx, TURN_RIGHT.x1, TURN_RIGHT.x2, TURN_RIGHT.y1, TURN_RIGHT.y2);
  const standing = same(flashedButton(game.ctx), TURN_RIGHT) && !loop.flashButnActive;
  frame();
  const askedWithoutTick = loop.flashButnActive && same(flashedButton(game.ctx), TURN_RIGHT);
  frame();
  const backWithoutTick = flashedButton(game.ctx) === null;
  console.log(`flash, then passes without a tick: standing ${standing}, put-back asked ${askedWithoutTick}, back ${backWithoutTick}`);
  check(standing, 'FlashButton should invert its rectangle before it returns, with nothing left pending');
  check(askedWithoutTick && backWithoutTick, 'a pass without a tick should ask for the put-back, and the next VBL make it');

  // ---- TAG01b29a after d.Time++, painted in its tick unless a put-back waits --------
  // `DrawViewport` (:648), `WaitForButtonFlash` (:665), `d.Time++` (:670),
  // `d.freezeLifeTimer--` (:694), `TAG01b29a` (:695). CSBWin's `WaitForButtonFlash` holds
  // the pass until the put-back, so what `TAG01b29a` draws is on screen only after it.
  game.onTick(() => hostLog.push(`DrawViewport d.Time ${game.ctx.state.tickCount} freezeLifeTimer ${party.freezeLifeTimer}`));
  const tickOrder = (flash: boolean): { time: number; log: string[]; held: boolean; next: { inverted: Rect | null; changed: boolean; held: boolean } } => {
    reset();
    party.freezeLifeTimer = 5;
    hostLog.length = 0;
    const time = game.ctx.state.tickCount;
    if (flash) {
      flashButton(game.ctx, TURN_RIGHT.x1, TURN_RIGHT.x2, TURN_RIGHT.y1, TURN_RIGHT.y2);
      setClockTick(game.ctx, 1);
    }
    frame(!flash);
    const log = [...hostLog];
    const held = game.paintHeld();
    game.takeFlashChanged();
    frame();
    return { time, log, held, next: { inverted: flashedButton(game.ctx), changed: game.takeFlashChanged(), held: game.paintHeld() } };
  };
  const plain = tickOrder(false);
  console.log(`a tick: ${plain.log.join(' | ')}; paint held ${plain.held}`);
  check(plain.log.join(' | ') === `DrawViewport d.Time ${plain.time} freezeLifeTimer 5 | TAG01b29a d.Time ${plain.time + 1} freezeLifeTimer 4 | paint`,
    'TAG01b29a should run after DrawViewport, d.Time++ and d.freezeLifeTimer-- (CSBCode.cpp:648-695), and be painted in its tick, with no second DrawViewport');
  check(!plain.held, 'a tick that asked for no put-back should not hold the paint');
  const flashed = tickOrder(true);
  console.log(`a flash, then its tick: ${flashed.log.join(' | ')}; paint held ${flashed.held}; ` +
    `next VBL inverted ${show(flashed.next.inverted)}, redraw due ${flashed.next.changed}, held ${flashed.next.held}`);
  check(flashed.log.join(' | ') === `DrawViewport d.Time ${flashed.time} freezeLifeTimer 5 | TAG01b29a d.Time ${flashed.time + 1} freezeLifeTimer 4`,
    'with a put-back asked, TAG01b29a should draw without a paint after it');
  check(flashed.held, 'with a put-back asked, the tick should hold the paint for the rest of its VBL');
  check(flashed.next.inverted === null && flashed.next.changed && !flashed.next.held,
    'the next VBL should put the rectangle back and ask for the redraw that paints TAG01b29a');

  // ---- a second flash waits out the first ------------------------------------------
  reset();
  flashButton(game.ctx, TURN_LEFT.x1, TURN_LEFT.x2, TURN_LEFT.y1, TURN_LEFT.y2);
  waitForButtonFlash(game.ctx);
  flashButton(game.ctx, TURN_RIGHT.x1, TURN_RIGHT.x2, TURN_RIGHT.y1, TURN_RIGHT.y2);
  const second = flashedButton(game.ctx);
  console.log(`flash, wait, flash again: inverted ${show(second)}, pending ${loop.flashButnActive}`);
  check(same(second, TURN_RIGHT) && !loop.flashButnActive,
    'a flash after a put-back was asked should wait it out, then invert its own rectangle');
  frame();
  frame();

  // ---- CastMagic waits for the flash first ------------------------------------------
  reset();
  const caster = testChampion(0, { name: 'HERO' });
  party.champions = [caster];
  flashButton(game.ctx, TURN_LEFT.x1, TURN_LEFT.x2, TURN_LEFT.y1, TURN_LEFT.y2);
  game.systems.magic.castSpellFromUi(0);
  console.log(`CastMagic with a flash standing: put-back asked ${loop.flashButnActive}`);
  check(loop.flashButnActive, 'CastMagic should ask for the put-back of a standing flash (Magic.cpp:942)');
  frame();

  // ---- the spell panel: `_MagicSelection` holds the loop through its waits ---------------
  let redraws = 0;
  const ui = newUIState(graphics, game.ctx, { getGraphicBitmap: () => null, renderLastFrame: () => { redraws++; } });
  let castAt = -1;
  let frameNo = 0;
  const magic = game.systems.magic;
  wrapMember(magic, 'castSpellFromUi', (cast) => (chIdx) => { castAt = frameNo; return cast(chIdx); });
  party.magicCasterIndex = 0;
  const word18552 = ui.uiTables.graphic231.word18552;
  const buttons18060 = ui.uiTables.graphic231.buttons.buttons18060;
  console.log(`d.Word18552: ${word18552.map(show).join(' ')}`);
  // The canary: the rectangles flashed are the rectangles clicked, buttons 101-107 of the
  // magic panel's list, and the cast's literal rectangle is button 108's.
  const clickRect = (id: number): Rect => buttons18060.find((b) => b.word0 === id)!;
  check(word18552.length === 7 && word18552.every((r, i) => same(r, clickRect(101 + i))),
    'd.Word18552 should hold the click rectangles of magic buttons 101-107');
  const CAST: Rect = { x1: 0xea, x2: 0x12f, y1: 0x3f, y2: 0x49 };
  check(same(clickRect(108), CAST), "the cast's flash should be button 108's rectangle");

  /** Click magic button `id`, then VBLs until the script lets the loop go: what each showed. */
  const panelClick = (id: number): Array<{ flashed: Rect | null; runes: number; running: boolean }> => {
    const b = clickRect(id);
    handleMagicClick(ui, (b.x1 + b.x2) >> 1, (b.y1 + b.y2) >> 1);
    frameNo = 0;
    const seen = [{ flashed: flashedButton(game.ctx), runes: caster.incantation.length, running: game.isRunningScript() }];
    for (let i = 0; i < 4; i++) {
      frameNo++;
      frame();
      seen.push({ flashed: flashedButton(game.ctx), runes: caster.incantation.length, running: game.isRunningScript() });
    }
    return seen;
  };
  const trace = (seen: ReturnType<typeof panelClick>): string =>
    seen.map((f) => `${show(f.flashed)} ${f.runes} rune(s)${f.running ? ' held' : ''}`).join(' | ');

  caster.attributes.mana = 50;
  redraws = 0;
  const rune = panelClick(101);
  console.log(`rune 101, the click then each VBL: ${trace(rune)}; redrawn ${redraws}`);
  check(rune[0]!.running && rune[0]!.flashed === null && rune[0]!.runes === 0,
    'the click should start the script, which holds the loop before its first VBL');
  check(same(rune[1]!.flashed, word18552[0]!) && same(rune[2]!.flashed, word18552[0]!) && rune[2]!.runes === 0,
    'the rune should stand inverted for two VBLs (FlashButton, then wvbl(_3_)), the incantation unchanged');
  check(rune[3]!.flashed === null && rune[3]!.runes === 1 && !rune[3]!.running && redraws === 1,
    'the third VBL should put the rune back, then the rune be added, the loop let go and the panel redrawn');

  const back = panelClick(107);
  console.log(`take-back 107: ${trace(back)}`);
  check(same(back[1]!.flashed, word18552[6]!) && back[2]!.runes === 1 && back[3]!.flashed === null && back[3]!.runes === 0,
    'the take-back should flash d.Word18552[24..27] for two VBLs, then take the rune back');

  panelClick(101);
  castAt = -1;
  const cast = panelClick(108);
  console.log(`cast 108: ${trace(cast)}; cast at VBL ${castAt}`);
  check(same(cast[1]!.flashed, CAST) && cast[1]!.runes === 1,
    'the cast button should stand inverted for one VBL, the incantation still there');
  check(cast[2]!.flashed === null && castAt === 2 && !cast[2]!.running,
    "CastMagic's WaitForButtonFlash should put it back at the next VBL, and the cast follow");

  // ---- the attack menu: `_TAG019fac` flashes the option taken ----------------------------
  const PASS: Rect = { x1: 0x11d, x2: 0x13f, y1: 0x4d, y2: 0x53 };
  const OPTIONS: Rect[] = [0x56, 0x62, 0x6e].map((y1) => ({ x1: 0xea, x2: 0x13e, y1, y2: y1 + 10 }));
  const buttons17892 = ui.uiTables.graphic231.buttons.buttons17892;
  console.log(`d.Buttons17892: ${buttons17892.map((b) => `${b.word0} ${show(b)}`).join(' ')}`);
  // The canary: the options flash exactly their click rectangles; PASS one column more.
  const attackRect = (id: number): Rect => buttons17892.find((b) => b.word0 === id)!;
  check(OPTIONS.every((r, i) => same(attackRect(113 + i), r)),
    "the three options' flashes should be the click rectangles of buttons 113-115");
  check(same(attackRect(112), { ...PASS, x2: PASS.x2 - 1 }), "PASS's flash should be button 112's rectangle and one column right of it");

  const partner: Champion = { ...caster, name: 'TWO', possessions: emptyPossessions(), partyPosition: 1, incantation: [] };
  party.champions = [caster, partner];
  party.magicCasterIndex = -1;
  game.setMouseEventHandlers({ translate: clicks.translate, button: (num, x, y) => { if (num === 111) handleAttackAreaClick(ui, x, y); }, unclick: () => {} });
  const clickAt = (r: Rect) => () => { clicks.click(game, 111, (r.x1 + r.x2) >> 1, (r.y1 + r.y2) >> 1); };

  prepareAttack(ui, 0);
  const pass = flashOf('PASS', clickAt(attackRect(112)));
  check(pass.tick === undefined && same(pass.after[0]!, PASS) && pass.after[1] === null && pass.after[2] === null,
    'PASS should flash (0x11d, 0x13f, 0x4d, 0x53) with no tick, and the next VBL put it back (CSBCode.cpp:773)');
  check(ui.ctx.interface.attackingCharacterOrdinal === 0, 'PASS should close the menu');

  prepareAttack(ui, 0);
  const offered = ui.ctx.interface.word20248;
  const air = flashOf('option 113 at the air', clickAt(attackRect(113)));
  check(air.tick === undefined && same(air.after[0]!, OPTIONS[0]!) && air.after[1] === null,
    'a blow at the air (0, d.clockTick = 0) should flash the option with no tick, and the next VBL put it back (:773)');
  // A blow that lands returns 1, which makes a tick due. Whether one lands is the attack
  // tools' business: here a stand-in for the engine's `Attack` decides it.
  standIn(game.systems.character, 'executeAttack', () => 1);
  prepareAttack(ui, 0);
  const first = flashOf('option 113, a blow that lands', clickAt(attackRect(113)));
  check(same(first.tick ?? null, OPTIONS[0]!) && same(first.after[0]!, OPTIONS[0]!) && first.after[1] === null,
    "the first option's tick should draw it inverted, and the next VBL put it back");
  check(ui.ctx.interface.attackingCharacterOrdinal === 0, 'the attack should close the menu');

  // Champion 1's key column: W opens its menu, then each key of the column is a row.
  reset();
  const keyRow = (key: string): { inverted: Rect | null; ordinal: number } => {
    handleUIKey(ui, key);
    const result = { inverted: flashedButton(game.ctx), ordinal: ui.ctx.interface.attackingCharacterOrdinal };
    frame();
    frame();
    return result;
  };
  const opened = keyRow('KeyW');
  const third = keyRow('KeyX');
  console.log(`attack keys: W opens (menu ${opened.ordinal}, inverted ${show(opened.inverted)}); ` +
    `X, row 3 of ${offered}, inverted ${show(third.inverted)}, menu ${third.ordinal}`);
  check(opened.ordinal === 2 && opened.inverted === null, "W should open champion 1's menu and flash nothing");
  check(offered === 3 && same(third.inverted, OPTIONS[2]!) && third.ordinal === 0 && flashedButton(game.ctx) === null,
    'X should flash the third row, as its click does, the attack close the menu, and the next VBLs put it back');

  finish();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
