/**
 * The end of the page's game: a message where the screen was, white on black, for an
 * error that stops it. A game file refused is CSBWin's `die` (`src/engine/Die.ts`): a
 * `graphics.dat`, `CSBgraphics.dat` or `dungeon.dat` that does not read, or is not the one
 * the game names. CSBWin puts the message in a box and quits; the author's decision is
 * this screen, where the player can read it and choose what to do (`DEBT.md` H).
 *
 * The message is a canvas of its own in the game canvas's place, the same size on the
 * page, drawn at the resolution it is shown at. Its text is a browser font of 12pt or more,
 * since `graphics.dat`'s font may be the file refused. The game canvas leaves the page
 * with its listeners, so nothing draws over the message or answers a click.
 */

/** The font: at least 12pt, the author's floor. */
const FONT = '14pt monospace';
const MARGIN = 24;
const LINE_HEIGHT = 26;

const HEADING = 'The game has stopped.';
const FOOTER = 'Replace the file and reload the page, or choose another game beside this screen.';

let shown = false;

/** Put `message` up in `canvas`'s place. Only the first call does: the first error is the cause. */
export function showFatalMessage(canvas: HTMLCanvasElement, message: string): void {
    if (shown || !canvas.isConnected) return;
    shown = true;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    const scale = window.devicePixelRatio || 1;
    const screen = document.createElement('canvas');
    screen.id = canvas.id;
    screen.className = canvas.className;
    screen.style.cursor = 'default';
    screen.style.imageRendering = 'auto';
    screen.width = Math.round(width * scale);
    screen.height = Math.round(height * scale);
    const ctx = screen.getContext('2d');
    if (ctx) {
        ctx.scale(scale, scale);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#fff';
        ctx.font = FONT;
        ctx.textBaseline = 'top';
        const lines = [HEADING, '', ...message.split('\n'), '', FOOTER]
            .flatMap((line) => wrap(ctx, line, width - 2 * MARGIN));
        lines.forEach((line, i) => ctx.fillText(line, MARGIN, MARGIN + i * LINE_HEIGHT));
    }
    canvas.replaceWith(screen);
}

/** `line` cut at spaces into lines no wider than `maxWidth`; a word wider than that stands alone. */
function wrap(ctx: CanvasRenderingContext2D, line: string, maxWidth: number): string[] {
    const out: string[] = [];
    let current = '';
    for (const word of line.split(' ')) {
        const next = current === '' ? word : `${current} ${word}`;
        if (current !== '' && ctx.measureText(next).width > maxWidth) {
            out.push(current);
            current = word;
        } else {
            current = next;
        }
    }
    out.push(current);
    return out;
}
