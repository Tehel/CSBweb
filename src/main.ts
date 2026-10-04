/**
 * Dungeon Master Web: the page's bootstrap. `init` loads the game files, constructs the
 * engine and the screen, runs the intro, wires the page to both, and starts the loop.
 */

import { SoundManager } from './audio/SoundManager';
import { CsbRandom } from './core/random';
import { CSBGraphicsLoader } from './data/CSBGraphicsLoader';
import { extractPresetHeroes } from './data/HeroExtractor';
import { dataSetFor } from './data/DataSets';
import { emptyDungeonData } from './data/DungeonLoader';
import { GraphicsLoader } from './data/GraphicsLoader';
import { BrowserSaveStore, downloadSaveFile } from './data/saves';
import { Game } from './engine/Game';
import { buildGameTables, type GameTables } from './engine/GameTables';
import { extractGraphicsTables, type GraphicsTables } from './data/tables/GraphicsTables';
import { UtilityDiskMessages, UtilityError } from './engine/Chaos';
import { GameSaves, drawPlaythrough } from './engine/GameSaves';
import { loadSwoosh, type Swoosh } from './data/SwooshLoader';
import { loadGlfx } from './lib/glfx-loader';
import { GameScreen } from './renderer/GameScreen';
import { bindDataSetChooser, bindExtrasToggle, bindSaveDrop, bindUIContext, drawMapPreview, handleCursorFilter } from './ui';
import { ScrollingText } from './renderer/csbwin/ScrollingText';
import { UIMode } from './renderer/ui/UIState';
import { Die, runBootSequence, runShowCredits } from './renderer/intro/BootSequence';
import type { PrisonDoorChoice } from './renderer/intro/PrisonDoor';
import { SOUND_DYING, type WonChampion } from './renderer/intro/ShowCredits';
import { determineMastery } from './engine/skills';
import { loadUISettings, type UISettings } from './ui/settings';

console.log('Dungeon Master Web - Initializing...');

// Global game instance
let game: Game | null = null;
let screen: GameScreen | null = null;
let crtController: CrtController | null = null;

/** The game this page plays, chosen before anything is loaded (`?dungeon=<id>`). */
const dataSetId = new URLSearchParams(window.location.search).get('dungeon');
const dataSet = dataSetFor(dataSetId);
if (dataSetId !== null && dataSet.id !== dataSetId) console.warn(`Unknown data set '${dataSetId}'; playing ${dataSet.id}`);
const CRT_SCANLINES_SRC = '/QPN59-320x200-resized.png';
const CRT_UPDATE_INTERVAL_MS = 1000 / 20;
const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!gameCanvasEl) console.log(`Couldn't find game canvas !`);

interface CrtController {
    isAvailable: () => boolean;
    isEnabled: () => boolean;
    setEnabled: (enabled: boolean) => boolean;
}

