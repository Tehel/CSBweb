import type { UIContext } from './context';
import { setUIContext } from './context';
export { handleCursorFilter } from './cursorFilter';
import { bindUIEvents } from './events';

export { isDebugFeaturesEnabled } from './context';
export { updateDebug, updateHover, appendLog, clearLog } from './messages';
export { drawMapPreview } from './mapPreview';
export { bindDataSetChooser } from './dataSetChooser';

export function bindUIContext(ctx: UIContext): void {
    setUIContext(ctx);
    bindUIEvents();
}
