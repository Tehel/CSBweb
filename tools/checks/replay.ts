/**
 * A game logged at its input boundary plays back the same (`doc/RECORDING.md` → "The
 * port's recorder"): the game is a function of its start, its VBLs and the changes the
 * page makes to it (`Game.input`, `src/engine/InputBoundary.ts`), each before the VBL it
 * was logged at.
 *
 * Each game is a page without the DOM: the engine, its screen over a stand-in canvas
 * (`GameScreen`), the page's input path (`GameInput`), its saves over a store in memory
 * (`GameSaves`) and its settings, wired as `src/main.ts` wires them, on a clock the tool
 * moves (`ManualClock`). The recorded page is played as a player plays it: pointer events
 * and keys handed to `GameInput` between uneven wakes of the loop, the screen composed
 * after each input, at every VBL that asks, and at every frame of a menu's press. The
 * replayed page is a fresh one from the same start, fed the log alone: each change applied
 * before its VBL, VBLs run one by one, and the screen drawn only at the tick's
 * `DrawViewport`, which a click in the viewport is resolved through. A dialog that a played
 * VBL opened (the disk menu, from its icon) the replay takes down itself, where the log
 * lets the clock run.
 *
 * Two games, a new one and `csbgame7.dat`, each played through the boundary's doors but
 * a read, the Reincarnate screen and `?dev`'s level keys: clicks and pointer moves, the movement keys, a mirror clicked in the
 * viewport and its champion resurrected, panel keys (a rune, an inventory, an attack and
 * its damage's flash), the settings dialog's held clock and a change of the extras in it,
 * `?dev`'s move, F5 with the clock running, and the disk menu's SAVE with it stopped.
 *
 * 1. Every change is logged at the same VBL, with the same `d.Time` and `d.RandomNumber`,
 *    in both games: what the recorded page composes and the replay does not takes nothing
 *    from the game's stream, and changes nothing the game reads.
 * 2. The two games' final saves are byte-identical.
 *
 * Run: `npm test -- --only=replay.ts`
 */
import { readFileSync } from 'node:fs';

import { CsbRandom } from '../../src/core/random';
import { emptyDungeonData } from '../../src/data/DungeonLoader';
import { Game } from '../../src/engine/Game';
import { GameSaves } from '../../src/engine/GameSaves';
import type { InputChange } from '../../src/engine/InputBoundary';
import { applySaveBytes, buildSaveFile } from '../../src/engine/SaveGameFile';
import { NO_FULLSCREEN } from '../../src/lib/fullscreen';
import { GameInput, type KeyPress } from '../../src/renderer/GameInput';
import { GameScreen } from '../../src/renderer/GameScreen';
import { Presenter } from '../../src/renderer/Presenter';
import { ScrollingText } from '../../src/renderer/csbwin/ScrollingText';
import { hostDrawing } from '../../src/renderer/ui/HostDrawing';
import { searchMouseButtons } from '../../src/renderer/ui/Mouse';
import { openReincarnateScreen } from '../../src/renderer/ui/ReIncarnate';
import { SAVE_MENU_GEOMETRY, saveMenuButtons } from '../../src/renderer/ui/SaveMenu';
import { UIMode, type UIState } from '../../src/renderer/ui/UIState';
import { VIEWPORT_X, VIEWPORT_Y } from '../../src/renderer/ViewportGraphics';
import { Settings, applyToGame } from '../../src/settings/Settings';
import { check, finish } from '../lib/check';
import { ManualClock } from '../lib/clock';
import { STOCK_DATA_SET, diskFiles } from '../lib/dataSets';
import { STOCK_DIR, gameTablesOf, graphicsTablesOf, stockGraphics } from '../lib/game';
import { memoryStore, savePath } from '../lib/saves';

/**
 * Where a game starts: a new game of the stock set, or a save read. A new game's stream
 * is drawn from `Math.random` as its world is read (`Game.readNewGame`), and its
 * `d.RandomGameID` again while a save holds it (`GameSaves.newGameRead`), so the
 * recording carries both as the read leaves them, and the replay takes them over its own.
 */
type Start =
  | { readonly kind: 'new'; readonly begun?: { readonly random: number; readonly randomGameID: number } }
  | { readonly kind: 'save'; readonly bytes: Uint8Array };

/** The recorded new game's stream, pinned once its world is read, so its run is the same every time. */
const NEW_GAME_SEED = 0x2b5a1c07;