function createCrtController(canvas: HTMLCanvasElement): CrtController {
    let enabled = false;
    let intervalId: number | null = null;
    let glcanvas: GLFXCanvas | null = null;
    let texture: GLFXTexture | null = null;
    let lines: HTMLImageElement | null = null;

    const available = !!fx && typeof fx.canvas === 'function';
    if (!available)
        return { isAvailable: () => false, isEnabled: () => false, setEnabled: () => false };

    try {
        glcanvas = fx.canvas();
    } catch (e) {
        console.warn('glfx failed to initialize; CRT effect disabled');
        return { isAvailable: () => false, isEnabled: () => false, setEnabled: () => false };
    }

    const parent = canvas.parentNode;
    if (!parent)
        return { isAvailable: () => false, isEnabled: () => false, setEnabled: () => false };

    glcanvas.width = canvas.width;
    glcanvas.height = canvas.height;
    glcanvas.className = canvas.className;
    glcanvas.id = `${canvas.id}_gl`;
    glcanvas.style.display = 'none';
    parent.appendChild(glcanvas);

    lines = new Image();
    lines.src = CRT_SCANLINES_SRC;
    // What the effect is given: the game canvas with the scanlines over it, composed on a
    // canvas of its own. Only the game paints the game canvas: scanlines painted there
    // would darken it with every pass, and a screen that does not repaint (the entrance,
    // the credits) would be black in seconds.
    const composed = document.createElement('canvas');
    composed.width = canvas.width;
    composed.height = canvas.height;
    texture = glcanvas.texture(composed);

    const draw = (): void => {
        const ctx = composed.getContext('2d');
        if (!ctx || !glcanvas || !texture || !lines) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.drawImage(canvas, 0, 0);
        if (lines.complete && lines.naturalWidth > 0) {
            ctx.drawImage(lines, 0, 0, w, h);
        }
        texture.loadContentsOf(composed);

        const hw = w / 2;
        const hh = h / 2;
        const w75 = w * 0.75;
        glcanvas
            .draw(texture)
            .bulgePinch(hw, hh, w75, 0.12)
            .vignette(0.25, 0.74)
            .update();
    };

    const start = (): void => {
        if (intervalId !== null) return;
        intervalId = window.setInterval(draw, CRT_UPDATE_INTERVAL_MS);
    };

    const stop = (): void => {
        if (intervalId === null) return;
        window.clearInterval(intervalId);
        intervalId = null;
    };

    return {
        isAvailable: () => true,
        isEnabled: () => enabled,
        setEnabled: (next: boolean) => {
            if (next === enabled) return enabled;
            if (!glcanvas) return false;
            // The effect's canvas lies over the game canvas and takes no input
            // (`#game-canvas_gl`, index.html): the game canvas is the one input surface,
            // with the effect or without.
            if (next) {
                start();
                glcanvas.style.display = '';
            } else {
                stop();
                glcanvas.style.display = 'none';
            }
            enabled = next;
            return enabled;
        },
    };
}


function setCrtEnabled(enabled: boolean): boolean {
    if (!crtController) return false;
    return crtController.setEnabled(enabled);
}

function isCrtEnabled(): boolean {
    return crtController?.isEnabled() ?? false;
}

/**
 * `DrawViewport`, then the screen composed over it (`GameScreen.drawViewport`): the main
 * loop's tick and a script's tick. A game's first view is the tick `MainLoop` opens with
 * (`tag000698`, doc/CSBwin-src/CSBCode.cpp:601; `Game.start`). Every other redraw is
 * `refreshScreen`'s.
 */
function renderView() {
    // Once `MainLoop` has returned the screen is `_ShowCredits`'s.
    if (!game || !screen || game.mainLoopHasReturned()) return;

    const party = game.ctx.party;
    screen.setPartyState(party.state);
    screen.drawViewport(party.state.position, party.state.facing, game.ctx.state.word1868);
}

/** The screen composed again over the viewport as it stands, without `DrawViewport`. */
function refreshScreen() {
    if (!game || !screen || game.mainLoopHasReturned()) return;
    screen.setPartyState(game.ctx.party.state);
    screen.refreshOverlay();
}

/**
 * What `init` reads from the server before anything is built. Not `dungeon.dat`: the boot
 * reads it once ENTER is chosen, as CSBWin does (`readNewGame`).
 */
interface GameFiles {
    graphicsLoader: GraphicsLoader;
    /** The optional CSBgraphics.dat overlay (extended decorations, portraits, etc.). */
    csbGraphicsLoader: CSBGraphicsLoader | null;
}

async function loadGameFiles(): Promise<GameFiles> {
    console.log(`Loading ${dataSet.name}: graphics.dat...`);
    const graphicsLoader = new GraphicsLoader();
    await graphicsLoader.load(`${dataSet.dir}/graphics.dat`);
    console.log(`✓ Loaded graphics: ${graphicsLoader.getItemCount()} items`);

    let csbGraphicsLoader: CSBGraphicsLoader | null = new CSBGraphicsLoader();
    if (dataSet.csbGraphics && await csbGraphicsLoader.tryLoad(`${dataSet.dir}/CSBgraphics.dat`)) {
        console.log('✓ Loaded CSBgraphics.dat overlay');
    } else {
        console.log('CSBgraphics.dat not found; extended decorations disabled');
        csbGraphicsLoader = null;
    }
    return { graphicsLoader, csbGraphicsLoader };
}

