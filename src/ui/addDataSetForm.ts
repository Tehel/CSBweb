/**
 * The form that adds a player's own data set (`src/data/LocalDataSets.ts`), opened by the
 * welcome page's "+ Add my own" (`src/ui/welcomePage.ts`): a modal dialog in the page's
 * look (`welcomePage.css`), on one screen, in two columns under its title.
 *
 * - **The left column** is what the player gives: the name, the id (the `<id>` of
 *   `local:<id>`, made from the name until the player writes one), a short description,
 *   the authors, separated by commas, the reincarnation rule (`dmRules`, DM's at first), to a
 *   moderator alone whether it is an official game, one of FTL's own (`official`, off at first), the graphics a
 *   dungeon without its own `graphics.dat` plays, DM's or CSB's, whichever the manifest
 *   has, and none where it has neither, which leaves a set its own to give, and one area that takes the files: dropped there, several at once, or chosen in
 *   the picker a click on it opens. An image is the thumbnail, if it is 320x200, the
 *   screen's size (`THUMBNAIL_WIDTH`): one of another size, or that does not read, is not
 *   taken, its row saying why, and any thumbnail given before stays. Any other file goes where
 *   what it holds says, whatever its name (`identifyLocalDataSetFile`): `dungeon.dat`,
 *   `graphics.dat`, `CSBgraphics.dat`, the Hint Oracle's `hcsb.hct` and `hcsb.dat`; one
 *   that reads as none of them goes where its name says, whatever its case, so that a
 *   broken file shows why on its row. A file given again replaces the one before. A PC
 *   `dungeon.dat`, little-endian, is taken as the Atari file it is the twin of
 *   (`recordFile`), and that is the file the record keeps.
 *   Without a thumbnail, its row offers "Generate from data", which draws the one the site's
 *   sets have, the last frame of the title (`TitleThumbnail.ts`), from the set's own
 *   `graphics.dat` or its base set's. With one, its row offers a checkbox in place of its
 *   file's name, which its tooltip says: off at first, it shows the thumbnail in place of
 *   the title's animation (`thumbnailAsTitle`).
 * - **The right column** is the checklist of everything the set has, `checkLocalDataSet`'s
 *   verdict on each, run at every change: a green check where it is given and right, a
 *   red cross where it is needed and missing, or wrong, and nothing where it is optional
 *   and absent. A wrong one says why under it; each row's tooltip says what it is. A given
 *   file can be removed from its row. Under it, what the dungeon holds, once its
 *   `dungeon.dat` reads (`dungeonCensus`, `src/engine/DungeonCensus.ts`): its levels, its
 *   items by kind, its monsters and their groups, and its DSAs with the operations they
 *   use, named in the row's tooltip. Under that, CANCEL and CONFIRM, which is enabled when
 *   nothing is wrong and writes the record the check made.
 *
 * The welcome page's pen on a local set's tile opens the form on its record, to edit it:
 * every field and file is the record's, and the record CONFIRM writes keeps its id and
 * when it was added. The id cannot be changed, since its saves are filed under it, and
 * `dungeon.dat` cannot be removed, only replaced. A new `dungeon.dat` gives the record a
 * new signature (`checkLocalDataSet`): the saves stored stay, and each loads its own
 * world, but an import is checked against the new one. DELETE, beside the title, asks
 * first: the confirmation says how many saves go with the set, where it has any, and
 * that the save menu's EXPORT keeps them. Its DELETE removes the record and every save
 * filed under its id; its CANCEL keeps both.
 *
 * PUBLISH, beside DELETE, offers the stored set to the site, pending a moderator's
 * approval (the welcome page's tick). It is enabled while the form shows the record as it is stored:
 * a change is CONFIRMed first. It sends the record to `api/data-sets` with the player's
 * `playerId`, as `server/publish.ts` reads it, the thumbnail as a PNG, and leaves the
 * record as it is. Once published, the form closes and the page shows the sets again,
 * asked for anew; a refusal is said under the checklist, a problem of the server's check
 * on its row, and the form stays.
 *
 * A moderator's pen on a published set's tile opens the form on the set as the site holds
 * it (`openPublishedSetForm`): its text, and the files of its folder, read by the welcome
 * page. The id is shown without `local:`, and cannot be changed, since its players' saves
 * are filed under it; `dungeon.dat` can only be replaced; there is no DELETE nor PUBLISH.
 * CONFIRM, enabled once something is changed and nothing is wrong, sends the edit to
 * `api/data-sets/<id>` (`server/edit.ts`): the text, the files that changed, and the names
 * of those removed. A new `dungeon.dat` is said under the checklist to reach no saved game
 * (`DEBT.md` P11). Once edited, the form closes and the page shows the sets again, asked
 * for anew; a refusal is said as PUBLISH's is, and the form stays.
 */
