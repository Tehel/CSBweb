/**
 * The form that adds a player's own data set (`src/data/LocalDataSets.ts`), opened by the
 * welcome page's "+ Add my own" (`src/ui/welcomePage.ts`): a modal dialog in the page's
 * look (`welcomePage.css`).
 *
 * - **The fields**: the name, the id (the `<id>` of `local:<id>`, made from the name until
 *   the player writes one), a short description, the authors, separated by commas, and
 *   the reincarnation rule (`dmRules`).
 * - **The files**, each dropped on the dialog or chosen on its row, and each replaced or
 *   removed before CONFIRM: `dungeon.dat`, `graphics.dat`, `CSBgraphics.dat`, the Hint
 *   Oracle's `hcsb.hct` and `hcsb.dat`, and a thumbnail. A dropped file goes to the row of
 *   its name, whatever its case, an image to the thumbnail's; a chosen one goes to its row.
 *   Without a `graphics.dat`, the player chooses DM's or CSB's, whichever the manifest has.
 * - **The check**, `checkLocalDataSet`, runs at every change. A problem shows under its
 *   field once the player has given that field something; the line beside CONFIRM names
 *   the fields still to be given. CONFIRM is enabled when there is no problem, and writes
 *   the record the check made (`onConfirm`).
 */
import { folderFiles, type DataSetFiles } from '../data/DataSetFiles';
import { dataSetNamed, type DataSetManifest } from '../data/DataSets';
import {
    checkLocalDataSet,
    type LocalDataSetDraft, type LocalDataSetField, type LocalDataSetFile, type LocalDataSetRecord,
} from '../data/LocalDataSets';

/** The sets a record without a `graphics.dat` may play the graphics of. */
const BASE_SETS = ['dm-atari', 'csb'];

/** The rows of files, in the form's order. */
const FILE_ROWS: readonly { file: LocalDataSetFile; label: string; hint: string }[] = [
    { file: 'dungeon.dat', label: 'dungeon.dat', hint: 'Needed' },
    { file: 'graphics.dat', label: 'graphics.dat', hint: 'Or the graphics below' },
    { file: 'CSBgraphics.dat', label: 'CSBgraphics.dat', hint: 'Where the dungeon has one' },
    { file: 'hcsb.hct', label: 'hcsb.hct', hint: 'The Hint Oracle, with hcsb.dat' },
    { file: 'hcsb.dat', label: 'hcsb.dat', hint: 'The Hint Oracle, with hcsb.hct' },
    { file: 'thumbnail', label: 'Thumbnail', hint: 'An image, 320x200 at best' },
];

/** What the line beside CONFIRM calls a field still to be given. */
const FIELD_NAMES: Record<LocalDataSetField, string> = {
    id: 'an id', name: 'a name', baseSet: 'the graphics', 'dungeon.dat': 'dungeon.dat', 'graphics.dat': 'graphics.dat',
    'CSBgraphics.dat': 'CSBgraphics.dat', 'hcsb.hct': 'hcsb.hct', 'hcsb.dat': 'hcsb.dat', thumbnail: 'a thumbnail',
};

const FORM = `
<form class="add-set-form">
  <h2 class="px" id="add-set-title">Add my own dungeon</h2>
  <div class="add-set-fields">
    <label class="add-set-field" data-about="name"><span class="px px2">Name</span>
      <input name="name" maxlength="60" autocomplete="off"><span class="add-set-problem"></span></label>
    <label class="add-set-field" data-about="id"><span class="px px2">Id</span>
      <span class="add-set-id"><span class="px px2">local:</span><input name="id" maxlength="40" autocomplete="off" spellcheck="false"></span>
      <span class="add-set-problem"></span></label>
    <label class="add-set-field"><span class="px px2">Description</span>
      <textarea name="description" rows="2" maxlength="300"></textarea></label>
    <label class="add-set-field"><span class="px px2">Authors</span>
      <input name="authors" maxlength="200" placeholder="Separated by commas" autocomplete="off"></label>
    <label class="add-set-check"><input type="checkbox" name="dmRules">
      <span>DM rules: a champion reincarnated keeps their attributes</span></label>
  </div>
  <h3 class="px px2">Files</h3>
  <p class="add-set-hint">Drop the dungeon's files here, or choose each one.</p>
  <ul class="add-set-files"></ul>
  <p class="add-set-dropped" aria-live="polite"></p>
  <fieldset class="add-set-base" data-about="baseSet">
    <legend class="px px2">Without a graphics.dat</legend>
    <span class="add-set-problem"></span>
  </fieldset>
  <div class="add-set-buttons">
    <p class="add-set-status" aria-live="polite"></p>
    <button type="button" class="btn px" id="add-set-cancel">Cancel</button>
    <button type="button" class="btn px" id="add-set-confirm" disabled>Confirm</button>
  </div>
</form>`;