/**
 * `_ReadEntireGame` for a new game (doc/CSBwin-src/SaveGame.cpp:1480-1494): the data set's
 * `dungeon.dat`, read into the running game. A file that will not open is `die(50)`
 * (`:1480-1486`); one that fails its read is `false`, for the boot's `tag01efee`. The
 * game's playthrough is then held against the store's (`GameSaves.newGameRead`).
 */
async function readNewGame(game: Game, saves: GameSaves): Promise<boolean> {
    const name = `${dataSet.dir}/dungeon.dat`;
    const response = await fetch(name).catch(() => null);
    if (!response?.ok) throw new Die(50, `Cannot open dungeon file '${name}'`);
    const read = game.readDungeonDat(new Uint8Array(await response.arrayBuffer()));
    if (read) {
        console.log(`✓ Read ${name}: ${game.ctx.dungeon.getData().maps.length} levels`);
        await saves.newGameRead();
    }
    return read;
}

/**
 * The data set's `mini.dat`, for RISE's new adventure. A file that will not open is the
 * utility's "CAN'T FIND NEW ADVENTURE MINI.DAT" (doc/CSBwin-src/Chaos.cpp:2245-2251).
 */
async function readMiniDat(): Promise<Uint8Array> {
    const response = await fetch(`${dataSet.dir}/mini.dat`).catch(() => null);
    if (!response?.ok) throw new UtilityError(UtilityDiskMessages[24]);
    return new Uint8Array(await response.arrayBuffer());
}

/** The sound manager, unlocked by the first click or key: browsers keep audio locked until then. */
function createSoundManager(graphicsLoader: GraphicsLoader, tables: GameTables): SoundManager {
    const sound = new SoundManager(graphicsLoader);
    if (sound.isAvailable()) {
        const unlockAudio = (): void => {
            sound.unlock();
        };
        if (gameCanvasEl) gameCanvasEl.addEventListener('pointerdown', unlockAudio, { once: true });
        window.addEventListener('keydown', unlockAudio, { once: true });
    }
    sound.setSoundTable(tables.sound1772);
    if (sound.isAvailable()) sound.preloadAll();
    return sound;
}

/** The Atari ST disk's FTL logo and the recording of its sound, which every data set shares. */
const SWOOSH_DIR = '/gamefiles/swoosh';
const SWOOSH_RECORDING = 'swoosh';

/**
 * The FTL logo for the boot, read from `swoosh.img` as any game file is, or `null`
 * without it: the logo is an extra (`DEBT.md` X), so the boot shows none with the setting
 * off, and none where the file is not served. Its sound is `swoosh.wav`; the logo is shown
 * silent without that file.
 */
async function loadSwooshFiles(sound: SoundManager, settings: UISettings): Promise<{ image: Swoosh; startSound: () => void } | null> {
    if (!settings.extras) return null;
    const fetchFile = async (name: string): Promise<ArrayBuffer | null> => {
        const response = await fetch(`${SWOOSH_DIR}/${name}`).catch(() => null);
        return response?.ok ? response.arrayBuffer() : null;
    };
    const [img, wav] = await Promise.all([fetchFile('swoosh.img'), fetchFile('swoosh.wav')]);
    if (!img) return null;
    let image: Swoosh;
    try {
        image = loadSwoosh(new Uint8Array(img));
    } catch (error) {
        console.warn('No FTL logo:', error);
        return null;
    }
    if (wav) await sound.loadRecording(SWOOSH_RECORDING, wav).catch(() => console.warn('No swoosh: swoosh.wav is not a sound'));
    return { image, startSound: () => sound.playRecording(SWOOSH_RECORDING) };
}

/**
 * The engine and the screen, each handed what it asks of the other: the engine its
 * `GameHost`, the screen its `GameScreenHooks`. Both are handed the one message area,
 * which the engine writes and the screen draws.
 */
