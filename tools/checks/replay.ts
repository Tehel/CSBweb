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
 * the page writes it), and played by the player (`RecordingPlayer`): its start read, its
 * rules and extras set, each change applied before its VBL, the VBLs run by the loop as
 * the page runs them, a span under a held clock at once and the loop stopped at the end,
 * and the screen drawn only at the tick's `DrawViewport`, which a click in the viewport is
 * resolved through. It shows no dialog and writes no save: the disk menu a played VBL
 * opens is its game half alone.
 *
 * Two games, a new one and `csbgame7.dat`, each played through the boundary's doors but
 * a read, the Reincarnate screen and `?dev`'s level keys: clicks and pointer moves, the movement keys, a mirror clicked in the
 * viewport and its champion resurrected, panel keys (a rune, an inventory, an attack and
 * its damage's flash), the settings dialog's held clock and a change of the extras in it,
 * `?dev`'s move, F5 with the clock running, the Sleepsave as the party lies down and
 * wakes, and the disk menu's SAVE with the clock stopped.
 *
 * 1. A read begins a recording: a new game's from its stream and playthrough, a save's
 *    from its file, with the rules and the extras, and the boot's DM rules its first change.
 * 2. Every change is recorded at the same VBL, with the same `d.Time` and `d.RandomNumber`,
 *    in both games: what the recorded page composes and the replay does not takes nothing
 *    from the game's stream, and changes nothing the game reads.
 * 3. The two games' final saves are byte-identical, the replay showed no dialog and
 *    wrote no save, and its player met no drift.
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
 * 8. A Sleepsave's point says it was taken inside a VBL, and F9's read of it begins a
 *    branch there, which replays from its root through both joins: the join is checked
 *    against the file the replayed VBL made where the recorded one made the Sleepsave.
 * 9. The game's end is a point of its own: `csbgame7.dat` with every champion at 1 HP,
 *    put before the Stone Golem, which kills them. The recording ends in the VBL that
 *    asked for the credits, with `d.Word11694`, records nothing after it, and the store
 *    holds it so; a read after it, which no save of it follows, prunes the store and
 *    keeps it whole. It replays to the same end, and a recording whose end is moved a
 *    VBL on, or whose `d.Word11694` is not the game's, or without its end, drifts there.
 * 10. A point is shared as a package (`src/engine/RecordingPackage.ts`): the path to
 *    F5's save in the branch, to the Sleepsave inside a VBL in the third, and to the lost
 *    game's end, each written, read back the same and played from the package alone, a
 *    save's path to the file its save holds, through its joins. A package whose save's
 *    file is not the path's drifts at its end; one whose form is wrong is refused. The
 *    replay tool's page (`tools/lib/playback.ts`) plays each the same, to the same game.
 *
 * Run: `npm test -- --only=replay.ts`
 *
 * `--measure` plays a long new game instead, keys and clicks at a player's pace, F5 and
 * F9 now and then, and prints what its package costs: a change, a branch, the whole.
 */
import { readFileSync } from 'node:fs';

import { VBL_FREQUENCY } from '../../src/core/constants';
import { CsbRandom } from '../../src/core/random';
import { Position } from '../../src/core/types';
import { emptyDungeonData } from '../../src/data/DungeonLoader';
import { readRecordingPath, readSaveFileFields, type RecordingEntry, type SaveEntry } from '../../src/data/saves';
import { Game } from '../../src/engine/Game';
import { NO_EXTRAS } from '../../src/engine/GameContext';
import { GameSaves } from '../../src/engine/GameSaves';
import { Recorder, type Recording, type RecordingPoint } from '../../src/engine/Recorder';
import {
  packageOfEnd, packageOfSave, readRecordingPackage, RecordingPackageError, writeRecordingPackage, type RecordingPackage,
} from '../../src/engine/RecordingPackage';
import { RecordingPlayer, type SavedAtEnd } from '../../src/engine/RecordingPlayer';
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
import { playPath } from '../lib/playback';
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
/** A VBL of the wall clock, rounded up: a wake of the loop runs one, now and then two. */
const VBL_MS = Math.ceil(1000 / VBL_FREQUENCY);

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
  /** A replay's player. */
  player: RecordingPlayer | null = null;
  /** A replay's VBLs with a dialog up, and with the clock held. */
  dialogVbls = 0;
  heldVbls = 0;
  /** A replay's spans under a held clock, and those whose VBLs more than one wake of the loop ran. */
  heldSpans = 0;
  heldSpread = 0;
  /** Where the host was asked to show the credits: the boundary's VBLs, and `d.Word11694`. */
  credits: { vbls: number; word11694: boolean } | null = null;

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
      showCredits: (word11694) => { this.credits = { vbls: game.input.vbls, word11694 }; },
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
    if (!recorded) {
      let heldAt: number | null = null;
      game.onFrame(() => {
        if (screen.ui.dialog || screen.ui.saveMenu || screen.ui.hintOracleUp) this.dialogVbls++;
        if (!game.ctx.state.paused) {
          heldAt = null;
          return;
        }
        this.heldVbls++;
        if (heldAt === null) this.heldSpans++;
        else if (heldAt !== this.clock.time) this.heldSpread++;
        heldAt = this.clock.time;
      });
    }
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
   * A fresh page playing `path` from the first recording's start, from the recordings
   * alone (`RecordingPlayer`), its own recorder begun at each start the player reads, then
   * the loop, as the page plays one (`playRecording`, `src/main.ts`): a span under a held
   * clock run at once, and the loop stopped at the end. The boot's DM rules are a root's
   * first change. `shared`: a page whose stores this one writes its recording to, as
   * another tab's. `savedAtEnd`: the save a path shared at a save's point ends at.
   */
  static replay(path: readonly Recording[], shared: Page | null = null, savedAtEnd: SavedAtEnd | null = null): Page {
    const page = new Page(false, shared);
    const { game } = page;
    const player = new RecordingPlayer(game, path, DUNGEON, savedAtEnd);
    player.onBegin((recording) => page.recorder.begin(recording.start, recording.parent));
    player.onEnd(() => game.stop());
    game.runAtOnceWhile(() => player.held);
    player.start();
    page.player = player;
    game.start(true);
    return page;
  }

  /** The loop woken a VBL apart while the player plays, up to `vbls` of the recording it plays. */
  play(vbls = Infinity): void {
    const player = this.player!;
    while (player.playing && player.point.vbls < vbls) {
      if (!this.clock.advance(VBL_MS)) throw new Error('the loop stopped while the player plays');
    }
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
    const before = this.page.writes;
    this.key('F5');
    await settle();
    check(this.page.writes === before + 1, 'F5 writes a save with the clock running');
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

  /**
   * The party laid down from the first champion's inventory, and woken after `ms`: the
   * Sleepsave written at each, its file and its tail made inside the VBL of the click.
   */
  async sleepSave(ms = 1500): Promise<void> {
    const before = this.page.writes;
    this.key('Digit7', '7');
    const zzz = this.pointOf(145);
    this.click(zzz.x, zzz.y);
    await settle();
    check(this.page.game.ctx.party.state.sleeping && this.page.writes === before + 1, 'the party lies down, and the Sleepsave is written');
    this.play(ms);
    const wake = this.pointOf(146);
    this.click(wake.x, wake.y);
    await settle();
    check(!this.page.game.ctx.party.state.sleeping && this.page.writes === before + 2, 'and wakes, the Sleepsave written over');
  }

  /**
   * The game's end, as the store's tests want it: the store's last write settled, VBLs
   * after it, and a last change after the last VBL, which the player applies with no
   * VBL to follow.
   */
  async end(): Promise<void> {
    await settle();
    this.play(100);
    this.page.input.keyDown({ key: '', code: 'KeyW', ctrlKey: false, metaKey: false, altKey: false });
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
  player.play(500);
  player.wander();
  player.key('Numpad7');
  player.key('KeyL');
  player.play(400);
  resurrectIaido(player);
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
  await player.sleepSave();
  player.play(800);
  await player.diskMenuSave();
  player.play(2000);
  await player.end();
}

/** Up to Iaido's mirror, the south face of (10,3): `?dev`'s move, the party turned to face it, the mirror clicked and RESURRECT. */
function resurrectIaido(player: Player): void {
  const { page } = player;
  const { game } = page;
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
}

/** `csbgame7.dat`: the party put before a Stone Golem, which its attacks hit, among the rest. */
async function saveScript(player: Player): Promise<void> {
  const { page } = player;
  const { game } = page;
  player.play(400);
  // Asleep, a tick runs every VBL: a short sleep, which the Stone Golem below sleeps through.
  await player.sleepSave(100);
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
  await player.end();
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
  const other = Page.replay([rootCut], recorded);
  other.play(10);
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

  const read = await readRecordingPath(store, second.id);
  check(read.map((recording) => recording.id).join() === `${root.id},${second.id}`,
    'the store gives the branch\'s path from its root (`readRecordingPath`)');
  const path = Page.replay(read);
  path.play();
  sameGame(recorded, path, healed, 'the second branch, pruned around, replayed from its root through the join');
}

/**
 * From where `pruned` left `recorded`, the second branch running: the party moved back to
 * `home`, where it sleeps with nothing about to wake it, laid down and woken, the Sleepsave made inside the VBL of each click, and F9's read of it a third branch,
 * whose point says it was taken inside a VBL. Played on, it replays from its root
 * through both joins: the second join is checked against the file the replayed VBL made
 * where the recorded one made the Sleepsave, before the rest of that VBL ran.
 */
async function sleepBranch(recorded: Page, home: Position): Promise<void> {
  const player = new Player(recorded);
  const second = recorded.recording;
  check(recorded.game.devMoveParty(home.z, home.x, home.y), '`?dev` moves the party back to where the game began');
  player.play(300);
  await player.sleepSave(100);
  const sleep = (await recorded.saves.list()).find((entry) => entry.sleep)!;
  check(sleep.recording?.recording === second.id && sleep.recording.inVbl === true,
    `the Sleepsave names its point in the branch, taken inside a VBL (${JSON.stringify(sleep.recording)})`);
  player.play(400);
  recorded.input.keyDown({ key: '', code: 'F9', ctrlKey: false, metaKey: false, altKey: false });
  await settle();
  const third = recorded.recording;
  check(JSON.stringify(third.parent) === JSON.stringify(sleep.recording) && third.start.kind === 'save'
    && firstDifference(third.start.bytes, await recorded.store.read(sleep.id)) < 0,
    'F9 reads the Sleepsave, a branch at its point');
  player.play(600);
  player.key('KeyW');
  player.play(800);
  await recorded.recordings.flush();
  const store = recorded.recordingStore;
  const read = await readRecordingPath(store, third.id);
  check(read.length === 3 && read[1]!.id === second.id, `the store gives its path from its root (${read.map((recording) => recording.id).join()})`);
  const path = Page.replay(read);
  path.play();
  const { drift, joins } = path.player!;
  check(joins === 2 && drift?.kind !== 'join',
    `the branch replayed up to the Sleepsave's point makes the file it made inside the VBL${drift?.kind === 'join' ? ` (first difference at ${drift.byte})` : ', byte-identical'}`);
  sameGame(recorded, path, await store.read(third.id), 'and the Sleepsave\'s branch replayed from its root through both joins');
  await savePackage(recorded, read.slice(0, 2), sleep, 'the Sleepsave');
}

/** `start` played by `script` and recorded, then the recording played back in a fresh page. */
async function replay(name: string, start: Start, script: (player: Player) => Promise<void>): Promise<void> {
  console.log(`\n=== ${name} ===`);
  const recorded = await Page.record(start);
  const begun = recorded.recording;
  const { position } = recorded.game.ctx.party.state;
  const home = new Position(position.x, position.y, position.z);
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

  const played = Page.replay([await stored(recorded)]);
  const { game } = played;
  played.play();
  console.log(`  composed: recorded ${recorded.views} views and ${recorded.composed} screens more, replayed ${played.views} and ${played.composed}`);
  sameGame(recorded, played, recording, 'every change is replayed at its VBL');
  check(played.dialogVbls === 0 && played.heldVbls > 0 && played.store.files.size === 0,
    `the replay shows no dialog and writes no save: the disk menu's and the settings' clock held through ${played.heldVbls} VBLs, nothing shown`);
  check(played.heldSpans > 0 && played.heldSpread === 0 && played.clock.pending === null,
    `each span under a held clock is played at once, in the wake of the loop that held it (${played.heldSpans} spans), and the loop stops at the end`);

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
  await sleepBranch(recorded, home);
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
  const drift = played.player!.drift;
  check(drift === null && !played.player!.playing && parted < 0 && replayed.changes.length === changes.length && replayed.vbls === recording.vbls
    && JSON.stringify(replayed.end) === JSON.stringify(recording.end),
    `${what}, with d.Time and d.RandomNumber as recorded (${replayed.changes.length} of ${changes.length}${recording.end ? `, to the game's end` : ''}${drift ? `, drift ${JSON.stringify(drift)}` : ''})`);
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

  const alone = Page.replay([written]);
  alone.play();
  sameGame(recorded, alone, written, 'the branch replayed from its own start alone');

  const root = await store.read(written.parent!.recording);
  check(root.parent === null && root.ended, 'its parent is the root, ended');
  const path = Page.replay([root, written]);
  path.play();
  const { drift, joins } = path.player!;
  check(joins === 1 && drift?.kind !== 'join',
    `the root replayed up to the point makes the file the branch read${drift?.kind === 'join' ? ` (first difference at ${drift.byte})` : ', byte-identical'}`);
  sameGame(recorded, path, written, 'and the branch replayed from its root through the join');

  const quick = (await recorded.saves.list()).find((entry) => entry.quick && entry.recording?.recording === written.id)!;
  const shared = await savePackage(recorded, [root, written], quick, 'F5 in the branch');
  await refusals(shared);
}

/**
 * `csbgame7.dat`, every champion at 1 HP, put before the Stone Golem, which kills them:
 * the game's end a point of its recording, kept by the prune and replayed to the same end.
 */
async function lostGame(): Promise<void> {
  console.log('\n=== a lost game ===');
  const scratch = await Page.record(CSBGAME7);
  for (const champion of scratch.game.ctx.party.state.champions) champion.attributes.health = 1;
  const recorded = await Page.record(scratch.saveFile());
  const { game, recordingStore: store } = recorded;
  const player = new Player(recorded);
  player.play(300);
  check(game.devMoveParty(6, 18, 13), '`?dev` moves the party before the Stone Golem');
  for (let n = 0; n < 120 && !game.mainLoopHasReturned(); n++) player.play(500);
  const recording = recorded.recording;
  const { credits } = recorded;
  check(game.ctx.party.state.gameIsLost && credits?.word11694 === false && recording.ended
    && JSON.stringify(recording.end) === JSON.stringify({ word11694: false }) && recording.vbls === credits.vbls,
    `the golem kills the party, and the recording ends in the VBL that asks for the credits, with d.Word11694 (${recording.vbls} VBLs, ${recording.changes.length} changes)`);
  player.key('KeyW');
  check(recorded.recording.changes.length === recording.changes.length && recorded.recording.vbls === recording.vbls,
    'a key after the end is recorded nowhere');
  await recorded.recordings.flush();
  const written = await store.read(recording.id);
  check(sameRecording(written, recording) && store.entries.get(recording.id)?.end?.word11694 === false,
    'the store holds it, ended, its row with the game\'s end');

  const played = Page.replay([written]);
  played.play();
  check(played.credits?.word11694 === false, 'the replay asks for the credits too');
  sameGame(recorded, played, written, 'the lost game replayed');
  const drifts: [string, Recording, boolean | null, number][] = [
    ['its end a VBL early', { ...written, vbls: written.vbls - 1 }, null, written.vbls - 1],
    ['its end a VBL late', { ...written, vbls: written.vbls + 1 }, false, written.vbls],
    ['a d.Word11694 not the game\'s', { ...written, end: { word11694: true } }, false, written.vbls],
    ['no end, played on past it', { ...written, vbls: written.vbls + 60, ended: false, end: null }, false, written.vbls],
  ];
  for (const [what, tampered, word11694, vbls] of drifts) {
    const drifted = Page.replay([tampered]);
    drifted.play();
    const { drift } = drifted.player!;
    check(drift?.kind === 'end' && drift.word11694 === word11694 && drift.vbls === vbls,
      `a recording with ${what} drifts at its end (${JSON.stringify(drift)})`);
  }
  const entry = store.entries.get(written.id)!;
  const shared = packageOfEnd([written], TEXT, { recordedAt: entry.recordedAt, endedAt: entry.writtenAt, playTime: recorded.game.playTime() });
  const fromPackage = await playPackage(shared, 'the lost game\'s end shared');
  sameGame(recorded, fromPackage, written, 'the lost game played from its package');

  // A read after the end, which no save of its recording follows: its first write prunes.
  const start = (await recorded.saves.list())[0]!;
  check(start.recording === null, 'no save names a point in the lost game');
  recorded.saves.read(await recorded.saves.open(start));
  game.input.apply({ kind: 'unclick' });
  const next = recorded.recording;
  await recorded.recordings.flush();
  check(store.entries.has(next.id) && store.entries.has(recording.id) && sameRecording(await store.read(recording.id), recording),
    'the next read\'s first write prunes the store, and keeps the game\'s end whole');
}

/* ------------------------------------------------------------ packages ---- */

/** What a player says of the recordings the tool shares. */
const TEXT = { title: 'The tool\'s game', author: 'replay.ts', description: 'Played by a tool.\nTwo lines.' };

/** Two packages the same, their files byte for byte. */
function samePackage(a: RecordingPackage, b: RecordingPackage): boolean {
  const json = (pkg: RecordingPackage) => JSON.stringify(pkg, (_, value: unknown) => (value instanceof Uint8Array ? [...value] : value));
  return json(a) === json(b);
}

/** `pkg` written, read back the same, and played in a fresh page from the package alone. */
async function playPackage(pkg: RecordingPackage, what: string): Promise<Page> {
  const file = await writeRecordingPackage(pkg);
  const read = await readRecordingPackage(file);
  console.log(`  ${what}: a package of ${read.path.length} recording${read.path.length === 1 ? '' : 's'}, ${Math.round(file.length / 1024)} KB`);
  check(samePackage(read, pkg), `${what}: its package written (${file.length} bytes) and read back the same`);
  const savedAtEnd = read.shared.kind === 'save' ? read.shared : null;
  const played = Page.replay(read.path, null, savedAtEnd);
  played.play();
  await samePlayback(played, read.path, savedAtEnd);
  return played;
}

/**
 * `path` played again by the replay tool's page (`tools/lib/playback.ts`), which plays it
 * as `played` did: the same drift, or none, at the same point, through as many joins, to
 * the same game.
 */
async function samePlayback(played: Page, path: readonly Recording[], savedAtEnd: SavedAtEnd | null): Promise<void> {
  const alone = await playPath(STOCK_DATA_SET, diskFiles(STOCK_DATA_SET), path, savedAtEnd);
  const player = played.player!;
  const file = buildSaveFile(alone.game, { portraitOf: (champion) => alone.game.ctx.host.portraitOf(champion) });
  check(JSON.stringify(alone.drift) === JSON.stringify(player.drift) && JSON.stringify(alone.point) === JSON.stringify(player.point)
    && alone.joins === player.joins && firstDifference(file, played.saveFile()) < 0,
    `and the replay tool's page plays it the same${alone.drift ? `, to its drift (${alone.drift.kind})` : ''}`);
}

/**
 * The package of `path`, the store's path to `save`'s recording, shared at `save`'s
 * point: played from the package to the file the save holds, through its joins, and
 * a package whose file is not the path's drifting at its end.
 */
async function savePackage(recorded: Page, path: readonly Recording[], save: SaveEntry, what: string): Promise<RecordingPackage> {
  const point = save.recording!;
  const file = await recorded.store.read(save.id);
  const root = recorded.recordingStore.entries.get(path[0]!.id)!;
  const pkg = packageOfSave(path, point, file, TEXT, { recordedAt: root.recordedAt, endedAt: save.savedAt, playTime: save.playTime });
  const last = pkg.path[pkg.path.length - 1]!;
  check(last.changes.length === point.changes && last.vbls === point.vbls && last.ended && pkg.info.start.kind === (path[0]!.start.kind),
    `${what}'s point shared: the path's last recording cut at it (${point.changes} changes, ${point.vbls} VBLs${point.inVbl ? ', inside the VBL' : ''})`);
  const played = await playPackage(pkg, what);
  const { drift, joins, point: at } = played.player!;
  check(drift === null && !played.player!.playing && joins === path.length - 1 && at.changes === point.changes && at.vbls === point.vbls,
    `played from the package to the save's point through ${joins} join${joins === 1 ? '' : 's'}, making the file the save holds${drift ? ` (drift ${JSON.stringify(drift)})` : ''}`);
  const other = new Uint8Array(file);
  other[100] ^= 1;
  const tampered = Page.replay(pkg.path, null, { file: other, inVbl: point.inVbl === true });
  tampered.play();
  const parted = tampered.player!.drift;
  check(parted?.kind === 'save' && parted.byte === 100, `and a package whose save's file is not the path's drifts at its end (${JSON.stringify(parted)})`);
  await samePlayback(tampered, pkg.path, { file: other, inVbl: point.inVbl === true });
  return pkg;
}

/** Packages whose form is wrong, each refused. */
async function refusals(pkg: RecordingPackage): Promise<void> {
  const [root, branch] = pkg.path as [Recording, Recording];
  const wrong: [string, () => Promise<unknown>][] = [
    ['no gzip', () => readRecordingPackage(new TextEncoder().encode('{}'))],
    ['no JSON', async () => readRecordingPackage(await gzipped('{'))],
    ['another version', async () => readRecordingPackage(await gzipped(JSON.stringify({ version: 2 })))],
    ['more than the limit unzipped', async () => readRecordingPackage(await writeRecordingPackage(pkg), 1000)],
    ['an empty title', () => writeRecordingPackage({ ...pkg, info: { ...pkg.info, title: ' ' } })],
    ['a title too long', () => writeRecordingPackage({ ...pkg, info: { ...pkg.info, title: 'x'.repeat(61) } })],
    ['a control character in its author', () => writeRecordingPackage({ ...pkg, info: { ...pkg.info, author: 'a\nb' } })],
    ['a start not its root\'s', () => writeRecordingPackage({ ...pkg, info: { ...pkg.info, start: { kind: 'save', level: 99, champions: [] } } })],
    ['a branch of no recording of the path', () => writeRecordingPackage({ ...pkg, path: [root, { ...branch, parent: { ...branch.parent!, recording: 'other' } }] })],
    ['a parent played on past its child\'s point', () => writeRecordingPackage({ ...pkg, path: [{ ...root, vbls: root.vbls + 1 }, branch] })],
    ['a recording of another set', () => writeRecordingPackage({ ...pkg, path: [{ ...root, dataSet: 'other' }, branch] })],
    ['the game\'s end at a save\'s point', () => writeRecordingPackage({ ...pkg, path: [root, { ...branch, end: { word11694: false } }] })],
    ['a read among its changes', async () => readRecordingPackage(await edited(pkg, (json) => { json.path[1].changes[0].change = { kind: 'read' }; }))],
    ['a rule too many', async () => readRecordingPackage(await edited(pkg, (json) => { json.path[0].rules.more = false; }))],
    ['a loop flag of another type', async () => readRecordingPackage(await edited(pkg, (json) => { json.path[1].start.carried.loop.moveHistory = [0]; }))],
  ];
  const refused: string[] = [];
  for (const [what, read] of wrong) {
    if (await read().then(() => false, (error: unknown) => error instanceof RecordingPackageError)) refused.push(what);
    else console.log(`  not refused: ${what}`);
  }
  check(refused.length === wrong.length, `a package is refused with ${refused.join(', ')}`);
}

async function gzipped(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** `pkg`'s file with its JSON edited by `edit`. */
async function edited(pkg: RecordingPackage, edit: (json: any) => void): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(await writeRecordingPackage(pkg))]).stream().pipeThrough(new DecompressionStream('gzip'));
  const json: unknown = JSON.parse(await new Response(stream).text());
  edit(json);
  return gzipped(JSON.stringify(json));
}

/* ------------------------------------------------------- the long game ---- */

/** How long `--measure`'s game is played, in minutes of its clock. */
const MEASURE_MINUTES = Number(process.argv.find((arg) => arg.startsWith('--minutes='))?.slice(10) ?? 60);

/**
 * A new game played for `MEASURE_MINUTES` at a player's pace: a key or a click in the
 * viewport every second or so, F5 every three minutes and F9 every nine, each F9 a
 * branch from F5's save. Then the package of a last F5's point: what it costs, a change
 * and a branch, and that it plays to that save.
 */
async function measure(): Promise<void> {
  console.log(`\n=== a long game, ${MEASURE_MINUTES} minutes, measured ===`);
  const began = Date.now();
  const recorded = await Page.record('new');
  const { clock } = recorded;
  const player = new Player(recorded);
  resurrectIaido(player);
  const choices = new CsbRandom(0x1095);
  const keys = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE'];
  const end = clock.time + MEASURE_MINUTES * 60_000;
  let saveAt = clock.time + 3 * 60_000;
  let loadAt = clock.time + 9 * 60_000;
  while (clock.time < end) {
    if (choices.below(4) === 0) player.click(VIEWPORT_X + 20 + choices.below(184), VIEWPORT_Y + 10 + choices.below(116));
    else player.key(keys[choices.below(keys.length)]!);
    player.play(300 + choices.below(1200));
    if (clock.time >= saveAt) {
      player.key('F5');
      await settle();
      saveAt += 3 * 60_000;
    }
    if (clock.time >= loadAt) {
      player.key('F9');
      await settle();
      loadAt += 9 * 60_000;
    }
  }
  player.key('F5');
  await settle();
  await recorded.recordings.flush();
  const save = (await recorded.saves.list()).find((entry) => entry.quick)!;
  const store = recorded.recordingStore;
  const path = await readRecordingPath(store, save.recording!.recording);
  const pkg = packageOfSave(path, save.recording!, await recorded.store.read(save.id), TEXT,
    { recordedAt: store.entries.get(path[0]!.id)!.recordedAt, endedAt: save.savedAt, playTime: save.playTime });
  const file = await writeRecordingPackage(pkg);
  const changes = pkg.path.reduce((sum, recording) => sum + recording.changes.length, 0);
  const branches = pkg.path.length - 1;
  const unsaved = { ...pkg, path: pkg.path.map((recording, n) => (n === 0 || recording.start.kind !== 'save' ? recording : { ...recording, start: { ...recording.start, bytes: new Uint8Array(0) } })) };
  const bare = (await writeRecordingPackage({ ...unsaved, shared: { kind: 'save', file: new Uint8Array(0), inVbl: false } })).length;
  const json = new TextEncoder().encode(JSON.stringify(pkg, (_, value: unknown) => (value instanceof Uint8Array ? 'x'.repeat(Math.ceil(value.length / 3) * 4) : value))).length;
  console.log(`  played: ${recorded.game.input.vbls} VBLs, ${changes} changes on its path, ${branches} branches, in ${((Date.now() - began) / 1000).toFixed(1)} s`);
  console.log(`  package: ${file.length} bytes gzipped, ${json} bytes of JSON`);
  console.log(`  a change: ${(bare / changes).toFixed(1)} bytes; a save's file: ${((file.length - bare) / (branches + 1)).toFixed(0)} bytes (${(await recorded.store.read(save.id)).length} bytes raw)`);
  const playedAt = Date.now();
  const played = Page.replay(pkg.path, null, pkg.shared.kind === 'save' ? pkg.shared : null);
  played.play();
  const { drift, joins } = played.player!;
  check(drift === null && joins === branches, `the long game plays from its package to the save, through ${joins} joins (${((Date.now() - playedAt) / 1000).toFixed(1)} s)`);
}

const CSBGAME7 = new Uint8Array(readFileSync(savePath('csbgame7.dat')));

if (process.argv.includes('--measure')) {
  await measure();
} else {
  await replay('a new game', 'new', newGameScript);
  await replay('csbgame7.dat', CSBGAME7, saveScript);
  await lostGame();
}
finish();
