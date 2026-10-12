/**
 * The form that adds a player's own data set (`src/data/LocalDataSets.ts`), opened by the
 * welcome page's "+ Add my own" (`src/ui/welcomePage.ts`): a modal dialog in the page's
 * look (`welcomePage.css`), on one screen, in two columns under its title.
 *
 * - **The left column** is what the player gives: the name, the id (the `<id>` of
 *   `local:<id>`, made from the name until the player writes one), a short description,
 *   the authors, separated by commas, the reincarnation rule (`dmRules`), the graphics a
 *   dungeon without its own `graphics.dat` plays, DM's or CSB's, whichever the manifest
 *   has, and one area that takes the files: dropped there, several at once, or chosen in
 *   the picker a click on it opens. A file goes where its name says, whatever its case:
 *   `dungeon.dat`, `graphics.dat`, `CSBgraphics.dat`, the Hint Oracle's `hcsb.hct` and
 *   `hcsb.dat`; an image is the thumbnail. A file given again replaces the one before.
 *   Without a thumbnail, its row offers "Generate from data", which draws the one the site's
 *   sets have, the last frame of the title (`TitleThumbnail.ts`), from the set's own
 *   `graphics.dat` or its base set's.
 * - **The right column** is the checklist of everything the set has, `checkLocalDataSet`'s
 *   verdict on each, run at every change: a green check where it is given and right, a
 *   red cross where it is needed and missing, or wrong, and nothing where it is optional
 *   and absent. A wrong one says why under it; each row's tooltip says what it is. A given
 *   file can be removed from its row. Under it, what the dungeon holds, once its
 *   `dungeon.dat` reads (`dungeonCensus`, `src/engine/DungeonCensus.ts`): its levels, its
 *   items by kind, its monsters and their groups, and its DSAs with the operations they
 *   use, named in the row's tooltip. Under that, CANCEL and CONFIRM, which is enabled when
 *   nothing is wrong and writes the record the check made.
 */
import { folderFiles, type DataSetFiles } from '../data/DataSetFiles';
import { dataSetNamed, type DataSetManifest } from '../data/DataSets';
import { GraphicsLoader } from '../data/GraphicsLoader';
import { ITEM_KINDS, isIllegalSubcode, operationsUsed, type DungeonCensus } from '../engine/DungeonCensus';
import { StkOp } from '../engine/DsaSystem';
import { lastTitleFrame, thumbnailPng } from '../renderer/intro/TitleThumbnail';
import {
    checkLocalDataSet,
    type LocalDataSetDraft, type LocalDataSetField, type LocalDataSetFile, type LocalDataSetProblem, type LocalDataSetRecord,
} from '../data/LocalDataSets';

/** The sets a record without a `graphics.dat` may play the graphics of. */
const BASE_SETS = ['dm-atari', 'csb'];

/** A row of the checklist: the field or file it is about, and whether the set needs it. */
interface ChecklistRow {
    about: LocalDataSetField;
    label: string;
    needed: boolean;
    /** What it is, the row's tooltip. */
    hint: string;
}

const CHECKLIST: readonly ChecklistRow[] = [
    { about: 'name', label: 'Name', needed: true, hint: 'The name the welcome page shows.' },
    { about: 'id', label: 'Id', needed: true, hint: "Its place in the page's address and the key its saves are filed under: lowercase letters, digits, '.', '-' and '_'." },
    { about: 'dungeon.dat', label: 'dungeon.dat', needed: true, hint: 'The dungeon itself.' },
    { about: 'graphics.dat', label: 'graphics.dat', needed: true, hint: "The dungeon's graphics, or DM's or CSB's, chosen on the left." },
    { about: 'CSBgraphics.dat', label: 'CSBgraphics.dat', needed: false, hint: "CSBWin's extra graphics, for a dungeon made with them." },
    { about: 'hcsb.hct', label: 'hcsb.hct', needed: false, hint: "The Hint Oracle's hints, with hcsb.dat." },
    { about: 'hcsb.dat', label: 'hcsb.dat', needed: false, hint: "The Hint Oracle's program, with hcsb.hct." },
    { about: 'thumbnail', label: 'Thumbnail', needed: false, hint: "The welcome page's picture of it: an image, 320x200 at best, or the last frame of its title, drawn from its graphics." },
];

