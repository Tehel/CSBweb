/**
 * Dungeon Master Web: the page's bootstrap. `init` loads the game files, constructs the
 * engine and the screen, runs the intro, wires the page to both, and starts the loop.
 */

import { SoundManager } from './audio';
import { CSBGraphicsLoader, GraphicsLoader, dataSetFor, emptyDungeonData } from './data';
import { Game, buildGameTables, type GameTables } from './engine';
import {
    applySaveBytes,
    buildSavePayload,
    encodeSavePayload,
    makeSaveFileName,
} from './engine/SaveGamePayload';
import { loadGlfx } from './lib/glfx-loader';
import { GameScreen } from './renderer/GameScreen';
import { bindDataSetChooser, bindUIContext, drawMapPreview, handleCursorFilter, isDebugFeaturesEnabled, updateDebug } from './ui';
import { scrollingText } from './renderer/csbwin/ScrollingText';
import { UIMode } from './renderer/ui/UIState';
import { createDevTools } from './dev';
import { Die, runBootSequence, runShowCredits, type SavedGameRead } from './renderer/intro/BootSequence';
import type { PrisonDoorChoice } from './renderer/intro/PrisonDoor';
import { SOUND_DYING, type WonChampion } from './renderer/intro/ShowCredits';
import { determineMastery } from './engine/skills';
import { loadUISettings } from './ui/settings';

console.log('Dungeon Master Web - Initializing...');

// Global game instance
let game: Game | null = null;
let screen: GameScreen | null = null;
let crtController: CrtController | null = null;
/**
 * Set by `onRestoreSave` and `onRestoreFailed`, read and cleared by the boot's save
 * chooser (`consumeSavedGameRead`).
 */
let savedGameRead: SavedGameRead = 'cancelled';

/** How the chooser's last read came out, and forget it. */
function consumeSavedGameRead(): SavedGameRead {
    const read = savedGameRead;
    savedGameRead = 'cancelled';
    return read;
}

// Dev-only harness (PLAN.md Phase 14). Reached only via isDebugFeaturesEnabled().
const dev = createDevTools({
    get game() { return game; },
    renderView,
    // F5 packs a `CHARDESC` like any other save, and that needs graphic 26 for the
    // champions who carry only a portrait index.
    portraitOf: (champion) => screen?.portraitPixelsFor(champion),
    repackOpenChest: () => screen?.repackChest(),
});

