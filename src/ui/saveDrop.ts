/**
 * A save into the page: the save menu's import. A file dropped anywhere on the page while
 * the save/load screen is up, the disk menu's or the entrance's chooser, is handed to it
 * (`saveMenuDrop`, `src/renderer/ui/SaveMenu.ts`) with its name, its bytes and the date
 * it was last written. There is no picker.
 *
 * The whole page takes the drop, not the canvas alone: the CRT effect shows a canvas of
 * its own over the game's, and a file that misses its target would otherwise be opened by
 * the browser in the game's place. So a file dropped with no dialog up is swallowed.
 */
import type { GameScreen } from '../renderer/GameScreen';

function carriesFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false;
}

export function bindSaveDrop(screen: GameScreen): void {
    window.addEventListener('dragover', (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = screen.isSaveMenuOpen() ? 'copy' : 'none';
    });
    window.addEventListener('drop', (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        const file = event.dataTransfer?.files[0];
        if (!file || !screen.isSaveMenuOpen()) return;
        void file.arrayBuffer().then((buffer) => {
            screen.handleSaveMenuDrop({ name: file.name, bytes: new Uint8Array(buffer), modifiedAt: file.lastModified });
        });
    });
}
