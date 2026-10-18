/**
 * `POST api/data-sets/<id>` with a `multipart/form-data` body: a set's text and files edited
 * by a moderator, in the form its tile's pen opens on the welcome page
 * (`src/ui/addDataSetForm.ts`). `app.ts` takes the request, names its asker, refuses one who
 * does not moderate before it reads the body, and reads its form; this module decides. The
 * route's JSON body is a moderation's (`moderate.ts`).
 *
 * The form is a publish's (`publish.ts`) but for the id, the URL's: every text field, the
 * files that change, by the name the game reads them under, and `remove` (`EDIT_REMOVE_FIELD`)
 * once per file the set no longer has. Every other file of its folder stays as it is, those
 * the form does not know too (CSB's `mini.dat`, a readme). Any set is edited, pending,
 * approved or hidden, with an owner or none.
 *
 * The rules, in order, each answered with nothing changed:
 *
 *   403  an asker who is not a moderator, before the body is read (`app.ts`)
 *   413  a body over `MAX_PUBLISH_BYTES` (`app.ts`), or a file over `MAX_PUBLISHED_FILE_BYTES`
 *   400  a body that is not a form, a field missing, twice, of the wrong kind, unknown or
 *        too long, or a `remove` that names no file of a set, names one twice, or one given
 *   404  an id the table does not hold
 *   422  the set as it would be, its folder's files and the form's, fails the page's check,
 *        as a publish does
 *   409  another edit of the set wrote its new folder first
 *
 * A form that changes no file changes the row alone: its text and flags. One that does
 * writes a new folder, since a folder never changes once written, which `backup.ts` relies
 * on: the old one copied whole into `GAMEFILES_DIR/.<id>.<uuid>.partial/`, its links
 * followed, its removed files deleted, the form's written, its base set's `graphics.dat`
 * copied where it is left without one, then renamed `GAMEFILES_DIR/<dir>@<n>/`, `<n>` one
 * more than the old folder's, 2 after the first. No id holds an `@` (`LOCAL_ID_PATTERN`), so
 * no publish takes that name. Then the row: its `dir` the new folder, its flags following
 * from its files as a publish's do, and its walls the new `dungeon.dat`'s where one is
 * given (`DataSetStore.edit`). Then the old folder is deleted; one that will not go is
 * logged and left, a folder no row names. A player who loaded the set before plays its old
 * files until they load it again.
 *
 * A new `dungeon.dat` reaches no save already made, since a save holds its dungeon
 * (`DEBT.md` P11), and its walls replace the row's, so an import of a save of the old one
 * is no longer named after the set (`doc/SAVES.md`). The form says so before CONFIRM.
 *
 * 200 answers `{"id": "<id>"}`; a refusal `{"error": "<why>"}`, a 422 with the problems
 * too. No answer, and no log, holds the `playerId`. Each edit is notified (`notify.ts`), by
 * the moderator's name.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { LOCAL_DATA_SET_FILES } from '../src/data/DataSets.ts';
import type { DataSetStore, DataSetViewer } from './dataSets.ts';
import type { Notify } from './notify.ts';
import { checkSet, readSetForm, thumbnailFile, writeSetFiles, type CheckDataSet, type PublishAnswer } from './publish.ts';

/** What `editDataSet` needs of the server. */
export interface EditOptions {
    checkDataSet: CheckDataSet;
    dataSets: DataSetStore;
    gamefilesDir: string;
    notify: Notify;
    now: () => number;
}

