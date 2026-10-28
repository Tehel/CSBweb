/**
 * A game logged at its input boundary plays back the same (`doc/RECORDING.md` → "The
 * port's recorder"): the game is a function of its start, its VBLs and the changes the
 * page makes to it (`Game.input`, `src/engine/InputBoundary.ts`), each before the VBL it
 * was logged at.
 *
 * Each game is a page without the DOM: the engine, its screen over a stand-in canvas
 * (`GameScreen`), the page's input path (`GameInput`), its saves over a store in memory
 * (`GameSaves`), its recorder (`Recorder`) and its settings, wired as `src/main.ts` wires
 * them, on a clock the tool moves (`ManualClock`). The recorded page reads its game as the
 * page does, the extras set first, and is played as a player plays it: pointer events and
 * keys handed to `GameInput` between uneven wakes of the loop, the screen composed after
 * each input, at every VBL that asks, and at every frame of a menu's press. The replayed
 * page is a fresh one fed the recording alone, as the recorded page's store holds it
 * (`RecordingWriter` over a store in memory, written every five seconds of the clock as
 * the page writes it): its start read, its rules and extras set,
 * each change applied before its VBL, VBLs run one by one, and the screen drawn only at
 * the tick's `DrawViewport`, which a click in the viewport is resolved through. A dialog
 * that a played VBL opened (the disk menu, from its icon) the replay takes down itself,
 * where the recording lets the clock run.
 *
 * Two games, a new one and `csbgame7.dat`, each played through the boundary's doors but
 * a read, the Reincarnate screen and `?dev`'s level keys: clicks and pointer moves, the movement keys, a mirror clicked in the
 * viewport and its champion resurrected, panel keys (a rune, an inventory, an attack and
 * its damage's flash), the settings dialog's held clock and a change of the extras in it,
 * `?dev`'s move, F5 with the clock running, and the disk menu's SAVE with it stopped.
 *
 * 1. A read begins a recording: a new game's from its stream and playthrough, a save's
 *    from its file, with the rules and the extras, and the boot's DM rules its first change.
 * 2. Every change is recorded at the same VBL, with the same `d.Time` and `d.RandomNumber`,
 *    in both games: what the recorded page composes and the replay does not takes nothing
 *    from the game's stream, and changes nothing the game reads.
 * 3. The two games' final saves are byte-identical.
 * 4. A read ends a recording, and F9's begins the next from the save it reads.
 * 5. The store holds a recording as it grows: before its last write, what the page had
 *    written when it was closed, the changes so far; after it, the whole recording, which
 *    the replay plays. A write that fails is written again at the next. The recording a
 *    read replaced is finished, ended, at the next write, and one no save links, left in
 *    the store before the game, is gone at the first.
 * 6. The recordings make a tree: F5's save and the disk menu's name the recording and
 *    their point in it, before their tail; F9's read of the disk menu's save begins a
 *    branch of the recording at that point, with what the read left beside the file
 *    (`CarriedState`). The branch, played on with a save in it, replays from its own
 *    start alone, and from its root through the join: the root replayed up to the point
 *    makes the very file the branch read, and the branch read over it, what the read left
 *    set, plays out as recorded. The join needs that state: without it, the final saves
 *    differ.
 * 7. What no save and no running game reaches is pruned: at a load, the recording
 *    replaced is cut at the last point a save or a branch names; at a save deleted, at
 *    the one before it; at a save written over, a branch no save reaches any more is
 *    removed, its parts with it; a recording the running branch joins is kept. Another
 *    page's prune cuts the running branch, and its page's next write writes it whole
 *    again. The branch still replays from its root through the join.
 *
 * Run: `npm test -- --only=replay.ts`
 */
import { readFileSync } from 'node:fs';

import { CsbRandom } from '../../src/core/random';
import { emptyDungeonData } from '../../src/data/DungeonLoader';
import { readSaveFileFields, type RecordingEntry, type SaveEntry } from '../../src/data/saves';
import { Game } from '../../src/engine/Game';
import { NO_EXTRAS } from '../../src/engine/GameContext';
import { GameSaves } from '../../src/engine/GameSaves';
import { applyExtras } from '../../src/engine/InputBoundary';
import { Recorder, setCarriedState, type Recording, type RecordingPoint } from '../../src/engine/Recorder';
import { RecordingWriter } from '../../src/engine/RecordingWriter';
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
import { memoryRecordingStore, memoryStore, savePath } from '../lib/saves';

