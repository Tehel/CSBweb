/**
 * What the server tells the moderators' phones: each change to the sets, through an ntfy
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
 * <who> is a moderator's name (`Moderator`, `dataSets.ts`), `its owner` for a set or a
 * recording withdrawn, and `a player` for a set published or a recording shared by one who
 * does not moderate: never a `playerId`. The
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

/** Tells someone of `event`, without waiting. */
export type Notify = (event: DataSetEvent) => void;

/** Tells no one: the server without `NTFY_URL`, and the dev server. */
export const NOBODY: Notify = () => {};

/** How long a message waits for ntfy's answer. */
const TIMEOUT_MS = 10_000;

/** The message `event` is. */
export function notificationText({ name, activity, document, recording, by, at }: DataSetEvent): string {
    const date = new Date(at);
    const two = (value: number) => String(value).padStart(2, '0');
    const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
    const what = document ?? recording;
    return `Dataset ${name}: ${activity}${what === undefined ? '' : ` (${what})`}\nBy ${by} at ${stamp}`;
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
