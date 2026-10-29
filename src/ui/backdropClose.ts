/**
 * A welcome page's dialog that its backdrop closes (`src/ui/welcomePage.ts`): the
 * dialogs that only show, HOW TO PLAY, ABOUT and the book's, never a form a click away
 * would lose the input of.
 */

/**
 * `dialog`, shown modal, closed by a click on its backdrop: pressed and released outside
 * its box, so that a drag selecting its text to past its edge does not close it, nor a
 * click on its scrollbar, which is the dialog's own.
 */
export function closeOnBackdrop(dialog: HTMLDialogElement): void {
    const outside = (event: MouseEvent) => {
        const box = dialog.getBoundingClientRect();
        return event.target === dialog
            && (event.clientX < box.left || event.clientX >= box.right || event.clientY < box.top || event.clientY >= box.bottom);
    };
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (event) => { pressedOutside = outside(event); });
    dialog.addEventListener('click', (event) => {
        if (pressedOutside && outside(event)) dialog.close();
        pressedOutside = false;
    });
}