function construct(files: GameFiles, graphicsTables: GraphicsTables, tables: GameTables, sound: SoundManager): { game: Game; screen: GameScreen; saves: GameSaves; messages: ScrollingText } {
    const messages = new ScrollingText();
    const playSound = (soundId: number, rateIdx?: number, highVolume?: number) => sound.playSound(soundId, rateIdx, highVolume);
    // The screen is built second, over the engine's dungeon, so the engine→UI notices
    // reach it through this variable.
    let screen: GameScreen | null = null;
    // Over an empty world, as `d.Initialize()` leaves CSBWin's: the boot reads the game.
    const game = new Game(emptyDungeonData(), tables, {
        cursorFilter: handleCursorFilter,
        messages,
        playSound,
        // `d.PartySleeping`: button 145 puts the party to sleep, 146 or a blow
        // wakes it. The UI follows with `Buttons17796` (`doc/CSBwin-src/Mouse.cpp:1698`)
        // or the adventure lists back (`CSBCode.cpp:7056-7057`), and the message
        // area with its tenfold timeout (`CSBCode.cpp:1546-1553`).
        sleepChanged: (sleeping) => {
            screen?.setUIMode(sleeping ? UIMode.Sleeping : UIMode.Adventure);
            messages.setPartySleeping(sleeping);
        },
        // The first half of Reincarnate: the engine raises the name-entry screen
        // (`doc/CSBwin-src/CSBCode.cpp:6738` around `Code13ea4.cpp:20`); the
        // screen hands its answer to `HallOfChampions.reincarnateNamed`.
        openReincarnateScreen: (chIdx) => screen?.openReincarnateScreen(chIdx),
        // A weapon hand changed, or a chest left the open inventory's weapon hand:
        // the attack menu, the inventory and the open chest are the screen's.
        closeAttackMenuOf: (chIdx) => screen?.closeAttackMenuOf(chIdx),
        attackingCharacterOrdinal: () => screen?.attackingCharacterOrdinal() ?? 0,
        showHideInventory: (chIdx) => screen?.showHideInventory(chIdx),
        repackChest: () => screen?.repackChest(),
        // `TAG02076e` / `TAG0207cc` from the engine: the Hall of Champions and `WakeUp`.
        tag02076e: () => screen?.tag02076e(),
        tag0207cc: () => screen?.tag0207cc(),
        // The prison's fourth champion asks whether the adventure begins.
        championJoined: () => saves.championJoined(),
        // `ShowCredits(1)`: `MainLoop` has returned on a lost game
        // (doc/CSBwin-src/CSBCode.cpp:11325), or has won it (`:631`).
        // A frame threw: CSBWin's `die`, the loop stopped.
        die: reportError,
        showCredits: (word11694) => {
            if (screen) showEndOfGame(game, screen, saves, sound, messages, word11694).catch(reportError);
        },
        // A script's tick, `_ProcessTimersViewportAndSound`, draws the viewport itself.
        drawViewport: () => renderView(),
        // The main loop's tick paints what `TAG01b29a` drew after its `DrawViewport`.
        paint: () => refreshScreen(),
        // `TAG01b29a`, after the tick's `d.Time++`: the flinch and the attack panel.
        tag01b29a: () => screen?.attackPanelTick(),
        // `DisplayCharacterDamage`'s splat and figure, and `TAG011366` drawing over them.
        displayCharacterDamage: (chIdx, damage) => screen?.displayCharacterDamage(chIdx, damage),
        tag011366: (chIdx) => screen?.tag011366(chIdx),
        drawCharacterState: (chIdx, charFlags) => screen?.drawCharacterState(chIdx, charFlags),
    });

    // The game's saves: the disk menu's, the boot's chooser's, and F5 and F9's. The store
    // draws from a stream of its own for a row of an earlier version that names no
    // playthrough, and so does an import for a file that names none: the game's stream
    // is the game's.
    const storeRandom = new CsbRandom();
    const saveStore = new BrowserSaveStore((rows) => drawPlaythrough(storeRandom, rows));
    const saves = new GameSaves(game, dataSet, saveStore, {
        // A save packs a `CHARDESC`, and that needs graphic 26 for the champions who
        // carry only a portrait index.
        portraitOf: (champion) => screen?.portraitPixelsFor(champion),
        repackOpenChest: () => screen?.repackChest(),
        askBeginAdventure: (source) => screen?.askBeginAdventure(source),
    }, logSave, storeRandom);

    screen = new GameScreen(gameCanvasEl, {
        graphicsLoader: files.graphicsLoader,
        tables: graphicsTables,
        ctx: game.ctx,
        csbGraphicsLoader: files.csbGraphicsLoader ?? undefined,
        messages,
    }, {
        // The second half of Reincarnate is done: the screen has handed the typed name
        // to the engine (the first half is the host's `openReincarnateScreen`).
        onReincarnated: () => refreshScreen(),
        // The save/load screen behind the disk icon. The UI owns the list and the
        // buttons; the store, and serializing and restoring the world, are the
        // engine's, so they come back through these. The menu has stopped the clock.
        onListSaves: () => saves.list(),
        onListEverySave: () => saves.listEverySet(),
        onReadSave: (entry) => saves.open(entry),
        // RISE, on the entrance: a new adventure from a save of any set.
        onMakeNewAdventure: async (source) => saves.makeNewAdventure(source, await readMiniDat()),
        onSaveGame: (over) => saves.save('stopped', over ?? 'new'),
        isPrison: () => saves.inPrison(),
        // EXPORT: the row's file as the store holds it, downloaded under the row's name.
        onExportSave: async (entry) => downloadSaveFile(entry.name, (await saves.open(entry)).bytes),
        // The import: a file dropped on the page (`bindSaveDrop`), held against the dungeon.
        onImportSave: (file, confirmed) => saves.importSave(file, confirmed),
        onRestoreSave: (save) => saves.read(save),
        // The boot's chooser only: its read failed, and `tag01efee` follows; or RISE's
        // new adventure was refused, and the entrance says why.
        onRestoreFailed: (error) => {
            console.error(error instanceof UtilityError ? 'New adventure refused:' : 'Saved game damaged:', error);
            saves.readFailed(error);
        },
    });
    return { game, screen, saves, messages };
}

