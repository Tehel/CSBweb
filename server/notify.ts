/**
 * What the server tells the moderators' phones: each change to the sets and to the public
 * names, through an ntfy
 * (`doc/DEPLOYMENT.md` → "Notifications"). A set published (`publish.ts`), approved,
 * rejected, withdrawn, hidden or shown (`moderate.ts`), edited (`edit.ts`), or given or
 * relieved of a document (`documents.ts`), and a recording of a set's shared, approved,
 * hidden, shown, broken, deleted or withdrawn (`recordings.ts`), is one message of two lines:
 *
 *   Dataset <name>: <added | approved | rejected | withdrawn | shown | hidden | edited>
 *   By <who> at YYYYMMDD HH:mm
 *
 * or, for a document, `Dataset <name>: document <added | removed> (<file>)` first, and for a
 * recording, `Dataset <name>: recording <added | approved | …> (<title>)`.
 *
 * A public name chosen or changed by its player (`identity.ts`), so that a moderator sees
 * each name the Hall of Fame shows, or reset by a moderator, is one too:
 *
 *   Name <name>: <chosen | changed from <old> | reset> (public id <id>)
 *   By <who> at YYYYMMDD HH:mm
 *
 * <who> is a moderator's name (`Moderator`, `dataSets.ts`), `its owner` for a set or a
 * recording withdrawn, and `a player` for a set published, a recording shared or a name
 * chosen by one who does not moderate: never a `playerId`. The
 * time is the server's local time, its `TZ`.
 *
 * A message is sent and forgotten: no request waits on ntfy, and one it refuses or does not
 * answer in `TIMEOUT_MS` is logged, `ntfy: …`, and dropped.
 */

/** What became of a set. */
export type DataSetActivity = 'added' | 'approved' | 'rejected' | 'withdrawn' | 'shown' | 'hidden' | 'edited' | 'document added' | 'document removed'
    | `recording ${'added' | 'approved' | 'hidden' | 'shown' | 'broken' | 'deleted' | 'withdrawn'}`;

/** A change to a set, as a notification says it. */
export interface DataSetEvent {
    /** The set's name, not its id. */
    name: string;
    activity: DataSetActivity;
    /** The document's file, for a document added or removed. */
    document?: string;
    /** The recording's title, for a recording's activity. */
    recording?: string;
    /** Who did it: a moderator's name, `its owner` or `a player`. */
    by: string;
    /** When, as `Date.now()` gives it. */
    at: number;
}

/** A public name's change, as a notification says it. */
export interface IdentityEvent {
    /** The name: the new one, or the one reset. */
    name: string;
    activity: 'chosen' | 'changed' | 'reset';
    /** The name before, for a name changed. */
    was?: string;
    /** The identity's public id, which its page in the Hall of Fame is at. */
    publicId: string;
    /** Who did it: a moderator's name, or `a player`. */
    by: string;
    /** When, as `Date.now()` gives it. */
    at: number;
}

/** Tells someone of `event`, without waiting. */
export type Notify = (event: DataSetEvent | IdentityEvent) => void;

/** Tells no one: the server without `NTFY_URL`, and the dev server. */
export const NOBODY: Notify = () => {};

/** How long a message waits for ntfy's answer. */
const TIMEOUT_MS = 10_000;

/** The message `event` is. */
export function notificationText(event: DataSetEvent | IdentityEvent): string {
    const date = new Date(event.at);
    const two = (value: number) => String(value).padStart(2, '0');
    const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
    if ('publicId' in event) {
        const activity = event.activity === 'changed' ? `changed from ${event.was}` : event.activity;
        return `Name ${event.name}: ${activity} (public id ${event.publicId})\nBy ${event.by} at ${stamp}`;
    }
    const what = event.document ?? event.recording;
    return `Dataset ${event.name}: ${event.activity}${what === undefined ? '' : ` (${what})`}\nBy ${event.by} at ${stamp}`;
}

/**
 * Each event posted to the ntfy topic `url` (`https://<host>/<topic>`), with Basic
 * authentication where `user` is given.
 */
export function ntfyNotifier(url: string, user: string | null, password: string | null): Notify {
    const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8' };
    if (user !== null) headers.Authorization = `Basic ${Buffer.from(`${user}:${password ?? ''}`).toString('base64')}`;
    return (event) => {
        fetch(url, { method: 'POST', headers, body: notificationText(event), signal: AbortSignal.timeout(TIMEOUT_MS) })
            .then((response) => {
                if (!response.ok) console.error(`ntfy: '${event.name}' ${event.activity}, answered ${response.status}`);
            }, (error: unknown) => {
                console.error(`ntfy: '${event.name}' ${event.activity}, not sent (${error instanceof Error ? error.message : String(error)})`);
            });
    };
}
