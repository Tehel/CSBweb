import { chooserSets, type DataSet, type DataSetManifest } from '../data/DataSets';

/**
 * The chooser beside the canvas: one entry per set of the manifest but the hidden ones
 * (`chooserSets`), `current` selected. Choosing
 * another reloads the page with `?dungeon=<id>`, so everything built from the set is built
 * afresh, as CSBWin started on another directory would be.
 */
export function bindDataSetChooser(manifest: DataSetManifest, current: DataSet): void {
    const select = document.getElementById('data-set') as HTMLSelectElement | null;
    if (!select) return;
    for (const set of chooserSets(manifest, current)) {
        const option = document.createElement('option');
        option.value = set.id;
        option.textContent = set.name;
        option.selected = set.id === current.id;
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('dungeon', select.value);
        window.location.assign(url.toString());
    });
}
