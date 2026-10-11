import { canvasPoint } from '../lib/crt';

/** The canvas pixel a pointer event is over, through the CRT effect's curve where it is on. */
export function getEventPosition(canvas: HTMLCanvasElement, e: MouseEvent): { x: number, y: number } {
    return canvasPoint(canvas, e);
}
