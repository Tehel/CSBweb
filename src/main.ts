/**
 * Dungeon Master Web: the page's bootstrap. Without a known `?dungeon=`, `init` shows the
 * welcome page and builds nothing else. With one, it loads the game files, constructs the
 * engine and the screen, runs the intro, wires the page to both, and starts the loop.
 */

import { SoundManager } from './audio/SoundManager';
import { VBL_FREQUENCY } from './core/constants';
import { CsbRandom } from './core/random';
import { extractPresetHeroes } from './data/HeroExtractor';
import {
    DATA_SET_FILES_ROUTE, DATA_SET_WALLS_ROUTE, DATA_SETS_ROUTE, dataSetNamed, parseManifest, PLAYER_ID_HEADER, PROOF_ID, PROOF_RECORDING_PREFIX, PROOFS_ROUTE, SHARED_RECORDING_ID, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH,
    thumbnailPath, type DataSet, type DataSetManifest,
} from './data/DataSets';
import { digestedFiles, fileDigest, folderFiles, loadGameFiles, readAchievementsText, type DataSetFiles, type DigestedFiles, type GameFiles } from './data/DataSetFiles';
import { parsePublishedDungeons, type KnownDungeon } from './data/DungeonSignature';
import { isLocalDataSetId, localDataSet, recordFiles } from './data/LocalDataSets';
import { findRecordingSet, parseSetDigests, type SetDigests } from './data/RecordingSet';
import { emptyDungeonData } from './data/DungeonLoader';
import { GraphicsLoader } from './data/GraphicsLoader';
import { BrowserAchievementStore, BrowserDataSetStore, BrowserRecordingStore, BrowserSaveStore, downloadSaveFile, readRecordingPath, type DrawPlaythrough, type OpenedSave, type SaveStore } from './data/saves';
import { UTILITY_PORTRAITS_FILE, readUtilityPortraits, type UtilityPortraits } from './data/UtilityPortraits';
import { Game } from './engine/Game';
import { buildGameTables, type GameTables } from './engine/GameTables';
import { extractGraphicsTables, type GraphicsTables } from './data/tables/GraphicsTables';
import { UtilityDiskMessages, UtilityError } from './engine/Chaos';
import { GameSaves, drawPlaythrough } from './engine/GameSaves';
import { PageAchievements } from './engine/achievements/PageAchievements';
import { readAchievementSetFiles, type AchievementSetFiles } from './engine/achievements/DataCounts';
import { PageProofs, storedPackage } from './engine/achievements/PageProofs';
import { achievementDefs } from './ui/achievementFiles';
import { loadSwoosh, type Swoosh } from './data/SwooshLoader';
// A file, never inlined as a `data:` URL, which the server's policy does not fetch (`SECURITY_HEADERS`).
import swooshImageUrl from './assets/swoosh.img?url&no-inline';
import swooshSoundUrl from './assets/swoosh.wav?url';
import { createCrtEffect, type CrtEffect } from './lib/crt';
import { Presenter } from './renderer/Presenter';
import { NO_FULLSCREEN, createFullscreen, type PageFullscreen } from './lib/fullscreen';
import { GameScreen, type KeptView } from './renderer/GameScreen';
import { NO_INPUT, type GameInput } from './renderer/GameInput';
import { hostDrawing } from './renderer/ui/HostDrawing';
import { bindSaveDrop, bindUIEvents, RECORDING_STOPPED_HASH, showFatalMessage, showWelcomePage, welcomePageQuery } from './ui';
import { ScrollingText } from './renderer/csbwin/ScrollingText';
import { UIMode } from './renderer/ui/UIState';
import { openReincarnateScreen } from './renderer/ui/ReIncarnate';
import { askBeginAdventure } from './renderer/ui/SaveMenu';
import { showAchievementNotice, takeBannerChanged } from './renderer/ui/AchievementBanner';
import { introProbe, openHintOracle, runBootSequence, type BootSequenceDeps } from './renderer/intro/BootSequence';
import { reduceTitlePicture } from './renderer/intro/TitlePicture';
import type { TitleFrame } from './renderer/intro/TitleThumbnail';
import { queueDyingSound, showEndOfGame } from './renderer/intro/EndOfGame';
import { Die } from './core/Die';
import { csbGraphicsOpener } from './engine/FileSignatures';
import type { PrisonDoorChoice } from './renderer/intro/PrisonDoor';
import { Recorder } from './engine/Recorder';
import { partyNames, RecordingWriter } from './engine/RecordingWriter';
import { endLines, RecordingPlayer, skippedLine, type SavedAtEnd } from './engine/RecordingPlayer';
import { KeptCheckpoints } from './engine/Checkpoint';
import {
    BACK_VBLS, FORWARD_VBLS, drawRecordingStrip, nextPace, rewindPage, seekBack, seekLanded, stripActionAt, stripKeyAction, type Pace,
    type StripAction, type StripState,
} from './renderer/ui/RecordingStrip';
import { packageOfSave, readRecordingPackage, recordingPackageUrl, writeRecordingPackage } from './engine/RecordingPackage';
import { pathToWay, pointPath, pointRecordingId, SAVE_POINT_PREFIX, savedAtWay, storedPoints, wayPoints } from './engine/RecordingPoints';
import { cutAtSave } from './engine/RecordingCut';
import { cutPageOf, standInPage } from './renderer/StandInPage';
import type { Recording, RecordingPoint } from './engine/Recorder';
import { applySaveBytes } from './engine/SaveGameFile';
import { Settings, applyToGame, type SettingsValues } from './settings/Settings';
import type { KeyboardLayoutMap } from './renderer/ui/KeyLabels';
import { GameEvents, keptPlayerId, keptTeleportedPlaythroughs, playerId, sendBeacon } from './ui/gameEvents';
import { askVerdicts, hasPublicName, sendProof } from './ui/proofRoutes';

console.log('Dungeon Master Web - Initializing...');

// Global game instance
let game: Game | null = null;
let screen: GameScreen | null = null;
let crtController: CrtEffect | null = null;
/**
 * The page's one animation clock (`src/renderer/Presenter.ts`): the interface's
 * animations, composed again through `refreshScreen`'s guards, the pre-game screens' VBLs,
 * and the CRT effect.
 */
const presenter = new Presenter(() => {
    if (game && screen) screen.animationFrame(game.mainLoopHasReturned());
});

