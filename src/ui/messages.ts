const hoverEl = document.getElementById('hover');
const logEl = document.getElementById('log');
const logLines: string[] = [];
const MAX_LOG_LINES = 200;

/**
 * Developer/debug output. Goes ONLY to the external `#log` div — never to the in-game
 * message area, which belongs to CSBWin's `SCROLLING_TEXT` and is reserved for real
 * gameplay text (see `doc/CSBWIN_MESSAGES_REFERENCE.md`).
 *
 * Gameplay messages must be emitted as fragments via the engine's `MessageSink`
 * (`printLinefeed()` + `quePrintLines(color, text)`), not through this function.
 */
export function updateDebug(message: string): void {
    appendLog(message);
}

export function updateHover(message: string): void {
    if (hoverEl) hoverEl.innerHTML = `<p>${message}</p>`;
}

export function appendLog(message: string): void {
    if (!logEl) return;
    const plain = message.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
    const lines = plain.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    if (lines.length === 0) return;
    logLines.push(...lines);
    if (logLines.length > MAX_LOG_LINES) {
        logLines.splice(0, logLines.length - MAX_LOG_LINES);
    }
    logEl.textContent = logLines.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
}

export function clearLog(): void {
    if (!logEl) return;
    logLines.length = 0;
    logEl.textContent = '';
}
