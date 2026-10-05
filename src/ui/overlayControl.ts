import type { UIContext } from './context';

/**
 * The overlay's dev control (`DEBT.md` G25): the data set's overlays and overlay palettes
 * shown as a DSA's `&OVERLAY`, `&PALETTE` and `&JITTER` show them
 * (`src/engine/Overlay.ts`), with their parameters, since no dungeon the port plays runs
 * one. It changes the game as they do, so a save made after carries what it showed. Hide
 * is the page's alone: CSBWin puts an overlay down at its end, or when a read fails.
 */
export function bindOverlayControl(ctx: UIContext): void {
    const value = (id: string): number => {
        const input = document.getElementById(id) as HTMLInputElement | null;
        return Math.trunc(Number(input?.value ?? 0)) || 0;
    };
    const on = (id: string, action: () => void): void => {
        document.getElementById(id)?.addEventListener('click', () => {
            action();
            ctx.refreshScreen();
        });
    };
    const overlay = () => ctx.game.ctx.overlay;
    // The digits typed are the inputs', not the game's keys (`GameInput.keyDown`, on the document).
    document.getElementById('overlay-control')?.addEventListener('keydown', (e) => e.stopPropagation());

    on('btn-overlay-show', () => {
        overlay().SelectOverlay(value('overlay-number'), value('overlay-p1'), value('overlay-p2'),
            value('overlay-p3'), value('overlay-p4'), ctx.game.ctx.state.tickCount);
        if (!overlay().active) console.warn(`No overlay ${value('overlay-number')} in this data set's CSBgraphics.dat`);
    });
    on('btn-overlay-hide', () => { overlay().active = false; });
    on('btn-overlay-palette', () => {
        overlay().SetOverlayPalette(value('overlay-palette-number'), value('overlay-palette-density'));
    });
    on('btn-overlay-jitter', () => {
        overlay().Jitter(value('overlay-jitter-x'), value('overlay-jitter-y'), 0, 0);
    });
}
