import type { UIContext } from './context';
import { setUIContext } from './context';
export { handleCursorFilter } from './cursorFilter';
import { bindUIEvents } from './events';

export { updateDebug, updateHover, appendLog, clearLog } from './messages';
export { drawMapPreview } from './mapPreview';

export function bindUIContext(ctx: UIContext): void {
    setUIContext(ctx);
    bindUIEvents();
}