/** The files the drop area takes, by the name the game reads them under. */
const NAMED_FILES: readonly LocalDataSetFile[] = ['dungeon.dat', 'graphics.dat', 'CSBgraphics.dat', 'hcsb.hct', 'hcsb.dat'];

/** `doc/CSBwin-src/CSBCode.cpp:6796-6841`. */
const DM_RULES_HINT = 'Every reincarnation adds 12 random attribute points. Without DM rules, as in CSB, the '
    + 'attributes, HP, stamina and mana are first cut by a penalty, so a reincarnated champion ends weaker.';

const FORM = `
<form class="add-set-form">
  <h2 class="px" id="add-set-title">Add my own dungeon</h2>
  <div class="add-set-columns">
    <div class="add-set-give">
      <label class="add-set-field"><span class="px px2">Name</span>
        <input name="name" maxlength="60" autocomplete="off"></label>
      <label class="add-set-field"><span class="px px2">Id</span>
        <span class="add-set-id"><span class="px px2">local:</span><input name="id" maxlength="40" autocomplete="off" spellcheck="false"></span></label>
      <label class="add-set-field"><span class="px px2">Description</span>
        <textarea name="description" rows="2" maxlength="300"></textarea></label>
      <label class="add-set-field"><span class="px px2">Authors</span>
        <input name="authors" maxlength="200" placeholder="Separated by commas" autocomplete="off"></label>
      <label class="add-set-check" title="${DM_RULES_HINT}"><input type="checkbox" name="dmRules">
        <span>DM rules: reincarnation raises attributes</span></label>
      <fieldset class="add-set-base" title="The graphics a dungeon plays when it has no graphics.dat of its own">
        <legend class="px px2">Without graphics.dat</legend>
      </fieldset>
      <label class="add-set-drop" tabindex="0">
        <input type="file" multiple hidden>
        <span class="px px2">Drop files here</span>
      </label>
      <p class="add-set-dropped" aria-live="polite"></p>
    </div>
    <div class="add-set-have">
      <ul class="add-set-checklist" aria-label="What the dungeon has"></ul>
      <dl class="add-set-holds" aria-label="What the dungeon holds" hidden></dl>
      <div class="add-set-buttons">
        <button type="button" class="btn px" id="add-set-cancel">Cancel</button>
        <button type="button" class="btn px" id="add-set-confirm" disabled>Confirm</button>
      </div>
    </div>
  </div>
</form>`;