/** The game this page plays, chosen before anything is loaded (`?dungeon=<id>`). */
const dataSet = dataSetFor(new URLSearchParams(window.location.search).get('dungeon'));
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
    texture = glcanvas.texture(canvas);

    const draw = (): void => {
        const ctx = canvas.getContext('2d');
        if (!ctx || !glcanvas || !texture || !lines) return;
        const w = canvas.width;
        const h = canvas.height;
        if (lines.complete && lines.naturalWidth > 0) {
            ctx.drawImage(lines, 0, 0, w, h);
        }
        texture.loadContentsOf(canvas);

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
            if (next) {
                start();
                canvas.style.display = 'none';
                glcanvas.style.display = '';
            } else {
                stop();
                glcanvas.style.display = 'none';
                canvas.style.display = '';
                renderView();
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

// Render the 3D view
function renderView() {
    // Once `MainLoop` has returned the screen is `_ShowCredits`'s.
    if (!game || !screen || game.mainLoopHasReturned()) return;

    const party = game.ctx.party;
    const pos = party.state.position;
    const facing = party.state.facing;

    screen.setPartyState(party.state);
    screen.render(pos, facing, game.ctx.state.word1868);
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
    updateDebug(`Loading ${dataSet.name}: graphics.dat...`);
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
 * (`:1480-1486`); one that fails its read is `false`, for the boot's `tag01efee`.
 */
async function readNewGame(game: Game): Promise<boolean> {
    const name = `${dataSet.dir}/dungeon.dat`;
    const response = await fetch(name).catch(() => null);
    if (!response?.ok) throw new Die(50, `Cannot open dungeon file '${name}'`);
    const read = game.readDungeonDat(new Uint8Array(await response.arrayBuffer()));
    if (read) console.log(`✓ Read ${name}: ${game.ctx.dungeon.getData().maps.length} levels`);
    return read;
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

/**
 * The engine and the screen, each handed what it asks of the other: the engine its
 * `GameHost`, the screen its `GameScreenHooks`.
 */
function construct(files: GameFiles, tables: GameTables, sound: SoundManager): { game: Game; screen: GameScreen } {
    const playSound = (soundId: number, rateIdx?: number, highVolume?: number) => sound.playSound(soundId, rateIdx, highVolume);
    // The screen is built second, over the engine's dungeon, so the engine→UI notices
    // reach it through this variable.
    let screen: GameScreen | null = null;
    // Over an empty world, as `d.Initialize()` leaves CSBWin's: the boot reads the game.
    const game = new Game(emptyDungeonData(), tables, {
        cursorFilter: handleCursorFilter,
        messages: scrollingText,
        playSound,
        // `d.PartySleeping`: button 145 puts the party to sleep, 146 or a blow
        // wakes it. The UI follows with `Buttons17796` (`doc/CSBwin-src/Mouse.cpp:1698`)
        // or the adventure lists back (`CSBCode.cpp:7056-7057`), and the message
        // area with its tenfold timeout (`CSBCode.cpp:1546-1553`).
        sleepChanged: (sleeping) => {
            screen?.setUIMode(sleeping ? UIMode.Sleeping : UIMode.Adventure);
            scrollingText.setPartySleeping(sleeping);
        },
        // The first half of Reincarnate: the engine raises the name-entry screen
        // (`doc/CSBwin-src/CSBCode.cpp:6738` around `Code13ea4.cpp:20`); the
        // screen's answer comes back through `onReincarnateNamed` below.
        openReincarnateScreen: (chIdx) => screen?.openReincarnateScreen(chIdx),
        // A weapon hand changed, or a chest left the open inventory's weapon hand:
        // the attack menu, the inventory and the open chest are the screen's.
        closeAttackMenuOf: (chIdx) => screen?.closeAttackMenuOf(chIdx),
        showHideInventory: (chIdx) => screen?.showHideInventory(chIdx),
        repackChest: () => screen?.repackChest(),
        // `TAG02076e` / `TAG0207cc` from the engine: the Hall of Champions and `WakeUp`.
        tag02076e: () => screen?.tag02076e(),
        tag0207cc: () => screen?.tag0207cc(),
        // `ShowCredits(1)`: `MainLoop` has returned on a lost game
        // (doc/CSBwin-src/CSBCode.cpp:11325), or has won it (`:631`).
        // A frame threw: CSBWin's `die`, the loop stopped.
        die: reportError,
        showCredits: (word11694) => {
            if (screen) showEndOfGame(game, screen, sound, word11694).catch(reportError);
        },
        // A script's tick, `_ProcessTimersViewportAndSound`, draws the viewport itself;
        // the main loop's tick paints what `TAG01b29a` drew with it.
        drawViewport: () => renderView(),
        // `TAG01b29a`, after the tick's `d.Time++`: the flinch and the attack panel.
        tag01b29a: () => screen?.attackPanelTick(),
        // `DisplayCharacterDamage`'s splat and figure, and `TAG011366` drawing over them.
        displayCharacterDamage: (chIdx, damage) => screen?.displayCharacterDamage(chIdx, damage),
        tag011366: (chIdx) => screen?.tag011366(chIdx),
    });

    screen = new GameScreen(gameCanvasEl, {
        graphicsLoader: files.graphicsLoader,
        dungeonState: game.ctx.dungeon,
        footprints: game.ctx.footprints,
        csbGraphicsLoader: files.csbGraphicsLoader ?? undefined,
        characterStats: game.systems.characterStats,
    }, {
        queueSound: (ordinal, mapX, mapY, deltaTime) => game.ctx.sounds.queueSound(ordinal, mapX, mapY, deltaTime, game.ctx.party.state.position.z),
        viewingFilter: (options) => game.processViewingFilter(options),
        onObjectMove: (position, object, place, unchangedRoom, facing) => {
            game.triggerObjectMove(position, object, place, unchangedRoom, facing);
        },
        onSpellCast: (chIdx) => game.castSpellFromUi(chIdx),
        // The attack menu: `Attack()` and `d.attackDamageToDisplay`.
        onChampionAttack: (chIdx, attackType) => game.championAttack(chIdx, attackType),
        isRunningScript: () => game.isRunningScript(),
        // `_TAG019fac`'s flash of the attack option taken.
        flashButton: (x1, x2, y1, y2) => game.flashButton(x1, x2, y1, y2),
        // `_MagicSelection`, which the spell panel runs as a script for its flashes.
        runScript: (script) => game.runScript(script),
        flashButtonScript: (x1, x2, y1, y2) => game.flashButtonScript(x1, x2, y1, y2),
        waitForButtonFlashScript: () => game.waitForButtonFlashScript(),
        onConsumeAttackDamage: () => game.consumeAttackDamageToDisplay(),
        applyFeeding: (chIdx, fp) => game.applyFeeding(chIdx, fp),
        // The inventory click's `RemoveCharacterPossession` / `AddCharacterPossession`.
        onRemoveCharacterPossession: (chIdx, slot) => game.removeCharacterPossession(chIdx, slot),
        onAddCharacterPossession: (chIdx, object, slot) => game.addCharacterPossession(chIdx, object, slot),
        onResurrectReincarnateCancel: (button) => {
            game.resurrectReincarnateCancel(button);
        },
        // The second half of Reincarnate: the screen hands the typed name back so the
        // engine can finish (the first half is the host's `openReincarnateScreen`).
        onReincarnateNamed: (chIdx, name, title) => {
            game.reincarnateNamed(chIdx, name, title);
            renderView();
        },
        // Buttons 145 and 146 (the host's `sleepChanged` is the engine's answer).
        onSleep: () => game.sleep(),
        setClockTick: (value) => game.setClockTick(value),
        onWakeUp: () => game.wakeUp(),
        // Buttons 147 and 148 (the screen's halves are `handleMouseButton`'s).
        onFreeze: () => game.freeze(),
        // The button flash: `TAG02076e`'s `WaitForButtonFlash`, and the rectangle the
        // screen inverts.
        waitForButtonFlash: () => game.waitForButtonFlash(),
        flashedButton: () => game.flashedButton(),
        onThaw: () => game.thaw(),
        // The save/load screen behind the disk icon. The UI owns the list and the
        // buttons; serializing and restoring the world is the engine's, so it comes
        // back through these three.
        onCreateSave: () => {
            // The portrait pixels for champions created in play come from the
            // screen: `CHARDESC` holds the picture, and only this side has
            // graphic 26 to cut it from.
            const payload = buildSavePayload(game, {
                portraitOf: (champion) => screen?.portraitPixelsFor(champion),
            });
            return {
                meta: {
                    name: makeSaveFileName(payload.header.savedAt),
                    savedAt: payload.header.savedAt,
                    level: payload.header.level,
                    champions: payload.header.champions,
                },
                bytes: encodeSavePayload(payload),
            };
        },
        onSaveWritten: () => game.saveWritten(),
        onRestoreSave: (bytes) => {
            applySaveBytes(game, bytes);
            // The entrance screen's "Resume" needs to know whether a save actually
            // came back: CSBWin loops on `ReadEntireGame`'s result and re-shows the
            // door when it did not (`doc/CSBwin-src/CSBCode.cpp:10634-10641`).
            savedGameRead = 'loaded';
            renderView();
        },
        // The boot's chooser only: its read failed, and `tag01efee` follows.
        onRestoreFailed: (error) => {
            console.error('Saved game damaged:', error);
            savedGameRead = 'damaged';
        },
        onSetPaused: (paused) => game.setPaused(paused),
        onPaletteSelected: (index) => {
            game.currentPalette = index;
        },
    });
    return { game, screen };
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
async function showEndOfGame(game: Game, screen: GameScreen, sound: SoundManager, word11694: boolean): Promise<void> {
    screen.setHoverPoint(null);
    screen.refreshOverlay();
    const { x, y, z } = game.ctx.party.state.position;
    const end = await runShowCredits(
        {
            canvas: gameCanvasEl,
            gameScreen: screen,
            playSound: (soundId, rateIdx) => sound.playSound(soundId, rateIdx),
            consumeSavedGameRead,
            readNewGame: () => readNewGame(game),
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
    scrollingText.restart();
    screen.initializePlayState();
    game.resumeMainLoop();
    game.start();
    renderView();
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
 */
async function runIntro(game: Game, screen: GameScreen, sound: SoundManager): Promise<PrisonDoorChoice> {
    const skipIntro =
        new URLSearchParams(window.location.search).get('intro') === '0'
        || loadUISettings().debug;
    return runBootSequence({
        canvas: gameCanvasEl,
        gameScreen: screen,
        playSound: (soundId, rateIdx) => sound.playSound(soundId, rateIdx),
        consumeSavedGameRead,
        readNewGame: () => readNewGame(game),
        skip: skipIntro,
    });
}

/** The page's side of play: its input and debug chrome, and a redraw per move and per tick. */
function wire(game: Game, screen: GameScreen, sound: SoundManager): void {
    bindUIContext({
        screen,
        game,
        renderView,
        onQuickSave: dev.quickSave,
        onQuickLoad: dev.quickLoad,
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
        const posInfo = game.getPositionInfo();
        console.log(`Movement ${success ? 'SUCCESS' : 'BLOCKED'}:`, posInfo);

        if (success) updateDebug(posInfo || 'Moved');
    });

    // A move draws nothing: it brings a tick on at once (`d.clockTick = 1`), and CSBWin
    // draws the viewport only in the tick, once a new party level is loaded
    // (doc/CSBwin-src/CSBCode.cpp:618-639).
    let mapPreviewAt = '';
    game.onTick(() => {
        renderView();
        const { x, y, z } = game.ctx.party.state.position;
        if (`${x},${y},${z}` !== mapPreviewAt) {
            mapPreviewAt = `${x},${y},${z}`;
            drawMapPreview(z);
        }
    });

    // The engine drives the message strip (`GameHost.messages`), a scanline of its scroll
    // a VBL; CSBWin's `vblInterrupt` invalidates the window after each
    // (doc/CSBwin-src/CSBCode.cpp:1003). A VBL that inverted a flashed button is drawn too,
    // unless its tick holds the paint until the put-back (`Game.paintHeld`).
    game.onFrame(() => {
        if (game.paintHeld()) return;
        const scrolled = scrollingText.takeChanged();
        const flashed = game.takeFlashChanged();
        if (scrolled || flashed) renderView();
    });
}

function start(game: Game): void {
    game.start();
    console.log('✓ Game engine started');
    console.log('✓ Starting position:', game.getPositionInfo());

    // Dev convenience only: restore the previous session's quick-save so a reload
    // lands back where you were. With Debug off, boot into a fresh dungeon.
    if (isDebugFeaturesEnabled()) dev.quickLoad();
    // The game is read, new or resumed: where CSBWin's boot forces DM rules.
    game.forceDMRulesAtBoot();

    // Initial render
    renderView();
    drawMapPreview(game.ctx.party.state.position.z);
}

async function init() {
    try {
        bindDataSetChooser(dataSet);
        updateDebug('Loading Phase 1: Core modules...');
        const files = await loadGameFiles();
        const tables = buildGameTables(files.graphicsLoader);
        const sound = createSoundManager(files.graphicsLoader, tables);
        const built = construct(files, tables, sound);
        game = built.game;
        screen = built.screen;
        await createCrt();
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
            (window as unknown as Record<string, unknown>).__probe = { game, screen, renderView };
        }
        await runIntro(built.game, built.screen, sound);
        wire(built.game, built.screen, sound);
        start(built.game);
    } catch (error) {
        reportError(error);
    }
}

/** An error that ends the page's game: `init`'s, or `die`'s (`Die`) wherever it comes from. */
function reportError(error: unknown): void {
    console.error(error);
    updateDebug(`Error: ${error}`);
}


// Start the application
init();
