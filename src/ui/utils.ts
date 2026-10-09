import { canvasPoint } from '../lib/crt';
import type { DungeonData } from '../data/dungeonTypes';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH, VIEWPORT_X, VIEWPORT_Y } from '../renderer/ViewportGraphics';

/** The canvas pixel a pointer event is over, through the CRT effect's curve where it is on. */
export function getEventPosition(canvas: HTMLCanvasElement, e: MouseEvent): { x: number, y: number } {
    return canvasPoint(canvas, e);
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