/** Where a recorded game starts: a new game of the stock set, or a save's file read. */
type Start = 'new' | Uint8Array;

/** The recorded new game's stream, pinned once its world is read, so its run is the same every time. */
const NEW_GAME_SEED = 0x2b5a1c07;

/** The extras the recorded games begin with, which only their recordings give the replays. */
const START_EXTRAS = { ...NO_EXTRAS, drinkAtFountain: true, showItemProperties: true };

const DUNGEON = new Uint8Array(readFileSync(`${STOCK_DIR}/dungeon.dat`));

/** How often the page writes the running recording (`RECORDING_WRITE_MS`, `src/main.ts`). */
const RECORDING_WRITE_MS = 5000;

/** The pages' recordings' ids, one count for every page, which may share a store. */
let recordingIds = 0;

/** The id of a recording left in the store before the recorded game, which no save links. */
const EARLIER = 'earlier';

/** Let what the page awaits settle: the store's promises, and the timers of a menu's press. */
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** A page without the DOM, wired as `src/main.ts` wires one (`construct`, `wire`). */
class Page {
  readonly clock = new ManualClock();
  /** The store's writes, a save written over another's row included. */
  writes = 0;
  readonly store: ReturnType<typeof memoryStore>;
  readonly game: Game;
  readonly screen: GameScreen;
  readonly input: GameInput;
  readonly saves: GameSaves;
  readonly settings = new Settings(null);
  readonly recorder: Recorder;
  /** Whether the recording store refuses its writes. */
  readonly storeFull = { now: false };
  readonly recordingStore: ReturnType<typeof memoryRecordingStore>;
  readonly recordings: RecordingWriter;
  /** The clock's time the running recording was last written at. */
  private writtenAt = this.clock.time;
  /** The screens composed: the tick's views, and the rest. */
  views = 0;
  composed = 0;