import { folderFiles, type DataSetFiles } from '../data/DataSetFiles';
import {
    DATA_SETS_ROUTE, dataSetNamed, EDIT_REMOVE_FIELD, LOCAL_DATA_SET_FILES, LOCAL_DATA_SET_PREFIX, LOCAL_DATA_SET_TEXT_LIMITS, PLAYER_ID_HEADER, PNG_HEAD_BYTES, pngSize,
    THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH, type DataSetManifest,
} from '../data/DataSets';
import { GraphicsLoader } from '../data/GraphicsLoader';
import { ITEM_KINDS, isIllegalSubcode, operationsUsed, type DungeonCensus } from '../engine/DungeonCensus';
import { StkOp } from '../engine/dsa/DsaTypes';
import { lastTitleFrame, thumbnailPng } from '../renderer/intro/TitleThumbnail';
import { recordFile, type LocalDataSetFile, type LocalDataSetRecord } from '../data/LocalDataSets';
import {
    checkLocalDataSet, identifyLocalDataSetFile,
    type LocalDataSetDraft, type LocalDataSetField, type LocalDataSetProblem,
} from '../engine/LocalDataSetCheck';
import { playerId } from './gameEvents';

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
    { about: 'thumbnail', label: 'Thumbnail', needed: false, hint: `The welcome page's picture of it: an image of ${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}, the screen's size, or the last frame of its title, drawn from its graphics.` },
];

/** The files the drop area takes by name, the name the game reads them under. */
const NAMED_FILES: readonly LocalDataSetFile[] = ['dungeon.dat', 'graphics.dat', 'CSBgraphics.dat', 'hcsb.hct', 'hcsb.dat'];

/** The thumbnail's checkbox. */
const AS_TITLE_HINT = "The game opens on this picture, faded in and out, in place of the title's animation.";

/** Under the checklist, where a published set's `dungeon.dat` is replaced. */
const NEW_DUNGEON_NOTE = 'Saved games keep the dungeon they were made in: the new dungeon.dat reaches new games only, '
    + 'and a save of the old one is no longer recognised as this dungeon\'s.';

/** The official game's checkbox, a moderator's. */
const OFFICIAL_HINT = "One of FTL's own games, listed on the welcome page with them, before the fans' dungeons.";

/** `doc/CSBwin-src/CSBCode.cpp:6796-6841`. */
const DM_RULES_HINT = 'Every reincarnation adds 12 random attribute points. Without DM rules, as in CSB, the '
    + 'attributes, HP, stamina and mana are first cut by a penalty, so a reincarnated champion ends weaker.';

const FORM = `
<form class="add-set-form">
  <div class="add-set-head">
    <h2 class="px" id="add-set-title">Add my own dungeon</h2>
    <span class="add-set-actions">
      <button type="button" class="add-set-publish px px2" hidden>Publish</button>
      <button type="button" class="add-set-delete px px2" hidden>Delete</button>
    </span>
  </div>
  <div class="add-set-columns">
    <div class="add-set-give">
      <label class="add-set-field"><span class="px px2">Name</span>
        <input name="name" maxlength="${LOCAL_DATA_SET_TEXT_LIMITS.name}" autocomplete="off"></label>
      <label class="add-set-field"><span class="px px2">Id</span>
        <span class="add-set-id"><span class="px px2">local:</span><input name="id" maxlength="40" autocomplete="off" spellcheck="false"></span></label>
      <label class="add-set-field"><span class="px px2">Description</span>
        <textarea name="description" rows="2" maxlength="${LOCAL_DATA_SET_TEXT_LIMITS.description}"></textarea></label>
      <label class="add-set-field"><span class="px px2">Authors</span>
        <input name="authors" maxlength="${LOCAL_DATA_SET_TEXT_LIMITS.authors}" placeholder="Separated by commas" autocomplete="off"></label>
      <label class="add-set-check" title="${DM_RULES_HINT}"><input type="checkbox" name="dmRules" checked>
        <span>DM rules: reincarnation raises attributes</span></label>
      <label class="add-set-check add-set-official" title="${OFFICIAL_HINT}" hidden><input type="checkbox" name="official">
        <span>Official game, one of FTL's own</span></label>
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

/** The confirmation DELETE opens. */
const CONFIRM_DELETE = `
<form class="add-set-form">
  <h2 class="px" id="delete-set-title"></h2>
  <p class="delete-set-text"></p>
  <div class="add-set-buttons">
    <button type="button" class="btn px" id="delete-set-cancel">Cancel</button>
    <button type="button" class="btn px" id="delete-set-confirm">Delete</button>
  </div>