/**
 * `_ShowCredits(1)`: the end of the game, lost or won, over the last frame the adventure
 * drew (`src/renderer/intro/ShowCredits.ts`). The adventure's cursor is drawn into the screen,
 * so it is lifted first, as `STHideCursor(HC50)` lifts CSBWin's.
 *
 * A game that was saved or loaded can be restarted from it. Then the chooser or the
 * entrance has set up the next game, and `_StartCSB` runs `MainLoop` again
 * (doc/CSBwin-src/CSBCode.cpp:11320-11327), on the same `Game` and the same screen.
 */
async function showEndOfGame(game: Game, screen: GameScreen, saves: GameSaves, sound: SoundManager, messages: ScrollingText, word11694: boolean): Promise<void> {
    screen.setHoverPoint(null);
    screen.refreshOverlay();
    const { x, y, z } = game.ctx.party.state.position;
    const end = await runShowCredits(
        {
            canvas: gameCanvasEl,
            gameScreen: screen,
            playSound: (soundId, rateIdx) => sound.playSound(soundId, rateIdx),
            consumeSavedGameRead: () => saves.consumeSavedGameRead(),
            readNewGame: () => readNewGame(game, saves),
            rise: dataSet.miniDat,
        },
        {
            queueDyingSound: () => game.ctx.sounds.queueSound(SOUND_DYING, x, y, 0, z),
            canRestartFromSavegame: game.canRestartFromSavegame(),
            word11694,
            champions: word11694 ? wonChampions(game, screen) : [],
            // `_StartCSB` turns palette switching off before a lost game's credits
            // (doc/CSBwin-src/CSBCode.cpp:11323); `MainLoop`'s won game leaves it as it was.
            palette11946: word11694 ? screen.palette11946() : null,
        },
    );
    if (end === 'terminate') return;
    messages.restart();
    screen.initializePlayState();
    game.resumeMainLoop();
    game.start();
    drawMapPreview(game.ctx.party.state.position.z);
}

