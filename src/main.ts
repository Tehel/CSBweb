/**
 * Dungeon Master Web - Main Entry Point
 *
 * TypeScript/Vite-based Dungeon Master web port
 */

import {
    DEFAULT_PALETTE,
    atariToRGB,
    Direction,
    RoomType
} from './core';
import { CSBGraphicsLoader, DungeonLoader, GraphicsLoader, drawImage } from './data';
import { loadSaveGameState, applySaveGameState } from './data/SaveGameLoader';
import { Game, MovementAction, type Champion, type PartyState, type RuntimeSaveState } from './engine';
import { ViewportRenderer } from './renderer/ViewportRenderer';

console.log('Dungeon Master Web - Initializing...');

// Global game instance
let game: Game | null = null;
let renderer: ViewportRenderer | null = null;
let graphicsLoader: GraphicsLoader | null = null;
let dungeonLoader: DungeonLoader | null = null;
let csbGraphicsLoader: CSBGraphicsLoader | null = null;

const QUICK_SAVE_KEY = 'dmweb_quicksave_v1';
const QUICK_SAVEGAME_RAW_KEY = 'dmweb_savegame_raw_v1';
const GAME_DATA_DIR = '/gamefiles/dm-atari/';

// Get canvas and context
const canvas = document.getElementById('viewport') as HTMLCanvasElement;
if (!canvas) {
    throw new Error('Canvas element not found');
}

const ctx = canvas.getContext('2d');
if (!ctx) {
    throw new Error('Could not get 2D context');
}
const viewportCtx: CanvasRenderingContext2D = ctx;

// Debug output element
const debugEl = document.getElementById('debug');

function updateDebug(message: string) {
    if (debugEl) {
        debugEl.innerHTML = `<p>${message}</p>`;
    }
    if (renderer) {
        const plain = message.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
        const lines = plain.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
        renderer.setMessageLines(lines);
    }
}

function decodeBase64ToBytes(data: string): Uint8Array {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i) & 0xff;
    }
    return out;
}

const RANDOM_NAMES = [ 'Hawk', 'Leif', 'Tiggy', 'Chani', 'Gothmog', 'Zed', 'Wuuuf', 'Nabi'];

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createRandomChampion(partyPosition: number): Champion {
    const alive = Math.random() > 0.1;
    const maxHealth = randomInt(60, 180);
    const maxStamina = randomInt(40, 160);
    const maxMana = randomInt(20, 120);
    const name = RANDOM_NAMES[randomInt(0, RANDOM_NAMES.length-1)];

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
        incantation: [0, 0, 0, 0],
        incantationIndex: 0,
        weaponHand: randomInt(0, 95),
        shieldHand: Math.random() > 0.5 ? randomInt(0, 95) : null,
        quiver: null,
        partyPosition,
        facing: partyPosition & 3,
    };
}

function injectRandomParty(saveSnapshot: boolean): void {
    if (!game) return;
    const current = game.getParty().getState();
    const champions: Champion[] = [];
    for (let i = 0; i < 4; i++) {
        champions.push(createRandomChampion(i));
    }
    const next: PartyState = {
        ...current,
        champions,
        moving: false,
        turning: false,
        lastMoveTime: 0,
    };
    game.setPartyState(next);
    if (saveSnapshot) {
        quickSave();
    }
    renderView();
    updateDebug(saveSnapshot ? 'Random party injected + quick-saved (F8)' : 'Random party injected');
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
    const state = game.getRuntimeSaveState();
    localStorage.setItem(QUICK_SAVE_KEY, JSON.stringify(state));
    updateDebug('Quick-saved');
}

