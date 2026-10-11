/**
 * Dungeon Master Web: the page's bootstrap. `init` loads the game files, constructs the
 * engine and the screen, runs the intro, wires the page to both, and starts the loop.
 */

import { SoundManager } from './audio/SoundManager';
import { CsbRandom } from './core/random';
import { Position } from './core/types';
import { CSBGraphicsLoader } from './data/CSBGraphicsLoader';
import { extractPresetHeroes } from './data/HeroExtractor';
import { MANIFEST_NAME, dataSetFor, parseManifest, type DataSet, type DataSetManifest } from './data/DataSets';
import { emptyDungeonData } from './data/DungeonLoader';
import { GraphicsLoader } from './data/GraphicsLoader';
import { parseHcsbDat } from './data/HintOracleLoader';
import { BrowserSaveStore, downloadSaveFile, type OpenedSave } from './data/saves';
import { UTILITY_PORTRAITS_FILE, UtilityPortraits } from './data/UtilityPortraits';
import { Game } from './engine/Game';
import { buildGameTables, type GameTables } from './engine/GameTables';
import { extractGraphicsTables, type GraphicsTables } from './data/tables/GraphicsTables';
import { UtilityDiskMessages, UtilityError } from './engine/Chaos';
import { GameSaves, drawPlaythrough } from './engine/GameSaves';
import { loadSwoosh, type Swoosh } from './data/SwooshLoader';
import { createCrtEffect, type CrtEffect } from './lib/crt';
import { NO_FULLSCREEN, createFullscreen } from './lib/fullscreen';
import { GameScreen } from './renderer/GameScreen';
import { bindDataSetChooser, bindSaveDrop, bindSettingsControls, bindUIContext, drawMapPreview, showFatalMessage } from './ui';
import { ScrollingText } from './renderer/csbwin/ScrollingText';
import { UIMode } from './renderer/ui/UIState';
import { runBootSequence, runHintOracle, runShowCredits } from './renderer/intro/BootSequence';
import { Die } from './engine/Die';
import { csbGraphicsOpener } from './engine/FileSignatures';
import type { HintOracleFiles } from './renderer/ui/HintOracleButton';
import type { PrisonDoorChoice } from './renderer/intro/PrisonDoor';
import { SOUND_DYING, type WonChampion } from './renderer/intro/ShowCredits';
import { determineMastery } from './engine/skills';
import { applySaveBytes } from './engine/SaveGameFile';
import { Settings, applyToGame, type SettingsValues } from './settings/Settings';
import type { KeyboardLayoutMap } from './renderer/ui/KeyLabels';
import { GameEvents, playerId, sendBeacon } from './ui/gameEvents';

console.log('Dungeon Master Web - Initializing...');

// Global game instance
let game: Game | null = null;
let screen: GameScreen | null = null;
let crtController: CrtEffect | null = null;

/** The folder of the games and their manifest, relative to the page as every fetch is. */
const GAMEFILES_DIR = 'gamefiles';
/**
 * The game this page plays, chosen from the manifest before anything else is loaded
 * (`?dungeon=<id>`, `chooseDataSet`).
 */
let dataSet!: DataSet;
/** The FTL logo's folder, the manifest's, or `null` where it names none. */
let swooshDir: string | null = null;
const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!gameCanvasEl) console.log(`Couldn't find game canvas !`);
/**
 * `#game` in fullscreen, as DISPLAY's FULLSCREEN asks (`src/lib/fullscreen.ts`). The
 * browser's change redraws the screen, and the button with it.
 */
const fullscreen = gameCanvasEl.parentElement
    ? createFullscreen(gameCanvasEl.parentElement, gameCanvasEl, () => refreshScreen()) : NO_FULLSCREEN;

/**
 * The player's settings (`src/settings/Settings.ts`), kept in `localStorage`, or for this
 * page only where the browser forbids it.
 */
const settings = new Settings((() => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
})());

