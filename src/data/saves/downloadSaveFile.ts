/**
 * A save out of the page: the save menu's EXPORT. The file is the row's bytes as the
 * store holds them, a bare CSBWin `.dat`, which CSBWin opens; what the row alone holds
 * (its date, its play time, whether F5 wrote it) stays behind.
 *
 * The browser's own download: a link to the bytes, clicked. No picker, so the file goes
 * where the browser puts its downloads, under the row's name.
 */
export function downloadSaveFile(name: string, bytes: Uint8Array): void {
    // Copy out of the caller's buffer, as the store's write does: a view onto a larger
    // buffer would otherwise be downloaded whole.
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    // The download has the blob from the click on; the URL is of no use after it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
