/**
 * A save into the page: the save menu's import. A file dropped anywhere on the page while
 * the save/load screen is up, the disk menu's or the entrance's chooser, is handed to it
 * (`saveMenuDrop`, `src/renderer/ui/SaveMenu.ts`) with its name, its bytes and the date
 * it was last written. There is no picker. RISE's chooser imports nothing, so over it the
 * drop is refused as with no dialog up.
 *
 * The whole page takes the drop, not the canvas alone: the CRT effect shows a canvas of
 * its own over the game's, and a file that misses its target would otherwise be opened by
 * the browser in the game's place. So a file dropped with no dialog up is swallowed.
 */
import { saveMenuDrop, saveMenuTakesDrops } from '../renderer/ui/SaveMenu';
import type { UIState } from '../renderer/ui/UIState';

function carriesFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false;
}

export function bindSaveDrop(ui: UIState): void {
    window.addEventListener('dragover', (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = saveMenuTakesDrops(ui) ? 'copy' : 'none';
    });
    window.addEventListener('drop', (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        const file = event.dataTransfer?.files[0];
        if (!file || !saveMenuTakesDrops(ui)) return;
        void file.arrayBuffer().then((buffer) => {
            saveMenuDrop(ui, { name: file.name, bytes: new Uint8Array(buffer), modifiedAt: file.lastModified });
        });
    });
}
