import type { UIContext } from './context';
import { setUIContext } from './context';
export { handleCursorFilter } from './cursorFilter';
import { bindUIEvents } from './events';

export { drawMapPreview } from './mapPreview';
export { bindDataSetChooser } from './dataSetChooser';
export { bindSaveDrop } from './saveDrop';

export function bindUIContext(ctx: UIContext): void {
    setUIContext(ctx);
    bindUIEvents();
}
