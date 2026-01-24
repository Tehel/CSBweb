/**
 * Dungeon Master Web
 */

import { Direction } from './core';
import { SoundManager } from './audio';
import { CSBGraphicsLoader, DungeonData, DungeonLoader, GraphicsLoader, type PresetHero } from './data';
import { loadSaveGameState, applySaveGameState, saveSaveGameState, type SaveGameState } from './data/SaveGameLoader';
import { Game, type ActuatorTables, type TimerTables, type Champion, type PartyState, type RuntimeSaveState, assignPresetHeroPossessions, createChampionFromPreset, createSkillsFromSubskillLevels, type AddCharacterTables } from './engine';
import { loadGlfx } from './lib/glfx-loader';
import { ViewportRenderer } from './renderer/ViewportRenderer';
import { extractObjectTables } from './renderer/csbwin/ObjectTables';
import { extractUITables } from './renderer/csbwin/UITables';
import { extractViewportTables } from './renderer/csbwin/ViewportTables';
import { bindUIContext, drawMapPreview, handleCursorFilter, updateDebug } from './ui';

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

const QUICK_SAVEGAME_RAW_KEY = 'dmweb_savegame_raw_v1';
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


function decodeBase64ToBytes(data: string): Uint8Array {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i) & 0xff;
    }
    return out;
}

function encodeBytesToBase64(data: Uint8Array): string {
    let bin = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.subarray(i, i + chunkSize);
        bin += String.fromCharCode(...chunk);
    }
    return btoa(bin);
}

const RANDOM_NAMES = [ 'Halk', 'Leif', 'Tiggy', 'Chani', 'Gothmog', 'Zed', 'Wuuuf', 'Nabi'];
const RANDOM_PORTRAIT_COUNT = 24;

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createRandomChampion(partyPosition: number): Champion {
    const alive = Math.random() > 0.1;
    const maxHealth = randomInt(60, 180);
    const maxStamina = randomInt(40, 160);
    const maxMana = randomInt(20, 120);
    const name = RANDOM_NAMES[randomInt(0, RANDOM_NAMES.length-1)];
    const weaponHand = randomInt(0, 95);
    const shieldHand = Math.random() > 0.5 ? randomInt(0, 95) : null;
    const possessions: Array<number | null> = new Array(30).fill(null);
    possessions[0] = shieldHand;
    possessions[1] = weaponHand;
    for (let slot = 2; slot < possessions.length; slot++) {
        if (Math.random() < 0.3) {
            possessions[slot] = randomInt(0, 95);
        }
    }
    const skills = createSkillsFromSubskillLevels(randomSkillLevels());

    return {
        name,
        attributes: {
            health: alive ? randomInt(10, maxHealth) : 0,
            maxHealth,
            stamina: alive ? randomInt(10, maxStamina) : 0,
            maxStamina,
            mana: alive ? randomInt(0, maxMana) : 0,
            maxMana,
            luck: randomInt(20, 80),
            strength: randomInt(20, 80),
            dexterity: randomInt(20, 80),
            wisdom: randomInt(20, 80),
            vitality: randomInt(20, 80),
            antiMagic: randomInt(20, 80),
            antiFire: randomInt(20, 80),
            experience: randomInt(0, 65000),
            fighter: randomInt(1, 8),
            ninja: randomInt(1, 8),
            priest: randomInt(1, 8),
            wizard: randomInt(1, 8),
        },
        alive,
        portraitGraphic: randomInt(0, RANDOM_PORTRAIT_COUNT - 1),
        incantation: [],
        food: randomInt(0, 2047),
        water: randomInt(0, 2047),
        wounds: randomInt(0, 0x3f),
        poisonCount: Math.random() < 0.2 ? randomInt(1, 3) : 0,
        skills,
        weaponHand,
        shieldHand,
        quiver: null,
        shieldStrength: 0,
        possessions,
        partyPosition,
        facing: partyPosition & 3,
    };
}