  /**
   * `recorded`: the screen composed as the page composes it, after every input and at
   * every VBL that asks. Otherwise only the tick's `DrawViewport`, as a player draws.
   * `shared`: a page whose stores this one writes to as well, as another tab's.
   */
  private constructor(private readonly recorded: boolean, shared: Page | null = null) {
    this.store = shared?.store ?? memoryStore(() => { this.writes++; });
    this.recordingStore = shared?.recordingStore ?? memoryRecordingStore(this.storeFull);
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
    this.recorder = new Recorder(game, 'replay', STOCK_DATA_SET.id, () => `recording-${++recordingIds}`);
    this.recordings = new RecordingWriter(this.recorder, this.recordingStore, this.store, { now: () => this.clock.time });
    saves = new GameSaves(game, STOCK_DATA_SET, diskFiles(STOCK_DATA_SET), this.store, {
      portraitOf: drawing.portraitOf,
      askBeginAdventure: () => { throw new Error('no prison in this dungeon'); },
    }, () => {}, new CsbRandom(1), async () => [], this.recorder);
    saves.onRowGone(() => { void this.recordings.prune().catch(() => {}); });
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
   * A page whose game is `start`, read and begun as the page reads and begins one: its
   * extras `START_EXTRAS`, then the read, which begins the recording (`GameSaves`), then
   * the boot's DM rules and the loop.
   */
  static async record(start: Start): Promise<Page> {
    const page = new Page(true);
    const { game, saves } = page;
    page.settings.update({ extras: START_EXTRAS });
    if (start === 'new') {
      game.readDungeonDat(DUNGEON);
      game.ctx.random.setSeed(NEW_GAME_SEED);
      await saves.newGameRead();
    } else {
      const entry: SaveEntry = {
        id: 'start.dat', name: 'start.dat', dataSet: STOCK_DATA_SET.id, quick: false, sleep: false,
        savedAt: 1000, usedAt: 1000, playTime: 1234, unofficial: false, recording: null, ...readSaveFileFields(start)!,
      };
      await page.store.write(entry, start);
      saves.read(await saves.open(entry));
    }
    game.forceDMRulesAtBoot();
    game.start(true);
    return page;
  }

  /**
   * A fresh page at `recording`'s start, from the recording alone: the new game's world
   * read and its stream and playthrough set, or the save read and what its read left
   * beside the file set; the rules and the extras set; its own recorder begun there, and
   * the loop. The boot's DM rules are a root's first change. `shared`: a page whose stores
   * this one writes its recording to, as another tab's.
   */
  static replay(recording: Recording, shared: Page | null = null): Page {
    const page = new Page(false, shared);
    const { game } = page;
    const { ctx } = game;
    const { start } = recording;
    if (start.kind === 'new') {
      game.readDungeonDat(DUNGEON);
      ctx.random.setSeed(start.random);
      ctx.state.block1.randomGameID = start.randomGameID;
      page.begin(recording);
    } else {
      page.join(recording);
    }
    game.start(true);
    return page;
  }

  /**
   * `branch` read over the game this page plays, as its join is played: its save read,
   * what the recorded read left beside the file set, its rules and its extras; the disk
   * menu a played VBL opened taken down where the read let the clock run; its own
   * recorder begun there.
   */
  join(branch: Recording): void {
    const { start } = branch;
    if (start.kind !== 'save') throw new Error('a branch starts from a save');
    applySaveBytes(this.game, start.bytes);
    if (start.carried) setCarriedState(this.game, start.carried);
    if (!this.game.ctx.state.paused && this.ui.saveMenu) this.takeDownDialog();
    this.begin(branch);
  }

  /** `recording`'s rules and extras set, and this page's recorder begun at its start. */
  private begin(recording: Recording): void {
    const { ctx } = this.game;
    Object.assign(ctx.rules, recording.rules);
    applyExtras(ctx, recording.extras);
    this.recorder.begin(recording.start, recording.parent);
  }

  /**
   * `recording`'s changes applied to this page's game, each before the VBL it was logged
   * at, counted from the recording this page's recorder began at its start or its join;
   * then its VBLs run, up to `until` where the join of a branch is.
   */
  async play(recording: Recording, until: { changes: number; vbls: number } = { changes: recording.changes.length, vbls: recording.vbls }): Promise<void> {
    const { game } = this;
    const vbls = () => this.recorder.point()!.vbls;
    for (const entry of recording.changes.slice(0, until.changes)) {
      while (vbls() < entry.vbl) game.runFrame();
      if (entry.change.kind === 'pause' && !entry.change.paused && this.ui.saveMenu) this.takeDownDialog();
      game.input.apply(entry.change);
      await settle();
    }
    while (vbls() < until.vbls) game.runFrame();
  }

  /** The running recording written, as the page writes it every `RECORDING_WRITE_MS`. */
  writeOnTime(): void {
    if (this.clock.time - this.writtenAt < RECORDING_WRITE_MS) return;
    this.writtenAt = this.clock.time;
    void this.recordings.flush().catch(() => {});
  }

  /** What the recorder has of the game. */
  get recording(): Recording {
    return this.recorder.recording!;
  }

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

  /** The disk menu a VBL opened, taken down by the player: the interface's alone, the clock the recording's. */
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
    this.page.writeOnTime();
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
    await this.savedAtItsPoint(true);
  }

