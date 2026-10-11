import type { UIContext } from './context';
import { setUIContext } from './context';
import { bindUIEvents } from './events';
export { bindSettingsControls } from './settings';

export { drawMapPreview } from './mapPreview';
export { bindDataSetChooser } from './dataSetChooser';
export { bindSaveDrop } from './saveDrop';
export { showFatalMessage } from './fatalMessage';

export function bindUIContext(ctx: UIContext): void {
    setUIContext(ctx);
    bindUIEvents();
}