/** The folder of the games, relative to the page as every fetch is. */
const GAMEFILES_DIR = 'gamefiles';
/** The colour of the page's lines in the message area while a recording plays: the room texts' white. */
const RECORDING_LINE_COLOR = 15;
/** How often the running recording is written to the store (`RecordingWriter`), in milliseconds. */
const RECORDING_WRITE_MS = 5000;
/** How often the page asks for the verdicts its proofs await (`PageProofs.refresh`): nothing is asked while none does. */
const VERDICTS_MS = 2 * 60 * 1000;
/** The time a recording's viewer stays at its end before loop plays it again (`playRecording`). */
const LOOP_DELAY_MS = 2000;
/**
 * The game this page plays, chosen from the manifest before anything else is loaded
 * (`?dungeon=<id>`, `chooseDataSet`).
 */
let dataSet!: DataSet;
/** Where its files are read from: its folder, or a local set's record (`chooseDataSet`). */
let setFiles!: DigestedFiles;
/** Its thumbnail, `null` where it has none: from its folder, or a local set's record (`chooseDataSet`). */
let setThumbnail!: () => Promise<Blob | null>;
/**
 * `?recording=<id>`: the recording this page plays back in place of a game, the site's or
 * the store's (`playRecording`), on the set it names, or `null`. Its player, once it is begun.
 */
const playedRecording = new URLSearchParams(window.location.search).get('recording');
/**
 * `?from=` and `&to=`: the saves on the way a store's point is played from, cut there
 * (`cutPlayedPath`), and to (`WayPoint.id`, `src/engine/RecordingPoints.ts`).
 */
const playedFrom = new URLSearchParams(window.location.search).get('from');
const playedTo = new URLSearchParams(window.location.search).get('to');
let recordingPlayer: RecordingPlayer | null = null;
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
    screen.syncParty();
    screen.drawViewport(party.state.position, party.state.facing, game.ctx.state.word1868);
}

/**
 * The screen composed again over the viewport as it stands, without `DrawViewport`. Once
 * `MainLoop` has returned the screen is `_ShowCredits`'s, but where a recording plays,
 * whose end has no credits (`playRecording`).
 */
function refreshScreen() {
    if (!game || !screen || (game.mainLoopHasReturned() && playedRecording === null)) return;
    screen.syncParty();
    screen.refreshOverlay();
}

/**
 * `_ReadEntireGame` for a new game (doc/CSBwin-src/SaveGame.cpp:1579-1594): the data set's
 * `dungeon.dat`, read into the running game. A file that will not open is `die(50)`
 * (`:1579-1586`), and so is one that fails its read `die(0xbad)` (`Game.readDungeonDat`).
 * The game's playthrough is then held against the store's (`GameSaves.newGameRead`).
 */
async function readNewGame(game: Game, saves: GameSaves, events: GameEvents): Promise<void> {
    game.readDungeonDat(await readDungeonFile());
    console.log(`✓ Read ${setFiles.where('dungeon.dat')}: ${game.ctx.dungeon.getData().maps.length} levels`);
    await saves.newGameRead();
    events.newGameRead();
}

