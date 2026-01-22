import { getUIContext } from './context';

const hoverEl = document.getElementById('hover');

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
