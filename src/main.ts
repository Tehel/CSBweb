/**
 * Dungeon Master Web - Main Entry Point
 *
 * TypeScript/Vite-based Dungeon Master web port
 */

import {
    BinaryFile,
    DEFAULT_PALETTE,
    atariToRGB,
    Direction,
    RoomType
} from './core';
import { DungeonLoader, GraphicsLoader, drawImage } from './data';
import { Game, MovementAction } from './engine';
import { ViewportRenderer, directionToAngle, type ViewState } from './renderer';

console.log('Dungeon Master Web - Initializing...');

// Global game instance
let game: Game | null = null;
let renderer: ViewportRenderer | null = null;
let graphicsLoader: GraphicsLoader | null = null;

// Get canvas and context
const canvas = document.getElementById('viewport') as HTMLCanvasElement;
if (!canvas) {
    throw new Error('Canvas element not found');
}

const ctx = canvas.getContext('2d');
if (!ctx) {
    throw new Error('Could not get 2D context');
}

// Debug output element
const debugEl = document.getElementById('debug');

function updateDebug(message: string) {
    if (debugEl) {
        debugEl.innerHTML = `<p>${message}</p>`;
    }
}

// Render the 3D view
function renderView() {
    if (!game || !renderer) return;

    const party = game.getParty();
    const viewState: ViewState = {
        position: party.getPosition(),
        facing: party.getFacing(),
        angle: directionToAngle(party.getFacing()),
        offsetX: 0,
        offsetY: 0,
        mapIndex: party.getMapIndex(),
    };

    renderer.render(viewState);
}

// Initialize the game
async function init() {
    try {
        updateDebug('Loading Phase 1: Core modules...');

        // Test DungeonLoader
        console.log('Testing DungeonLoader...');
        const dungeonLoader = new DungeonLoader();
        try {
            updateDebug('Loading dungeon.dat...');
            const dungeon = await dungeonLoader.load('/gamefiles/dungeon.dat');

            console.log(`✓ Loaded dungeon:`, dungeon);
            console.log(`  - Seed: ${dungeon.header.randomSeed}`);
            console.log(`  - Maps: ${dungeon.maps.length}`);
            console.log(`  - Total objects: ${dungeon.header.objectCounts.reduce((a, b) => a + b, 0)}`);
            console.log(`  - Texts: ${dungeon.textData.length}`);
            console.log(`  - Start: (${dungeon.header.startPosition.x}, ${dungeon.header.startPosition.y}) facing ${Direction[dungeon.header.startPosition.facing]}`);

            // Display first map info
            const firstMap = dungeon.maps[0];
            console.log(`  - First map: ${firstMap.descriptor.width}×${firstMap.descriptor.height}, level ${firstMap.descriptor.level}`);

            updateDebug(
                `Phase 2 Complete!<br>` +
                `✓ DungeonLoader: Full parser working<br>` +
                `✓ Loaded ${dungeon.maps.length} maps<br>` +
                `✓ Parsed ${dungeon.header.objectCounts.reduce((a, b) => a + b, 0)} objects across 16 databases<br>` +
                `✓ Decoded ${dungeon.textData.length} text entries<br>` +
                `✓ Start position: (${dungeon.header.startPosition.x}, ${dungeon.header.startPosition.y})<br>` +
                `✓ First map: ${firstMap.descriptor.width}×${firstMap.descriptor.height} tiles`
            );

            // Load graphics
            console.log('Loading graphics.dat...');
            graphicsLoader = new GraphicsLoader();
            await graphicsLoader.load('/gamefiles/graphics.dat');
            console.log(`✓ Loaded graphics: ${graphicsLoader.getItemCount()} items`);

            // Initialize game engine
            console.log('Initializing game engine...');
            game = new Game(dungeon);

            // Initialize renderer
            console.log('Initializing 3D renderer...');
            renderer = new ViewportRenderer(
                canvas,
                game.getDungeonState(),
                graphicsLoader
            );
            console.log('✓ Renderer initialized');

            // Register movement callback
            game.onMove((success, message) => {
                const posInfo = game?.getPositionInfo();
                console.log(`Movement ${success ? 'SUCCESS' : 'BLOCKED'}:`, posInfo, message || '');

                if (message) {
                    updateDebug(message);
                } else if (success) {
                    updateDebug(posInfo || 'Moved');
                }

                // Render 3D view after movement
                if (success && renderer && game) {
                    renderView();
                }
            });

            // Register tick callback to update view
            game.onTick(() => {
                if (renderer && game) {
                    renderView();
                }
            });

            // Start game loop
            game.start();
            console.log('✓ Game engine started');
            console.log('✓ Starting position:', game.getPositionInfo());

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
                `✓ 3D renderer initialized<br>` +
                `✓ Ray-casting viewport active<br>` +
                `✓ Party at: (${dungeon.header.startPosition.x}, ${dungeon.header.startPosition.y})<br>` +
                `✓ Facing: ${Direction[dungeon.header.startPosition.facing]}<br>` +
                `✓ Use WASD/Arrows to move, Q/E to turn!`
            );

            // Test graphics loader
            // await testGraphicsLoader();

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
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#fff';
    ctx.font = '20px "Courier New"';
    ctx.textAlign = 'center';
    ctx.fillText('Phase 2: Data Loaders ✓', canvas.width / 2, 30);

    // Draw palette colors
    ctx.font = '12px "Courier New"';
    ctx.textAlign = 'left';
    ctx.fillText('Default Palette:', 20, 70);

    for (let i = 0; i < DEFAULT_PALETTE.length; i++) {
        const color = atariToRGB(DEFAULT_PALETTE[i]);
        const x = 20 + (i % 8) * 75;
        const y = 90 + Math.floor(i / 8) * 50;

        ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
        ctx.fillRect(x, y, 60, 30);

        ctx.fillStyle = '#fff';
        ctx.fillRect(x, y + 30, 60, 15);
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.fillText(`${i}`, x + 30, y + 41);
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

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#fff';
    ctx.font = '20px "Courier New"';
    ctx.textAlign = 'center';
    ctx.fillText(`Phase 3: Game Engine ✓`, canvas.width / 2, 25);

    ctx.font = '12px "Courier New"';
    ctx.fillText(`Map 0: ${map.descriptor.width}×${map.descriptor.height} tiles`, canvas.width / 2, 45);

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
                case RoomType.STONE:
                    ctx.fillStyle = '#444'; // Wall
                    break;
                case RoomType.OPEN:
                    ctx.fillStyle = '#888'; // Floor
                    break;
                case RoomType.DOOR:
                    ctx.fillStyle = '#aa6'; // Door
                    break;
                case RoomType.STAIRS:
                    ctx.fillStyle = '#6a6'; // Stairs
                    break;
                case RoomType.PIT:
                    ctx.fillStyle = '#222'; // Pit
                    break;
                case RoomType.TELEPORTER:
                    ctx.fillStyle = '#66a'; // Teleporter
                    break;
                case RoomType.FALSEWALL:
                    ctx.fillStyle = '#a66'; // False wall
                    break;
                default:
                    ctx.fillStyle = '#f0f'; // Unknown
            }

            ctx.fillRect(px, py, scale - 1, scale - 1);

            // Mark start position
            if (x === dungeon.header.startPosition.x && y === dungeon.header.startPosition.y) {
                ctx.fillStyle = '#ff0';
                ctx.fillRect(px + scale / 4, py + scale / 4, scale / 2, scale / 2);
            }
        }
    }

    // Legend
    ctx.fillStyle = '#fff';
    ctx.font = '10px "Courier New"';
    ctx.textAlign = 'left';
    const legendY = offsetY + map.descriptor.height * scale + 20;
    ctx.fillText(`Wall █ Floor █ Door █ Stairs █ Start █`, 20, legendY);
}

