/**
 * Dungeon Master Web: the page's bootstrap. Without a known `?dungeon=`, `init` shows the
 * welcome page and builds nothing else. With one, it loads the game files, constructs the
 * engine and the screen, runs the intro, wires the page to both, and starts the loop.
 */

import { SoundManager } from './audio/SoundManager';
import { CsbRandom } from './core/random';
import { Position } from './core/types';
import { extractPresetHeroes } from './data/HeroExtractor';
import { DATA_SET_WALLS_ROUTE, DATA_SETS_ROUTE, dataSetNamed, parseManifest, PLAYER_ID_HEADER, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, thumbnailPath, type DataSet, type DataSetManifest } from './data/DataSets';
import { folderFiles, loadGameFiles, type DataSetFiles, type GameFiles } from './data/DataSetFiles';
import { parsePublishedDungeons, type KnownDungeon } from './data/DungeonSignature';
import { isLocalDataSetId, localDataSet, recordFiles } from './data/LocalDataSets';
import { emptyDungeonData } from './data/DungeonLoader';
import { GraphicsLoader } from './data/GraphicsLoader';
import { BrowserDataSetStore, BrowserSaveStore, downloadSaveFile, type DrawPlaythrough, type OpenedSave } from './data/saves';
import { UTILITY_PORTRAITS_FILE, UtilityPortraits } from './data/UtilityPortraits';
import { Game } from './engine/Game';
import { buildGameTables, type GameTables } from './engine/GameTables';
import { extractGraphicsTables, type GraphicsTables } from './data/tables/GraphicsTables';
import { UtilityDiskMessages, UtilityError } from './engine/Chaos';
import { GameSaves, drawPlaythrough } from './engine/GameSaves';
import { loadSwoosh, type Swoosh } from './data/SwooshLoader';
import swooshImageUrl from './assets/swoosh.img?url';
import swooshSoundUrl from './assets/swoosh.wav?url';
import { createCrtEffect, type CrtEffect } from './lib/crt';
import { NO_FULLSCREEN, createFullscreen, type PageFullscreen } from './lib/fullscreen';
import { GameScreen } from './renderer/GameScreen';
import { bindSaveDrop, bindUIEvents, showFatalMessage, showWelcomePage, welcomePageQuery } from './ui';
import { ScrollingText } from './renderer/csbwin/ScrollingText';
import { UIMode } from './renderer/ui/UIState';
import { runBootSequence, runHintOracle, type BootSequenceDeps } from './renderer/intro/BootSequence';
import { reduceTitlePicture } from './renderer/intro/TitlePicture';
import type { TitleFrame } from './renderer/intro/TitleThumbnail';
import { showEndOfGame } from './renderer/intro/EndOfGame';
import { Die } from './engine/Die';
import { csbGraphicsOpener } from './engine/FileSignatures';
import type { PrisonDoorChoice } from './renderer/intro/PrisonDoor';
import { applySaveBytes } from './engine/SaveGameFile';
import { Settings, applyToGame, type SettingsValues } from './settings/Settings';
import type { KeyboardLayoutMap } from './renderer/ui/KeyLabels';
import { GameEvents, keptPlayerId, keptTeleportedPlaythroughs, playerId, sendBeacon } from './ui/gameEvents';

console.log('Dungeon Master Web - Initializing...');

// Global game instance
let game: Game | null = null;
let screen: GameScreen | null = null;
let crtController: CrtEffect | null = null;

/** The folder of the games, relative to the page as every fetch is. */
const GAMEFILES_DIR = 'gamefiles';
/**
 * The game this page plays, chosen from the manifest before anything else is loaded
 * (`?dungeon=<id>`, `chooseDataSet`).
 */
let dataSet!: DataSet;
/** Where its files are read from: its folder, or a local set's record (`chooseDataSet`). */
let setFiles!: DataSetFiles;
/** Its thumbnail, `null` where it has none: from its folder, or a local set's record (`chooseDataSet`). */
let setThumbnail!: () => Promise<Blob | null>;
const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!gameCanvasEl) console.log(`Couldn't find game canvas !`);
/**
 * `#game` in fullscreen, as DISPLAY's FULLSCREEN asks, and the screen at the shape its
 * ASPECT RATIO asks (`src/lib/fullscreen.ts`). The browser's change redraws the screen,
 * and the button with it.
 */
const fullscreen: PageFullscreen = gameCanvasEl.parentElement
    ? createFullscreen(gameCanvasEl.parentElement, gameCanvasEl, () => refreshScreen()) : { ...NO_FULLSCREEN, setAspect: () => {} };

