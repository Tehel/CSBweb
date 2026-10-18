/**
 * `POST api/data-sets/<id>/documents`: a set's documents (`DataSetDocument`,
 * `src/data/DataSets.ts`), added and removed by a moderator from the book on its tile on the
 * welcome page (`src/ui/welcomePage.ts`). `app.ts` takes the request, names its asker,
 * refuses one who does not moderate before it reads the body, and reads it; this module
 * decides.
 *
 * A document is a file of the set's folder that the game never reads, a manual, a solution,
 * an author's notes, listed in `data_set_documents` (`dataSets.ts`), which `api/data-sets`
 * gives the page with its set. Any set of the table takes them, pending, approved or hidden,
 * with an owner or none.
 *
 *   a form, one file `file`   the file added as a document, under its own name
 *   `{"remove": "<file>"}`    the document `<file>` removed, its file deleted
 *
 * The rules, in order, each answered with nothing changed:
 *
 *   403  an asker who is not a moderator, before the body is read (`app.ts`)
 *   413  a form over `MAX_PUBLISH_BYTES`, or a JSON body over `MAX_MODERATION_BYTES` (`app.ts`)
 *   400  a body that is not a form of one file `file` or that JSON alone, or a file whose
 *        name is not a document's (`isDocumentName`) or is the set's thumbnail's
 *   404  an id the table does not hold, or a removal of a file that is not one of its documents
 *   409  a file of the name its folder holds already, a game file, a readme or a document;
 *        or another change of the set wrote its new folder first
 *
 * A change writes the set a new folder, as a moderator's edit of its files does, since a
 * folder never changes once written, which `backup.ts` relies on: the old one copied whole,
 * the file written or deleted, as `GAMEFILES_DIR/<dir>@<n>/` (`writeNextFolder`, `edit.ts`).
 * Then the row and the document's, in one transaction, and the old folder is deleted; one
 * that will not go is logged and left, a folder no row names. A moderator's edit carries the
 * documents to its new folder with every file its form does not know.
 *
 * 200 answers `{"id": "<id>"}`; a refusal `{"error": "<why>"}`. No answer, and no log, holds
 * the `playerId`. Each change is notified (`notify.ts`), by the moderator's name, the file
 * named.
 */
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DOCUMENT_EXTENSIONS, DOCUMENT_NAME_LIMIT, isDocumentName } from '../src/data/DataSets.ts';
import type { DataSetStore, DataSetViewer } from './dataSets.ts';
import { deleteOldFolder, writeNextFolder } from './edit.ts';
import type { ModerationAnswer } from './moderate.ts';
import type { Notify } from './notify.ts';
import { thumbnailFile } from './publish.ts';

/** The form's one field, the file added. */
export const DOCUMENT_FIELD = 'file';

/** What `addDocument` and `removeDocument` need of the server. */
export interface DocumentOptions {
    dataSets: DataSetStore;
    gamefilesDir: string;
    notify: Notify;
    /** The clock a notification is dated by. */
    now: () => number;
}

/** The file `body` names, or `null` where it is not `{"remove": "<file>"}` alone. */
export function documentRemoval(body: string): string | null {
    let json: unknown;
    try {
        json = JSON.parse(body);
    } catch {
        return null;
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
    const file = (json as { remove?: unknown }).remove;
    return Object.keys(json).length === 1 && typeof file === 'string' ? file : null;
}

/** `form`, sent by `viewer` to the set `id`, checked and, where it passes, its file added as a document. */
export async function addDocument(id: string, form: FormData, viewer: DataSetViewer, { dataSets, gamefilesDir, notify, now }: DocumentOptions): Promise<ModerationAnswer> {
    const refuse = (status: number, error: string): ModerationAnswer => ({ status, body: { error } });

    if (!viewer.moderator) return refuse(403, 'Only a moderator may add a document.');
    const values = form.getAll(DOCUMENT_FIELD);
    const file = values[0];
    if ([...form.keys()].some((key) => key !== DOCUMENT_FIELD) || values.length !== 1 || typeof file === 'string' || file === undefined) {
        return refuse(400, `The form is not one file '${DOCUMENT_FIELD}'.`);
    }
    const name = file.name;
    if (!isDocumentName(name)) {
        return refuse(400, `A document's name ends in ${DOCUMENT_EXTENSIONS.join(', ')}, is at most ${DOCUMENT_NAME_LIMIT} characters, starts with no '.' and holds no '/' or '\\'.`);
    }
    if (name === thumbnailFile(id)) return refuse(400, 'This is the name of the set\'s thumbnail.');
    const set = dataSets.read().dataSets.find((row) => row.id === id);
    if (!set) return refuse(404, 'The site has no set of this id.');
    if (existsSync(join(gamefilesDir, set.dir, name))) return refuse(409, 'The set\'s folder holds a file of this name already.');

    const bytes = new Uint8Array(await file.arrayBuffer());
    const dir = await writeNextFolder(gamefilesDir, id, set.dir, (partial) => writeFile(join(partial, name), bytes));
    if (dir === null) return refuse(409, 'Another change of the set was written first.');
    try {
        dataSets.addDocument(id, dir, { file: name, size: bytes.length });
    } catch (error) {
        await rm(join(gamefilesDir, dir), { recursive: true, force: true });
        throw error;
    }
    await deleteOldFolder(gamefilesDir, id, set.dir, dir, 'given a document');
    console.log(`'${id}' given the document '${name}', its files now in ${dir}`);
    notify({ name: set.name, activity: 'document added', document: name, by: viewer.moderator.name, at: now() });
    return { status: 200, body: { id } };
}

/** `body`, sent by `viewer` about the set `id`, checked and, where it passes, the document it names removed. */
export async function removeDocument(id: string, body: string, viewer: DataSetViewer, { dataSets, gamefilesDir, notify, now }: DocumentOptions): Promise<ModerationAnswer> {
    const refuse = (status: number, error: string): ModerationAnswer => ({ status, body: { error } });

    if (!viewer.moderator) return refuse(403, 'Only a moderator may remove a document.');
    const file = documentRemoval(body);
    if (file === null) return refuse(400, 'The body is not {"remove": "<file>"}.');
    const set = dataSets.read().dataSets.find((row) => row.id === id);
    if (!set) return refuse(404, 'The site has no set of this id.');
    // A name of the table's is a document's (`parseManifest`, `addDocument`), so it leaves no folder.
    if (!isDocumentName(file) || !set.documents.some((document) => document.file === file)) return refuse(404, 'The set has no document of this name.');

    const dir = await writeNextFolder(gamefilesDir, id, set.dir, (partial) => rm(join(partial, file), { force: true }));
    if (dir === null) return refuse(409, 'Another change of the set was written first.');
    try {
        dataSets.removeDocument(id, dir, file);
    } catch (error) {
        await rm(join(gamefilesDir, dir), { recursive: true, force: true });
        throw error;
    }
    await deleteOldFolder(gamefilesDir, id, set.dir, dir, 'relieved of a document');
    console.log(`'${id}' relieved of the document '${file}', its files now in ${dir}`);
    notify({ name: set.name, activity: 'document removed', document: file, by: viewer.moderator.name, at: now() });
    return { status: 200, body: { id } };
}
