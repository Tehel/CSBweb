/**
 * `POST api/data-sets/<id>`: a set moderated, from its tile on the welcome page
 * (`src/ui/welcomePage.ts`). `app.ts` takes the request, names its asker
 * (`dataSetViewer`) and reads its body; this module decides.
 *
 * The body is JSON, `{"action": "approve" | "reject" | "hide" | "show"}`, and nothing else:
 *
 *   approve  pending → approved
 *   reject   pending → gone: the row deleted, then its folder. The set's owner may send it
 *            too, to withdraw their own pending set.
 *   hide     approved → hidden: the welcome page's grid leaves it out but for a moderator,
 *            and `?dungeon=<id>` and CONTINUE play it all the same
 *   show     hidden → approved
 *
 * The rules, in order, each answered with nothing changed:
 *
 *   413  a body over `MAX_MODERATION_BYTES` (`app.ts`)
 *   400  a body that is not that JSON, or names another action
 *   404  an id the table does not hold
 *   403  an asker who is not a moderator, unless they are the set's owner rejecting it
 *        while it is pending; a malformed `playerId`, or none, is nobody's
 *   409  an action the set's state does not take: approve an approved set, reject an
 *        approved one, hide a pending or a hidden one, show one that is not hidden; and a
 *        reject of a set with no owner, the site's, or of the default set, whose folders
 *        are the author's, uploaded by hand
 *
 * Deleting an approved set, changing a set's files, taking an approval back, and the
 * order of the sets and the default are left to a moderator's hands on the VPS
 * (`doc/DEPLOYMENT.md` → "Moderating the sets").
 *
 * A reject deletes the row first, so the set is offered to nobody before its folder goes;
 * a folder that will not go is logged and left, a folder no row names, which the next
 * publish of its id is refused (`publish.ts`) and which can be deleted by hand.
 * `backup.ts` has copied it already, unless it was published since the last night.
 *
 * 200 answers `{"id": "<id>"}`; a refusal `{"error": "<why>"}`. No answer, and no log,
 * holds the `playerId`. Each change is notified (`notify.ts`), by the moderator's name, or as
 * withdrawn by its owner, a folder left or not. The page cannot be made to send one by another site's form: the
 * `X-Player-Id` header is not one a form sets, and a `fetch` that sets it is preflighted,
 * which the server answers 405, granting nothing.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { MODERATION_ACTIONS as ACTIONS, type ModerationAction } from '../src/data/DataSets.ts';
import { samePlayerId, type DataSetStore, type DataSetViewer } from './dataSets.ts';
import type { DataSetActivity, Notify } from './notify.ts';

/** The largest body `api/data-sets/<id>` reads. */
export const MAX_MODERATION_BYTES = 1024;

/** The state of a set each action takes. */
const TAKES: Record<ModerationAction, 'pending' | 'approved' | 'hidden'> = { approve: 'pending', reject: 'pending', hide: 'approved', show: 'hidden' };

/** Each action, done. */
const DONE: Record<ModerationAction, DataSetActivity> = { approve: 'approved', reject: 'rejected', hide: 'hidden', show: 'shown' };

/** The status and the JSON body `api/data-sets/<id>` answers with. */
export interface ModerationAnswer {
    status: number;
    body: { id: string } | { error: string };
}

/** What `moderateDataSet` needs of the server. */
export interface ModerationOptions {
    dataSets: DataSetStore;
    gamefilesDir: string;
    notify: Notify;
    /** The clock a notification is dated by. */
    now: () => number;
}

/** The action `body` names, or `null` where it is not `{"action": <one of ACTIONS>}` alone. */
export function moderationAction(body: string): ModerationAction | null {
    let json: unknown;
    try {
        json = JSON.parse(body);
    } catch {
        return null;
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
    const keys = Object.keys(json);
    const action = (json as { action?: unknown }).action;
    return keys.length === 1 && ACTIONS.includes(action as ModerationAction) ? action as ModerationAction : null;
}

/** `body`, sent by `viewer` about the set `id`, checked and, where it passes, done. */
export async function moderateDataSet(id: string, body: string, viewer: DataSetViewer, { dataSets, gamefilesDir, notify, now }: ModerationOptions): Promise<ModerationAnswer> {
    const refuse = (status: number, error: string): ModerationAnswer => ({ status, body: { error } });

    const action = moderationAction(body);
    if (action === null) return refuse(400, `The body is not {"action": ${ACTIONS.map((name) => `"${name}"`).join(' | ')}}.`);
    const stored = dataSets.read();
    const set = stored.dataSets.find((row) => row.id === id);
    if (!set) return refuse(404, 'The site has no set of this id.');
    const owns = viewer.playerId !== null && set.owner !== null && samePlayerId(set.owner, viewer.playerId);
    if (!viewer.moderator && !(owns && action === 'reject' && set.pending)) return refuse(403, 'Only a moderator may do this, or the owner withdraw their own pending set.');

    const state = set.pending ? 'pending' : set.hidden ? 'hidden' : 'approved';
    if (TAKES[action] !== state) return refuse(409, `The set is ${state}: only ${TAKES[action] === 'approved' ? 'an' : 'a'} ${TAKES[action]} set is ${DONE[action]}.`);
    if (action === 'reject' && (set.owner === null || set.id === stored.defaultId)) return refuse(409, 'The site\'s own sets are removed by hand.');

    const withdrawn = viewer.moderator === null;
    const activity = withdrawn ? 'withdrawn' : DONE[action];
    const notified = () => notify({ name: set.name, activity, by: viewer.moderator?.name ?? 'its owner', at: now() });
    if (action === 'approve') dataSets.approve(id);
    else if (action === 'hide' || action === 'show') dataSets.setHidden(id, action === 'hide');
    else {
        dataSets.remove(id);
        try {
            await rm(join(gamefilesDir, set.dir), { recursive: true, force: true });
        } catch (error) {
            console.error(`'${id}' ${activity}, its folder left (${error instanceof Error ? error.message : String(error)})`);
            notified();
            return { status: 200, body: { id } };
        }
    }
    console.log(`'${id}' ${activity}`);
    notified();
    return { status: 200, body: { id } };
}