/**
 * Open the form over the welcome page. `takenIds` are the player's sets' ids, which a new
 * one may not take. CONFIRM calls `store` with the record; once it has stored it, the form
 * closes and calls `added`. An error `store` throws is shown under the checklist, and the
 * form stays.
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
    const dropped = form.querySelector<HTMLElement>('.add-set-dropped')!;
    const confirm = form.querySelector<HTMLButtonElement>('#add-set-confirm')!;
    const baseBox = form.querySelector<HTMLFieldSetElement>('.add-set-base')!;
    const drop = form.querySelector<HTMLElement>('.add-set-drop')!;
    const picker = drop.querySelector('input')!;
    const holds = form.querySelector<HTMLElement>('.add-set-holds')!;

    const files: Partial<Record<LocalDataSetFile, File>> = {};
    let idWritten = false;
    let record: LocalDataSetRecord | null = null;
    let generation = 0;
    /** Why the thumbnail could not be drawn, shown on its row until a thumbnail is given. */
    let drawFailure = '';
    let drawing = false;

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
            changed();
        });
        label.append(radio, text('span', '', set.name));
        baseBox.append(label);
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

    const checklist = form.querySelector('.add-set-checklist')!;
    const rows = new Map(CHECKLIST.map((row) => {
        const item = document.createElement('li');
        item.dataset.about = row.about;
        const mark = text('span', 'add-set-mark', '');
        mark.setAttribute('aria-hidden', 'true');
        const given = text('span', 'add-set-given', '');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'add-set-remove';
        remove.textContent = '×';
        remove.title = `Remove ${row.label}`;
        remove.setAttribute('aria-label', remove.title);
        remove.addEventListener('click', () => {
            delete files[row.about as LocalDataSetFile];
            changed();
        });
        const problem = text('span', 'add-set-problem', '');
        item.append(mark, text('span', 'px px2', row.label), given, remove, problem);
        checklist.append(item);
        return [row.about, { row, item, given, remove, problem }] as const;
    }));
    const generate = document.createElement('button');
    generate.type = 'button';
    generate.className = 'add-set-generate';
    generate.textContent = 'Generate from data';
    generate.title = "The last frame of the dungeon's title, drawn from its graphics";
    generate.addEventListener('click', async () => {
        const own = files['graphics.dat'];
        const set = baseSet;
        drawing = true;
        drawFailure = '';
        changed();
        try {
            const bytes = own ? new Uint8Array(await own.arrayBuffer()) : await base(set)?.read('graphics.dat');
            if (!bytes) throw new Error(`${set}'s graphics.dat could not be read`);
            const graphics = new GraphicsLoader();
            graphics.loadFromArray(bytes);
            const png = await thumbnailPng(await lastTitleFrame(graphics));
            // The graphics it was drawn from are still the set's, and no thumbnail came meanwhile.
            if (files['graphics.dat'] === own && (own || baseSet === set) && !files.thumbnail) {
                files.thumbnail = new File([png], 'title.png', { type: 'image/png' });
            }
        } catch (error) {
            drawFailure = `It could not be drawn: ${error instanceof Error ? error.message : String(error)}`;
        }
        drawing = false;
        changed();
    });

    /** The global line under the checklist: what `store` threw. */
    const failure = text('p', 'add-set-problem add-set-failure', '');
    checklist.after(failure);

    /** `list`'s files, each where its name says; the names of those that go nowhere are shown. */
    function take(list: Iterable<File>): void {
        const unknown: string[] = [];
        for (const file of list) {
            const where = fileRow(file);
            if (where) files[where] = file;
            else unknown.push(file.name);
            if (where === 'thumbnail') drawFailure = '';
        }
        dropped.textContent = unknown.length > 0 ? `Not one of a dungeon's files: ${unknown.join(', ')}.` : '';
        changed();
    }
    drop.addEventListener('dragover', (event) => {
        event.preventDefault();
        drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    dialog.addEventListener('dragover', (event) => event.preventDefault());
    dialog.addEventListener('drop', (event) => {
        event.preventDefault();
        drop.classList.remove('over');
        take(event.dataTransfer?.files ?? []);
    });
    drop.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            picker.click();
        }
    });
    picker.addEventListener('change', () => {
        take(picker.files ?? []);
        picker.value = '';
    });

    name.addEventListener('input', () => {
        if (!idWritten) id.value = idFromName(name.value);
        changed();
    });
    id.addEventListener('input', () => {
        idWritten = id.value !== '';
        changed();
    });
    for (const field of [description, authors, dmRules]) field.addEventListener('input', changed);

    form.addEventListener('submit', (event) => event.preventDefault());
    form.querySelector('#add-set-cancel')!.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', async () => {
        const made = record;
        if (!made) return;
        confirm.disabled = true;
        failure.textContent = '';
        try {
            await store(made);
        } catch (error) {
            failure.textContent = `It could not be stored: ${error instanceof Error ? error.message : String(error)}`;
            confirm.disabled = false;
            return;
        }
        dialog.close();
        added(made);
    });
    dialog.addEventListener('close', () => dialog.remove());

    /** The check again, after any change, and the checklist redrawn from its verdict. */
    function changed(): void {
        const ownGraphics = files['graphics.dat'] !== undefined;
        for (const radio of baseBox.querySelectorAll('input')) radio.disabled = ownGraphics;
        baseBox.classList.toggle('disabled', ownGraphics);
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
        void checkLocalDataSet(draft, takenIds, base, Date.now()).then(({ problems, record: made, census }) => {
            if (mine !== generation) return;
            for (const { row, item, given, remove, problem } of rows.values()) {
                // The graphics' problems are about the file or, without it, about the base set.
                const own = problems.filter((p) => p.about === row.about || (row.about === 'graphics.dat' && p.about === 'baseSet'));
                const value = valueOf(row.about, draft, files, bases.find((set) => set.id === baseSet)?.name ?? baseSet);
                const state = own.length > 0 ? 'wrong' : value !== null ? 'right' : row.needed ? 'wrong' : 'absent';
                item.className = state;
                // The name and the id are in their fields beside it.
                given.textContent = row.about === 'name' || row.about === 'id' ? '' : value ?? '';
                remove.hidden = !(row.about in files);
                // A needed field left empty is shown by its cross alone; anything else wrong says why.
                problem.textContent = value !== null || !row.needed ? own.map((p) => p.text).join(' ') : '';
                if (row.about === 'thumbnail' && value === null) {
                    // Drawn from graphics that read.
                    generate.disabled = drawing || problems.some((p) => p.about === 'graphics.dat' || p.about === 'baseSet');
                    given.replaceChildren(generate);
                    problem.textContent = drawFailure;
                }
                item.title = [row.hint, ...own.map((p: LocalDataSetProblem) => p.text)].join('\n');
            }
            holds.hidden = census === null;
            holds.replaceChildren(...(census ? censusRows(census) : []));
            record = made;
            confirm.disabled = made === null;
        });
    }

    document.body.append(dialog);
    dialog.showModal();
    changed();
}