/**
 * What this keyboard prints on each key, where the browser says
 * (`navigator.keyboard.getLayoutMap()`, Chromium's alone), read once at the start; `null`
 * until then, and where it does not say. DOM's types do not have it yet.
 */
let keyboardLayout: KeyboardLayoutMap | null = null;
function readKeyboardLayout(): void {
    const keyboard = (navigator as { keyboard?: { getLayoutMap?: () => Promise<KeyboardLayoutMap> } }).keyboard;
    keyboard?.getLayoutMap?.().then((map) => { keyboardLayout = map; }, () => {});
}
readKeyboardLayout();

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
 * (`tag000698`, doc/CSBwin-src/CSBCode.cpp:611; `Game.start`). Every other redraw is
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
    /** `CSBgraphics.dat`, CSBWin's extensions' overlay, or its absence (`CSBGraphicsLoader`). */
    csbGraphicsLoader: CSBGraphicsLoader;
    /** The Hint Oracle's `hcsb.hct` and `hcsb.dat`, where the data set has them. */
    hintOracle: HintOracleFiles | null;
}

async function loadGameFiles(): Promise<GameFiles> {
    console.log(`Loading ${dataSet.name}: graphics.dat...`);
    const graphicsLoader = new GraphicsLoader();
    await graphicsLoader.load(`${dataSet.dir}/graphics.dat`);
    console.log(`✓ Loaded graphics: ${graphicsLoader.getItemCount()} items`);

    // A data set's file that does not load or parse throws, and the page refuses it
    // (`reportError`).
    const csbGraphicsLoader = new CSBGraphicsLoader();
    if (dataSet.csbGraphics) {
        await csbGraphicsLoader.load(`${dataSet.dir}/CSBgraphics.dat`);
        console.log('✓ Loaded CSBgraphics.dat overlay');
    }
    return { graphicsLoader, csbGraphicsLoader, hintOracle: await loadHintOracle() };
}

/**
 * The Hint Oracle's two files, or `null` where the data set has none, or `hcsb.dat` does
 * not read: then the inventory's close box is CSBWin's (`src/renderer/ui/HintOracleButton.ts`).
 * `hcsb.hct` is read when the Oracle opens, under the running world's key.
 */
async function loadHintOracle(): Promise<HintOracleFiles | null> {
    if (!dataSet.hintOracle) return null;
    const fetchFile = async (name: string): Promise<Uint8Array | null> => {
        const response = await fetch(`${dataSet.dir}/${name}`).catch(() => null);
        return response?.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    };
    const [hct, dat] = await Promise.all([fetchFile('hcsb.hct'), fetchFile('hcsb.dat')]);
    if (!hct || !dat) return null;
    try {
        return { hct, dat: parseHcsbDat(dat) };
    } catch (error) {
        console.warn('No Hint Oracle:', error);
        return null;
    }
}

/**
 * `_ReadEntireGame` for a new game (doc/CSBwin-src/SaveGame.cpp:1579-1594): the data set's
 * `dungeon.dat`, read into the running game. A file that will not open is `die(50)`
 * (`:1579-1586`), and so is one that fails its read `die(0xbad)` (`Game.readDungeonDat`).
 * The game's playthrough is then held against the store's (`GameSaves.newGameRead`).
 */
async function readNewGame(game: Game, saves: GameSaves, events: GameEvents): Promise<void> {
    const name = `${dataSet.dir}/dungeon.dat`;
    const response = await fetch(name).catch(() => null);
    if (!response?.ok) throw new Die(50, `Cannot open dungeon file '${name}'`);
    game.readDungeonDat(new Uint8Array(await response.arrayBuffer()));
    console.log(`✓ Read ${name}: ${game.ctx.dungeon.getData().maps.length} levels`);
    await saves.newGameRead();
    events.newGameRead();
}

/**
 * The data set's `mini.dat`, for RISE's new adventure. A file that will not open is the
 * utility's "CAN'T FIND NEW ADVENTURE MINI.DAT" (doc/CSBwin-src/Chaos.cpp:2835-2843).
 */
