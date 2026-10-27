import { GameInput, type GameInputHost } from '../renderer/GameInput';
import { getEventPosition } from './utils';

let uiBound = false;

/**
 * The canvas's pointer, read through pointer events rather than mouse events. A browser
 * sends a finger's or a stylus's mouse events only once it lifts, the press and the
 * release together, so nothing could be held down: the eye, to read a scroll or a
 * champion's masteries. A pointer event comes as it happens, for a mouse as for a touch.
 * The canvas's `touch-action: none` (`index.html`) keeps the browser from taking a
 * touch for a scroll or a zoom, and cancelling it. Only the primary pointer counts.
 *
 * A finger leaves the canvas as it lifts, and the cursor would go with it, the object in
 * hand included: only a mouse's leaving takes the cursor off. A finger is first seen as
 * it presses, so the press puts the cursor where it is.
 *
 * A press captures the pointer, so its release is the canvas's wherever it happens: the
 * eye let go off the canvas is let go. Until then its moves are the canvas's too, at the
 * nearest edge (`canvasPoint`), and it leaves the canvas only once released.
 */
function bindCanvasEvents(canvas: HTMLCanvasElement | null, input: GameInput): void {
    if (!canvas) return;
    if (canvas.dataset.uiBound === 'true') return;
    canvas.dataset.uiBound = 'true';

    canvas.addEventListener('pointermove', (e) => {
        if (!e.isPrimary) return;
        const { x, y } = getEventPosition(canvas, e);
        input.mouseMove(x, y);
    });

    canvas.addEventListener('pointerdown', (e) => {
        if (!e.isPrimary) return;
        const { x, y } = getEventPosition(canvas, e);
        input.mouseDown(x, y, e.button, e.pointerType !== 'mouse');
        // A synthetic event's pointer is none the browser tracks, and capturing it throws.
        if (e.isTrusted) canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointerup', (e) => {
        if (e.isPrimary) input.mouseUp();
    });

    canvas.addEventListener('pointercancel', (e) => {
        if (e.isPrimary) input.mouseUp();
    });

    canvas.addEventListener('wheel', (e) => {
        if (input.wheel(e.deltaY)) e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    canvas.addEventListener('pointerleave', (e) => {
        if (e.isPrimary && e.pointerType === 'mouse') input.mouseLeave();
    });
}

/**
 * The page's listeners, on the game canvas and the document, handing over to the game's
 * input path, which they return: the pre-game screens' as play's (`GameInput.take`).
 */
export function bindUIEvents(host: GameInputHost): GameInput {
    const input = new GameInput(host);
    const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement | null;
    bindCanvasEvents(gameCanvasEl, input);

    if (!uiBound) {
        uiBound = true;

        input.install();

        document.addEventListener('keydown', (e) => {
            if (input.keyDown(e)) e.preventDefault();
        });
    }
    return input;
}
