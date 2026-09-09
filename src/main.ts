/**
 * Dungeon Master Web
 */

import { Direction } from './core';
import { SoundManager } from './audio';
import { CSBGraphicsLoader, DungeonData, DungeonLoader, GraphicsLoader } from './data';
import { Game, type ActuatorTables, type TimerTables, type TimerHooks, type AddCharacterTables } from './engine';
import { loadGlfx } from './lib/glfx-loader';
import { ViewportRenderer } from './renderer/ViewportRenderer';
import { extractObjectTables } from './renderer/csbwin/ObjectTables';
import { extractUITables } from './renderer/csbwin/UITables';
import { extractViewportTables } from './renderer/csbwin/ViewportTables';
import { bindUIContext, drawMapPreview, handleCursorFilter, isDebugFeaturesEnabled, updateDebug } from './ui';
import { scrollingText } from './renderer/csbwin/ScrollingText';
import { createDevTools } from './dev';

console.log('Dungeon Master Web - Initializing...');

// Global game instance
let game: Game | null = null;
let renderer: ViewportRenderer | null = null;
let graphicsLoader: GraphicsLoader | null = null;
let dungeonLoader: DungeonLoader | null = null;
let csbGraphicsLoader: CSBGraphicsLoader | null = null;
let dungeonData: DungeonData | null = null;
let soundManager: SoundManager | null = null;
let addCharacterTables: AddCharacterTables | null = null;
let actuatorTables: ActuatorTables | null = null;
let timerTables: TimerTables | null = null;
let crtController: CrtController | null = null;

// Dev-only harness (PLAN.md Phase 14). Reached only via isDebugFeaturesEnabled().
const dev = createDevTools({
    get game() { return game; },
    get renderer() { return renderer; },
    get dungeonData() { return dungeonData; },
    get timerTables() { return timerTables; },
    getAddCharacterTables,
    renderView,
});

const GAME_DATA_DIR = '/gamefiles/dm-atari';
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


function getAddCharacterTables(): AddCharacterTables | null {
    if (!graphicsLoader) return null;
    if (addCharacterTables) return addCharacterTables;

    const uiTables = extractUITables(graphicsLoader);
    const viewportTables = extractViewportTables(graphicsLoader);
    const objectTables = extractObjectTables(graphicsLoader, viewportTables.wallRectanglesOffset);
    addCharacterTables = {
        carryLocation: uiTables.graphic232.carryLocation,
        objDescCarryMask: objectTables.objDescCarryMask,
    };
    return addCharacterTables;
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
    if (!game || !renderer) return;

    const party = game.party;
    const pos = party.state.position;
    const facing = party.state.facing;

    renderer.setPartyState(party.state);
    renderer.processMouseQueue();
    renderer.render(pos, facing);
}


