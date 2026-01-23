/**
 * Dungeon Master Web
 */

import {
    Direction
} from './core';
import { CSBGraphicsLoader, DungeonData, DungeonLoader, GraphicsLoader } from './data';
import { loadSaveGameState, applySaveGameState, saveSaveGameState, type SaveGameState } from './data/SaveGameLoader';
import { Game, type Champion, type PartyState, type RuntimeSaveState } from './engine';
import { ViewportRenderer } from './renderer/ViewportRenderer';
import { bindUIContext, drawMapPreview, updateDebug } from './ui';

console.log('Dungeon Master Web - Initializing...');

// Global game instance
let game: Game | null = null;
let renderer: ViewportRenderer | null = null;
let graphicsLoader: GraphicsLoader | null = null;
let dungeonLoader: DungeonLoader | null = null;
let csbGraphicsLoader: CSBGraphicsLoader | null = null;
let dungeonData: DungeonData | null = null;

const QUICK_SAVEGAME_RAW_KEY = 'dmweb_savegame_raw_v1';
const GAME_DATA_DIR = '/gamefiles/dm-atari';

const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!gameCanvasEl) console.log(`Couldn't find game canvas !`);


const lines = new Image();
lines.src = '/QPN59-320x200-resized.png';

// window.addEventListener('load', fakeCRT, false);
function fakeCRT() {
   
    console.log('fakeCRT');
    // Try to create a WebGL canvas (will fail if WebGL isn't supported)
    let glcanvas;
    try {
        glcanvas = fx.canvas();
    } catch (e) {return;}
    
    const srcctx = gameCanvasEl.getContext('2d')!;
    
    // This tells glfx what to use as a source image
    const texture = glcanvas.texture(gameCanvasEl);
    
    console.log(lines.width);
    console.log(lines.height);
    console.log(gameCanvasEl.width);
    console.log(gameCanvasEl.height);

    // Just setting up some details to tweak the bulgePinch effect

    // Hide the source 2D canvas and put the WebGL Canvas in its place
    gameCanvasEl.parentNode!.appendChild(glcanvas);
    glcanvas.className = gameCanvasEl.className;
    glcanvas.id = gameCanvasEl.id + '_gl';
    // gameCanvasEl.id = 'old_' + gameCanvasEl.id;
    // gameCanvasEl.style.display = 'none';
    // return;
    // TODO: should be directly with the "render" call on ticks, not separate
    setInterval(() => {
        // adds scanlines to the source
        const w = gameCanvasEl.width;
        const h = gameCanvasEl.height;
        // srcctx.drawImage(lines, 0, 0, w, h);
        
        // Load the latest source frame
        texture.loadContentsOf(gameCanvasEl);
        
        // aiming to look like: https://www.dungeon-master.com/forum/viewtopic.php?t=31300
        // Apply WebGL magic: https://evanw.github.io/glfx.js/docs/
        const hw = w / 2;
        const hh = h / 2;
        const w75 = w * 0.75;
        glcanvas.draw(texture)
            .bulgePinch(hw, hh, w75, 0.12)
            .vignette(0.25, 0.74)
            .update();
    }, 1000 / 20);
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
        weaponHand,
        shieldHand,
        quiver: null,
        shieldStrength: 0,
        possessions,
        partyPosition,
        facing: partyPosition & 3,
    };
}

function injectRandomParty(): void {
    if (!game) return;
    const current = game.party.state;
    const champions: Champion[] = [];
    for (let i = 0; i < 4; i++) {
        champions.push(createRandomChampion(i));
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
            dungeonData = dungeon;

            console.log(`✓ Loaded dungeon:`, dungeon);
            console.log(`  - Seed: ${dungeon.header.randomSeed}`);
            console.log(`  - Maps: ${dungeon.maps.length}`);
            console.log(`  - Total objects: ${dungeon.header.objectCounts.reduce((a, b) => a + b, 0)}`);
            console.log(`  - Start: (${dungeon.header.startPosition.x}, ${dungeon.header.startPosition.y}) facing ${Direction[dungeon.header.startPosition.facing]}`);

            // Display first map info
            const firstMap = dungeon.maps[0];
            console.log(`  - First map: ${firstMap.descriptor.width}×${firstMap.descriptor.height}, level ${firstMap.descriptor.level}`);

            // Load graphics
            console.log('Loading graphics.dat...');
            graphicsLoader = new GraphicsLoader();
            await graphicsLoader.load(`${GAME_DATA_DIR}/graphics.dat`);
            console.log(`✓ Loaded graphics: ${graphicsLoader.getItemCount()} items`);

            // Optional CSBgraphics.dat overlay (extended decorations, portraits, etc.)
            csbGraphicsLoader = new CSBGraphicsLoader();
            const csbLoaded = await csbGraphicsLoader.tryLoad(`${GAME_DATA_DIR}/CSBgraphics.dat`);
            if (csbLoaded) {
                console.log('✓ Loaded CSBgraphics.dat overlay');
            } else {
                console.log('CSBgraphics.dat not found; extended decorations disabled');
                csbGraphicsLoader = null;
            }

            // Initialize game engine
            console.log('Initializing game engine...');
            game = new Game(dungeon);

            // Initialize viewport renderer
            console.log('Initializing viewport renderer (CSBWin bytecode system)...');
            const dungeonState = game.dungeonState;
            renderer = new ViewportRenderer(graphicsLoader, dungeonState, csbGraphicsLoader ?? undefined);
            await renderer.initialize(gameCanvasEl);
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
            });

            // Register movement callback
            game.onMove((success, message) => {
                const posInfo = game?.getPositionInfo();
                console.log(`Movement ${success ? 'SUCCESS' : 'BLOCKED'}:`, posInfo, message ?? ' ');

                if (message) updateDebug(message);
                else if (success) updateDebug(posInfo || 'Moved');

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