/**
 * Open the form over the welcome page. `takenIds` are the player's sets' ids, which a new
 * one may not take. CONFIRM calls `store` with the record; once it has stored it, the form
 * closes and calls `added`. An error `store` throws is shown beside CONFIRM, and the form
 * stays.
 */
export function openAddDataSetForm(
    manifest: DataSetManifest,
    takenIds: ReadonlySet<string>,
    store: (record: LocalDataSetRecord) => Promise<void>,
    added: (record: LocalDataSetRecord) => void,
): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'add-set';
    dialog.setAttribute('aria-labelledby', 'add-set-title');
    dialog.innerHTML = FORM;
    const form = dialog.querySelector('form')!;
    const input = (name: string): HTMLInputElement => form.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    const [name, id, authors, dmRules] = ['name', 'id', 'authors', 'dmRules'].map(input);
    const description = form.querySelector('textarea')!;
    const status = form.querySelector<HTMLElement>('.add-set-status')!;
    const dropped = form.querySelector<HTMLElement>('.add-set-dropped')!;
    const confirm = form.querySelector<HTMLButtonElement>('#add-set-confirm')!;
    const baseBox = form.querySelector<HTMLFieldSetElement>('.add-set-base')!;

    const files: Partial<Record<LocalDataSetFile, Blob>> = {};
    /** The fields the player has given something: their problems show. */
    const touched = new Set<LocalDataSetField>();
    let idWritten = false;
    let record: LocalDataSetRecord | null = null;
    let generation = 0;

    const bases = BASE_SETS.flatMap((set) => dataSetNamed(manifest, set) ?? []);
    let baseSet = bases[0]?.id ?? BASE_SETS[0];
    for (const set of bases) {
        const label = document.createElement('label');
        label.className = 'add-set-check';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'baseSet';
        radio.value = set.id;
        radio.checked = set.id === baseSet;
        radio.addEventListener('change', () => {
            baseSet = set.id;
            changed('baseSet');
        });
        label.append(radio, text('span', '', `${set.name}'s graphics`));
        baseBox.insertBefore(label, baseBox.querySelector('.add-set-problem'));
    }
    /** The base sets' files, each read once. */
    const baseReads = new Map<string, Promise<Uint8Array | null>>();
    const base = (set: string): DataSetFiles | null => {
        const found = bases.find((s) => s.id === set);
        if (!found) return null;
        const folder = folderFiles(found.dir);
        return {
            read: (file) => {
                const key = `${set}/${file}`;
                if (!baseReads.has(key)) baseReads.set(key, folder.read(file));
                return baseReads.get(key)!;
            },
            where: folder.where,
        };
    };

    const list = form.querySelector('.add-set-files')!;
    const rows = new Map(FILE_ROWS.map(({ file, label, hint }) => {
        const row = document.createElement('li');
        row.dataset.about = file;
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.hidden = true;
        if (file === 'thumbnail') picker.accept = 'image/*';
        const choose = button('Choose', () => picker.click());
        const remove = button('Remove', () => setFile(file, null));
        picker.addEventListener('change', () => {
            if (picker.files?.[0]) setFile(file, picker.files[0]);
            picker.value = '';
        });
        const given = text('span', 'add-set-given', hint);
        row.append(text('span', 'px px2', label), given, choose, remove, picker, text('span', 'add-set-problem', ''));
        list.append(row);
        return [file, { given, remove, hint }] as const;
    }));

    function setFile(file: LocalDataSetFile, blob: File | null): void {
        if (blob) files[file] = blob;
        else delete files[file];
        showFile(file, blob);
        changed(file);
    }
    function showFile(file: LocalDataSetFile, blob: File | null): void {
        const row = rows.get(file)!;
        row.given.textContent = blob ? `${blob.name}, ${blob.size.toLocaleString('en')} bytes` : row.hint;
        row.given.classList.toggle('has-file', blob !== null);
        row.remove.hidden = blob === null;
        baseBox.hidden = files['graphics.dat'] !== undefined;
    }
    for (const { file } of FILE_ROWS) showFile(file, null);

    name.addEventListener('input', () => {
        if (!idWritten) id.value = idFromName(name.value);
        changed('name');
    });
    id.addEventListener('input', () => {
        idWritten = id.value !== '';
        changed('id');
    });
    for (const field of [description, authors, dmRules]) field.addEventListener('input', () => changed(null));

    dialog.addEventListener('dragover', (event) => event.preventDefault());
    dialog.addEventListener('drop', (event) => {
        event.preventDefault();
        const unknown: string[] = [];
        for (const file of event.dataTransfer?.files ?? []) {
            const row = fileRow(file);
            if (row) setFile(row, file);
            else unknown.push(file.name);
        }
        dropped.textContent = unknown.length > 0 ? `Not one of a dungeon's files: ${unknown.join(', ')}.` : '';
    });

    form.addEventListener('submit', (event) => event.preventDefault());
    form.querySelector('#add-set-cancel')!.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', async () => {
        const made = record;
        if (!made) return;
        confirm.disabled = true;
        status.textContent = 'Adding…';
        try {
            await store(made);
        } catch (error) {
            status.textContent = `It could not be stored: ${error instanceof Error ? error.message : String(error)}`;
            confirm.disabled = false;
            return;
        }
        dialog.close();
        added(made);
    });
    dialog.addEventListener('close', () => dialog.remove());

    /** The check again, for a change of `field` (`null`: one with no check of its own). */
    function changed(field: LocalDataSetField | null): void {
        if (field) touched.add(field);
        const draft: LocalDataSetDraft = {
            id: id.value.trim(),
            name: name.value,
            description: description.value,
            authors: authors.value.split(','),
            dmRules: dmRules.checked,
            baseSet,
            files: { ...files },
        };
        const mine = ++generation;
        record = null;
        confirm.disabled = true;
        void checkLocalDataSet(draft, takenIds, base, Date.now()).then(({ problems, record: made }) => {
            if (mine !== generation) return;
            for (const element of form.querySelectorAll<HTMLElement>('[data-about]')) {
                const about = element.dataset.about as LocalDataSetField;
                const shown = touched.has(about) ? problems.filter((problem) => problem.about === about) : [];
                element.querySelector('.add-set-problem')!.textContent = shown.map((problem) => problem.text).join(' ');
                element.classList.toggle('has-problem', shown.length > 0);
            }
            const untouched = [...new Set(problems.filter((problem) => !touched.has(problem.about)).map((problem) => problem.about))];
            status.textContent = untouched.length > 0 ? `Still to give: ${untouched.map((about) => FIELD_NAMES[about]).join(', ')}.` : '';
            record = made;
            confirm.disabled = made === null;
        });
    }

    document.body.append(dialog);
    dialog.showModal();
    changed(null);
}

/** The row a dropped file goes to: its name's, whatever its case, or the thumbnail's for an image. */
function fileRow(file: File): LocalDataSetFile | null {
    const named = FILE_ROWS.find((row) => row.file !== 'thumbnail' && row.file.toLowerCase() === file.name.toLowerCase());
    if (named) return named.file;
    return file.type.startsWith('image/') ? 'thumbnail' : null;
}

/** An id made from `name`: lowercase, every run of other characters a '-', at most 40. */
export function idFromName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9._]+/g, '-').replace(/^[-._]+/, '').slice(0, 40).replace(/-+$/, '');
}

function button(label: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'add-set-button px px2';
    element.textContent = label;
    element.addEventListener('click', onClick);
    return element;
}

function text(tag: string, className: string, content: string): HTMLElement {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = content;
    return element;
}
