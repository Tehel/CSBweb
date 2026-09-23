import { Position, RoomType } from '../core';
import { getUIContext, isDebugFeaturesEnabled } from './context';
import { updateDebug } from './messages';
import { getEventPosition, getMapPreviewLayout } from './utils';

const mapCanvasEl = document.getElementById('map-canvas') as HTMLCanvasElement | null;

export function drawMapPreview(levelIndex: number): void {
    const ctx = getUIContext();
    if (!ctx || !mapCanvasEl) return;

    const canvasCtx: CanvasRenderingContext2D = mapCanvasEl.getContext('2d')!;
    canvasCtx.imageSmoothingEnabled = true;

    const map = ctx.dungeonData.maps[levelIndex];
    const { cellSize, offsetX, offsetY } = getMapPreviewLayout(mapCanvasEl, map);
    canvasCtx.fillStyle = '#000';
    canvasCtx.fillRect(0, 0, mapCanvasEl.width, mapCanvasEl.height);

    const colors: Map<RoomType, string> = new Map([
        [RoomType.STONE, '#444'],
        [RoomType.OPEN, '#888'],
        [RoomType.DOOR, '#aa6'],
        [RoomType.STAIRS, '#6a6'],
        [RoomType.PIT, '#222'],
        [RoomType.TELEPORTER, '#66a'],
        [RoomType.FALSEWALL, '#a66'],
    ]);

    const current = ctx.game.party.state.position;
    for (let x = 0; x < map.descriptor.width; x++) {
        for (let y = 0; y < map.descriptor.height; y++) {
            const tile = map.tiles[x][y];
            const px = offsetX + x * cellSize;
            const py = offsetY + y * cellSize;
            canvasCtx.fillStyle = colors.get(tile.roomType) ?? '#f0f';
            canvasCtx.fillRect(px, py, cellSize - 1, cellSize - 1);

            if (current.x === x && current.y === y && current.z === levelIndex) {
                canvasCtx.fillStyle = 'red';
                canvasCtx.fillRect(px + cellSize / 4, py + cellSize / 4, cellSize / 2, cellSize / 2);
            }
        }
    }
}

export function handleMapCanvasClick(e: MouseEvent): void {
    if (!isDebugFeaturesEnabled() || !mapCanvasEl) return;
    const ctx = getUIContext();
    if (!ctx) return;

    const map = ctx.dungeonData.maps[ctx.game.party.state.position.z];
    const { cellSize, offsetX, offsetY } = getMapPreviewLayout(mapCanvasEl, map);
    const { x, y } = getEventPosition(mapCanvasEl, e);
    if (x < offsetX || y < offsetY) return;
    const maxX = offsetX + map.descriptor.width * cellSize;
    const maxY = offsetY + map.descriptor.height * cellSize;
    if (x >= maxX || y >= maxY) return;

    const gx = Math.floor((x - offsetX) / cellSize);
    const gy = Math.floor((y - offsetY) / cellSize);
    if (gx < 0 || gy < 0 || gx >= map.descriptor.width || gy >= map.descriptor.height) return;

    const state = ctx.game.party.state;
    ctx.game.setPartyState({
        ...state,
        position: new Position(gx, gy, state.position.z),
        moving: false,
        turning: false,
    });
    ctx.renderView();
    drawMapPreview(state.position.z);
    updateDebug(`Teleported to (${gx}, ${gy}, ${state.position.z})`);
}