// Helper: Test graphics loader and display images
async function testGraphicsLoader() {
    try {
        console.log('Testing GraphicsLoader...');
        const graphicsLoader = new GraphicsLoader();
        await graphicsLoader.load('/gamefiles/graphics.dat');

        console.log(`✓ Loaded graphics: ${graphicsLoader.getItemCount()} items`);

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Title
        ctx.fillStyle = '#fff';
        ctx.font = '20px "Courier New"';
        ctx.textAlign = 'center';
        ctx.fillText('Phase 2: Graphics Decoder Test', canvas.width / 2, 30);

        // Get palette
        const palette = graphicsLoader.getPalette(0);
        console.log(`✓ Using palette 0:`, palette);

        // Try to decode and display several test images
        const testImages = [
            { index: 0, label: 'Credit Screen', x: 20, y: 60 },
            { index: 1, label: 'Title', x: 20, y: 180 },
            { index: 2, label: 'Title BG', x: 240, y: 60 },
            { index: 557, label: 'Font', x: 460, y: 60 }
        ];

        let successCount = 0;
        let failCount = 0;

        for (const test of testImages) {
            try {
                const image = graphicsLoader.getImage(test.index);
                console.log(`  ✓ Image ${test.index} (${test.label}): ${image.width}×${image.height}`);

                // Draw image using our helper function
                const scale = 1;
                drawImage(ctx, image, palette, test.x, test.y, scale);

                // Draw label
                ctx.fillStyle = '#ff0';
                ctx.font = '10px "Courier New"';
                ctx.textAlign = 'left';
                ctx.fillText(`${test.index}: ${test.label} (${image.width}×${image.height})`, test.x, test.y - 5);

                successCount++;
            } catch (error) {
                console.warn(`  ✗ Could not decode image ${test.index} (${test.label}):`, error);

                // Draw error marker
                ctx.fillStyle = '#f00';
                ctx.fillRect(test.x, test.y, 50, 50);
                ctx.fillStyle = '#fff';
                ctx.font = '10px "Courier New"';
                ctx.textAlign = 'left';
                ctx.fillText(`${test.index}: ERROR`, test.x, test.y - 5);

                failCount++;
            }
        }

        // Show cache stats
        const stats = graphicsLoader.getCacheStats();
        console.log(`✓ Cache stats: ${stats.cachedImages} images, ${stats.cachedRaw} raw`);

        // Update debug info
        updateDebug(
            `Phase 2 Complete + Graphics!<br>` +
            `✓ GraphicsLoader: ${graphicsLoader.getItemCount()} total graphics<br>` +
            `✓ Palettes: ${graphicsLoader.getData()?.palettes.length || 0} extracted<br>` +
            `✓ IMG1/IMG2 decoder: ${successCount}/${testImages.length} images decoded<br>` +
            `✓ Cache: ${stats.cachedImages} images cached<br>` +
            (failCount > 0 ? `⚠ ${failCount} images failed to decode` : '')
        );

        // Draw palette at bottom
        ctx.fillStyle = '#fff';
        ctx.font = '10px "Courier New"';
        ctx.textAlign = 'left';
        ctx.fillText('Palette 0:', 20, canvas.height - 35);

        for (let i = 0; i < 16; i++) {
            const color = atariToRGB(palette[i]);
            ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
            ctx.fillRect(90 + i * 25, canvas.height - 40, 20, 20);
        }

    } catch (error) {
        console.warn('Graphics loader test failed:', error);
        updateDebug(
            `Graphics test failed:<br>` +
            `${error}<br>` +
            `Note: Place graphics.dat in static/gamefiles/`
        );
    }
}

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
    }

    if (handled) {
        e.preventDefault();
    }
});

// Start the application
init();
