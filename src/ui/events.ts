import { GameInput } from '../renderer/GameInput';
import { getUIContext } from './context';
import { handleMapCanvasClick } from './mapPreview';
import { updateChampionPanel } from './championPanel';
import { getEventPosition } from './utils';

let uiBound = false;

const mapCanvasEl = document.getElementById('map-canvas') as HTMLCanvasElement | null;

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
        if (e.pointerType !== 'mouse') input.mouseMove(x, y);
        input.mouseDown(x, y, e.button);
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

export function bindUIEvents(): void {
    const ctx = getUIContext();
    if (!ctx) return;

    const input = new GameInput(ctx);
    const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement | null;
    bindCanvasEvents(gameCanvasEl, input);

    if (!uiBound) {
        uiBound = true;

        input.install();

        document.getElementById('btn-qsave')?.addEventListener('click', () => ctx.onQuickSave());
        document.getElementById('btn-qload')?.addEventListener('click', () => ctx.onQuickLoad());

        // Once per game tick, which is when skills and attributes can change. The panel
        // does nothing while it is hidden.
        ctx.game.onTick(() => updateChampionPanel());

        document.addEventListener('keydown', (e) => {
            if (input.keyDown(e)) e.preventDefault();
        });

        mapCanvasEl?.addEventListener('click', (e) => {
            handleMapCanvasClick(e);
        });
    }
}
