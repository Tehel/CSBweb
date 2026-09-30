import type { DungeonData } from '../data/dungeonTypes';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH, VIEWPORT_X, VIEWPORT_Y } from '../renderer/ViewportGraphics';

export function getEventPosition(canvas: HTMLCanvasElement, e: MouseEvent): { x: number, y: number } {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    return { x, y };
}

export function getMapPreviewLayout(canvas: HTMLCanvasElement, map: DungeonData['maps'][number]) {
    const availableHeight = canvas.height - 0;
    const availableWidth = canvas.width - 4;
    const cellSize = Math.floor(Math.min(
        availableWidth / map.descriptor.width,
        availableHeight / map.descriptor.height,
        12
    ));
    const offsetX = (canvas.width - map.descriptor.width * cellSize) / 2;
    const offsetY = (canvas.height - map.descriptor.height * cellSize) / 2;
    return { cellSize, offsetX, offsetY };
}

export function isViewportPoint(x: number, y: number): boolean {
    return x >= VIEWPORT_X && x < VIEWPORT_X + VIEWPORT_WIDTH &&
        y >= VIEWPORT_Y && y < VIEWPORT_Y + VIEWPORT_HEIGHT;
}