/** A change as the boundary told it, with the game's clock and stream as they stood. */
interface Logged {
  readonly change: InputChange;
  readonly vbl: number;
  /** `d.Time`. */
  readonly time: number;
  /** `d.RandomNumber`. */
  readonly random: number;
}

const DUNGEON = new Uint8Array(readFileSync(`${STOCK_DIR}/dungeon.dat`));

/** Let what the page awaits settle: the store's promises, and the timers of a menu's press. */
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** A page without the DOM, wired as `src/main.ts` wires one (`construct`, `wire`). */
class Page {
  readonly clock = new ManualClock();
  /** The store's writes, a save written over another's row included. */
  writes = 0;
  readonly store = memoryStore(() => { this.writes++; });
  readonly game: Game;
  readonly screen: GameScreen;
  readonly input: GameInput;
  readonly saves: GameSaves;
  readonly settings = new Settings(null);
  readonly log: Logged[] = [];
  /** The screens composed: the tick's views, and the rest. */
  views = 0;
  composed = 0;

  /**
   * `recorded`: the screen composed as the page composes it, after every input and at
   * every VBL that asks. Otherwise only the tick's `DrawViewport`, as a player draws.
   */
  private constructor(private readonly recorded: boolean) {
    const graphics = stockGraphics();
    const tables = gameTablesOf(graphics);
    const messages = new ScrollingText(tables.byte1830);
    let screen: GameScreen | null = null;
    let saves: GameSaves | null = null;
    const drawing = hostDrawing(() => screen?.ui ?? null);
    const game = new Game(emptyDungeonData(), tables, {
      messages,
      clock: this.clock,
      sleepChanged: (sleeping) => {
        screen?.setUIMode(sleeping ? UIMode.Sleeping : UIMode.Adventure);
        messages.setPartySleeping(sleeping);
      },
      openReincarnateScreen: (chIdx) => { if (screen) openReincarnateScreen(screen.ui, chIdx); },
      ...drawing,
      championJoined: () => saves?.championJoined(),
      die: (error) => { throw error; },
      drawViewport: () => this.renderView(),
      paint: () => { if (this.recorded) this.refreshScreen(); },
    });
    saves = new GameSaves(game, STOCK_DATA_SET, diskFiles(STOCK_DATA_SET), this.store, {
      portraitOf: drawing.portraitOf,
      askBeginAdventure: () => { throw new Error('no prison in this dungeon'); },
    }, () => {}, new CsbRandom(1));
    const presenter = new Presenter(() => screen?.animationFrame(game.mainLoopHasReturned()));
    const image = { width: 320, height: 200, data: new Uint8ClampedArray(320 * 200 * 4) };
    const canvas = { getContext: () => ({ createImageData: () => image, putImageData: () => {} }) };
    screen = new GameScreen(canvas as unknown as ConstructorParameters<typeof GameScreen>[0], {
      graphicsLoader: graphics,
      tables: graphicsTablesOf(graphics),
      ctx: game.ctx,
      messages,
      hintOracle: null,
    }, {
      onReincarnated: () => this.refreshScreen(),
      onListSaves: () => this.saves.list(),
      onListEverySave: () => this.saves.listEverySet(),
      onReadSave: (entry) => this.saves.open(entry),
      onMakeNewAdventure: () => { throw new Error('no RISE in this tool'); },
      onHasNewFaces: async () => false,
      onSaveGame: (over) => this.saves.save('stopped', over ?? 'new'),
      isPrison: () => this.saves.inPrison(),
      onExportSave: () => { throw new Error('no export in this tool'); },
      onDeleteSave: (entry) => this.saves.remove(entry),
      onImportSave: () => { throw new Error('no import in this tool'); },
      onRestoreSave: (save) => this.saves.read(save),
      onRestoreFailed: (error) => { throw error; },
      onOpenHintOracle: () => { throw new Error('no Hint Oracle in this dungeon'); },
      onSleepSave: () => { void this.saves.sleepSave(); },
      onExit: () => {},
      settings: this.settings,
      isCrtAvailable: () => false,
      fullscreen: NO_FULLSCREEN,
      keyboardLayout: () => null,
      onTeleport: null,
    }, presenter, () => {});
    this.game = game;
    this.screen = screen;
    this.saves = saves;
    this.input = new GameInput({
      game,
      screen,
      refreshScreen: () => this.refreshScreen(),
      onQuickSave: () => { void this.saves.quickSave(); },
      onQuickLoad: () => { void this.saves.quickLoad(); },
      onDevLevel: null,
    });
    this.input.install();
    this.settings.subscribe((values) => applyToGame(game, values));
    game.onTick(() => {
      const { selectedCharacterIndex, sleeping } = game.ctx.party.state;
      if (selectedCharacterIndex < 0 && !sleeping) this.renderView();
    });
    if (recorded) {
      game.onFrame(() => {
        if (game.paintHeld()) return;
        const scrolled = messages.takeChanged();
        const flashed = game.takeFlashChanged();
        const moved = screen.takeCursorMoved();
        const wheeled = screen.takeWheelTurned();
        if (scrolled || flashed || moved || wheeled) this.refreshScreen();
      });
    }
  }