function quickLoad(): void {
    if (!game) return;
    const raw = localStorage.getItem(QUICK_SAVE_KEY);
    if (!raw) {
        updateDebug('No quick-save found');
        return;
    }
    try {
        const state = JSON.parse(raw) as RuntimeSaveState;
        game.applyRuntimeSaveState(state);
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

    const party = game.getParty();
    const pos = party.getPosition();
    const facing = party.getFacing();
    const mapIndex = party.getMapIndex();

    // ViewportRenderer.render(facing, x, y, mapIndex)
    // console.log(`Rendering viewport: pos=(${pos.x},${pos.y}) facing=${facing} map=${mapIndex}`);
    renderer.setPartyState(party.getState());
    renderer.processMouseQueue();
    renderer.render(facing, pos.x, pos.y, mapIndex);

    // Debug: log execution
    // const log = renderer.getExecutionLog();
    // if (log.length > 0) {
    //     console.log(`Bytecode executed: ${log.length} operations`);
    //     console.log('First 5 ops:', log.slice(0, 5));
    // }
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

            const rawSave = localStorage.getItem(QUICK_SAVEGAME_RAW_KEY);
            if (rawSave) {
                try {
                    const saveBytes = decodeBase64ToBytes(rawSave);
                    const saveState = loadSaveGameState(saveBytes);
                    applySaveGameState(dungeon, saveState);
                    console.log('✓ Applied savegame state from localStorage');
                } catch (error) {
                    console.warn('Failed to apply savegame state:', error);
                }
            }

            // Initialize game engine
            console.log('Initializing game engine...');
            game = new Game(dungeon);

            // Initialize viewport renderer
            console.log('Initializing viewport renderer (CSBWin bytecode system)...');
            const dungeonState = game.getDungeonState();
            renderer = new ViewportRenderer(graphicsLoader, dungeonState, csbGraphicsLoader ?? undefined);
            await renderer.initialize();
            console.log('✓ Viewport renderer initialized');

            // Replace the main canvas with the full screen canvas
            const screenCanvas = renderer.getCanvas();
            const oldCanvas = document.getElementById('viewport');
            if (oldCanvas && oldCanvas.parentNode) {
                screenCanvas.id = 'viewport';

                // Scale the full screen canvas using CSS
                // Use integer scaling (3x) to maintain pixel-perfect rendering
                // Full screen: 320×200 @ 3x = 960×600
                screenCanvas.style.width = '960px';   // 320 * 3
                screenCanvas.style.height = '600px';  // 200 * 3
                screenCanvas.style.imageRendering = 'pixelated';
                screenCanvas.style.imageRendering = '-moz-crisp-edges';
                screenCanvas.style.imageRendering = 'crisp-edges';

                oldCanvas.parentNode.replaceChild(screenCanvas, oldCanvas);
                console.log('✓ Replaced canvas with full screen (320×200 @ 3x scale)');
            }

            screenCanvas.addEventListener('mousemove', (e) => {
                if (!renderer) return;
                const rect = screenCanvas.getBoundingClientRect();
                const scaleX = screenCanvas.width / rect.width;
                const scaleY = screenCanvas.height / rect.height;
                const x = Math.floor((e.clientX - rect.left) * scaleX);
                const y = Math.floor((e.clientY - rect.top) * scaleY);
                renderer.setHoverPoint({ x, y });
                renderView();
            });

            screenCanvas.addEventListener('mousedown', (e) => {
                if (!renderer) return;
                const rect = screenCanvas.getBoundingClientRect();
                const scaleX = screenCanvas.width / rect.width;
                const scaleY = screenCanvas.height / rect.height;
                const x = Math.floor((e.clientX - rect.left) * scaleX);
                const y = Math.floor((e.clientY - rect.top) * scaleY);
                const buttonMask = e.button === 2 ? 1 : e.button === 0 ? 2 : 0;
                if (buttonMask !== 0) {
                    renderer.enqueueMouseClick(x, y, buttonMask);
                    renderView();
                }
            });

            screenCanvas.addEventListener('mouseup', () => {
                if (!renderer) return;
                renderer.enqueueMouseUnclick();
                renderView();
            });

            screenCanvas.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });

            screenCanvas.addEventListener('mouseleave', () => {
                if (!renderer) return;
                renderer.setHoverPoint(null);
                renderView();
            });

            // Register movement callback
            game.onMove((success, message) => {
                const posInfo = game?.getPositionInfo();
                console.log(`Movement ${success ? 'SUCCESS' : 'BLOCKED'}:`, posInfo, message ?? ' ');

                if (message) updateDebug(message);
                else if (success) updateDebug(posInfo || 'Moved');

                // Render 3D view after movement
                if (success && renderer && game) renderView();
            });

            // Register tick callback to update view
            game.onTick(() => { if (renderer && game) renderView(); });

            // Start game loop
            game.start();
            console.log('✓ Game engine started');
            console.log('✓ Starting position:', game.getPositionInfo());

            // Test graphics loader
            // await testGraphicsLoader();

            // Initial render
            renderView();

            // Debug: Check surrounding tiles
            const pos = game.getParty().getPosition();
            const mapIdx = game.getParty().getMapIndex();
            const ds = game.getDungeonState();
            console.log('Current tile:', ds.getTile(mapIdx, pos.x, pos.y));
            console.log('Surrounding tiles:');
            console.log('  North (0,-1):', ds.getTile(mapIdx, pos.x, pos.y - 1), ds.isWalkable(mapIdx, pos.x, pos.y - 1) ? 'walkable' : 'blocked');
            console.log('  East (+1,0):', ds.getTile(mapIdx, pos.x + 1, pos.y), ds.isWalkable(mapIdx, pos.x + 1, pos.y) ? 'walkable' : 'blocked');
            console.log('  South (0,+1):', ds.getTile(mapIdx, pos.x, pos.y + 1), ds.isWalkable(mapIdx, pos.x, pos.y + 1) ? 'walkable' : 'blocked');
            console.log('  West (-1,0):', ds.getTile(mapIdx, pos.x - 1, pos.y), ds.isWalkable(mapIdx, pos.x - 1, pos.y) ? 'walkable' : 'blocked');

            updateDebug(
                `Phase 4 Complete!<br>` +
                `✓ Cell-based 2.5D renderer initialized<br>` +
                `✓ 21-cell viewport system active<br>` +
                `✓ Party at: (${dungeon.header.startPosition.x}, ${dungeon.header.startPosition.y})<br>` +
                `✓ Facing: ${Direction[dungeon.header.startPosition.facing]}<br>` +
                `✓ Use WASD/Arrows to move, Q/E to turn!`
            );

        } catch (error) {
            console.warn('Could not load dungeon.dat:', error);
            updateDebug(
                `Phase 2 modules ready (file test skipped)!<br>` +
                `✓ DungeonLoader implemented<br>` +
                `✓ All 16 database parsers<br>` +
                `✓ Text decoder (5-bit encoding)<br>` +
                `✓ Map tile parser<br>` +
                `Note: Place dungeon.dat in static/gamefiles/ to test loading`
            );

            // Still draw palette test
            drawPaletteTest();
        }

        console.log('✓ Phase 2 initialization complete');
    } catch (error) {
        console.error('Initialization error:', error);
        updateDebug(`Error: ${error}`);
    }
}