/** The data set's `dungeon.dat`: one that will not open is `die(50)` (`readNewGame`). */
async function readDungeonFile(): Promise<Uint8Array> {
    const bytes = await setFiles.read('dungeon.dat');
    if (!bytes) throw new Die(50, `Cannot open dungeon file '${setFiles.where('dungeon.dat')}'`);
    return bytes;
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
 * read once; `null` for a set without it, or whose file does not read, which has no toggle.
 */
let utilityPortraits: Promise<UtilityPortraits | null> | null = null;
function utilityPortraitsOfSet(): Promise<UtilityPortraits | null> {
    utilityPortraits ??= readUtilityPortraits(() => setFiles.read(UTILITY_PORTRAITS_FILE),
        (error) => console.warn(`${UTILITY_PORTRAITS_FILE} does not read:`, error));
    return utilityPortraits;
}

/**
 * The events that may unlock the sound: a mouse's press is a user activation, a finger's
 * only at its lift, so the press, the lift, the click and the key all try, until one does.
 */
const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown'] as const;

/**
 * The sound manager, unlocked by the first press or key anywhere on the page, the Sound
 * button's included: browsers keep audio locked until then.
 */
function createSoundManager(graphicsLoader: GraphicsLoader, tables: GameTables): SoundManager {
    const sound = new SoundManager(graphicsLoader);
    if (sound.isAvailable()) {
        const unlockAudio = (): void => {
            void sound.unlock().then((running) => {
                if (!running) return;
                for (const type of AUDIO_UNLOCK_EVENTS) window.removeEventListener(type, unlockAudio);
            });
        };
        for (const type of AUDIO_UNLOCK_EVENTS) window.addEventListener(type, unlockAudio);
    }
    sound.setSoundTable(tables.sound1772, tables.amigaSounds);
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
 * `GameHost`, the screen its `ScreenHooks`. Both are handed the one message area,
 * which the engine writes and the screen draws. `tracked` is what the page tracks
 * achievements with, where it does (`TrackedSet`).
 */
function construct(files: GameFiles, graphicsTables: GraphicsTables, tables: GameTables, sound: SoundManager,
    tracked: TrackedSet | null): Built {
    const messages = new ScrollingText(tables.byte1830);
    const playSound = (soundId: number, rateIdx?: number, highVolume?: number) => sound.playSound(soundId, rateIdx, highVolume);
    // The screen is built second, over the engine's dungeon, so the engine→UI notices
    // reach it through this variable.
    let screen: GameScreen | null = null;
    const drawing = hostDrawing(() => screen?.ui ?? null);
    // Over an empty world, as `d.Initialize()` leaves CSBWin's: the boot reads the game.
    const game = new Game(emptyDungeonData(), tables, {
        messages,
        playSound,
        playAmigaSound: (soundIndex, period, volume) => sound.playAmigaSound(soundIndex, period, volume),
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
        openReincarnateScreen: (chIdx) => { if (screen) openReincarnateScreen(screen.ui, chIdx); },
        // What the attack menu, `ShowHideInventory`, `TAG02076e`, `TAG0207cc`, a save read
        // in play, `KillCharacter` and the damage shown draw, and a champion's portrait
        // pixels, which only the screen holds.
            ...drawing,
            // What a checkpoint keeps of the screen (`src/engine/Checkpoint.ts`).
            keptView: () => screen?.keptView() ?? null,
            setKeptView: (view) => screen?.setKeptView(view as KeptView),
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
            // The adventure's animations end with it: a chew draws nothing over the credits.
            presenter.cancel();
            events.ended(word11694);
            void proofs?.ended();
            // A recording played back ends at the game's end as at any other point, with
            // no credits: a lost game's dying sound alone (`playRecording`).
            if (playedRecording !== null) {
                if (!word11694) queueDyingSound(game);
                return;
            }
            if (screen) showEndOfGame({ ...introDeps({ game, screen, saves, events, input }, sound), game, messages }, word11694).catch(reportError);
        },
        // A script's tick, `_ProcessTimersViewportAndSound`, draws the viewport itself.
        drawViewport: () => renderView(),
        // The main loop's tick paints what `TAG01b29a` drew after its `DrawViewport`.
        paint: () => refreshScreen(),
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
    // Each read begins a recording of the game from it, which the next read ends.
    const recorder = new Recorder(game, __CSBWEB_BUILD__, dataSet.id, () => setFiles.digests(),
        () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    // Written to the store as it grows: every few seconds, and as the page is hidden, the
    // way most games end. A write that fails is written again at the next.
    const recordingStore = new BrowserRecordingStore((rows) => drawPlaythrough(storeRandom, rows));
    const recordings = new RecordingWriter(recorder, recordingStore, saveStore, {
        now: () => Date.now(),
        playTime: () => game.playTime(),
        champions: () => partyNames(game),
    });
    const writeRecording = (): void => { recordings.flush().catch(() => {}); };
    setInterval(writeRecording, RECORDING_WRITE_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeRecording(); });
    window.addEventListener('pagehide', writeRecording);
    const saves = new GameSaves(game, dataSet, setFiles, saveStore, {
        // A save packs a `CHARDESC`, and that needs graphic 26 for the champions who
        // carry only a portrait index.
        portraitOf: drawing.portraitOf,
        askBeginAdventure: (source) => { if (screen) askBeginAdventure(screen.ui, source); },
    }, logSave, storeRandom, publishedDungeons, recorder);
    // What a save deleted or written over alone reached of the recordings goes with it.
    saves.onRowGone(() => { recordings.prune().catch(() => {}); });

    // The playthroughs a `?dev` teleport has touched, which neither send statistics nor earn achievements.
    const teleported = keptTeleportedPlaythroughs(pageStorage);
    // The statistics' events: sent by a production build only, and shown on the console
    // otherwise; neither when the player has turned them off, nor of a recording played
    // back, no game of the player's.
    const events = new GameEvents({
        game,
        set: dataSet.id,
        build: __CSBWEB_BUILD__,
        player: playerId,
        enabled: () => settings.values.statistics && playedRecording === null,
        send: import.meta.env.PROD ? sendBeacon : (event) => console.debug('Event, not sent:', event),
        teleported,
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
            source, await readMiniDat(), newFaces ? await utilityPortraitsOfSet() : null)),
        onHasNewFaces: async () => (await utilityPortraitsOfSet()) !== null,
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
        // A press held on the map dialog's square moves the party there, on a page opened
        // with `?dev` alone: on its level at once, to another as `devChangeLevel` goes. A
        // script holding the loop (the fusion) runs on the party where it stands. The game
        // sends no statistics from then on (`GameEvents.teleported`).
        onTeleport: new URLSearchParams(window.location.search).has('dev') ? (map, x, y) => {
            if (!game.devMoveParty(map, x, y)) return;
            events.teleported();
            refreshScreen();
        } : null,
        // The achievements dialog's: the tracker's, where the page tracks any.
        achievements: () => achievements?.view() ?? null,
        // The Hint Oracle's button: the screen has stopped the clock and shaded the
        // interface, and the Oracle has the canvas until it closes.
        onOpenHintOracle: (square) => {
            const close = (): void => {
                screen?.closeHintOracle();
            };
            if (!screen || !files.hintOracle) return close();
            const deps = { input, gameScreen: screen, playSound };
            void openHintOracle(deps, files.hintOracle, square, game.ctx.dungeon.getData().hintKey, messages)
                .then((error) => { if (error !== null) console.error('Hint Oracle:', error); })
                .finally(close);
        },
    }, presenter, () => crtController?.presented());

    // The page's input, one path for the pre-game screens and play: nobody's while the page
    // loads, a pre-game screen's while one has the canvas, and play's once `wire` releases it.
    const input = bindUIEvents({
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
    const playInput = input.take(NO_INPUT);

    // The achievements of a game the player plays: none for a recording played back, whose
    // game is not the player's (`doc/ACHIEVEMENTS.md` → "The page").
    const defs = tracked && achievementDefs(tracked.own);
    const achievementStore = new BrowserAchievementStore((rows) => drawPlaythrough(storeRandom, rows));
    const achievements = tracked && defs && new PageAchievements(game, dataSet.id, defs, screen.ui.objectTables.objectNames,
        screen.ui.graphics.basicGraphic(26), achievementStore, saves, teleported, tracked.files, (message, error) => console.warn(message, error),
        tracked.ownOf);
    // Each unlock a banner over the view, with ACHIEVEMENT NOTICES on.
    achievements?.onShown(({ def }) => showAchievementNotice(screen.ui, { name: def.name, tier: def.tier }));
    // The proofs of the unlocks, sent by a player with a public name at a save and at the
    // game's end, and their verdicts asked at the start, every proof's, which a replay again
    // may have changed, then every few minutes those still awaited (`doc/ACHIEVEMENTS.md` → "Proofs").
    const sources = { flush: () => recordings.flush(), recordings: recordingStore, saves: saveStore };
    const proofs = achievements && new PageProofs(achievements, dataSet.id, achievementStore, {
        named: hasPublicName, send: sendProof, ask: askVerdicts, packageOf: (point) => storedPackage(point, dataSet.id, sources),
        now: () => Date.now(), log: (message, error) => console.warn(message, error),
    });
    if (proofs) {
        saves.onSaved((entry) => { void proofs.saved(entry); });
        void proofs.refresh(true);
        setInterval(() => { void proofs.refresh(); }, VERDICTS_MS);
    }
    return { game, screen, saves, recorder, recordings, recordingStore, messages, events, input, playInput, achievements, proofs };
}

/**
 * What the page tracks a game's achievements with (`doc/ACHIEVEMENTS.md` → "The page"): the
 * set's dungeon files, which their counts are read from and a CSB adventure's start against
 * (`AchievementTracker`); the text of its own achievements file (`ACHIEVEMENTS_FILE`); and
 * that of any set's, by its id, which the achievements across games compare.
 */
interface TrackedSet {
    files: AchievementSetFiles;
    own: string | null;
    ownOf(setId: string): Promise<string | null>;
}

/** What `construct` builds, which the boot, the play and the end of the game share. */
interface Built {
    game: Game;
    screen: GameScreen;
    saves: GameSaves;
    recorder: Recorder;
    recordings: RecordingWriter;
    recordingStore: BrowserRecordingStore;
    messages: ScrollingText;
    events: GameEvents;
    input: GameInput;
    /** Hands the input, held by nobody while the page loads, to play. */
    playInput: () => void;
    /** The achievements of the game the player plays, or `null` for a recording played back. */
    achievements: PageAchievements | null;
    /** Their proofs, sent and judged, where the page tracks them. */
    proofs: PageProofs | null;
}

/**
 * The probes' handle, `window.__probe`: what `tools/probe-ui.ts` and `tools/probe-frames.ts`
 * drive the live app through over CDP. `presetHeroes`: the heroes behind the dungeon's
 * mirrors, for `tools/lib/buildParty.ts`. `intro`: the pre-game screens' VBLs and waits
 * (`introProbe`). `player`: the recording `?recording=` plays (`playRecording`), or `null`.
 */
function probeHandle(built: Built, sound: SoundManager) {
    const presetHeroes = () => extractPresetHeroes(built.game.ctx.dungeon.getData(), built.game.ctx.tables.textDecode, built.game.ctx.tables);
    return { game: built.game, screen: built.screen, sound, saves: built.saves, achievements: built.achievements, proofs: built.proofs,
        recorder: built.recorder, recordings: built.recordings, recordingStore: built.recordingStore, player: () => recordingPlayer,
        readRecordingPath, packageOfSave, writeRecordingPackage, renderView, refreshScreen, presetHeroes, applySaveBytes, intro: introProbe };
}

/** `window.__probe` (`probeHandle`), whose type the probes' page-side functions are checked against. */
export type Probe = ReturnType<typeof probeHandle>;

/** What the boot and the end of the game share: the canvas, the screen, the sound and the game's read. */
function introDeps({ game, screen, saves, events, input }: Pick<Built, 'game' | 'screen' | 'saves' | 'events' | 'input'>, sound: SoundManager): Omit<BootSequenceDeps, 'skip' | 'title'> {
    return {
        input,
        gameScreen: screen,
        playSound: (soundId, rateIdx) => sound.playSound(soundId, rateIdx),
        consumeSavedGameRead: () => saves.consumeSavedGameRead(),
        readNewGame: () => readNewGame(game, saves, events),
        rise: dataSet.miniDat,
        amiga: game.ctx.tables.amigaSounds !== null,
    };
}

/** The optional CRT effect over the canvas (`src/lib/crt.ts`). Without WebGL, the settings' SCANLINES and SCREEN CURVE are inert. */
function createCrt(): void {
    crtController = createCrtEffect(gameCanvasEl, presenter);
}

/**
 * The title animation and the dungeon entrance, before anything is playable
 * (`src/renderer/intro/BootSequence.ts`). It runs before `wire`, so the adventure has no
 * input yet: the boot's screens hold it while they have the canvas.
 *
 * The FTL logo comes first (`loadSwooshFiles`). With the startup animations off, neither
 * it nor the title is shown, and the entrance is. `?intro=0` skips all of it, for the
 * golden-frame probe and `tools/probe-ui.ts`.
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

/**
 * What `wire` asks of a recording's viewer (`playRecording`): whether a span under a held
 * clock plays, and whether its strip shows something new.
 */
interface Viewer {
    held(): boolean;
    takeChanged(): boolean;
}

/**
 * The page's side of play: its input, and a redraw per move and per tick. A recording
 * played back (`viewer`) takes none of the page's input, its viewer's strip having it,
 * and its spans under a held clock, which the loop runs at once, are not drawn
 * (`RecordingPlayer.held`).
 */
function wire({ game, screen, messages, events, playInput }: Built, viewer: Viewer | null = null): void {
    if (!viewer) playInput();

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
    // the wheel in a dialog (`GameScreen.handleDialogWheel`). And so is one in which the
    // achievements' banner showed or went (`takeBannerChanged`).
    let heldThrough = false;
    game.onFrame(() => {
        if (viewer?.held()) {
            heldThrough = true;
            return;
        }
        if (game.paintHeld()) return;
        const scrolled = messages.takeChanged();
        const flashed = game.takeFlashChanged();
        const moved = screen.takeCursorMoved();
        const wheeled = screen.takeWheelTurned();
        const stripped = viewer?.takeChanged() ?? false;
        const bannered = takeBannerChanged(screen.ui);
        if (scrolled || flashed || moved || wheeled || stripped || bannered || heldThrough) {
            heldThrough = false;
            refreshScreen();
        }
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
    applyToGame(game, values);
}

/**
 * `?recording=<id>`: the recording `id` played back in place of a game (`RecordingPlayer`,
 * `doc/RECORDING.md` → "The port's player"), from its root through each branch down to
 * it. A site's id (`SHARED_RECORDING_ID`) is its package's path, read from the server and
 * never put in the store (`fetchSharedRecording`), played to the point it was shared at,
 * a save's file checked there. A proof's, `proof:<its id>` (`PROOF_RECORDING_PREFIX`), is
 * its package as the server answers it to a moderator alone, played as a site's is
 * (`fetchProofRecording`). A store's save, `save:<its row's id>` (`SAVE_POINT_PREFIX`),
 * is the path the store holds to its point, played to it and its file checked there, as a
 * site's (`readSavePoint`). Any other is the store's recording, its path as far up as the
 * store holds it (`readRecordingPath`). Every
 * tick is drawn, at the wall clock's pace times the viewer's; a span under a held clock
 * is played at once and undrawn (`Game.runAtOnceWhile`), and a line in the message area
 * says so (`skippedLine`). The page's input reaches nothing of the game, and the page
 * records nothing: no read of `GameSaves` begins a recording, nor sends a statistic. At
 * the path's end, or at a drift, the loop stops, the screen as the recording left it, and
 * a line in the message area says which (`endLines`), the area played on alone
 * (`runMessagesAlone`). The game's end is such a point: the credits are not played, a lost
 * game's dying sound alone, and the line says the game is won or lost there.
 *
 * The viewer's strip (`src/renderer/ui/RecordingStrip.ts`) has the input, and the screen
 * draws it over the message area: eject, which goes back to the welcome page, the book's
 * dialog as its PLAY left it where one played it (`RECORDING_STOPPED_HASH`); stop, which
 * plays the path again from its start in this page (`rewindPage`), paused once its first
 * tick has drawn the game; ten minutes or a minute back, from a checkpoint the page keeps
 * of the path (`KeptCheckpoints`) read in this page, or the path's start within a minute of
 * the target, then run at once to the target (`seekBack`), and darker where neither is; play and pause, play at the end being stop and play; a minute
 * or ten forward, run at once in slices, unheard, the screen drawn after each
 * (`Game.forward`); slower and faster, the pace between them; and loop, which plays the path again from its start `LOOP_DELAY_MS` after its
 * end, whatever ended it. Then the time played over the path's length. Stop and eject
 * end the message area played on alone. While the loop does not run, paused or at the
 * end, a move of the pointer is drawn at the display's next frame (`Presenter.animate`),
 * as the loop's VBL draws it while it runs.
 *
 * The path is read before the page is built (`readPlayedRecording`), and plays over `set`,
 * the set its files were found in (`playedSetOf`), or the one `?dungeon=` names, which must
 * be the same: a recording of another data set ends the page as an error does.
 */
async function playRecording(built: Built, sound: SoundManager, id: string, { path, savedAtEnd }: PlayedPath, set: string): Promise<void> {
    const { game, screen, messages, input } = built;
    if (dataSet.id !== set) throw new Error(`RECORDING ${id} IS NOT OF ${dataSet.name}`);
    const dungeonDat = await readDungeonFile();
    const print = (line: string): void => {
        messages.printLinefeed();
        messages.quePrintLines(RECORDING_LINE_COLOR, line);
    };
    let paused = false;
    let pace: Pace = 1;
    let loop = false;
    let hover: StripAction | null = null;
    /** Where a minute forward, or a seek back, runs to, while it runs (`Game.forward`). */
    let forwardTo: number | null = null;
    /** Whether a tick has run since the player began: what stop and back run to before they land. */
    let ticked = false;
    /** The path played again, `LOOP_DELAY_MS` after its end, while loop is on. */
    let loopTimer: ReturnType<typeof setTimeout> | null = null;
    /** The strip as last drawn, to tell a change (`Viewer.takeChanged`). */
    let drawn = '';
    /** The checkpoints kept of the path, one a minute of it, which its players share. */
    const kept = new KeptCheckpoints();
    let messagesAlone: (() => void) | null = null;
    /** Whether back by `by` VBLs from where the path stands, or a forward or a seek runs to, has a checkpoint to start from. */
    const canGoBack = (by: number): boolean => {
        const from = forwardTo ?? recordingPlayer?.vbls ?? 0;
        return from > 0 && kept.reaches(Math.max(0, from - by));
    };
    const strip = (): StripState => ({
        vbls: recordingPlayer?.vbls ?? 0, length: recordingPlayer?.length ?? 0, paused, ended: !(recordingPlayer?.playing ?? false),
        back: canGoBack(BACK_VBLS.back), back10: canGoBack(BACK_VBLS.back10), pace, loop, hover,
    });
    const shown = (state: StripState): string => JSON.stringify(state);
    screen.composer.overlay = (ui) => {
        const state = strip();
        drawn = shown(state);
        drawRecordingStrip(ui, state);
    };
    game.onTick(() => { ticked = true; });

    const cancelLoop = (): void => {
        if (loopTimer !== null) clearTimeout(loopTimer);
        loopTimer = null;
    };
    const loopLater = (): void => {
        if (loop && loopTimer === null && !(recordingPlayer?.playing ?? false)) loopTimer = setTimeout(() => restart(false), LOOP_DELAY_MS);
    };
    /** The VBLs run at once while `more` holds, unheard, the screen drawn after each slice and at the end. */
    const runAtOnce = (more: () => boolean): void => {
        sound.setMuted(true);
        game.forward(more, () => {
            sound.setMuted(false);
            forwardTo = null;
            refreshScreen();
        }, refreshScreen);
    };
    /** A new player of the path, the page's, which `play` or `seek` begins. */
    const newPlayer = (): RecordingPlayer => {
        const player = new RecordingPlayer(game, path, dungeonDat, savedAtEnd, kept);
        recordingPlayer = player;
        player.onSkipped((span) => print(skippedLine(span)));
        player.onEnd((drift) => {
            game.stop();
            forwardTo = null;
            sound.setMuted(false);
            const gameEnd = game.mainLoopHasReturned() ? game.ctx.state.gameWon : null;
            for (const line of endLines(path, drift, __CSBWEB_BUILD__, gameEnd)) print(line);
            messagesAlone = runMessagesAlone(game, messages);
            loopLater();
            refreshScreen();
            if (drift) console.warn(`Recording ${id} drifted, in a recording of build ${path.find((recording) => recording.id === drift.recording)?.build}:`, drift);
            else console.log(`✓ Recording ${id} played to its end`);
        });
        ticked = false;
        return player;
    };
    const play = (): void => {
        const player = newPlayer();
        player.start();
        if (player.playing) game.start(true);
    };
    /** What stop and back end first: the loop's timer, the message area played on alone, the player and a forward. */
    const leavePlay = (): void => {
        cancelLoop();
        messagesAlone?.();
        messagesAlone = null;
        recordingPlayer?.stop();
        forwardTo = null;
        sound.setMuted(false);
        framePending = false;
    };
    /**
     * The path played again from its start, the page put back as a new page has it
     * (`rewindPage`): paused once its first tick has drawn the game (stop), or playing (play
     * at the end, and loop).
     */
    const restart = (pauseAtStart: boolean): void => {
        leavePlay();
        // The screen's play state put back drops every animation (`Presenter.cancel`).
        rewindPage(game, screen, messages);
        // Every checkpoint is after the start, which the play takes again.
        kept.clear();
        paused = pauseAtStart;
        game.setPace(paused ? 0 : pace);
        play();
        if (paused) runAtOnce(() => !ticked);
        refreshScreen();
    };
    /**
     * Back a minute or ten of the path from where it stands, or where a forward or a seek
     * runs to: the latest checkpoint kept at or before the target read in this page by a
     * new player, or the path played again from its start (`seekBack`), then run at once,
     * unheard, until it lands (`seekLanded`), paused or playing as it was. The strip gives it
     * only where that start is near (`canGoBack`).
     */
    const seek = (by: number): void => {
        const from = forwardTo ?? recordingPlayer?.vbls ?? 0;
        const target = Math.max(0, from - by);
        leavePlay();
        game.setPace(paused ? 0 : pace);
        const player = newPlayer();
        seekBack(game, screen, messages, kept, target, player);
        if (!player.playing) return;
        game.start(true);
        forwardTo = target;
        // A forward while it runs adds its minute or ten to the target (`forwardTo`).
        runAtOnce(() => !seekLanded(player, forwardTo ?? target, ticked));
    };
    const looping = (): boolean => !paused && (recordingPlayer?.playing ?? false) && !game.isForwarding;
    /** The screen composed at the display's next frame, once however many moves ask before. */
    let framePending = false;
    const drawAtNextFrame = (): void => {
        if (looping() || framePending) return;
        framePending = true;
        presenter.animate(() => {
            const again = framePending;
            framePending = false;
            return again;
        });
    };
    const setPace = (next: Pace): void => {
        pace = next;
        if (!paused) game.setPace(pace);
    };
    const act = (action: StripAction): void => {
        switch (action) {
            case 'play':
                if (!recordingPlayer?.playing) return restart(false);
                paused = !paused;
                game.setPace(paused ? 0 : pace);
                break;
            case 'forward':
            case 'forward10': {
                const player = recordingPlayer;
                if (!player?.playing) return;
                if (forwardTo !== null) forwardTo += FORWARD_VBLS[action];
                else if (!game.isForwarding) {
                    forwardTo = player.vbls + FORWARD_VBLS[action];
                    // A span under a held clock is run to its end, as the loop runs it.
                    runAtOnce(() => player.vbls < (forwardTo ?? 0) || player.held);
                }
                break;
            }
            case 'faster': setPace(nextPace(pace, 'up')); break;
            case 'slower': setPace(nextPace(pace, 'down')); break;
            case 'loop':
                loop = !loop;
                if (loop) loopLater();
                else cancelLoop();
                break;
            case 'back':
            case 'back10':
                seek(BACK_VBLS[action]);
                break;
            case 'stop': return restart(true);
            case 'eject':
                cancelLoop();
                messagesAlone?.();
                recordingPlayer?.stop();
                game.stop();
                // The welcome page shows the dialog whose PLAY played it, where one did (`RECORDING_STOPPED_HASH`).
                window.location.assign(welcomePageQuery() + RECORDING_STOPPED_HASH);
                return;
        }
        refreshScreen();
    };
    input.take({
        mouseMove: (x, y) => {
            screen.setCursorPoint(screen.screenPoint(x, y));
            hover = stripActionAt(strip(), x, y);
            drawAtNextFrame();
        },
        mouseDown: (x, y, button) => {
            const action = button === 0 ? stripActionAt(strip(), x, y) : null;
            if (action) act(action);
        },
        mouseUp: () => {},
        mouseLeave: () => {
            screen.setCursorPoint(null);
            hover = null;
            drawAtNextFrame();
        },
        wheel: () => false,
        keyDown: (press) => {
            const action = stripKeyAction(press, strip());
            if (action) act(action);
            return action !== null;
        },
    });
    game.runAtOnceWhile(() => recordingPlayer?.held ?? false);
    wire(built, { held: () => (recordingPlayer?.held ?? false) || game.isForwarding, takeChanged: () => shown(strip()) !== drawn });
    play();
    console.log(`✓ Playing recording ${id}, from ${path.length > 1 ? `its root through ${path.length - 1} joins` : 'its start'}`);
}

/**
 * The message area played on alone once the loop has stopped at a recording's end, until
 * what it was given is shown: its scroll a VBL, and a queued line placed a pass, as the
 * loop plays them (`Game.runFrame`), at the `d.Time` the loop stopped at, so nothing
 * shown expires. Returns what ends it sooner: stop's and eject's.
 */
function runMessagesAlone(game: Game, messages: ScrollingText): () => void {
    const time = game.ctx.state.tickCount;
    const timer = setInterval(() => {
        messages.vblInterrupt();
        messages.printNextQueued(time);
        messages.clockTick(time);
        if (messages.takeChanged()) refreshScreen();
        const { printQueue, futureLines } = messages.backlog();
        const { pushTextUp, textScanlineScrollCount } = messages.scrollState();
        if (printQueue === 0 && futureLines === 0 && pushTextUp === 0 && textScanlineScrollCount < 0) clearInterval(timer);
    }, 1000 / VBL_FREQUENCY);
    return () => clearInterval(timer);
}

/**
 * What `?recording=` plays: a path, and the save its end makes where it ends at a save's
 * point; and where `?from=` names a save on its way, that save, which the path is cut at
 * once the set's files are known (`cutPlayedPath`).
 */
interface PlayedPath {
    readonly path: readonly Recording[];
    readonly savedAtEnd: SavedAtEnd | null;
    readonly from?: { readonly point: RecordingPoint; readonly file: Uint8Array | null };
}

/**
 * The path `?recording=<id>` names (`playRecording`), read before anything of the game is
 * built, so that its root names the set the page plays: the site's package, or the store's
 * save or recording, through stores of its own, as the welcome page opens them; with
 * `&to=`, to that save on its way (`pathToWay`), and with `&from=`, the save it is cut at
 * once the set is known (`cutPlayedPath`). One that neither the site nor the store holds, or
 * that passes no such save, ends the page as an error does.
 */
async function readPlayedRecording(id: string): Promise<PlayedPath> {
    if (SHARED_RECORDING_ID.test(id)) return fetchSharedRecording(id);
    if (id.startsWith(PROOF_RECORDING_PREFIX)) return fetchProofRecording(id.slice(PROOF_RECORDING_PREFIX.length));
    const storeRandom = new CsbRandom();
    const draw: DrawPlaythrough = (rows) => drawPlaythrough(storeRandom, rows);
    const recordingStore = new BrowserRecordingStore(draw);
    const saveStore = new BrowserSaveStore(draw);
    const played = id.startsWith(SAVE_POINT_PREFIX) ? await readSavePoint(saveStore, recordingStore, id.slice(SAVE_POINT_PREFIX.length))
        : { path: await readRecordingPath(recordingStore, id), savedAtEnd: null };
    if (playedFrom === null && playedTo === null) return played;
    // The saves on the way: the point's, as the book's dialog lists them.
    const rows = await recordingStore.list();
    const points = storedPoints(await saveStore.list(null), rows, played.path[0]?.dataSet ?? '');
    const point = points.find((one) => pointRecordingId(one) === id);
    const ways = point ? wayPoints(point, played.path, points, rows) : [];
    const way = (wayId: string) => {
        const found = ways.find((one) => one.id === wayId);
        if (!found) throw new Error(`The recording '${id}' passes no save '${wayId}'.`);
        return found;
    };
    let ended: PlayedPath = played;
    if (playedTo !== null) {
        const end = way(playedTo);
        ended = { path: pathToWay(played.path, end), savedAtEnd: await savedAtWay(end, played.path, saveStore) };
    }
    if (playedFrom === null) return ended;
    const start = way(playedFrom);
    return { ...ended, from: { point: start.point, file: start.row ? await saveStore.read(start.row.save.id) : null } };
}

/**
 * `played`'s path cut at the save `?from=` names on its way (`cutAtSave`,
 * `src/engine/RecordingCut.ts`), as UPLOAD cuts it (`src/ui/welcomePage.ts`): replayed
 * headless up to it in a page of the set's without the DOM, the set's files read through
 * `files`, a bar on the canvas meanwhile. A path that cannot start there, or drifts before
 * it, ends the page as an error does.
 */
async function cutPlayedPath(played: PlayedPath, set: DataSet, files: DataSetFiles): Promise<PlayedPath> {
    const { from } = played;
    if (!from) return played;
    const started = Date.now();
    const shown = cutProgressShown(gameCanvasEl, 'CUTTING THE RECORDING AT THE SAVE');
    const path = await cutAtSave(played.path, from.point, from.file, async () => cutPageOf(await standInPage(set, files)), {
        played: (vbls, of) => shown(vbls / Math.max(1, of)),
        breathe: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    });
    console.log(`✓ The recording cut at the save ${playedFrom}, in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { path, savedAtEnd: played.savedAtEnd };
}

/**
 * What the canvas shows while a path is cut (`cutPlayedPath`), before the game's screen
 * has it: `what`, and a bar as long as the part played, which the function returned draws.
 */
function cutProgressShown(canvas: HTMLCanvasElement, what: string): (fraction: number) => void {
    const context = canvas.getContext('2d');
    return (fraction) => {
        if (!context) return;
        context.fillStyle = '#000';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ccc';
        context.font = '8px monospace';
        context.textAlign = 'center';
        context.fillText(what.slice(0, 52), canvas.width / 2, 92);
        context.strokeStyle = '#ccc';
        context.strokeRect(60.5, 100.5, 199, 7);
        context.fillRect(62, 102, Math.round(196 * Math.min(1, fraction)), 4);
    };
}

/**
 * The site's recording `id`, read from its package as the server serves it
 * (`recordingPackageUrl`), its form checked (`readRecordingPackage`): its path, and
 * the save its end makes where it was shared at a save's point. A package the server does
 * not serve, or whose form is wrong, ends the page as an error does.
 */
async function fetchSharedRecording(id: string): Promise<PlayedPath> {
    return fetchPackage(recordingPackageUrl(id), {});
}

/**
 * The proof `id`'s package (`?recording=proof:<id>`), which the server answers only to a
 * moderator (`GET PROOFS_ROUTE/<id>`, `server/app.ts`), asked as this browser's player, and
 * played as a site's recording is, so that a moderator watches a proof that looks
 * suspicious from the Hall of Fame (`src/fame/famePage.ts`). Anyone else's page ends as an
 * error does.
 */
async function fetchProofRecording(id: string): Promise<PlayedPath> {
    if (!PROOF_ID.test(id)) throw new Error(`'${id}' is not a proof's id.`);
    return fetchPackage(`${PROOFS_ROUTE}/${id}`, { [PLAYER_ID_HEADER]: keptPlayerId() ?? '' });
}

/** The package at `url`, asked with `headers`, as `?recording=` plays it. */
async function fetchPackage(url: string, headers: Record<string, string>): Promise<PlayedPath> {
    const response = await fetch(url, { headers }).catch(() => null);
    if (!response?.ok) throw new Error(`Cannot read the recording '${url}'${response ? ` (HTTP ${response.status})` : ''}.`);
    const pkg = await readRecordingPackage(new Uint8Array(await response.arrayBuffer()));
    return { path: pkg.path, savedAtEnd: pkg.shared.kind === 'save' ? pkg.shared : null };
}

/**
 * The store's save `rowId` names as a point to play (`SAVE_POINT_PREFIX`): the path the
 * store holds to it, cut at its point (`pointPath`), and its file, which the path's end
 * makes again. A save the store does not hold up to its point ends the page as an error
 * does.
 */
async function readSavePoint(saveStore: SaveStore, recordingStore: BrowserRecordingStore, rowId: string): Promise<PlayedPath> {
    const save = (await saveStore.list(null)).find((entry) => entry.id === rowId);
    const point = save && storedPoints([save], await recordingStore.list(), save.dataSet)[0];
    if (!save || point?.kind !== 'save') throw new Error(`No recording reaches the save '${rowId}'.`);
    const bytes = await saveStore.read(save.id);
    return { path: await pointPath(recordingStore, point), savedAtEnd: { file: bytes, inVbl: point.save.recording.inVbl === true } };
}

/**
 * The set `path` plays over (`findRecordingSet`, `src/data/RecordingSet.ts`): its root's own
 * where its files still have the digests the path's recordings name, or another the server
 * offers whose files have them. A local set's recording is matched against its record's
 * files alone. A path that names no file plays over its own set, and so does one the server
 * cannot answer for, the console saying why. One whose files no set has ends the page as an
 * error does, saying which file of its set no longer matches.
 */
async function playedSetOf(manifest: DataSetManifest, path: readonly Recording[]): Promise<string> {
    const own = path[0]?.dataSet ?? '';
    if (path.every((recording) => recording.files === null)) return own;
    const sets = isLocalDataSetId(own) ? await localSetDigests(manifest, own, path) : await serverSetDigests(manifest);
    if (sets === null) return own;
    const found = findRecordingSet(path, sets);
    if (found.kind === 'refused') throw new Error(found.why);
    if (found.id !== own) console.log(`✓ The recording's files are ${found.id}'s: it plays over that set, not ${own}`);
    return found.id;
}

/** The local set `id`'s digests of the files `path` names, read from its record; `null` where the store has no such set. */
async function localSetDigests(manifest: DataSetManifest, id: string, path: readonly Recording[]): Promise<SetDigests[] | null> {
    const chosen = await chooseDataSet(manifest, id);
    if (!chosen) return null;
    const files: Record<string, string> = {};
    for (const name of new Set(path.flatMap((recording) => Object.keys(recording.files ?? {})))) {
        const bytes = await chosen.files.read(name);
        if (bytes) files[name] = fileDigest(bytes);
    }
    return [{ id, name: chosen.set.name, files }];
}

/**
 * The digests of the game files of the sets the server offers the page's player
 * (`DATA_SET_FILES_ROUTE`), named as the manifest names them; `null` where it cannot answer,
 * the console saying why.
 */
async function serverSetDigests(manifest: DataSetManifest): Promise<SetDigests[] | null> {
    try {
        const player = keptPlayerId();
        const response = await fetch(DATA_SET_FILES_ROUTE, player === null ? undefined : { headers: { [PLAYER_ID_HEADER]: player } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseSetDigests(await response.text(), new Map(manifest.dataSets.map((set) => [set.id, set.name])));
    } catch (error) {
        console.warn(`Cannot read the sets' files' digests '${DATA_SET_FILES_ROUTE}', so the recording plays over its own set: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
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
 * The set `id` names and where its files are read from, or `null` for none or an unknown
 * one: the welcome page's. `id` is `?dungeon=`'s, or a recording's set where the page plays
 * one without it. A `local:` id is a record of the store's (`src/data/LocalDataSets.ts`),
 * which plays its base set's `graphics.dat` where it has none; any other is the
 * manifest's, read from its folder. The console names an unknown one, but where `warn` is
 * false.
 */
async function chooseDataSet(manifest: DataSetManifest, id: string | null, warn = true): Promise<{ set: DataSet; files: DataSetFiles; thumbnail: () => Promise<Blob | null> } | null> {
    if (isLocalDataSetId(id)) {
        const storeRandom = new CsbRandom();
        const record = await new BrowserDataSetStore((rows) => drawPlaythrough(storeRandom, rows)).get(id!).catch((error: unknown) => {
            if (warn) console.warn(`The local data sets cannot be read: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        });
        if (!record) {
            if (warn) console.warn(`Unknown data set '${id}'`);
            return null;
        }
        const base = record.baseSet === null ? null : dataSetNamed(manifest, record.baseSet);
        return { set: localDataSet(record), files: recordFiles(record, base && folderFiles(base.dir)), thumbnail: () => Promise.resolve(record.files.thumbnail ?? null) };
    }
    const set = dataSetNamed(manifest, id);
    if (id !== null && !set && warn) console.warn(`Unknown data set '${id}'`);
    return set && { set, files: folderFiles(set.dir), thumbnail: () => fetchThumbnail(set) };
}

/** `set`'s thumbnail from its folder (`thumbnailPath`), or `null` where it cannot be fetched. */
async function fetchThumbnail(set: DataSet): Promise<Blob | null> {
    const response = await fetch(thumbnailPath(set)).catch(() => null);
    return response?.ok ? response.blob() : null;
}

/**
 * The welcome page (`src/ui/welcomePage.ts`), in the game's place: nothing of the game
 * is built. It lists the store's saves and recordings, so it opens the store as the game
 * does, whose upgrade may draw a playthrough for an older row.
 */
function openWelcomePage(manifest: DataSetManifest): Promise<void> {
    const storeRandom = new CsbRandom();
    const draw: DrawPlaythrough = (rows) => drawPlaythrough(storeRandom, rows);
    return showWelcomePage(document.body, manifest, new BrowserSaveStore(draw), new BrowserDataSetStore(draw), new BrowserRecordingStore(draw),
        new BrowserAchievementStore(draw), loadManifest,
        { settings, keyboardLayout: () => keyboardLayout });
}

async function init() {
    try {
        const manifest = await loadManifest();
        // A recording is read first: the set it plays is the one its files are found in, unless `?dungeon=` names one.
        const played = playedRecording === null ? null : await readPlayedRecording(playedRecording);
        const playedSet = played && await playedSetOf(manifest, played.path);
        const chosen = await chooseDataSet(manifest, new URLSearchParams(window.location.search).get('dungeon') ?? playedSet);
        if (!chosen) return await openWelcomePage(manifest);
        ({ set: dataSet, thumbnail: setThumbnail } = chosen);
        // Each file read through them keeps its digest, which a recording carries (`Recording.files`).
        setFiles = digestedFiles(chosen.files);
        // A recording played from a save on its way is cut there first, the canvas the game's screen has not taken yet.
        const cut = played && await cutPlayedPath(played, dataSet, setFiles);
        console.log(`Loading ${dataSet.name}...`);
        const files = await loadGameFiles(dataSet, setFiles);
        console.log(`✓ Loaded graphics: ${files.graphicsLoader.getItemCount()} items${dataSet.csbGraphics ? ', and the CSBgraphics.dat overlay' : ''}`);
        // Every graphics.dat table, read once: the engine's set is built from it, and the
        // screen is handed the same object.
        const graphicsTables = extractGraphicsTables(files.graphicsLoader);
        const tables = buildGameTables(graphicsTables);
        const sound = createSoundManager(files.graphicsLoader, tables);
        // Read past the digests: a recording names the files the game reads, and these are the achievements'.
        let tracked: TrackedSet | null = null;
        if (playedRecording === null) {
            const own = await readAchievementsText(chosen.files).catch(() => null);
            const ownOf = (id: string) => id === dataSet.id ? Promise.resolve(own)
                : chooseDataSet(manifest, id, false).then((other) => other && readAchievementsText(other.files));
            tracked = { files: await readAchievementSetFiles(dataSet, chosen.files), own, ownOf };
        }
        const built = construct(files, graphicsTables, tables, sound, tracked);
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
        // The probes' handle (`probeHandle`) — see the `probe-app` skill. Module scope is
        // invisible to the DevTools protocol, so a bug that only shows on screen is
        // otherwise unreachable without hand-patching this file.
        //
        // Guarded on a build-time flag, which no player can turn on: `__CSBWEB_PROBE__` is
        // the dev server's, and a build's only with `CSBWEB_PROBE=1` (`vite.config.mts`),
        // so the handle cannot reach a deployed bundle.
        if (__CSBWEB_PROBE__) (window as unknown as Record<string, unknown>).__probe = probeHandle(built, sound);
        if (playedRecording !== null && cut && playedSet !== null) return await playRecording(built, sound, playedRecording, cut, playedSet);
        // Before the intro: the entrance's chooser takes a dropped save as the disk menu does.
        bindSaveDrop(built.screen.ui);
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