</form>`;

/** A record the form is opened on, to edit it, and what deleting it takes. */
export interface EditedDataSet {
    record: LocalDataSetRecord;
    /** How many saves are filed under its id: deleting the set deletes them. */
    saves: number;
    /** Deletes the record and its saves. */
    remove: () => Promise<void>;
    /** Called once `remove` has deleted them, the form closed. */
    removed: () => void;
    /** Called once PUBLISH has published the set as `id`, the form closed. */
    published: (id: string) => void;
}

/** A record as the form edits it: a local set's, or a published set's, which has neither. */
type FormRecord = Omit<LocalDataSetRecord, 'dungeonSignature' | 'createdAt'> & { createdAt?: number };

/** A published set the form is opened on, by a moderator, to edit it on the site (`server/edit.ts`). */
export interface EditedPublishedSet {
    /**
     * Its text and the files of its folder, its id as the site's is, without `local:`, and
     * its `baseSet` `null` where the folder holds a `graphics.dat`.
     */
    record: FormRecord;
    /** Called once the site has taken the edit, the form closed. */
    edited: (id: string) => void;
}

/** Why a set was not stored, published or edited, and the problems the server's check found. */
interface Refusal {
    error: string;
    problems?: LocalDataSetProblem[];
}

/**
 * Open the form over the welcome page, on `edited`'s record where it is given. `takenIds`
 * are the player's other sets' ids, which a new one may not take. CONFIRM calls `store`
 * with the record; once it has stored it, the form closes and calls `added`. An error
 * `store` or `edited.remove` throws is shown under the checklist, and the form stays.
 */
export function openAddDataSetForm(
    manifest: DataSetManifest,
    takenIds: ReadonlySet<string>,
    store: (record: LocalDataSetRecord) => Promise<void>,
    added: (record: LocalDataSetRecord) => void,
    edited: EditedDataSet | null = null,
): void {
    const save = async (record: LocalDataSetRecord): Promise<Refusal | null> => {
        try {
            await store(record);
            return null;
        } catch (error) {
            return { error: `It could not be stored: ${error instanceof Error ? error.message : String(error)}` };
        }
    };
    openForm(manifest, takenIds, save, added, edited);
}

/** Open the form over the welcome page on `published`, a set of the site's a moderator edits. */
export function openPublishedSetForm(manifest: DataSetManifest, published: EditedPublishedSet): void {
    openForm(manifest, new Set(), null, () => {}, published);
}

/**
 * The form, adding a set or editing `edited`'s. CONFIRM calls `save` with the record, which
 * says why it was not saved, or `null`, and once it is, closes the form and calls `added`;
 * on a published set, `save` is `null`, and CONFIRM sends the edit to the site.
 */
function openForm(
    manifest: DataSetManifest,
    takenIds: ReadonlySet<string>,
    save: ((record: LocalDataSetRecord) => Promise<Refusal | null>) | null,
    added: (record: LocalDataSetRecord) => void,
    edited: EditedDataSet | EditedPublishedSet | null,
): void {
    /** The local set edited, its saves and actions. */
    const local = edited && 'remove' in edited ? edited : null;
    /** The published set edited. */
    const site = edited && !('remove' in edited) ? edited : null;
    const dialog = document.createElement('dialog');
    dialog.className = 'add-set';
    dialog.setAttribute('aria-labelledby', 'add-set-title');
    dialog.innerHTML = FORM;
    const form = dialog.querySelector('form')!;
    const input = (name: string): HTMLInputElement => form.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
    const [name, id, authors, dmRules, official] = ['name', 'id', 'authors', 'dmRules', 'official'].map(input);
    // Only a moderator says a set is official (`server/publish.ts`).
    official.closest('label')!.hidden = !manifest.moderator;
    const description = form.querySelector('textarea')!;
    /** On the thumbnail's row, in place of its name: `thumbnailAsTitle`. */
    const asTitle = document.createElement('input');
    asTitle.type = 'checkbox';
    asTitle.name = 'thumbnailAsTitle';
    const dropped = form.querySelector<HTMLElement>('.add-set-dropped')!;
    const confirm = form.querySelector<HTMLButtonElement>('#add-set-confirm')!;
    const baseBox = form.querySelector<HTMLFieldSetElement>('.add-set-base')!;
    const drop = form.querySelector<HTMLElement>('.add-set-drop')!;
    const picker = drop.querySelector('input')!;
    const holds = form.querySelector<HTMLElement>('.add-set-holds')!;

    const files: Partial<Record<LocalDataSetFile, File>> = {};
    const editing: FormRecord | null = edited?.record ?? null;
    let idWritten = editing !== null;
    let record: LocalDataSetRecord | null = null;
    /** The problems the server's check found in the set PUBLISH sent, shown until a change. */
    let refused: LocalDataSetProblem[] = [];
    /** The check's last verdict, which `draw` shows. */
    let verdict: { draft: LocalDataSetDraft; problems: LocalDataSetProblem[]; census: DungeonCensus | null } | null = null;
    let generation = 0;
    /** Why the last thumbnail given or drawn was not taken, shown on its row until one is taken or removed. */
    let thumbnailRefused = '';
    let drawing = false;

    const bases = BASE_SETS.flatMap((set) => dataSetNamed(manifest, set) ?? []);
    let baseSet = editing?.baseSet ?? bases[0]?.id ?? BASE_SETS[0];
    if (editing) {
        form.querySelector('#add-set-title')!.textContent = site ? 'Edit the published dungeon' : 'Edit my own dungeon';
        name.value = editing.name;
        id.value = site ? editing.id : editing.id.slice(LOCAL_DATA_SET_PREFIX.length);
        id.readOnly = true;
        id.title = site ? "The id stays: its players' saves are filed under it." : 'The id stays: its saves are filed under it.';
        if (site) form.querySelector<HTMLElement>('.add-set-id > span')!.hidden = true;
        description.value = editing.description;
        authors.value = editing.authors.join(', ');
        dmRules.checked = editing.dmRules;
        asTitle.checked = editing.thumbnailAsTitle;
        official.checked = editing.official;
        for (const [about, blob] of Object.entries(editing.files) as [LocalDataSetFile, Blob][]) {
            files[about] = blob instanceof File ? blob : new File([blob], about, { type: blob.type });
        }
    }
    /** The record's files as the form holds them: unchanged while each is the same object. */
    const storedFiles = { ...files };
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
    if (bases.length === 0) baseBox.remove();
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
            if (row.about === 'thumbnail') thumbnailRefused = '';
            changed();
        });
        const problem = text('span', 'add-set-problem', '');
        item.append(mark, text('span', 'px px2', row.label), given, remove, problem);
        checklist.append(item);
        return [row.about, { row, item, given, remove, problem }] as const;
    }));
    const asTitleLabel = document.createElement('label');
    asTitleLabel.className = 'add-set-check add-set-as-title';
    asTitleLabel.append(asTitle, text('span', '', 'As the title'));
    const generate = document.createElement('button');
    generate.type = 'button';
    generate.className = 'add-set-generate';
    generate.textContent = 'Generate from data';
    generate.title = "The last frame of the dungeon's title, drawn from its graphics";
    generate.addEventListener('click', async () => {
        const own = files['graphics.dat'];
        const set = baseSet;
        drawing = true;
        thumbnailRefused = '';
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
            thumbnailRefused = `It could not be drawn: ${error instanceof Error ? error.message : String(error)}`;
        }
        drawing = false;
        changed();
    });

    /** The global line under the checklist: why the set was not stored, published or edited. */
    const failure = text('p', 'add-set-problem add-set-failure', '');
    /** Under it, a published set's: what an edit does to its saved games. */
    const note = text('p', 'add-set-note', '');
    checklist.after(failure, note);

    /** `list`'s files, each where `fileRow` says, in turn; the names of those that go nowhere are shown. */
    async function take(list: Iterable<File>): Promise<void> {
        const unknown: string[] = [];
        for (const given of [...list]) {
            const file = await recordFile(given);
            const where = await fileRow(file);
            if (where === 'thumbnail') {
                thumbnailRefused = await thumbnailRefusal(file) ?? '';
                if (thumbnailRefused === '') files.thumbnail = file;
            }
            else if (where) files[where] = file;
            else unknown.push(file.name);
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
        void take(event.dataTransfer?.files ?? []);
    });
    drop.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            picker.click();
        }
    });
    picker.addEventListener('change', () => {
        void take([...picker.files ?? []]);
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
    for (const field of [description, authors, dmRules, official, asTitle]) field.addEventListener('input', changed);

    form.addEventListener('submit', (event) => event.preventDefault());
    form.querySelector('#add-set-cancel')!.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', async () => {
        const made = record;
        if (!made) return;
        confirm.disabled = true;
        failure.textContent = '';
        if (site) {
            const answer = await editRecord(site.record.id, made, baseSet, storedFiles);
            if ('id' in answer) {
                dialog.close();
                site.edited(answer.id);
                return;
            }
            failure.textContent = `It could not be edited: ${answer.error}`;
            refused = answer.problems ?? [];
            draw();
            return;
        }
        const refusal = await save!(made);
        if (refusal) {
            failure.textContent = refusal.error;
            confirm.disabled = false;
            return;
        }
        dialog.close();
        added(made);
    });
    dialog.addEventListener('close', () => dialog.remove());

    const publish = form.querySelector<HTMLButtonElement>('.add-set-publish')!;
    publish.hidden = local === null;
    publish.addEventListener('click', async () => {
        if (!local || !publishable()) return;
        publish.disabled = true;
        failure.textContent = '';
        const answer = await publishRecord(local.record, baseSet);
        if ('id' in answer) {
            dialog.close();
            local.published(answer.id);
            return;
        }
        failure.textContent = `It could not be published: ${answer.error}`;
        refused = answer.problems ?? [];
        draw();
    });

    const deleteButton = form.querySelector<HTMLButtonElement>('.add-set-delete')!;
    deleteButton.hidden = local === null;
    deleteButton.title = 'Delete this dungeon and its saves';
    deleteButton.addEventListener('click', () => {
        if (!local) return;
        failure.textContent = '';
        confirmDelete(local, dialog, (error) => {
            failure.textContent = `It could not be deleted: ${error instanceof Error ? error.message : String(error)}`;
        });
    });

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
            thumbnailAsTitle: asTitle.checked,
            official: official.checked,
            baseSet,
            files: { ...files },
        };
        const mine = ++generation;
        record = null;
        refused = [];
        confirm.disabled = true;
        publish.disabled = true;
        void checkLocalDataSet(draft, takenIds, base, editing?.createdAt ?? Date.now()).then(({ problems, record: made, census }) => {
            if (mine !== generation) return;
            verdict = { draft, problems, census };
            record = made;
            draw();
        });
    }

    /** The checklist, from the check's verdict and the server's refusal, and the buttons. */
    function draw(): void {
        if (!verdict) return;
        const { draft, census } = verdict;
        const problems = [...verdict.problems, ...refused];
        for (const { row, item, given, remove, problem } of rows.values()) {
            // The graphics' problems are about the file or, without it, about the base set.
            const own = problems.filter((p) => p.about === row.about || (row.about === 'graphics.dat' && p.about === 'baseSet'));
            const value = valueOf(row.about, draft, files, bases.find((set) => set.id === baseSet)?.name ?? baseSet);
            const state = own.length > 0 ? 'wrong' : value !== null ? 'right' : row.needed ? 'wrong' : 'absent';
            item.className = state;
            // The name and the id are in their fields beside it.
            given.textContent = row.about === 'name' || row.about === 'id' ? '' : value ?? '';
            // An edited set keeps a dungeon.dat: it can only be replaced.
            remove.hidden = !(row.about in files) || (editing !== null && row.about === 'dungeon.dat');
            // A needed field left empty is shown by its cross alone; anything else wrong says why.
            problem.textContent = value !== null || !row.needed ? own.map((p) => p.text).join(' ') : '';
            if (row.about === 'thumbnail' && value === null) {
                // Drawn from graphics that read.
                generate.disabled = drawing || problems.some((p) => p.about === 'graphics.dat' || p.about === 'baseSet');
                given.replaceChildren(generate);
            }
            // The checkbox needs the room: the file's name goes to the tooltip.
            if (row.about === 'thumbnail' && value !== null) {
                given.replaceChildren(asTitleLabel);
                asTitleLabel.title = `${AS_TITLE_HINT}\nThe thumbnail: ${value}`;
            }
            if (row.about === 'thumbnail') given.title = value ?? '';
            if (row.about === 'thumbnail') problem.textContent = [problem.textContent, thumbnailRefused].filter((t) => t !== '').join(' ');
            item.title = [row.hint, ...own.map((p: LocalDataSetProblem) => p.text)].join('\n');
        }
        holds.hidden = census === null;
        holds.replaceChildren(...(census ? censusRows(census) : []));
        // A published set is sent only once changed: every edit is notified.
        confirm.disabled = record === null || (site !== null && asStored());
        note.textContent = site && files['dungeon.dat'] !== storedFiles['dungeon.dat'] ? NEW_DUNGEON_NOTE : '';
        publish.disabled = !publishable();
        publish.title = publish.disabled ? 'CONFIRM the changes first: what is published is the set as it is stored'
            : "Offer it to the site, pending a moderator's approval";
    }

    /** Whether the check passed, and the form shows a local record as it is stored. */
    function publishable(): boolean {
        return local !== null && asStored();
    }

    /** Whether the check passed, and the form shows the record it was opened on as it is. */
    function asStored(): boolean {
        if (!editing || !record) return false;
        const sameFiles = LOCAL_DATA_SET_FILES.every((about) => files[about] === storedFiles[about]);
        return sameFiles && record.name === editing.name && record.description === editing.description
            && record.authors.join('\n') === editing.authors.join('\n') && record.dmRules === editing.dmRules
            && record.thumbnailAsTitle === editing.thumbnailAsTitle && record.official === editing.official
            && record.baseSet === editing.baseSet;
    }

    document.body.append(dialog);
    dialog.showModal();
    changed();
}

/** What the server answered a publish or an edit, as `server/publish.ts` says it, or why it could not be asked. */
type PublishAnswer = { id: string } | Refusal;

/** `record` sent to `api/data-sets` as `server/publish.ts` reads it, by the player whose `playerId` this is (`recordForm`). */
async function publishRecord(record: LocalDataSetRecord, baseSet: string): Promise<PublishAnswer> {
    const body = await recordForm(record, baseSet, {});
    if (!(body instanceof FormData)) return body;
    body.append('id', record.id);
    return post(DATA_SETS_ROUTE, body, 201);
}

/**
 * `record`, the published set `id` edited, sent to `api/data-sets/<id>` as
 * `server/edit.ts` reads it, by the moderator whose `playerId` this is: its fields, the
 * files that are not `stored`'s, and `remove` for each of `stored`'s it no longer has.
 */
async function editRecord(id: string, record: LocalDataSetRecord, baseSet: string, stored: Partial<Record<LocalDataSetFile, Blob>>): Promise<PublishAnswer> {
    const body = await recordForm(record, baseSet, stored);
    if (!(body instanceof FormData)) return body;
    for (const about of LOCAL_DATA_SET_FILES) if (stored[about] && !record.files[about]) body.append(EDIT_REMOVE_FIELD, about);
    return post(`${DATA_SETS_ROUTE}/${encodeURIComponent(id)}`, body, 200);
}

/**
 * `record`'s fields but its id, as the server reads a set's form, its files but those of
 * `unchanged`, by the name the game reads them under, and its thumbnail as a PNG. `baseSet`
 * is the form's, which the server takes whether or not the record has a `graphics.dat` of
 * its own.
 */
async function recordForm(record: LocalDataSetRecord, baseSet: string, unchanged: Partial<Record<LocalDataSetFile, Blob>>): Promise<FormData | PublishAnswer> {
    const body = new FormData();
    body.append('name', record.name);
    body.append('description', record.description);
    for (const author of record.authors) body.append('authors', author);
    body.append('dmRules', String(record.dmRules));
    body.append('thumbnailAsTitle', String(record.thumbnailAsTitle));
    body.append('official', String(record.official));
    body.append('baseSet', record.baseSet ?? baseSet);
    try {
        for (const [about, blob] of Object.entries(record.files) as [LocalDataSetFile, Blob][]) {
            if (blob === unchanged[about]) continue;
            body.append(about, about === 'thumbnail' ? await asPng(blob) : blob, about === 'thumbnail' ? 'thumbnail.png' : about);
        }
    } catch (error) {
        return { error: `the thumbnail cannot be made a PNG (${error instanceof Error ? error.message : String(error)}).` };
    }
    return body;
}

/** `body` posted to `route` by the player whose `playerId` this is, and what the server answered, `status` meaning done. */
async function post(route: string, body: FormData, status: number): Promise<PublishAnswer> {
    const response = await fetch(route, { method: 'POST', headers: { [PLAYER_ID_HEADER]: playerId() }, body }).catch(() => null);
    if (!response) return { error: 'the server cannot be reached.' };
    const answer = await response.json().catch(() => null) as PublishAnswer | null;
    if (response.status === status && answer && 'id' in answer) return answer;
    return answer && 'error' in answer ? answer : { error: `the server answered HTTP ${response.status}.` };
}

/**
 * Why `image` is not taken as a thumbnail: it does not read as an image, or is not
 * `THUMBNAIL_WIDTH`x`THUMBNAIL_HEIGHT`; `null` where it is taken.
 */
async function thumbnailRefusal(image: Blob): Promise<string | null> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(image);
    } catch {
        return 'It does not read as an image.';
    }
    const { width, height } = bitmap;
    bitmap.close();
    return width === THUMBNAIL_WIDTH && height === THUMBNAIL_HEIGHT ? null
        : `It is ${width}x${height}, not ${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}.`;
}

/** `image` as a PNG: itself where it is one, else drawn again and encoded. */
async function asPng(image: Blob): Promise<Blob> {
    if (pngSize(new Uint8Array(await image.slice(0, PNG_HEAD_BYTES).arrayBuffer())) !== null) return image;
    const bitmap = await createImageBitmap(image);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * The confirmation DELETE opens, over the form `form`: the set's name, how many of its
 * saves go with it, and CANCEL and DELETE. DELETE closes it and the form once
 * `edited.remove` has deleted them, and calls `edited.removed`; what it throws goes to
 * `failed`, the form staying.
 */
function confirmDelete(edited: EditedDataSet, form: HTMLDialogElement, failed: (error: unknown) => void): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'add-set delete-set';
    dialog.setAttribute('aria-labelledby', 'delete-set-title');
    dialog.innerHTML = CONFIRM_DELETE;
    dialog.querySelector('#delete-set-title')!.textContent = `Delete ${edited.record.name}?`;
    const { saves } = edited;
    dialog.querySelector('.delete-set-text')!.textContent = saves === 0
        ? 'It has no saved game.'
        : `Its ${saves === 1 ? 'saved game is' : `${saves} saved games are`} deleted with it. `
            + `To keep ${saves === 1 ? 'it' : 'them'}, play it first and EXPORT ${saves === 1 ? 'it' : 'each'} from the save menu.`;
    const remove = dialog.querySelector<HTMLButtonElement>('#delete-set-confirm')!;
    dialog.querySelector('#delete-set-cancel')!.addEventListener('click', () => dialog.close());
    remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
            await edited.remove();
        } catch (error) {
            dialog.close();
            failed(error);
            return;
        }
        dialog.close();
        form.close();
        edited.removed();
    });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
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

/**
 * Where a file goes: the thumbnail for an image; else the file it reads as
 * (`identifyLocalDataSetFile`), whatever its name; else the file of its name, whatever its case.
 */
async function fileRow(file: File): Promise<LocalDataSetFile | null> {
    if (file.type.startsWith('image/')) return 'thumbnail';
    return await identifyLocalDataSetFile(file) ?? NAMED_FILES.find((name) => name.toLowerCase() === file.name.toLowerCase()) ?? null;
}

/** An id made from `name`: lowercase, every run of other characters a '-', at most 40. */
function idFromName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9._]+/g, '-').replace(/^[-._]+/, '').slice(0, 40).replace(/-+$/, '');
}

function text(tag: string, className: string, content: string): HTMLElement {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = content;
    return element;
}