async function readMiniDat(): Promise<Uint8Array> {
    const response = await fetch(`${dataSet.dir}/mini.dat`).catch(() => null);
    if (!response?.ok) throw new UtilityError(UtilityDiskMessages[24]);
    return new Uint8Array(await response.arrayBuffer());
}

/**
 * The data set's `utility-portraits.dat`, for RISE's NEW FACE (`src/data/UtilityPortraits.ts`),
 * read once; `null` for a set without it, which has no toggle.
 */
let utilityPortraits: Promise<UtilityPortraits | null> | null = null;
function readUtilityPortraits(): Promise<UtilityPortraits | null> {
    utilityPortraits ??= (async () => {
        const response = await fetch(`${dataSet.dir}/${UTILITY_PORTRAITS_FILE}`).catch(() => null);
        if (!response?.ok) return null;
        const file = new GraphicsLoader();
        file.loadFromArray(new Uint8Array(await response.arrayBuffer()));
        return new UtilityPortraits(file);
    })();
    return utilityPortraits;
}

/**
 * The sound manager, unlocked by the first press or key anywhere on the page, the Sound
 * button's included: browsers keep audio locked until then.
 */
function createSoundManager(graphicsLoader: GraphicsLoader, tables: GameTables): SoundManager {
    const sound = new SoundManager(graphicsLoader);
    if (sound.isAvailable()) {
        const unlockAudio = (): void => {
            sound.unlock();
        };
        window.addEventListener('pointerdown', unlockAudio, { once: true });
        window.addEventListener('keydown', unlockAudio, { once: true });
    }
    sound.setSoundTable(tables.sound1772);
    if (sound.isAvailable()) sound.preloadAll();
    return sound;
}

/** The recording of the FTL logo's sound. */
const SWOOSH_RECORDING = 'swoosh';

/**
 * The FTL logo for the boot, read from `swoosh.img` as any game file is, or `null`
 * where the file is not served. The boot always shows it when it is (`DEBT.md` H). Its
 * sound is `swoosh.wav`; the logo is shown silent without that file.
 */