function randomSkillLevels(): number[] {
    const levels: number[] = [];
    for (let i = 0; i < 16; i++) {
        levels.push(randomInt(0, 4));
    }
    return levels;
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

function shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = randomInt(0, i);
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

function pickPresetHeroes(presets: PresetHero[], count: number): PresetHero[] {
    if (presets.length <= count) return presets.slice();
    return shuffle(presets.slice()).slice(0, count);
}

function findPresetHeroByPortrait(
    presets: PresetHero[],
    portraitIndex: number,
    position: { x: number; y: number; z: number },
    wall: number,
): PresetHero | null {
    const exact = presets.find((hero) =>
        hero.portraitIndex === portraitIndex
        && hero.location.map === position.z
        && hero.location.x === position.x
        && hero.location.y === position.y
        && hero.location.wall === wall
    );
    if (exact) return exact;
    return presets.find((hero) => hero.portraitIndex === portraitIndex) ?? null;
}

function addCharacterFromPortrait(portraitIndex: number, position: { x: number; y: number; z: number }, wall: number): boolean {
    if (!game || !dungeonData) return false;
    const party = game.party.state;
    if (party.objectInHand !== null && party.objectInHand !== undefined) return false;
    if (party.champions.length >= 4) return false;

    const hero = findPresetHeroByPortrait(dungeonData.presetHeroes ?? [], portraitIndex, position, wall);
    if (!hero) return false;

    const tables = getAddCharacterTables();
    const possessions = tables
        ? assignPresetHeroPossessions(hero.inventory, tables)
        : new Array(30).fill(null);

    const occupied = new Set(party.champions.map((champ) => champ.partyPosition));
    let partyPosition = 0;
    while (occupied.has(partyPosition) && partyPosition < 4) partyPosition += 1;
    if (partyPosition >= 4) return false;

    const champion = createChampionFromPreset(hero, partyPosition, possessions);
    return game.addChampion(champion);
}

function randomizeChampionVitals(champion: Champion): void {
    const healthRatio = Math.random() * 0.4 + 0.6;
    const staminaRatio = Math.random() * 0.35 + 0.55;
    const manaRatio = Math.random() * 0.5 + 0.5;
    champion.attributes.health = Math.max(1, Math.floor(champion.attributes.maxHealth * healthRatio));
    champion.attributes.stamina = Math.max(1, Math.floor(champion.attributes.maxStamina * staminaRatio));
    champion.attributes.mana = champion.attributes.maxMana > 0
        ? Math.max(0, Math.floor(champion.attributes.maxMana * manaRatio))
        : 0;
    champion.food = randomInt(1200, 2000);
    champion.water = randomInt(1200, 2000);
    champion.wounds = Math.random() < 0.15 ? randomInt(1, 0x3f) : 0;
}

function setCrtEnabled(enabled: boolean): boolean {
    if (!crtController) return false;
    return crtController.setEnabled(enabled);
}

function isCrtEnabled(): boolean {
    return crtController?.isEnabled() ?? false;
}

function injectRandomParty(): void {
    if (!game) return;
    const current = game.party.state;
    const champions: Champion[] = [];
    const presets = dungeonData?.presetHeroes ?? [];
    if (presets.length >= 4) {
        const tables = getAddCharacterTables();
        const picks = pickPresetHeroes(presets, 4);
        for (let i = 0; i < picks.length; i++) {
            const hero = picks[i];
            const possessions = tables
                ? assignPresetHeroPossessions(hero.inventory, tables)
                : new Array(30).fill(null);
            const champion = createChampionFromPreset(hero, i, possessions);
            randomizeChampionVitals(champion);
            champions.push(champion);
        }
    } else {
        for (let i = 0; i < 4; i++) {
            champions.push(createRandomChampion(i));
        }
    }
    const magicCasterIndex = champions.findIndex(c => c.attributes.maxMana > 0);
    const newState: PartyState = {
        ...current,
        champions,
        magicCasterIndex,
        moving: false,
        turning: false,
        lastMoveTime: 0,
    };
    console.log(`new party state: `, newState);
    game.setPartyState(newState);
    updateDebug('Random party injected');
}

function toggleAttackPanel(): void {
    if (!renderer) return;
    const next = !renderer.isAttackPanelVisible();
    renderer.setShowAttackPanel(next);
    updateDebug(next ? 'Attack panel ON' : 'Attack panel OFF');
    renderView();
}

function quickSave(): void {
    if (!game) return;
    const runtime = game.getRuntimeSaveState();
    const item16 = runtime.dungeon.item16 ?? [];
    const timers = runtime.dungeon.timers ?? [];
    const saveGameState: SaveGameState = {
        item16,
        timers,
        maxItem16: item16.length,
        maxTimers: timers.length,
        sequencedTimers: false,
        extendedTimers: false,
    };
    const rawBytes = saveSaveGameState(saveGameState);
    const payload = {
        runtime,
        raw: encodeBytesToBase64(rawBytes),
    };
    localStorage.setItem(QUICK_SAVEGAME_RAW_KEY, JSON.stringify(payload));
    updateDebug('Quick-saved');
}

function quickLoad(): void {
    if (!game) return;
    const raw = localStorage.getItem(QUICK_SAVEGAME_RAW_KEY);
    if (!raw) {
        updateDebug('No quick-save found');
        return;
    }
    try {
        const parsed = JSON.parse(raw) as { runtime: RuntimeSaveState; raw: string };
        const saveBytes = decodeBase64ToBytes(parsed.raw);
        const saveState = loadSaveGameState(saveBytes);
        applySaveGameState(game.state.dungeon, saveState);
        game.applyRuntimeSaveState(parsed.runtime);
        renderView();
        updateDebug('Quick-loaded');
    } catch (error) {
        console.warn('Failed to quick-load:', error);
        updateDebug('Quick-load failed (see console)');
    }
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
                soundManager.preloadAll();
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
            actuatorTables = {
                roomTimerFunctions: uiTables.graphic232.byte1596,
                objDescObjectType: objectTables.objDescObjectType,
                objDescCarryMask: objectTables.objDescCarryMask,
                carryLocation: uiTables.graphic232.carryLocation,
                cursorFilter: handleCursorFilter,
                onAddCharacter: (portraitIndex, position, pos) => addCharacterFromPortrait(portraitIndex, position, pos),
                onTextMessage: (text) => updateDebug(text),
                playSound: (soundId, rateIdx) => soundManager?.playSound(soundId, rateIdx),
            };
            timerTables = {
                monsterDesc: objectTables.monsterDesc,
            };

            // Initialize game engine
            console.log('Initializing game engine...');
            const timerHooks = soundManager
                ? { playSound: (soundId: number, rateIdx?: number) => soundManager?.playSound(soundId, rateIdx) }
                : undefined;
            const playSound = soundManager
                ? (soundId: number, rateIdx?: number) => soundManager?.playSound(soundId, rateIdx)
                : undefined;
            game = new Game(dungeon, actuatorTables, timerTables ?? undefined, undefined, timerHooks, playSound);

            // Initialize viewport renderer
            console.log('Initializing viewport renderer (CSBWin bytecode system)...');
            const dungeonState = game.dungeonState;
            renderer = new ViewportRenderer(graphicsLoader, dungeonState, csbGraphicsLoader ?? undefined);
            await renderer.initialize(gameCanvasEl);
            renderer.setPlaySound(playSound);
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
                onQuickSave: quickSave,
                onQuickLoad: quickLoad,
                onInjectRandomParty: injectRandomParty,
                onToggleAttackPanel: toggleAttackPanel,
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
            game.onMove((success, message, result) => {
                const posInfo = game?.getPositionInfo();
                console.log(`Movement ${success ? 'SUCCESS' : 'BLOCKED'}:`, posInfo, message ?? ' ');

                if (message) updateDebug(message);
                else if (success) updateDebug(posInfo || 'Moved');

                if (result?.soundId !== undefined) {
                    soundManager?.playSound(result.soundId, result.soundRateIdx);
                }

                // Render 3D view after movement
                if (success && renderer && game) {
                    renderView();
                    drawMapPreview(game.party.state.position.z);
                }
            });

            // Register tick callback to update view
            game.onTick(() => {
                 if (renderer && game) renderView();
            });

            // Start game loop
            game.start();
            console.log('✓ Game engine started');
            console.log('✓ Starting position:', game.getPositionInfo());

            quickLoad();

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