// Initialize the game
async function init() {
    try {
        updateDebug('Loading Phase 1: Core modules...');

        // Test DungeonLoader
        console.log('Testing DungeonLoader...');
        dungeonLoader = new DungeonLoader();
        try {
            updateDebug('Loading dungeon.dat...');
            const dungeon = await dungeonLoader.load(`${GAME_DATA_DIR}/dungeon.dat`);
            console.log('heroes', dungeon.presetHeroes);
            dungeonData = dungeon;

            console.log(`✓ Loaded dungeon:`, dungeon);
            console.log(`  - Seed: ${dungeon.header.randomSeed}`);
            console.log(`  - Maps: ${dungeon.maps.length}`);
            console.log(`  - Total objects: ${dungeon.header.objectCounts.reduce((a, b) => a + b, 0)}`);
            console.log(`  - Start: (${dungeon.header.startPosition.x}, ${dungeon.header.startPosition.y}) facing ${Direction[dungeon.header.facing]}`);

            // Display first map info
            const firstMap = dungeon.maps[0];
            console.log(`  - First map: ${firstMap.descriptor.width}×${firstMap.descriptor.height}, level ${firstMap.descriptor.level}`);

            // Load graphics
            console.log('Loading graphics.dat...');
            graphicsLoader = new GraphicsLoader();
            await graphicsLoader.load(`${GAME_DATA_DIR}/graphics.dat`);
            console.log(`✓ Loaded graphics: ${graphicsLoader.getItemCount()} items`);

            soundManager = new SoundManager(graphicsLoader);
            if (soundManager.isAvailable()) {
                const unlockAudio = (): void => {
                    soundManager?.unlock();
                };
                if (gameCanvasEl) {
                    gameCanvasEl.addEventListener('pointerdown', unlockAudio, { once: true });
                }
                window.addEventListener('keydown', unlockAudio, { once: true });
            }

            // Optional CSBgraphics.dat overlay (extended decorations, portraits, etc.)
            csbGraphicsLoader = new CSBGraphicsLoader();
            const csbLoaded = await csbGraphicsLoader.tryLoad(`${GAME_DATA_DIR}/CSBgraphics.dat`);
            if (csbLoaded) {
                console.log('✓ Loaded CSBgraphics.dat overlay');
            } else {
                console.log('CSBgraphics.dat not found; extended decorations disabled');
                csbGraphicsLoader = null;
            }

            const uiTables = extractUITables(graphicsLoader);
            const viewportTables = extractViewportTables(graphicsLoader);
            const objectTables = extractObjectTables(graphicsLoader, viewportTables.wallRectanglesOffset);
            soundManager?.setSoundTable(uiTables.graphic232.soundTable);
            if (soundManager?.isAvailable()) {
                soundManager.preloadAll();
            }
            actuatorTables = {
                roomTimerFunctions: uiTables.graphic232.byte1596,
                objDescObjectType: objectTables.objDescObjectType,
                objDescCarryMask: objectTables.objDescCarryMask,
                carryLocation: uiTables.graphic232.carryLocation,
                word1074: uiTables.graphic232.word1074,
                monsterDesc: objectTables.monsterDesc,
                cursorFilter: handleCursorFilter,
                messages: scrollingText,
                championMessageColors: uiTables.graphic232.byte1386,
                playSound: (soundId, rateIdx, distance) => soundManager?.playSound(soundId, rateIdx, distance),
                weaponDesc: objectTables.weaponDesc,
                weaponWeights: objectTables.weaponWeights,
                clothingWeights: objectTables.clothingWeights,
                miscWeights: objectTables.miscWeights,
            };
            timerTables = {
                monsterDesc: objectTables.monsterDesc,
                word1074: uiTables.graphic232.word1074,
                soundTable: uiTables.graphic232.soundTable,
                doorCharacteristics: objectTables.doorCharacteristics,
                monsterDroppings: objectTables.monsterDroppings,
                facingReplication: objectTables.facingReplication,
                monsterAttackSounds: objectTables.monsterAttackSounds,
                uByte590: uiTables.graphic232.uByte590,
                byte586: uiTables.graphic232.byte586,
                clothingArmour: objectTables.clothingArmour,
                clothingFlags: objectTables.clothingFlags,
                byte1412: uiTables.graphic232.byte1412,
                experienceForAttacking: uiTables.graphic230.experienceForAttacking,
                skillNumber: uiTables.graphic230.skillNumber,
                byte20046: uiTables.graphic230.byte20046,
                byte20002: uiTables.graphic230.byte20002,
                byte19958: uiTables.graphic230.byte19958,
                byte19914: uiTables.graphic230.byte19914,
                byte20090: uiTables.graphic230.byte20090,
                attackNames: uiTables.graphic230.attackNames,
            };

            // Initialize game engine
            console.log('Initializing game engine...');
            const timerHooks: TimerHooks = {
                onMissileTrace: dev.onMissileTrace,
            };
            if (soundManager) {
                timerHooks.playSound = (soundId: number, rateIdx?: number, distance?: number) =>
                    soundManager?.playSound(soundId, rateIdx, distance);
            }
            const playSound = soundManager
                ? (soundId: number, rateIdx?: number, distance?: number) => soundManager?.playSound(soundId, rateIdx, distance)
                : undefined;
            game = new Game(dungeon, actuatorTables, timerTables ?? undefined, undefined, timerHooks, playSound, {
                trace: dev.onMonsterAITrace,
            });
            game.setSpellDefinitions(uiTables.graphic230.spells);

            // Initialize viewport renderer
            console.log('Initializing viewport renderer (CSBWin bytecode system)...');
            const dungeonState = game.dungeonState;
            renderer = new ViewportRenderer(graphicsLoader, dungeonState, csbGraphicsLoader ?? undefined);
            await renderer.initialize(gameCanvasEl);
            renderer.setPlaySound(playSound);
            renderer.setCharacterStats(game.characterStats);
            renderer.setPaletteSelectedHandler((index) => {
                if (game) game.currentPalette = index;
            });
            renderer.setViewingFilter((options) => game?.processViewingFilter(options) ?? null);
            renderer.setObjectMoveHandler((position, object, place, unchangedRoom, facing) => {
                game?.triggerObjectMove(position, object, place, unchangedRoom, facing);
            });
            renderer.setSpellCastHandler((chIdx, incantation, totalManaCost) => {
                return game?.castSpellFromUi(chIdx, incantation, totalManaCost) ?? 0;
            });
            renderer.setFeedingHandler((chIdx, fp) => game?.applyFeeding(chIdx, fp) ?? false);
            renderer.setResurrectReincarnateCancelHandler((button) => {
                game?.resurrectReincarnateCancel(button);
            });
            await loadGlfx().catch((err) => {
                console.warn('glfx failed to load; CRT effect disabled', err);
            });
            crtController = createCrtController(gameCanvasEl);
            console.log('✓ Viewport renderer initialized');
            bindUIContext({
                renderer,
                game,
                dungeonData: dungeon,
                renderView,
                onQuickSave: dev.quickSave,
                onQuickLoad: dev.quickLoad,
                onInjectRandomParty: dev.injectRandomParty,
                onToggleMonsterAITrace: dev.toggleMonsterAITrace,
                onToggleMissileTrace: dev.toggleMissileTrace,
                onRunMissileScenario: dev.runNextMissileScenario,
                setCrtEnabled,
                isCrtEnabled,
                setSoundEnabled: (enabled) => {
                    soundManager?.unlock();
                    soundManager?.setEnabled(enabled);
                },
                isSoundEnabled: () => soundManager?.isEnabled() ?? false,
                setSoundVolume: (volume) => soundManager?.setVolume(volume),
                getSoundVolume: () => soundManager?.getVolume() ?? 0,
            });

            // Register movement callback
            game.onMove((success, result) => {
                const posInfo = game?.getPositionInfo();
                console.log(`Movement ${success ? 'SUCCESS' : 'BLOCKED'}:`, posInfo);

                if (success) updateDebug(posInfo || 'Moved');

                if (result?.soundId !== undefined) {
                    soundManager?.playSound(result.soundId, result.soundRateIdx);
                }

                // Render 3D view after movement
                if (success && renderer && game) {
                    renderView();
                    drawMapPreview(game.party.state.position.z);
                }
            });

            // Register tick callback to update view.
            // The message queue is pumped here, mirroring CSBWin's main loop
            // (doc/CSBwin-src/CSBCode.cpp:716) — see doc/CSBWIN_MESSAGES_REFERENCE.md.
            renderer.setChampionAttackHandler(
                (chIdx, attackType) => game?.championAttack(chIdx, attackType) ?? 0,
                () => game?.consumeAttackDamageToDisplay() ?? 0,
            );

            game.onTick(() => {
                 if (!renderer || !game) return;
                 scrollingText.pump(game.getTickCount());
                 // `TAG01b29a` — the champion flinch and the attack panel's redraw
                 // state, before the frame is drawn (doc/CSBwin-src/CSBCode.cpp:685).
                 renderer.attackPanelTick();
                 renderView();
            });

            // Start game loop
            game.start();
            console.log('✓ Game engine started');
            console.log('✓ Starting position:', game.getPositionInfo());

            // Dev convenience only: restore the previous session's quick-save so a reload
            // lands back where you were. With Debug off, boot into a fresh dungeon.
            if (isDebugFeaturesEnabled()) dev.quickLoad();

            // Initial render
            renderView();
            drawMapPreview(game.party.state.position.z);

        } catch (error) {
            console.warn('Could not load dungeon.dat:', error);
            updateDebug('Failed to load dungeon');
        }
    } catch (error) {
        console.error('Initialization error:', error);
        updateDebug(`Error: ${error}`);
    }
}


// Start the application
init();