async function loadSwooshFiles(sound: SoundManager): Promise<{ image: Swoosh; startSound: () => void } | null> {
    if (swooshDir === null) return null;
    const dir = swooshDir;
    const fetchFile = async (name: string): Promise<ArrayBuffer | null> => {
        const response = await fetch(`${dir}/${name}`).catch(() => null);
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
function construct(files: GameFiles, graphicsTables: GraphicsTables, tables: GameTables, sound: SoundManager): Built {
    const messages = new ScrollingText(tables.byte1830);
    const playSound = (soundId: number, rateIdx?: number, highVolume?: number) => sound.playSound(soundId, rateIdx, highVolume);
    // The screen is built second, over the engine's dungeon, so the engine→UI notices
    // reach it through this variable.
    let screen: GameScreen | null = null;
    // Over an empty world, as `d.Initialize()` leaves CSBWin's: the boot reads the game.
    const game = new Game(emptyDungeonData(), tables, {
        messages,
        playSound,
        playCustomSound: (samples, volume) => sound.playCustomSound(samples, volume),
        // `d.PartySleeping`: button 145 puts the party to sleep, 146 or a blow
        // wakes it. The UI follows with `Buttons17796` (`doc/CSBwin-src/Mouse.cpp:1837`)
        // or the adventure lists back (`CSBCode.cpp:7115-7116`), and the message
        // area with its tenfold timeout (`CSBCode.cpp:1556-1563`).
        sleepChanged: (sleeping) => {
            screen?.setUIMode(sleeping ? UIMode.Sleeping : UIMode.Adventure);
            messages.setPartySleeping(sleeping);
        },
        // The first half of Reincarnate: the engine raises the name-entry screen
        // (`doc/CSBwin-src/CSBCode.cpp:6797` around `Code13ea4.cpp:20`); the
        // screen hands its answer to `HallOfChampions.reincarnateNamed`.
        openReincarnateScreen: (chIdx) => screen?.openReincarnateScreen(chIdx),
        // A weapon hand changed, or a chest left the open inventory's weapon hand:
        // the attack menu, the inventory and the open chest are the screen's.
        closeAttackMenuOf: (chIdx) => screen?.closeAttackMenuOf(chIdx),
        attackingCharacterOrdinal: () => screen?.attackingCharacterOrdinal() ?? 0,
        pressingEye: () => screen?.pressingEye() ?? false,
        pressingMouth: () => screen?.pressingMouth() ?? false,
        displayResurrectChestOrScroll: () => screen?.displayResurrectChestOrScroll() ?? 0,
        showHideInventory: (chIdx) => screen?.showHideInventory(chIdx),
        releaseEyeOrMouth: () => screen?.releaseEyeOrMouth(),
        repackChest: () => screen?.repackChest(),
        // `TAG02076e` / `TAG0207cc` from the engine: the Hall of Champions and `WakeUp`.
        tag02076e: () => screen?.tag02076e(),
        tag0207cc: () => screen?.tag0207cc(),
        // The prison's fourth champion asks whether the adventure begins, and every
        // champion is reported.
        championJoined: (joined) => {
            saves.championJoined();
            events.championJoined(joined);
        },
        // `ShowCredits(1)`: `MainLoop` has returned on a lost game
        // (doc/CSBwin-src/CSBCode.cpp:11560), or has won it (`:641`).
        // A frame threw: CSBWin's `die`, the loop stopped.
        die: reportError,
        showCredits: (word11694) => {
            events.ended(word11694);
            if (screen) showEndOfGame({ game, screen, saves, messages, events }, sound, word11694).catch(reportError);
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
        // A champion sent to the wings by `&SWAPCHARACTER` takes their portrait's pixels.
        portraitOf: (champion) => screen?.portraitPixelsFor(champion),
    });

    // `CSBgraphics.dat` opens at its first section read, against what the game read names.
    files.csbGraphicsLoader.opener = csbGraphicsOpener(game.ctx);
    // A DSA's `&SOUND` numbered from 0 plays one of its sounds.
    game.ctx.sounds.csbGraphics = files.csbGraphicsLoader;
    // So do a DSA's `&OVERLAY` and `&PALETTE`, and a file that will not open puts the
    // overlay down.
    game.ctx.overlay.csbGraphics = files.csbGraphicsLoader;
    files.csbGraphicsLoader.cannotOpen = () => { game.ctx.overlay.active = false; };

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

    // The statistics' events: sent by a production build only, and shown on the console
    // otherwise; neither when the player has turned them off.
    const events = new GameEvents({
        game,
        set: dataSet.id,
        build: __CSBWEB_BUILD__,
        player: playerId,
        enabled: () => settings.values.statistics,
        send: import.meta.env.PROD ? sendBeacon : (event) => console.debug('Event, not sent:', event),
    });
    // RISE's new adventure, which a read then makes the running game.
    let adventure: OpenedSave | null = null;

    screen = new GameScreen(gameCanvasEl, {
        graphicsLoader: files.graphicsLoader,
        tables: graphicsTables,
        ctx: game.ctx,
        csbGraphicsLoader: files.csbGraphicsLoader,
        messages,
        hintOracle: files.hintOracle,
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
        onMakeNewAdventure: async (source, newFaces) => (adventure = await saves.makeNewAdventure(
            source, await readMiniDat(), newFaces ? await readUtilityPortraits() : null)),
        onHasNewFaces: async () => (await readUtilityPortraits()) !== null,
        onSaveGame: (over) => saves.save('stopped', over ?? 'new'),
        isPrison: () => saves.inPrison(),
        // EXPORT: the row's file as the store holds it, downloaded under the row's name.
        onExportSave: async (entry) => downloadSaveFile(entry.name, (await saves.open(entry)).bytes),
        // The import: a file dropped on the page (`bindSaveDrop`), held against the dungeon.
        onImportSave: (file, confirmed) => saves.importSave(file, confirmed),
        onRestoreSave: (save) => {
            saves.read(save);
            if (save === adventure) events.newGameRead();
            else events.savedGameRead();
        },
        // The boot's chooser only: its read failed, and `tag01efee` follows; or RISE's
        // new adventure was refused, and the entrance says why.
        onRestoreFailed: (error) => {
            console.error(error instanceof UtilityError ? 'New adventure refused:' : 'Saved game damaged:', error);
            saves.readFailed(error);
        },
        // The party lay down, or the player woke it: the playthrough's Sleepsave.
        onSleepSave: () => { void saves.sleepSave(); },
        // The settings dialog reads and changes the player's settings, which this page
        // applies (`applySettings`); its CRT toggle is inert without WebGL, and its
        // FULLSCREEN where the browser gives none.
        settings,
        isCrtAvailable: () => crtController?.isAvailable() ?? false,
        fullscreen,
        // The KEYS tab labels a key with what this keyboard prints on it, where the
        // browser says (`readKeyboardLayout`).
        keyboardLayout: () => keyboardLayout,
        // A click on the map dialog's square moves the party there, on a page opened with
        // `?dev` alone. A script holding the loop (the fusion) runs on the party where it stands.
        onTeleport: new URLSearchParams(window.location.search).has('dev') ? (x, y) => {
            if (game.isRunningScript()) return;
            const state = game.ctx.party.state;
            game.setPartyState({ ...state, position: new Position(x, y, state.position.z) });
        } : null,
        // The Hint Oracle's button: the screen has stopped the clock and shaded the
        // interface, and the Oracle has the canvas until it closes.
        onOpenHintOracle: (square) => {
            const close = (): void => {
                screen?.closeHintOracle();
            };
            if (!screen || !files.hintOracle) return close();
            const deps = { canvas: gameCanvasEl, gameScreen: screen, playSound };
            runHintOracle(deps, files.hintOracle, square, game.ctx.state.dungeon.hintKey).catch(reportError).finally(close);
        },
    });
    return { game, screen, saves, messages, events };
}

/** What `construct` builds, which the boot, the play and the end of the game share. */
interface Built {
    game: Game;
    screen: GameScreen;
    saves: GameSaves;
    messages: ScrollingText;
    events: GameEvents;
}

/**
 * `_ShowCredits(1)`: the end of the game, lost or won, over the last frame the adventure
 * drew (`src/renderer/intro/ShowCredits.ts`). The adventure's cursor is drawn into the screen,
 * so it is lifted first, as `STHideCursor(HC50)` lifts CSBWin's.
 *
 * A game that was saved or loaded can be restarted from it. Then the chooser or the
 * entrance has set up the next game, and `_StartCSB` runs `MainLoop` again
 * (doc/CSBwin-src/CSBCode.cpp:11555-11562), on the same `Game` and the same screen.
 */
async function showEndOfGame({ game, screen, saves, messages, events }: Built, sound: SoundManager, word11694: boolean): Promise<void> {
    screen.setHoverPoint(null);
    screen.refreshOverlay();
    const { x, y, z } = game.ctx.party.state.position;
    const end = await runShowCredits(
        {
            canvas: gameCanvasEl,
            gameScreen: screen,
            playSound: (soundId, rateIdx) => sound.playSound(soundId, rateIdx),
            consumeSavedGameRead: () => saves.consumeSavedGameRead(),
            readNewGame: () => readNewGame(game, saves, events),
            rise: dataSet.miniDat,
        },
        {
            queueDyingSound: () => game.ctx.sounds.queueSound(SOUND_DYING, x, y, 0, z),
            canRestartFromSavegame: game.canRestartFromSavegame(),
            word11694,
            champions: word11694 ? wonChampions(game, screen) : [],
            // `_StartCSB` turns palette switching off before a lost game's credits
            // (doc/CSBwin-src/CSBCode.cpp:11558); `MainLoop`'s won game leaves it as it was.
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

/** The optional CRT effect over the canvas (`src/lib/crt.ts`). Without WebGL, the button reports it unavailable. */
function createCrt(): void {
    crtController = createCrtEffect(gameCanvasEl);
}

/**
 * The title animation and the dungeon entrance, before anything is playable
 * (`src/renderer/intro/BootSequence.ts`). It runs before `wire` so the adventure
 * screen's own canvas handlers cannot see the entrance's clicks.
 *
 * The FTL logo comes first (`loadSwooshFiles`). With the startup animations off, neither
 * it nor the title is shown, and the entrance is. `?intro=0` skips all of it, for the
 * golden-frame probe and `tools/probe-ui.mjs`.
 */
async function runIntro({ game, screen, saves, events }: Built, sound: SoundManager): Promise<PrisonDoorChoice> {
    const skipIntro = new URLSearchParams(window.location.search).get('intro') === '0';
    const animations = !skipIntro && settings.values.startupAnimations;
    return runBootSequence({
        canvas: gameCanvasEl,
        gameScreen: screen,
        playSound: (soundId, rateIdx) => sound.playSound(soundId, rateIdx),
        consumeSavedGameRead: () => saves.consumeSavedGameRead(),
        readNewGame: () => readNewGame(game, saves, events),
        rise: dataSet.miniDat,
        swoosh: animations ? await loadSwooshFiles(sound) : null,
        title: animations,
        skip: skipIntro,
    });
}

/** The page's side of play: its input and debug chrome, and a redraw per move and per tick. */
function wire({ game, screen, saves, messages, events }: Built): void {
    bindUIContext({
        screen,
        game,
        refreshScreen,
        onQuickSave: () => { void saves.quickSave(); },
        onQuickLoad: () => { void saves.quickLoad(); },
    });

    game.onMove((success) => {
        if (success) console.debug(game.getPositionInfo() || 'Moved');
    });

    // A move draws nothing: it brings a tick on at once (`d.clockTick = 1`), and CSBWin
    // draws the viewport only in the tick, once a new party level is loaded
    // (doc/CSBwin-src/CSBCode.cpp:628-649).
    let mapPreviewAt = '';
    game.onTick(() => {
        events.tick();
        // `if (d.SelectedCharacterOrdinal != 0) goto tag000730; if (d.PartySleeping != 0)
        // goto tag000730;` (doc/CSBwin-src/CSBCode.cpp:646-647): no `DrawViewport` while an
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
    // (doc/CSBwin-src/CSBCode.cpp:1013). A VBL that inverted a flashed button is drawn too,
    // unless its tick holds the paint until the put-back (`Game.paintHeld`). And so is one
    // the pointer has moved before: the VBL handler alone draws the cursor (`:1050-1053`),
    // and a move of the pointer draws nothing itself (`GameInput.mouseMove`).
    game.onFrame(() => {
        if (game.paintHeld()) return;
        const scrolled = messages.takeChanged();
        const flashed = game.takeFlashChanged();
        const moved = screen.takeCursorMoved();
        if (scrolled || flashed || moved) refreshScreen();
    });
}

/** The player's settings, applied to what plays: the effect, the sound, the extras and the keys. */
function applySettings({ game }: Built, sound: SoundManager, values: SettingsValues): void {
    setCrtEnabled(values.crt);
    sound.setEnabled(values.sound);
    sound.setVolume(values.volume);
    applyToGame(game.ctx, values);
}

function start(game: Game): void {
    game.start();
    console.log('✓ Game engine started');
    console.log('✓ Starting position:', game.getPositionInfo());
    // The game is read, new or resumed: where CSBWin's boot forces DM rules.
    game.forceDMRulesAtBoot();

    drawMapPreview(game.ctx.party.state.position.z);
}

/**
 * The data sets' manifest (`src/data/DataSets.ts`). Without it the page cannot choose a
 * game, so a manifest that is missing or malformed ends the boot, and the error says why.
 */
async function loadManifest(): Promise<DataSetManifest> {
    const url = `${GAMEFILES_DIR}/${MANIFEST_NAME}`;
    const response = await fetch(url).catch(() => null);
    if (!response?.ok) throw new Error(`Cannot read the data sets' manifest '${url}'${response ? ` (HTTP ${response.status})` : ''}.`);
    return parseManifest(await response.text(), GAMEFILES_DIR);
}

/** The set `?dungeon=<id>` names, or the manifest's default. */
function chooseDataSet(manifest: DataSetManifest): DataSet {
    const id = new URLSearchParams(window.location.search).get('dungeon');
    const set = dataSetFor(manifest, id);
    if (id !== null && set.id !== id) console.warn(`Unknown data set '${id}'; playing ${set.id}`);
    return set;
}

async function init() {
    try {
        const manifest = await loadManifest();
        dataSet = chooseDataSet(manifest);
        swooshDir = manifest.swooshDir;
        bindDataSetChooser(manifest, dataSet);
        const files = await loadGameFiles();
        // Every graphics.dat table, read once: the engine's set is built from it, and the
        // screen is handed the same object.
        const graphicsTables = extractGraphicsTables(files.graphicsLoader);
        const tables = buildGameTables(graphicsTables);
        const sound = createSoundManager(files.graphicsLoader, tables);
        const built = construct(files, graphicsTables, tables, sound);
        game = built.game;
        screen = built.screen;
        // The data set's rules, before any file is read: one with an Extended Features
        // block sets its own (`DataSet.dmRules`).
        game.ctx.rules.dmRulesDesignOption = dataSet.dmRules;
        createCrt();
        // The settings before the FTL logo, which is drawn through the CRT effect and
        // heard through the sound, and at every change; then the page's buttons show
        // them, the CRT effect as applied.
        settings.subscribe((values) => applySettings(built, sound, values));
        bindSettingsControls(settings, isCrtEnabled);
        console.log('✓ Game engine and screen constructed');
        // The probes' handle. `tools/probe-ui.mjs` and `tools/probe-frames.mjs` drive the
        // live app through this over CDP — see the `probe-app` skill. Module scope is
        // invisible to the DevTools protocol, so a bug that only shows on screen is
        // otherwise unreachable without hand-patching this file.
        //
        // Guarded on a build-time flag rather than the page's Debug setting, which any
        // player can turn on: `__CSBWEB_PROBE__` is the dev server's, and a build's only
        // with `CSBWEB_PROBE=1` (`vite.config.mts`), so the handle cannot reach a deployed
        // bundle.
        if (__CSBWEB_PROBE__) {
            // `presetHeroes`: the heroes behind the dungeon's mirrors, for `tools/lib/buildParty.mjs`.
            const presetHeroes = () => extractPresetHeroes(built.game.ctx.dungeon.getData(), built.game.ctx.tables.textDecode, built.game.ctx.tables);
            (window as unknown as Record<string, unknown>).__probe = { game, screen, renderView, refreshScreen, presetHeroes, applySaveBytes };
        }
        // Before the intro: the entrance's chooser takes a dropped save as the disk menu does.
        bindSaveDrop(built.screen);
        await runIntro(built, sound);
        wire(built);
        start(built.game);
    } catch (error) {
        reportError(error);
    }
}

/** What F5, F9 or the Sleepsave did, for the console (`GameSaves`), with the error of one that failed. */
function logSave(message: string, error?: unknown): void {
    if (error === undefined) console.info(message);
    else console.warn(`${message}:`, error);
}

/**
 * An error that ends the page's game: `init`'s, or `die`'s (`Die`) wherever it comes from.
 * The game stops, and the message takes the screen's place (`showFatalMessage`).
 */
function reportError(error: unknown): void {
    console.error(error);
    game?.stop();
    setCrtEnabled(false);
    showFatalMessage(gameCanvasEl, error instanceof Error ? error.message : String(error));
}


// Start the application
init();