/** `form`, sent by `viewer` about the set `id`, checked and, where it passes, done. */
export async function editDataSet(id: string, form: FormData, viewer: DataSetViewer, { checkDataSet, dataSets, gamefilesDir, notify, now }: EditOptions): Promise<PublishAnswer> {
    const refuse = (status: number, error: string): PublishAnswer => ({ status, body: { error } });

    if (!viewer.moderator) return refuse(403, 'Only a moderator may edit a set.');
    const edit = readSetForm(form, true);
    if ('status' in edit) return edit;
    const set = dataSets.read().dataSets.find((row) => row.id === id);
    if (!set) return refuse(404, 'The site has no set of this id.');

    const old = join(gamefilesDir, set.dir);
    const inFolder = (file: string) => (file === 'thumbnail' ? thumbnailFile(id) : file);
    const had: Partial<Record<string, File>> = {};
    for (const file of LOCAL_DATA_SET_FILES) {
        const bytes = await readFile(join(old, inFolder(file))).catch(() => null);
        if (bytes) had[file] = new File([new Uint8Array(bytes)], file, { type: file === 'thumbnail' ? 'image/png' : 'application/octet-stream' });
    }
    const files = { ...had, ...edit.files };
    for (const file of edit.remove) delete files[file];
    const changesFiles = Object.keys(edit.files).length > 0 || edit.remove.some((file) => had[file]);

    const checked = await checkSet({ ...edit, id, files }, checkDataSet, dataSets, gamefilesDir, now());
    if ('status' in checked) return checked;
    const { record, walls } = checked;

    let dir = set.dir;
    if (changesFiles) {
        const written = await writeNextFolder(gamefilesDir, id, set.dir, async (partial) => {
            for (const file of edit.remove) await rm(join(partial, inFolder(file)), { force: true });
            await writeSetFiles(partial, id, edit.files, edit.baseSet, dataSets, gamefilesDir);
        });
        if (written === null) return refuse(409, 'Another edit of the set was written first.');
        dir = written;
    }

    try {
        dataSets.edit(id, {
            name: record.name, description: record.description, authors: record.authors, dir,
            csbGraphics: files['CSBgraphics.dat'] !== undefined,
            hintOracle: files['hcsb.hct'] !== undefined && files['hcsb.dat'] !== undefined,
            dmRules: record.dmRules,
            thumbnailAsTitle: record.thumbnailAsTitle,
            walls: edit.files['dungeon.dat'] ? walls : null,
        });
    } catch (error) {
        if (dir !== set.dir) await rm(join(gamefilesDir, dir), { recursive: true, force: true });
        throw error;
    }
    if (dir !== set.dir) await deleteOldFolder(gamefilesDir, id, set.dir, dir, 'edited');
    console.log(`'${id}' edited${dir !== set.dir ? `, its files now in ${dir}` : ''}`);
    notify({ name: record.name, activity: 'edited', by: viewer.moderator.name, at: now() });
    return { status: 200, body: { id } };
}

/**
 * The set `id`'s folder `dir`, under `gamefilesDir`, written anew with `change` applied, since
 * a folder never changes once written: copied whole into `.<id>.<uuid>.partial/`, its links
 * followed, `change` made to the copy, then renamed `<dir>@<n>` (`nextDir`). The new folder's
 * name, or `null` where another change of the set renamed first; no `.partial` is left
 * either way. A moderator's edit of the set's files writes one, and a document added or
 * removed (`documents.ts`).
 */
export async function writeNextFolder(gamefilesDir: string, id: string, dir: string, change: (partial: string) => Promise<void>): Promise<string | null> {
    const next = nextDir(gamefilesDir, dir);
    const partial = join(gamefilesDir, `.${id}.${randomUUID()}.partial`);
    try {
        // Followed, a link would have the files written through it, into the old folder's.
        await cp(join(gamefilesDir, dir), partial, { recursive: true, dereference: true });
        await change(partial);
        try {
            await rename(partial, join(gamefilesDir, next));
        } catch {
            return null;
        }
    } finally {
        await rm(partial, { recursive: true, force: true });
    }
    return next;
}

/**
 * The set `id`'s old folder `old` deleted, once its row names `dir`, written by
 * `writeNextFolder`: one that will not go is logged, the set `done`, and left, a folder no
 * row names.
 */
export async function deleteOldFolder(gamefilesDir: string, id: string, old: string, dir: string, done: string): Promise<void> {
    try {
        await rm(join(gamefilesDir, old), { recursive: true, force: true });
    } catch (error) {
        console.error(`'${id}' ${done} into ${dir}, ${old} left (${error instanceof Error ? error.message : String(error)})`);
    }
}

/** The folder an edit of the files of the set in `dir` writes: `<dir>@<n>`, the first `<n>` past `dir`'s own that `gamefilesDir` does not hold. */
function nextDir(gamefilesDir: string, dir: string): string {
    const versioned = /^(.*)@(\d+)$/.exec(dir);
    const base = versioned ? versioned[1]! : dir;
    let n = versioned ? Number(versioned[2]) + 1 : 2;
    while (existsSync(join(gamefilesDir, `${base}@${n}`))) n++;
    return `${base}@${n}`;
}