/** `localStorage`, or `null` where the browser forbids it. */
const pageStorage = (() => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
})();

/**
 * The player's settings (`src/settings/Settings.ts`), kept in `localStorage`, or for this
 * page only where the browser forbids it.
 */
const settings = new Settings(pageStorage);

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

function setCrt(scanlines: boolean, curve: boolean): void {
    crtController?.set(scanlines, curve);
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
 * `_ReadEntireGame` for a new game (doc/CSBwin-src/SaveGame.cpp:1579-1594): the data set's
 * `dungeon.dat`, read into the running game. A file that will not open is `die(50)`
 * (`:1579-1586`), and so is one that fails its read `die(0xbad)` (`Game.readDungeonDat`).
 * The game's playthrough is then held against the store's (`GameSaves.newGameRead`).
 */
async function readNewGame(game: Game, saves: GameSaves, events: GameEvents): Promise<void> {
    const name = setFiles.where('dungeon.dat');
    const bytes = await setFiles.read('dungeon.dat');
    if (!bytes) throw new Die(50, `Cannot open dungeon file '${name}'`);
    game.readDungeonDat(bytes);
    console.log(`✓ Read ${name}: ${game.ctx.dungeon.getData().maps.length} levels`);
    await saves.newGameRead();
    events.newGameRead();
}

/**
 * The data set's `mini.dat`, for RISE's new adventure. A file that will not open is the
 * utility's "CAN'T FIND NEW ADVENTURE MINI.DAT" (doc/CSBwin-src/Chaos.cpp:2835-2843).
 */
async function readMiniDat(): Promise<Uint8Array> {
    const bytes = await setFiles.read('mini.dat');
    if (!bytes) throw new UtilityError(UtilityDiskMessages[24]);
    return bytes;
}

/**
 * The data set's `utility-portraits.dat`, for RISE's NEW FACE (`src/data/UtilityPortraits.ts`),
 * read once; `null` for a set without it, which has no toggle.
 */
let utilityPortraits: Promise<UtilityPortraits | null> | null = null;
function readUtilityPortraits(): Promise<UtilityPortraits | null> {
    utilityPortraits ??= (async () => {
        const bytes = await setFiles.read(UTILITY_PORTRAITS_FILE);
        if (!bytes) return null;
        const file = new GraphicsLoader();
        file.loadFromArray(bytes);
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
 * The FTL logo for the boot, read from `swoosh.img`, the page's own asset, which every set
 * shares, or `null` where it cannot be fetched. The boot always shows it when it can
 * (`DEBT.md` H). Its sound is `swoosh.wav`; the logo is shown silent without that file.
 */
async function loadSwooshFiles(sound: SoundManager): Promise<{ image: Swoosh; startSound: () => void } | null> {
    const fetchFile = async (url: string): Promise<ArrayBuffer | null> => {
        const response = await fetch(url).catch(() => null);
        return response?.ok ? response.arrayBuffer() : null;
    };
    const [img, wav] = await Promise.all([fetchFile(swooshImageUrl), fetchFile(swooshSoundUrl)]);
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
 * The set's thumbnail as the boot shows it in the title's place (`DataSet.thumbnailAsTitle`):
 * reduced to sixteen registers (`reduceTitlePicture`), or `null` where there is none to
 * show, and the title animation plays. A thumbnail not `THUMBNAIL_WIDTH`x`THUMBNAIL_HEIGHT`,
 * which a record stored before the form refused one may hold, is not shown. The image is
 * read without colour management, so a PNG gives every player the same screen.
 */
async function loadTitlePicture(): Promise<TitleFrame | null> {
    try {
        const thumbnail = await setThumbnail();
        if (!thumbnail) {
            console.warn(`No title picture: ${dataSet.id} has no thumbnail`);
            return null;
        }
        const bitmap = await createImageBitmap(thumbnail, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const { width, height } = bitmap;
        if (width !== THUMBNAIL_WIDTH || height !== THUMBNAIL_HEIGHT) {
            bitmap.close();
            console.warn(`No title picture: the thumbnail is ${width}x${height}, not ${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}`);
            return null;
        }
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return reduceTitlePicture(context.getImageData(0, 0, width, height).data, width, height);
    } catch (error) {
        console.warn('No title picture:', error);
        return null;
    }
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
        // A save read in play: the screen leaves the old world for the one read.
        savedGameRead: () => screen?.savedGameRead(),
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
            if (screen) showEndOfGame({ ...introDeps({ game, screen, saves, messages, events }, sound), game, messages }, word11694).catch(reportError);
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
    const saves = new GameSaves(game, dataSet, setFiles, saveStore, {
        // A save packs a `CHARDESC`, and that needs graphic 26 for the champions who
        // carry only a portrait index.
        portraitOf: (champion) => screen?.portraitPixelsFor(champion),
        repackOpenChest: () => screen?.repackChest(),
        askBeginAdventure: (source) => screen?.askBeginAdventure(source),
    }, logSave, storeRandom, publishedDungeons);

    // The statistics' events: sent by a production build only, and shown on the console
    // otherwise; neither when the player has turned them off.
    const events = new GameEvents({
        game,
        set: dataSet.id,
        build: __CSBWEB_BUILD__,
        player: playerId,
        enabled: () => settings.values.statistics,
        send: import.meta.env.PROD ? sendBeacon : (event) => console.debug('Event, not sent:', event),
        teleported: keptTeleportedPlaythroughs(pageStorage),
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
        // DELETE, which a long press on a save puts in EXPORT's place.
        onDeleteSave: (entry) => saves.remove(entry),
        // The import: a file dropped on the page (`bindSaveDrop`), held against the dungeon.
        onImportSave: (file, answer) => saves.importSave(file, answer),
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
        // The settings dialog's EXIT, answered: the welcome page, what is not saved lost.
        onExit: () => window.location.assign(welcomePageQuery()),
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
        // The game sends no statistics from then on (`GameEvents.teleported`).
        onTeleport: new URLSearchParams(window.location.search).has('dev') ? (x, y) => {
            if (game.isRunningScript()) return;
            const state = game.ctx.party.state;
            game.setPartyState({ ...state, position: new Position(x, y, state.position.z) });
            events.teleported();
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

/** What the boot and the end of the game share: the canvas, the screen, the sound and the game's read. */
function introDeps({ game, screen, saves, events }: Built, sound: SoundManager): Omit<BootSequenceDeps, 'skip' | 'title'> {
    return {
        canvas: gameCanvasEl,
        gameScreen: screen,
        playSound: (soundId, rateIdx) => sound.playSound(soundId, rateIdx),
        consumeSavedGameRead: () => saves.consumeSavedGameRead(),
        readNewGame: () => readNewGame(game, saves, events),
        rise: dataSet.miniDat,
    };
}

/** The optional CRT effect over the canvas (`src/lib/crt.ts`). Without WebGL, the settings' SCANLINES and SCREEN CURVE are inert. */
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
 *
 * The welcome page's CONTINUE opens the page with `?save=<row id>` (`src/ui/welcomePage.ts`),
 * and that save is read straight into play (`continueSave`), with neither the title nor
 * the entrance. One that is not read leaves the entrance, without the logo or the title.
 */
async function runIntro(built: Built, sound: SoundManager): Promise<PrisonDoorChoice> {
    const params = new URLSearchParams(window.location.search);
    const save = params.get('save');
    if (save !== null && await continueSave(built, save)) return 'resume';
    const skipIntro = params.get('intro') === '0';
    const animations = !skipIntro && save === null && settings.values.startupAnimations;
    return runBootSequence({
        ...introDeps(built, sound),
        swoosh: animations ? await loadSwooshFiles(sound) : null,
        title: animations,
        titlePicture: animations && dataSet.thumbnailAsTitle ? await loadTitlePicture() : null,
        skip: skipIntro,
    });
}

/**
 * CONTINUE's save: the data set's row `id` read into the game as F9 reads one
 * (`GameSaves.read`), the save then the last one used. Resolves to whether it is in. A
 * row that is not the data set's, or is not in the store, is not read, and a file that
 * does not read leaves the game for the entrance to read anew; either way the console
 * says why.
 */
async function continueSave({ saves, events }: Built, id: string): Promise<boolean> {
    try {
        const entry = (await saves.list()).find((row) => row.id === id);
        if (!entry) {
            console.warn(`No saved game '${id}' of ${dataSet.id}: the entrance instead`);
            return false;
        }
        saves.read(await saves.open(entry));
        events.savedGameRead();
        console.log(`✓ Continued ${entry.name}`);
        return true;
    } catch (error) {
        console.warn(`Saved game '${id}' could not be read: the entrance instead`, error);
        return false;
    }
}

/** The page's side of play: its input, and a redraw per move and per tick. */
function wire({ game, screen, saves, messages, events }: Built): void {
    bindUIEvents({
        screen,
        game,
        refreshScreen,
        onQuickSave: () => { void saves.quickSave(); },
        onQuickLoad: () => { void saves.quickLoad(); },
        // On a page opened with `?dev`, the move down and up keys go a level down and up
        // whatever is there; the game then sends no statistics (`GameEvents.teleported`).
        onDevLevel: new URLSearchParams(window.location.search).has('dev') ? (delta) => {
            if (game.devChangeLevel(delta)) events.teleported();
        } : null,
    });

    game.onMove((success) => {
        if (success) console.debug(game.getPositionInfo() || 'Moved');
    });

    // A move draws nothing: it brings a tick on at once (`d.clockTick = 1`), and CSBWin
    // draws the viewport only in the tick, once a new party level is loaded
    // (doc/CSBwin-src/CSBCode.cpp:628-649).
    game.onTick(() => {
        events.tick();
        // `if (d.SelectedCharacterOrdinal != 0) goto tag000730; if (d.PartySleeping != 0)
        // goto tag000730;` (doc/CSBwin-src/CSBCode.cpp:646-647): no `DrawViewport` while an
        // inventory is open or the party sleeps.
        const { selectedCharacterIndex, sleeping } = game.ctx.party.state;
        if (selectedCharacterIndex < 0 && !sleeping) renderView();
    });

    // The engine drives the message strip (`GameHost.messages`), a scanline of its scroll
    // a VBL; CSBWin's `vblInterrupt` invalidates the window after each
    // (doc/CSBwin-src/CSBCode.cpp:1013). A VBL that inverted a flashed button is drawn too,
    // unless its tick holds the paint until the put-back (`Game.paintHeld`). And so is one
    // the pointer has moved before: the VBL handler alone draws the cursor (`:1050-1053`),
    // and a move of the pointer draws nothing itself (`GameInput.mouseMove`), nor does
    // the wheel in a dialog (`GameScreen.handleDialogWheel`).
    game.onFrame(() => {
        if (game.paintHeld()) return;
        const scrolled = messages.takeChanged();
        const flashed = game.takeFlashChanged();
        const moved = screen.takeCursorMoved();
        const wheeled = screen.takeWheelTurned();
        if (scrolled || flashed || moved || wheeled) refreshScreen();
    });
}

/**
 * The player's settings, applied to what plays: the effect, the screen's shape, the sound,
 * the extras and the keys.
 */
function applySettings({ game }: Built, sound: SoundManager, values: SettingsValues): void {
    setCrt(values.scanlines, values.curve);
    fullscreen.setAspect(values.aspectRatio);
    sound.setEnabled(values.sound);
    sound.setVolume(values.volume);
    applyToGame(game.ctx, values);
}

function start(game: Game): void {
    // The game is read, new or resumed: where CSBWin's boot forces DM rules, before
    // `_TAG021028` and the party's entry (doc/CSBwin-src/CSBCode.cpp:10796-10806).
    game.forceDMRulesAtBoot();
    game.start(true);
    console.log('✓ Game engine started');
    console.log('✓ Starting position:', game.getPositionInfo());
}

/**
 * The data sets' manifest (`src/data/DataSets.ts`), the server's answer for the player
 * whose kept `playerId` it is sent, its folders under `gamefiles/`. Without it the page cannot choose a game, so a manifest that is missing or
 * malformed ends the boot, and the error says why.
 */
async function loadManifest(): Promise<DataSetManifest> {
    const url = DATA_SETS_ROUTE;
    const player = keptPlayerId();
    const response = await fetch(url, player === null ? undefined : { headers: { [PLAYER_ID_HEADER]: player } }).catch(() => null);
    if (!response?.ok) throw new Error(`Cannot read the data sets' manifest '${url}'${response ? ` (HTTP ${response.status})` : ''}.`);
    return parseManifest(await response.text(), GAMEFILES_DIR);
}

/** The published sets' dungeons, once the server has given them: kept for the session. */
let published: Promise<KnownDungeon[]> | null = null;

/**
 * The published sets' dungeons (`parsePublishedDungeons`), the server's answer for the
 * player whose kept `playerId` it is sent, as for the manifest: what an import that is
 * not the running set's is held against beside the catalogue (`GameSaves.importSave`).
 * Asked for at the first such import, and kept; where the server cannot answer, the
 * console says why, the import is held against the catalogue alone, and the next asks
 * again.
 */
function publishedDungeons(): Promise<KnownDungeon[]> {
    published ??= (async () => {
        const player = keptPlayerId();
        const response = await fetch(DATA_SET_WALLS_ROUTE, player === null ? undefined : { headers: { [PLAYER_ID_HEADER]: player } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parsePublishedDungeons(await response.text());
    })().catch((error: unknown) => {
        console.warn(`Cannot read the published sets' walls '${DATA_SET_WALLS_ROUTE}': ${error instanceof Error ? error.message : String(error)}`);
        published = null;
        return [];
    });
    return published;
}

/**
 * The set `?dungeon=<id>` names and where its files are read from, or `null` for none or
 * an unknown one: the welcome page's. A `local:` id is a record of the store's
 * (`src/data/LocalDataSets.ts`), which plays its base set's `graphics.dat` where it has
 * none; any other is the manifest's, read from its folder.
 */
async function chooseDataSet(manifest: DataSetManifest): Promise<{ set: DataSet; files: DataSetFiles; thumbnail: () => Promise<Blob | null> } | null> {
    const id = new URLSearchParams(window.location.search).get('dungeon');
    if (isLocalDataSetId(id)) {
        const storeRandom = new CsbRandom();
        const record = await new BrowserDataSetStore((rows) => drawPlaythrough(storeRandom, rows)).get(id!).catch((error: unknown) => {
            console.warn(`The local data sets cannot be read: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        });
        if (!record) {
            console.warn(`Unknown data set '${id}'`);
            return null;
        }
        const base = record.baseSet === null ? null : dataSetNamed(manifest, record.baseSet);
        return { set: localDataSet(record), files: recordFiles(record, base && folderFiles(base.dir)), thumbnail: () => Promise.resolve(record.files.thumbnail ?? null) };
    }
    const set = dataSetNamed(manifest, id);
    if (id !== null && !set) console.warn(`Unknown data set '${id}'`);
    return set && { set, files: folderFiles(set.dir), thumbnail: () => fetchThumbnail(set) };
}

/** `set`'s thumbnail from its folder (`thumbnailPath`), or `null` where it cannot be fetched. */
async function fetchThumbnail(set: DataSet): Promise<Blob | null> {
    const response = await fetch(thumbnailPath(set)).catch(() => null);
    return response?.ok ? response.blob() : null;
}

/**
 * The welcome page (`src/ui/welcomePage.ts`), in the game's place: nothing of the game
 * is built. It lists the store's saves, so it opens the store as the game does, whose
 * upgrade may draw a playthrough for an older row.
 */
function openWelcomePage(manifest: DataSetManifest): Promise<void> {
    const storeRandom = new CsbRandom();
    const draw: DrawPlaythrough = (rows) => drawPlaythrough(storeRandom, rows);
    return showWelcomePage(document.body, manifest, new BrowserSaveStore(draw), new BrowserDataSetStore(draw), loadManifest);
}

async function init() {
    try {
        const manifest = await loadManifest();
        const chosen = await chooseDataSet(manifest);
        if (!chosen) return await openWelcomePage(manifest);
        ({ set: dataSet, files: setFiles, thumbnail: setThumbnail } = chosen);
        console.log(`Loading ${dataSet.name}...`);
        const files = await loadGameFiles(dataSet, setFiles);
        console.log(`✓ Loaded graphics: ${files.graphicsLoader.getItemCount()} items${dataSet.csbGraphics ? ', and the CSBgraphics.dat overlay' : ''}`);
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
        // heard through the sound, and at every change.
        settings.subscribe((values) => applySettings(built, sound, values));
        console.log('✓ Game engine and screen constructed');
        // The probes' handle. `tools/probe-ui.mjs` and `tools/probe-frames.mjs` drive the
        // live app through this over CDP — see the `probe-app` skill. Module scope is
        // invisible to the DevTools protocol, so a bug that only shows on screen is
        // otherwise unreachable without hand-patching this file.
        //
        // Guarded on a build-time flag, which no player can turn on: `__CSBWEB_PROBE__` is
        // the dev server's, and a build's only with `CSBWEB_PROBE=1` (`vite.config.mts`),
        // so the handle cannot reach a deployed bundle.
        if (__CSBWEB_PROBE__) {
            // `presetHeroes`: the heroes behind the dungeon's mirrors, for `tools/lib/buildParty.mjs`.
            const presetHeroes = () => extractPresetHeroes(built.game.ctx.dungeon.getData(), built.game.ctx.tables.textDecode, built.game.ctx.tables);
            (window as unknown as Record<string, unknown>).__probe = { game, screen, saves: built.saves, renderView, refreshScreen, presetHeroes, applySaveBytes };
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
 * The game dies (`Game.die`): it stops, and neither takes a key nor saves. The message
 * takes the screen's place (`showFatalMessage`).
 */
function reportError(error: unknown): void {
    console.error(error);
    game?.die();
    setCrt(false, false);
    showFatalMessage(gameCanvasEl, error instanceof Error ? error.message : String(error));
}


// Start the application
init();