  /**
   * A page whose game is `start`, read and begun as the page begins one, and logged from
   * then on. A new game recorded has no `begun` yet: the page's is `begun`.
   */
  static async open(start: Start, recorded: boolean): Promise<Page> {
    const page = new Page(recorded);
    const { game } = page;
    const { state } = game.ctx;
    if (start.kind === 'new') {
      game.readDungeonDat(DUNGEON);
      if (start.begun) {
        game.ctx.random.setSeed(start.begun.random);
        state.block1.randomGameID = start.begun.randomGameID;
      } else {
        game.ctx.random.setSeed(NEW_GAME_SEED);
        await page.saves.newGameRead();
      }
      page.begun = { random: game.ctx.random.getSeed(), randomGameID: state.block1.randomGameID };
    } else {
      applySaveBytes(game, start.bytes);
    }
    game.forceDMRulesAtBoot();
    game.start(true);
    game.input.listen((change, vbl) => {
      page.log.push({ change, vbl, time: state.tickCount, random: game.ctx.random.getSeed() });
    });
    return page;
  }

  /** A new game's stream and playthrough as its read left them. */
  begun: { random: number; randomGameID: number } | null = null;

  get ui(): UIState {
    return this.screen.ui;
  }

  private renderView(): void {
    if (this.game.mainLoopHasReturned()) return;
    const party = this.game.ctx.party;
    this.views++;
    this.screen.syncParty();
    this.screen.drawViewport(party.state.position, party.state.facing, this.game.ctx.state.word1868);
  }

  private refreshScreen(): void {
    if (this.game.mainLoopHasReturned()) return;
    this.composed++;
    this.screen.syncParty();
    this.screen.refreshOverlay();
  }

  /** The disk menu a VBL opened, taken down by the player: the interface's alone, the clock the log's. */
  takeDownDialog(): void {
    this.ui.saveMenu = null;
    this.ui.dialog = null;
  }

  /** The final save, as the disk menu would write it now. */
  saveFile(): Uint8Array {
    return buildSaveFile(this.game, { portraitOf: (champion) => this.game.ctx.host.portraitOf(champion) });
  }
}

/* ------------------------------------------------------------ the player ---- */

/**
 * Plays the recorded page: events handed to its input path, the loop woken between them
 * after uneven waits, from a stream of the tool's own.
 */
class Player {
  private readonly waits = new CsbRandom(0x5eed);

  constructor(readonly page: Page) {}

  /** One wake of the loop after `ms`: the VBLs the wall clock has let pass. */
  private wake(ms: number): void {
    this.page.clock.advance(ms);
  }

  /** About `ms` of play, in wakes of 1 to 70 ms. */
  play(ms: number): void {
    for (let gone = 0; gone < ms;) {
      const wait = 1 + this.waits.below(70);
      this.wake(wait);
      gone += wait;
    }
  }

  move(x: number, y: number): void {
    this.page.input.mouseMove(x, y);
    this.play(30);
  }

  /** A press and its release at (x, y), the pointer moved there first; `button` is `MouseEvent.button`'s. */
  click(x: number, y: number, button = 0): void {
    this.page.input.mouseMove(x, y);
    this.page.input.mouseDown(x, y, button);
    this.play(40 + this.waits.below(80));
    this.page.input.mouseUp();
    this.play(60 + this.waits.below(200));
  }

  key(code: string, key = ''): void {
    const press: KeyPress = { key, code, ctrlKey: false, metaKey: false, altKey: false };
    this.page.input.keyDown(press);
    this.play(80 + this.waits.below(200));
  }

