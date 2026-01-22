import type { UIContext } from './context';
import { setUIContext } from './context';
import { bindUIEvents } from './events';

export { updateDebug, updateHover } from './messages';
export { drawMapPreview } from './mapPreview';

export function bindUIContext(ctx: UIContext): void {
    setUIContext(ctx);
    bindUIEvents();
}
