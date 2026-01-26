import { getUIContext } from './context';

const hoverEl = document.getElementById('hover');
const logEl = document.getElementById('log');
const logLines: string[] = [];
const MAX_LOG_LINES = 200;

export function updateDebug(message: string): void {
    const ctx = getUIContext();
    if (!ctx) return;
    const plain = message.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
    const lines = plain.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    ctx.renderer.setMessageLines(lines);
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
}

export function clearLog(): void {
    if (!logEl) return;
    logLines.length = 0;
    logEl.textContent = '';
}