  /** The middle of the screen's points whose search gives button `id`. */
  pointOf(id: number): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 320; x++) {
        if (searchMouseButtons(this.page.ui, x, y, 2) === id) { sx += x; sy += y; n++; }
      }
    }
    if (n === 0) throw new Error(`no button ${id} on the screen`);
    return { x: Math.round(sx / n), y: Math.round(sy / n) };
  }

  /** The settings dialog opened with Esc, the clock held through some VBLs, `change` made in it, and closed. */
  async settingsDialog(change: () => void): Promise<void> {
    this.key('Escape', 'Escape');
    check(this.page.game.ctx.state.paused && this.page.ui.dialog !== null, 'Esc opens the settings and holds the clock');
    change();
    this.play(300);
    this.key('Escape', 'Escape');
    check(!this.page.game.ctx.state.paused, 'and Esc closes it and lets the clock run');
  }

  /** F5: the quick-save, with the clock running. */
  async quickSave(): Promise<void> {
    const before = this.page.store.files.size;
    this.key('F5');
    await settle();
    check(this.page.store.files.size === before + 1, 'F5 writes a save with the clock running');
  }

  /**
   * The disk icon of the first champion's inventory clicked, the menu's SAVE pressed with
   * the clock stopped, the menu closed with Esc, and the inventory with its key.
   */
  async diskMenuSave(): Promise<void> {
    const before = this.page.writes;
    this.key('Digit7', '7');
    const disk = this.pointOf(140);
    this.click(disk.x, disk.y);
    await settle();
    const menu = this.page.ui.saveMenu;
    check(menu !== null && this.page.game.ctx.state.paused, 'the disk icon opens the menu, the clock stopped');
    if (!menu) return;
    const save = saveMenuButtons(menu).find((b) => b.word0 === SAVE_MENU_GEOMETRY.saveButtonId)!;
    const x = (save.x1 + save.x2) >> 1;
    const y = (save.y1 + save.y2) >> 1;
    this.page.input.mouseMove(x, y);
    this.page.input.mouseDown(x, y, 0);
    this.page.input.mouseUp();
    for (let n = 0; n < 200 && (this.page.writes === before || this.page.ui.saveMenu?.busy || this.page.ui.saveMenu?.press); n++) {
      await settle(10);
    }
    this.play(200);
    check(this.page.writes === before + 1, 'and its SAVE writes a save with the clock stopped');
    this.key('Escape', 'Escape');
    check(this.page.ui.saveMenu === null && !this.page.game.ctx.state.paused, 'Esc closes the menu and lets the clock run');
    this.key('Digit7', '7');
  }

  /** Pointer moves over the viewport and the panels, each composing the screen at the VBL's frame. */
  wander(): void {
    for (const [x, y] of [[40, 60], [160, 120], [250, 80], [300, 160], [110, 100]] as const) this.move(x, y);
  }
}

/* ---------------------------------------------------------- the two games ---- */

/** A new game: walks, a mirror clicked in the viewport and its champion resurrected, then the rest. */
async function newGameScript(player: Player): Promise<void> {
  const { page } = player;
  const { game } = page;
  player.play(500);
  player.wander();
  player.key('Numpad7');
  player.key('KeyL');
  player.play(400);
  // Up to Iaido's mirror, the south face of (10,3): `?dev`'s move, then the party turned to face it.
  check(game.devMoveParty(0, 10, 4), '`?dev` moves the party below Iaido\'s mirror');
  page.input.mouseMove(100, 100);
  while (game.ctx.party.state.facing !== 0) player.key('KeyL');
  player.play(600);
  player.click(VIEWPORT_X + 112, VIEWPORT_Y + 50);
  player.play(300);
  const potential = game.ctx.party.state.potentialChampionIndex;
  check(potential >= 0, `a click on the mirror in the viewport brings its champion (${potential})`);
  const resurrect = page.ui.uiTables.graphic231.buttons.buttons18372[0]!;
  player.click((resurrect.x1 + resurrect.x2) >> 1, (resurrect.y1 + resurrect.y2) >> 1);
  player.play(500);
  const party = game.ctx.party.state;
  check(party.champions.length === 1 && party.potentialChampionIndex < 0, `and RESURRECT adds ${party.champions[0]?.name ?? 'nobody'}`);
  player.key('KeyQ', 'q');
  player.key('KeyQ', 'q');
  player.play(1500);
  player.key('Digit1', '1');
  player.key('Digit7', '7');
  player.wander();
  player.key('Digit7', '7');
  await player.settingsDialog(() => page.settings.update({ extras: { ...page.settings.values.extras, unlimitedKeyQueue: true } }));
  for (let n = 0; n < 6; n++) page.input.keyDown({ key: '', code: 'KeyK', ctrlKey: false, metaKey: false, altKey: false });
  player.play(3000);
  await player.quickSave();
  player.play(800);
  await player.diskMenuSave();
  player.key('Comma');
  player.play(2000);
}