/** `d.CH16482[0 … d.NumCharacter - 1]` as the won screen shows them (`Code1f9e6.cpp:176-215`). */
function wonChampions(game: Game, screen: GameScreen): WonChampion[] {
    const partySleeping = game.ctx.party.state.sleeping;
    return game.ctx.party.state.champions.map((champion) => ({
        name: champion.name,
        title: champion.title,
        // `*(name + 9)`: the title's second byte, its raw field's where there is one.
        titleByte1: champion.titleField?.[1] ?? (champion.title.length > 1 ? champion.title.charCodeAt(1) : 0),
        portrait: screen.championPortrait(champion),
        masteries: [0, 1, 2, 3].map((skill) => determineMastery(champion, skill | 0xc000, { partySleeping })),
    }));
}

/** The optional CRT effect over the canvas. Without glfx, the button reports it unavailable. */
async function createCrt(): Promise<void> {
    await loadGlfx().catch((err) => {
        console.warn('glfx failed to load; CRT effect disabled', err);
    });
    crtController = createCrtController(gameCanvasEl);
}

/**
 * The title animation and the dungeon entrance, before anything is playable
 * (`src/renderer/intro/BootSequence.ts`). It runs before `wire` so the adventure
 * screen's own canvas handlers cannot see the entrance's clicks.
 *
 * `?intro=0` skips it, and so does Debug: that mode quick-loads straight into a
 * saved game, where an entrance screen would only be in the way. The golden-frame
 * probe passes the query parameter.
 *
 * With the extras on, the FTL logo comes first (`loadSwooshFiles`).
 */
async function runIntro(game: Game, screen: GameScreen, saves: GameSaves, sound: SoundManager): Promise<PrisonDoorChoice> {
    const settings = loadUISettings();
    const skipIntro =
        new URLSearchParams(window.location.search).get('intro') === '0'
        || settings.debug;
    return runBootSequence({
        canvas: gameCanvasEl,
        gameScreen: screen,
        playSound: (soundId, rateIdx) => sound.playSound(soundId, rateIdx),
        consumeSavedGameRead: () => saves.consumeSavedGameRead(),
        readNewGame: () => readNewGame(game, saves),
        rise: dataSet.miniDat,
        swoosh: skipIntro ? null : await loadSwooshFiles(sound, settings),
        skip: skipIntro,
    });
}

/** The page's side of play: its input and debug chrome, and a redraw per move and per tick. */
function wire(game: Game, screen: GameScreen, saves: GameSaves, sound: SoundManager, messages: ScrollingText): void {
    bindUIContext({
        screen,
        game,
        refreshScreen,
        onQuickSave: () => { void saves.quickSave(); },
        onQuickLoad: () => { void saves.quickLoad(); },
        setCrtEnabled,
        isCrtEnabled,
        setSoundEnabled: (enabled) => {
            sound.unlock();
            sound.setEnabled(enabled);
        },
        isSoundEnabled: () => sound.isEnabled(),
        setSoundVolume: (volume) => sound.setVolume(volume),
        getSoundVolume: () => sound.getVolume(),
    });

    game.onMove((success) => {
        if (success) console.debug(game.getPositionInfo() || 'Moved');
    });

    // A move draws nothing: it brings a tick on at once (`d.clockTick = 1`), and CSBWin
    // draws the viewport only in the tick, once a new party level is loaded
    // (doc/CSBwin-src/CSBCode.cpp:618-639).
    let mapPreviewAt = '';
    game.onTick(() => {
        // `if (d.SelectedCharacterOrdinal != 0) goto tag000730; if (d.PartySleeping != 0)
        // goto tag000730;` (doc/CSBwin-src/CSBCode.cpp:636-637): no `DrawViewport` while an
        // inventory is open or the party sleeps.
        const { selectedCharacterIndex, sleeping } = game.ctx.party.state;
        if (selectedCharacterIndex < 0 && !sleeping) renderView();
        const { x, y, z } = game.ctx.party.state.position;
        if (`${x},${y},${z}` !== mapPreviewAt) {
            mapPreviewAt = `${x},${y},${z}`;
            drawMapPreview(z);
        }
    });

    // The engine drives the message strip (`GameHost.messages`), a scanline of its scroll
    // a VBL; CSBWin's `vblInterrupt` invalidates the window after each
    // (doc/CSBwin-src/CSBCode.cpp:1003). A VBL that inverted a flashed button is drawn too,
    // unless its tick holds the paint until the put-back (`Game.paintHeld`). And so is one
    // the pointer has moved before: the VBL handler alone draws the cursor (`:1040-1043`),
    // and a move of the pointer draws nothing itself (`GameInput.mouseMove`).
    game.onFrame(() => {
        if (game.paintHeld()) return;
        const scrolled = messages.takeChanged();
        const flashed = game.takeFlashChanged();
        const moved = screen.takeCursorMoved();
        if (scrolled || flashed || moved) refreshScreen();
    });
}