// Helper: Draw palette test
function drawPaletteTest() {
    viewportCtx.fillStyle = '#000';
    viewportCtx.fillRect(0, 0, canvas.width, canvas.height);

    viewportCtx.fillStyle = '#fff';
    viewportCtx.font = '20px "Courier New"';
    viewportCtx.textAlign = 'center';
    viewportCtx.fillText('Phase 2: Data Loaders ✓', canvas.width / 2, 30);

    // Draw palette colors
    viewportCtx.font = '12px "Courier New"';
    viewportCtx.textAlign = 'left';
    viewportCtx.fillText('Default Palette:', 20, 70);

    for (let i = 0; i < DEFAULT_PALETTE.length; i++) {
        const color = atariToRGB(DEFAULT_PALETTE[i]);
        const x = 20 + (i % 8) * 75;
        const y = 90 + Math.floor(i / 8) * 50;

        viewportCtx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
        viewportCtx.fillRect(x, y, 60, 30);

        viewportCtx.fillStyle = '#fff';
        viewportCtx.fillRect(x, y + 30, 60, 15);
        viewportCtx.fillStyle = '#000';
        viewportCtx.textAlign = 'center';
        viewportCtx.fillText(`${i}`, x + 30, y + 41);
    }
}

// Helper: Draw map preview
function drawMapPreview(dungeon: any) {
    const map = dungeon.maps[0];

    // Calculate scale to fit in available space (canvas height - header - legend)
    const availableHeight = canvas.height - 80 - 30; // 80 for header, 30 for legend
    const availableWidth = canvas.width - 40; // 20px margin on each side

    const scale = Math.floor(Math.min(
        availableWidth / map.descriptor.width,
        availableHeight / map.descriptor.height,
        18 // Max scale for readability
    ));

    viewportCtx.fillStyle = '#000';
    viewportCtx.fillRect(0, 0, canvas.width, canvas.height);

    viewportCtx.fillStyle = '#fff';
    viewportCtx.font = '20px "Courier New"';
    viewportCtx.textAlign = 'center';
    viewportCtx.fillText(`Phase 3: Game Engine ✓`, canvas.width / 2, 25);

    viewportCtx.font = '12px "Courier New"';
    viewportCtx.fillText(`Map 0: ${map.descriptor.width}×${map.descriptor.height} tiles`, canvas.width / 2, 45);

    // Draw map tiles
    const offsetX = (canvas.width - map.descriptor.width * scale) / 2;
    const offsetY = 65;

    for (let x = 0; x < map.descriptor.width; x++) {
        for (let y = 0; y < map.descriptor.height; y++) {
            const tile = map.tiles[x][y];
            const px = offsetX + x * scale;
            const py = offsetY + y * scale;

            // Color by room type
            switch (tile.roomType) {
                case RoomType.STONE:      viewportCtx.fillStyle = '#444'; // Wall
                    break;
                case RoomType.OPEN:       viewportCtx.fillStyle = '#888'; // Floor
                    break;
                case RoomType.DOOR:       viewportCtx.fillStyle = '#aa6'; // Door
                    break;
                case RoomType.STAIRS:     viewportCtx.fillStyle = '#6a6'; // Stairs
                    break;
                case RoomType.PIT:        viewportCtx.fillStyle = '#222'; // Pit
                    break;
                case RoomType.TELEPORTER: viewportCtx.fillStyle = '#66a'; // Teleporter
                    break;
                case RoomType.FALSEWALL:  viewportCtx.fillStyle = '#a66'; // False wall
                    break;
                default:                  viewportCtx.fillStyle = '#f0f'; // Unknown
            }

            viewportCtx.fillRect(px, py, scale - 1, scale - 1);

            // Mark start position
            if (x === dungeon.header.startPosition.x && y === dungeon.header.startPosition.y) {
                viewportCtx.fillStyle = '#ff0';
                viewportCtx.fillRect(px + scale / 4, py + scale / 4, scale / 2, scale / 2);
            }
        }
    }

    // Legend
    viewportCtx.fillStyle = '#fff';
    viewportCtx.font = '10px "Courier New"';
    viewportCtx.textAlign = 'left';
    const legendY = offsetY + map.descriptor.height * scale + 20;
    viewportCtx.fillText(`Wall █ Floor █ Door █ Stairs █ Start █`, 20, legendY);
}