/** `csbgame7.dat`: the party put before a Stone Golem, which its attacks hit, among the rest. */
async function saveScript(player: Player): Promise<void> {
  const { page } = player;
  const { game } = page;
  player.play(400);
  player.wander();
  // The golem at (18,12) of map 6, from the square south of it, facing north.
  check(game.devMoveParty(6, 18, 13), '`?dev` moves the party before the Stone Golem');
  player.play(600);
  let flashed = 0;
  game.onFrame(() => { if (game.ctx.interface.attackFlashVbls !== 0) flashed++; });
  for (let n = 0; n < 4; n++) {
    player.key('KeyQ', 'q');
    player.play(300);
    player.key('KeyQ', 'q');
    player.play(1800);
  }
  check(flashed > 0, `an attack hits, and its damage flashes (${flashed} VBLs)`);
  player.click(VIEWPORT_X + 112, VIEWPORT_Y + 70);
  player.key('Digit2', '2');
  player.key('Digit3', '3');
  player.key('Backquote', '`');
  await player.settingsDialog(() => page.settings.update({ extras: { ...page.settings.values.extras, gatherThrownWeapons: true } }));
  await player.quickSave();
  player.wander();
  player.key('Numpad5');
  player.play(1500);
  await player.diskMenuSave();
  player.key('Numpad8');
  player.play(3000);
}

/** `start` played by `script` and logged, then the log played back in a fresh page. */
async function replay(name: string, start: Start, script: (player: Player) => Promise<void>): Promise<void> {
  console.log(`\n=== ${name} ===`);
  const recorded = await Page.open(start, true);
  await script(new Player(recorded));
  const log = recorded.log;
  const kinds = new Map<string, number>();
  for (const { change } of log) kinds.set(change.kind, (kinds.get(change.kind) ?? 0) + 1);
  console.log(`  recorded: ${recorded.game.input.vbls} VBLs, d.Time ${recorded.game.ctx.state.tickCount}, ${log.length} changes`);
  console.log(`  ${[...kinds].map(([kind, n]) => `${kind} ${n}`).join(', ')}`);
  for (const kind of ['click', 'unclick', 'key', 'panelKey', 'pause', 'tag0207cc', 'extras', 'saveWritten', 'devMove']) {
    check(kinds.has(kind), `the game takes the boundary's ${kind}`);
  }

  const played = await Page.open(start.kind === 'new' ? { kind: 'new', begun: recorded.begun! } : start, false);
  const { game } = played;
  for (const entry of log) {
    while (game.input.vbls < entry.vbl) game.runFrame();
    if (entry.change.kind === 'pause' && !entry.change.paused && played.ui.saveMenu) played.takeDownDialog();
    game.input.apply(entry.change);
    await settle();
  }
  while (game.input.vbls < recorded.game.input.vbls) game.runFrame();

  console.log(`  composed: recorded ${recorded.views} views and ${recorded.composed} screens more, replayed ${played.views} and ${played.composed}`);
  const parted = played.log.findIndex((entry, n) => {
    const was = log[n];
    return !was || JSON.stringify(entry) !== JSON.stringify(was);
  });
  if (parted >= 0) {
    console.log(`  recorded: ${JSON.stringify(log[parted])}`);
    console.log(`  replayed: ${JSON.stringify(played.log[parted])}`);
  }
  check(parted < 0 && played.log.length === log.length,
    `every change is replayed at its VBL, with d.Time and d.RandomNumber as recorded (${played.log.length} of ${log.length})`);
  const a = recorded.saveFile();
  const b = played.saveFile();
  const differ = a.length !== b.length ? Math.min(a.length, b.length) : a.findIndex((byte, n) => byte !== b[n]);
  check(differ < 0, `and the two final saves are byte-identical (${a.length} bytes${differ < 0 ? '' : `, first difference at ${differ}`})`);
}

await replay('a new game', { kind: 'new' }, newGameScript);
await replay('csbgame7.dat', { kind: 'save', bytes: new Uint8Array(readFileSync(savePath('csbgame7.dat'))) }, saveScript);
finish();