  /**
   * The save just made was made in the running recording, at the point its file was
   * made: the changes recorded before it, its tail (`saveWritten`) the next, and the
   * VBLs at that.
   */
  private async savedAtItsPoint(quick: boolean): Promise<void> {
    const recording = this.page.recording;
    const row = (await this.page.saves.list()).find((entry) => entry.quick === quick)!;
    const point = row.recording;
    const tail = point && recording.changes[point.changes];
    check(point?.recording === recording.id && tail?.change.kind === 'saveWritten' && tail.vbl === point.vbls,
      `its row names the recording and its point there, before its tail (${point?.changes} changes, ${point?.vbls} VBLs)`);
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
    await this.savedAtItsPoint(false);
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

/** The first of two byte arrays' differences, or -1. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  return a.length !== b.length ? Math.min(a.length, b.length) : a.findIndex((byte, n) => byte !== b[n]);
}

/** Whether two recordings are the same, their start's file byte for byte. */
function sameRecording(a: Recording, b: Recording): boolean {
  const bytes = (r: Recording) => (r.start.kind === 'save' ? r.start.bytes : null);
  const [fileA, fileB] = [bytes(a), bytes(b)];
  if ((fileA === null) !== (fileB === null) || (fileA && fileB && firstDifference(fileA, fileB) >= 0)) return false;
  const rest = (r: Recording) => JSON.stringify({ ...r, start: r.start.kind === 'save' ? 'save' : r.start });
  return rest(a) === rest(b);
}

/**
 * What `page`'s store holds as the page is closed before its last write, then once it is
 * written, after a write that fails: the recording that is replayed.
 */
async function stored(page: Page): Promise<Recording> {
  const recording = page.recording;
  const store = page.recordingStore;
  await settle();
  const [entry, ...others] = await store.list();
  if (!entry) throw new Error('the store holds no recording');
  const closed = await store.read(entry.id);
  const held = closed.changes.length;
  check(others.length === 0 && held > 1 && held < recording.changes.length && !closed.ended && closed.vbls < recording.vbls
    && sameRecording(closed, { ...recording, changes: recording.changes.slice(0, held), vbls: closed.vbls, ended: false }),
    `the store holds the recording as it grows: closed now, its first ${held} changes of ${recording.changes.length}, ${closed.vbls} VBLs (${store.writes} writes, ${entry.parts} parts)`);
  check(!store.entries.has(EARLIER) && !store.parts.has(EARLIER), 'and the recording no save links, left in the store before it, is gone at its first write');
  page.storeFull.now = true;
  const failed = await page.recordings.flush().then(() => false, () => true);
  page.storeFull.now = false;
  check(failed && (await store.read(entry.id)).changes.length === held, 'a write that fails writes nothing');
  await page.recordings.flush();
  const written = await store.read(entry.id);
  check(sameRecording(written, recording), `and the next writes the whole of it (${written.changes.length} changes, ${written.vbls} VBLs)`);
  return written;
}

/** F9 has replaced `page`'s recording: it is finished at the next write. */
async function replaced(page: Page, recording: Recording): Promise<void> {
  const store = page.recordingStore;
  await page.recordings.flush();
  const [entry, ...others] = await store.list();
  const finished = entry && await store.read(entry.id);
  check(others.length === 0 && finished?.ended === true && sameRecording(finished, { ...recording, ended: true }),
    `the next write finishes the recording F9 replaced, ended (${finished?.vbls} VBLs), and holds nothing of the next before its first change`);
}

/** `recording` as the store holds it cut at `point`: its changes before it, its VBLs at it, ended. */
function cutAt(recording: Recording, point: RecordingPoint): Recording {
  return { ...recording, changes: recording.changes.slice(0, point.changes), vbls: point.vbls, ended: true };
}

/**
 * What no save and no running game reaches, pruned, from where `branch` left `recorded`:
 * the branch F9 began from the disk menu's save of `root` running, F5's save in it.
 */
async function pruned(recorded: Page, root: Recording): Promise<void> {
  const store = recorded.recordingStore;
  const { saves } = recorded;
  const player = new Player(recorded);
  // The prune a save deleted or written over owes is in the writer's queue, before this flush.
  const written = () => recorded.recordings.flush();

  const menu = (await saves.list()).find((entry) => entry.recording?.recording === root.id)!;
  const rootCut = await store.read(root.id);
  check(sameRecording(rootCut, cutAt(root, menu.recording!)) && rootCut.changes.length < root.changes.length,
    `at a load, the recording replaced is cut at the last point a save or a branch names (${rootCut.changes.length} changes of ${root.changes.length}, ${store.entries.get(root.id)!.parts} parts)`);

  // In the branch, a save of its own, then the disk menu's save read again: a second branch of the root.
  const own = await saves.save('running', 'new');
  player.play(800);
  player.key('KeyW');
  player.play(600);
  const first = recorded.recording;
  saves.read(await saves.open(menu));
  const second = recorded.recording;
  player.play(600);
  player.key('KeyE');
  player.play(600);
  await written();
  check(JSON.stringify(second.parent) === JSON.stringify(menu.recording)
    && sameRecording(await store.read(first.id), cutAt(first, own.recording!)),
    `and a load of an earlier save leaves the branch it ends cut at the last save made in it (${own.recording!.changes} changes)`);

  await saves.remove(own);
  await written();
  const quick = (await saves.list()).find((entry) => entry.quick)!;
  check(quick.recording?.recording === first.id && sameRecording(await store.read(first.id), cutAt(first, quick.recording)),
    `a save deleted cuts its recording at the one before it, F5's (${quick.recording!.changes} changes)`);

  player.key('F5');
  await settle();
  await written();
  const over = (await saves.list()).find((entry) => entry.quick)!;
  check(over.id === quick.id && over.recording?.recording === second.id && !store.entries.has(first.id) && !store.parts.has(first.id),
    'a save written over, F5\'s in the second branch, removes the branch no save reaches any more, its parts with it');

  await saves.remove(menu);
  await written();
  check(sameRecording(await store.read(root.id), rootCut),
    'a save deleted whose point the running branch joins at leaves its recording as it was');

  // Another page on the same stores, as a tab: its first write prunes what it does not play.
  const other = Page.replay(rootCut, recorded);
  await other.play(rootCut, { changes: 1, vbls: 10 });
  await other.recordings.flush();
  const cutHere = store.entries.get(second.id);
  check(cutHere?.ended === true && cutHere.changes === over.recording!.changes && store.entries.has(other.recording.id),
    `another page's prune cuts the running branch at its last save (${cutHere?.changes} changes of ${recorded.recording.changes.length})`);
  player.key('KeyW');
  player.play(400);
  await written();
  const healed = await store.read(second.id);
  check(sameRecording(healed, recorded.recording) && !healed.ended,
    `and its page's next write writes it whole again (${healed.changes.length} changes, ${store.entries.get(second.id)!.parts} parts)`);

  const path = Page.replay(await store.read(root.id));
  await path.play(rootCut, healed.parent!);
  path.join(healed);
  await path.play(healed);
  sameGame(recorded, path, healed, 'the second branch, pruned around, replayed from its root through the join');
}

/** `start` played by `script` and recorded, then the recording played back in a fresh page. */
async function replay(name: string, start: Start, script: (player: Player) => Promise<void>): Promise<void> {
  console.log(`\n=== ${name} ===`);
  const recorded = await Page.record(start);
  const begun = recorded.recording;
  // Left by a page before the tree: no save links it.
  const earlier: RecordingEntry = {
    id: EARLIER, dataSet: STOCK_DATA_SET.id, build: 'replay', parent: null, playthrough: 0,
    recordedAt: 0, writtenAt: 0, vbls: 0, ended: false, changes: 0, parts: 1,
  };
  await recorded.recordingStore.write(earlier, [{ id: EARLIER, seq: 0, start: begun.start, parent: null, rules: begun.rules, extras: begun.extras }], null);
  const { rules } = recorded.game.ctx;
  check(begun.start.kind === (start === 'new' ? 'new' : 'save') && begun.dataSet === STOCK_DATA_SET.id && begun.build === 'replay',
    `the read begins a recording of the ${begun.start.kind === 'new' ? 'new game' : 'save'}, its set's and its build's`);
  if (begun.start.kind === 'new') {
    check(begun.start.random === recorded.game.ctx.random.getSeed() && begun.start.randomGameID === recorded.game.ctx.state.block1.randomGameID,
      `from the stream and the playthrough its read left (${begun.start.random.toString(16)}, ${begun.start.randomGameID.toString(16)})`);
  } else {
    check(firstDifference(begun.start.bytes, start as Uint8Array) < 0, `from the save's file (${begun.start.bytes.length} bytes)`);
  }
  check(JSON.stringify(begun.extras) === JSON.stringify(START_EXTRAS) && JSON.stringify(begun.rules) === JSON.stringify(rules),
    `with the extras and the rules as it began (dmRules ${begun.rules.dmRules})`);
  check(begun.changes.length === 1 && begun.changes[0]!.change.kind === 'forceDMRules' && begun.changes[0]!.vbl === 0,
    'and the boot\'s DM rules its first change, before its first VBL');
  await script(new Player(recorded));
  const recording = recorded.recording;
  const { changes } = recording;
  const kinds = new Map<string, number>();
  for (const { change } of changes) kinds.set(change.kind, (kinds.get(change.kind) ?? 0) + 1);
  console.log(`  recorded: ${recording.vbls} VBLs, d.Time ${recorded.game.ctx.state.tickCount}, ${changes.length} changes`);
  console.log(`  ${[...kinds].map(([kind, n]) => `${kind} ${n}`).join(', ')}`);
  for (const kind of ['click', 'unclick', 'key', 'panelKey', 'pause', 'tag0207cc', 'extras', 'saveWritten', 'devMove']) {
    check(kinds.has(kind), `the game takes the boundary's ${kind}`);
  }

  const played = Page.replay(await stored(recorded));
  const { game } = played;
  await played.play(recording);
  console.log(`  composed: recorded ${recorded.views} views and ${recorded.composed} screens more, replayed ${played.views} and ${played.composed}`);
  sameGame(recorded, played, recording, 'every change is replayed at its VBL');

  // A read ends the replay's recording, and F9's begins the recorded page's next.
  applySaveBytes(game, recorded.saveFile());
  const at = played.recording.vbls;
  game.runFrame();
  game.input.apply({ kind: 'unclick' });
  const ended = played.recording;
  check(ended.ended && ended.vbls === at && ended.changes.length === changes.length,
    `a read ends a recording: no VBL nor change after it is recorded (${ended.vbls} VBLs)`);
  const menuSave = (await recorded.saves.list()).find((row) => row.playthrough === recorded.game.ctx.state.block1.randomGameID)!;
  recorded.input.keyDown({ key: '', code: 'F9', ctrlKey: false, metaKey: false, altKey: false });
  await settle();
  const next = recorded.recording;
  check(next.start.kind === 'save' && !next.ended && next.changes.length === 0 && next.vbls === 0
    && firstDifference(next.start.bytes, await recorded.store.read(menuSave.id)) < 0,
    'and F9\'s read begins the next, from the save it read, the disk menu\'s');
  check(JSON.stringify(next.parent) === JSON.stringify(menuSave.recording) && next.start.kind === 'save' && next.start.carried?.paused === false
    && menuSave.recording!.recording === recording.id,
    `a branch of the recording, at the point the save names (${JSON.stringify(next.parent)}), the clock running as the read left it`);
  await replaced(recorded, recording);
  await branch(recorded);
  await pruned(recorded, recording);
}

/** `played` has replayed `recording`, which `recorded` played: the same changes at the same VBLs, and the same game. */
function sameGame(recorded: Page, played: Page, recording: Recording, what: string): void {
  const { changes } = recording;
  const replayed = played.recording;
  const parted = replayed.changes.findIndex((entry, n) => {
    const was = changes[n];
    return !was || JSON.stringify(entry) !== JSON.stringify(was);
  });
  if (parted >= 0) {
    console.log(`  recorded: ${JSON.stringify(changes[parted])}`);
    console.log(`  replayed: ${JSON.stringify(replayed.changes[parted])}`);
  }
  check(parted < 0 && replayed.changes.length === changes.length && replayed.vbls === recording.vbls,
    `${what}, with d.Time and d.RandomNumber as recorded (${replayed.changes.length} of ${changes.length})`);
  const differ = firstDifference(recorded.saveFile(), played.saveFile());
  check(differ < 0, `and the two final saves are byte-identical (${recorded.saveFile().length} bytes${differ < 0 ? '' : `, first difference at ${differ}`})`);
}

/**
 * The branch F9 began, played on with a save in it, then replayed from the store twice:
 * from its own start alone, and from its root through the join, where the root replayed
 * up to the point makes the very file the branch read.
 */
async function branch(recorded: Page): Promise<void> {
  const player = new Player(recorded);
  player.play(600);
  player.wander();
  player.key('KeyW');
  player.play(1500);
  await player.quickSave();
  player.key('KeyE');
  player.play(1200);
  const recording = recorded.recording;
  await recorded.recordings.flush();
  const store = recorded.recordingStore;
  const written = await store.read(recording.id);
  check(sameRecording(written, recording) && written.parent !== null,
    `the store holds the branch, its parent with it (${written.changes.length} changes, ${written.vbls} VBLs)`);

  const alone = Page.replay(written);
  await alone.play(written);
  sameGame(recorded, alone, written, 'the branch replayed from its own start alone');

  const parent = written.parent!;
  const root = await store.read(parent.recording);
  check(root.parent === null && root.ended, 'its parent is the root, ended');
  const path = Page.replay(root);
  await path.play(root, parent);
  const start = written.start.kind === 'save' ? written.start.bytes : new Uint8Array(0);
  const differ = firstDifference(path.saveFile(), start);
  check(differ < 0, `the root replayed up to the point makes the file the branch read (${differ < 0 ? 'byte-identical' : `first difference at ${differ}`})`);
  path.join(written);
  await path.play(written);
  sameGame(recorded, path, written, 'and the branch replayed from its root through the join');
}

await replay('a new game', 'new', newGameScript);
await replay('csbgame7.dat', new Uint8Array(readFileSync(savePath('csbgame7.dat'))), saveScript);
finish();