// Keep debug helpers in the module without enabling them by default
void drawMapPreview;

// Button handlers
document.getElementById('btn-up')?.addEventListener('click', () => {
    if (game) {
        console.log('Move forward');
        game.move(MovementAction.MOVE_FORWARD);
    }
});

document.getElementById('btn-down')?.addEventListener('click', () => {
    if (game) {
        console.log('Move backward');
        game.move(MovementAction.MOVE_BACKWARD);
    }
});

document.getElementById('btn-left')?.addEventListener('click', () => {
    if (game) {
        console.log('Turn left');
        game.move(MovementAction.TURN_LEFT);
    }
});

document.getElementById('btn-right')?.addEventListener('click', () => {
    if (game) {
        console.log('Turn right');
        game.move(MovementAction.TURN_RIGHT);
    }
});

document.getElementById('btn-esc')?.addEventListener('click', () => {
    console.log('ESC');
    if (game) {
        const paused = !game.isPaused();
        game.setPaused(paused);
        updateDebug(paused ? 'Game paused' : 'Game resumed');
    }
});

document.getElementById('btn-qsave')?.addEventListener('click', () => {
    quickSave();
});

document.getElementById('btn-qload')?.addEventListener('click', () => {
    quickLoad();
});

// Keyboard handler
document.addEventListener('keydown', (e) => {
    if (!game) return;

    let handled = false;

    switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            console.log('Move forward');
            game.move(MovementAction.MOVE_FORWARD);
            handled = true;
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            console.log('Move backward');
            game.move(MovementAction.MOVE_BACKWARD);
            handled = true;
            break;
        case 'ArrowLeft':
        case 'q':
        case 'Q':
            console.log('Turn left');
            game.move(MovementAction.TURN_LEFT);
            handled = true;
            break;
        case 'ArrowRight':
        case 'e':
        case 'E':
            console.log('Turn right');
            game.move(MovementAction.TURN_RIGHT);
            handled = true;
            break;
        case 'a':
        case 'A':
            console.log('Strafe left');
            game.move(MovementAction.STRAFE_LEFT);
            handled = true;
            break;
        case 'd':
        case 'D':
            console.log('Strafe right');
            game.move(MovementAction.STRAFE_RIGHT);
            handled = true;
            break;
        case 'Escape':
            console.log('Toggle pause');
            const paused = !game.isPaused();
            game.setPaused(paused);
            updateDebug(paused ? 'Game paused' : 'Game resumed');
            handled = true;
            break;
        case 'F5':
            quickSave();
            handled = true;
            break;
        case 'F9':
            quickLoad();
            handled = true;
            break;
        case 'F8':
            injectRandomParty(true);
            handled = true;
            break;
        case 'F7':
            toggleAttackPanel();
            handled = true;
            break;
    }

    if (handled) {
        e.preventDefault();
    }
});

// Start the application
init();