function start(game: Game): void {
    game.start();
    console.log('✓ Game engine started');
    console.log('✓ Starting position:', game.getPositionInfo());
    // The game is read, new or resumed: where CSBWin's boot forces DM rules.
    game.forceDMRulesAtBoot();

    drawMapPreview(game.ctx.party.state.position.z);
}

async function init() {
    try {
        bindDataSetChooser(dataSet);
        bindExtrasToggle();
        const files = await loadGameFiles();
        // Every graphics.dat table, read once: the engine's set is built from it, and the
        // screen is handed the same object.
        const graphicsTables = extractGraphicsTables(files.graphicsLoader);
        const tables = buildGameTables(graphicsTables);
        const sound = createSoundManager(files.graphicsLoader, tables);
        const built = construct(files, graphicsTables, tables, sound);
        game = built.game;
        screen = built.screen;
        await createCrt();
        // The saved effect and sound before the intro, which is drawn through one and
        // heard through the other; `wire` applies the rest of the settings once the
        // intro is over.
        const settings = loadUISettings();
        setCrtEnabled(settings.crt);
        sound.setEnabled(settings.soundEnabled);
        sound.setVolume(settings.soundVolume);
        console.log('✓ Game engine and screen constructed');
        // Dev-only debug handle. `tools/probe-ui.mjs` drives the live app through this
        // over CDP — see the `probe-app` skill. Module scope is invisible to the
        // DevTools protocol, so a bug that only shows on screen is otherwise
        // unreachable without hand-patching this file.
        //
        // Guarded on Vite's build-time DEV flag rather than `isDebugFeaturesEnabled()`,
        // which the rest of the Phase 14 scaffolding uses: that toggle is applied from
        // the saved UI settings *after* this init runs, so it always reads false here.
        // `import.meta.env.DEV` is constant-folded to false by `vite build`, so the
        // handle cannot reach a production bundle.
        if (import.meta.env.DEV) {
            // `presetHeroes`: the heroes behind the dungeon's mirrors, for `tools/lib/buildParty.mjs`.
            const presetHeroes = () => extractPresetHeroes(built.game.ctx.dungeon.getData(), built.game.ctx.tables.textDecode);
            (window as unknown as Record<string, unknown>).__probe = { game, screen, renderView, presetHeroes };
        }
        // Before the intro: the entrance's chooser takes a dropped save as the disk menu does.
        bindSaveDrop(built.screen);
        await runIntro(built.game, built.screen, built.saves, sound);
        wire(built.game, built.screen, built.saves, sound, built.messages);
        start(built.game);
    } catch (error) {
        reportError(error);
    }
}

/** What F5 or F9 did, for the console (`GameSaves`), with the error of one that failed. */
function logSave(message: string, error?: unknown): void {
    if (error === undefined) console.info(message);
    else console.warn(`${message}:`, error);
}

/** An error that ends the page's game: `init`'s, or `die`'s (`Die`) wherever it comes from. */
function reportError(error: unknown): void {
    console.error(error);
}


// Start the application
init();