/**
 * What the checklist shows `about` holds: a field's text, a file's name, the base set's
 * graphics for a set without its own; `null` where it holds nothing.
 */
function valueOf(about: LocalDataSetField, draft: LocalDataSetDraft, files: Partial<Record<LocalDataSetFile, File>>, baseName: string): string | null {
    if (about === 'name') return draft.name.trim() || null;
    if (about === 'id') return draft.id || null;
    if (about === 'baseSet') return null;
    const file = files[about];
    if (file) return file.name;
    return about === 'graphics.dat' ? `${baseName}'s` : null;
}

const ITEM_KIND_LABEL: Record<typeof ITEM_KINDS[number], string> = {
    weapons: 'Weapons', clothing: 'Clothing', scrolls: 'Scrolls', potions: 'Potions', containers: 'Containers', misc: 'Misc',
};

/** `census` as the form shows it: a term and its line for each of the levels, the items, the monsters and the DSAs. */
function censusRows(census: DungeonCensus): HTMLElement[] {
    const { dsa } = census;
    const used = operationsUsed(dsa);
    const illegal = [...dsa.operations.keys()].filter(isIllegalSubcode).length;
    const rows: [string, string | HTMLElement[], string?][] = [
        ['Levels', census.maps === census.levels ? `${census.levels}` : `${plural(census.maps, 'map')} on ${plural(census.levels, 'level')}`],
        ['Items', ITEM_KINDS.map((kind) => text('span', '', `${ITEM_KIND_LABEL[kind]} ${census.items[kind]}`))],
        ['Monsters', census.groups === 0 ? 'None'
            : `${census.monsters} in ${plural(census.groups, 'group')}, of ${plural(census.monsterTypes, 'kind')}`],
        ['DSAs', dsa.dsas === 0 ? 'None' : [
            `${dsa.dsas}, ${plural(dsa.programs, 'program')} calling ${plural(used.length, 'operation')}`,
            dsa.undecoded > 0 ? `${plural(dsa.undecoded, 'program')} that do not decode` : '',
            illegal > 0 ? `${plural(illegal, 'illegal subcode')}` : '',
        ].filter(Boolean).join('; '), used.map((op) => StkOp[op]).join(', ')],
    ];
    return rows.flatMap(([term, line, title]) => {
        const definition = text('dd', typeof line === 'string' ? '' : 'add-set-kinds', '');
        definition.append(...(typeof line === 'string' ? [line] : line));
        if (title) definition.title = title;
        return [text('dt', 'px px2', term), definition];
    });
}

/** `n` and `word`, made plural but for one. */
function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Where a file goes: the file of its name, whatever its case, or the thumbnail for an image. */
function fileRow(file: File): LocalDataSetFile | null {
    const named = NAMED_FILES.find((name) => name.toLowerCase() === file.name.toLowerCase());
    if (named) return named;
    return file.type.startsWith('image/') ? 'thumbnail' : null;
}

/** An id made from `name`: lowercase, every run of other characters a '-', at most 40. */
export function idFromName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9._]+/g, '-').replace(/^[-._]+/, '').slice(0, 40).replace(/-+$/, '');
}

function text(tag: string, className: string, content: string): HTMLElement {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = content;
    return element;
}
