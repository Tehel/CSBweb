/**
 * What the server tells the author's phone: each change to the sets, through the VPS's ntfy
 * (`doc/DEPLOYMENT.md` → "Notifications"). A set published (`publish.ts`), approved,
 * rejected, withdrawn, hidden or shown (`moderate.ts`), or edited (`edit.ts`) is one message
 * of two lines:
 *
 *   Dataset <name>: <added | approved | rejected | withdrawn | shown | hidden | edited>
 *   By <who> at YYYYMMDD HH:mm
 *
 * <who> is a moderator's name (`Moderator`, `dataSets.ts`), `its owner` for a set withdrawn,
 * and `a player` for a set published by one who does not moderate: never a `playerId`. The
 * time is the server's local time, its `TZ`.
 *
 * A message is sent and forgotten: no request waits on ntfy, and one it refuses or does not
 * answer in `TIMEOUT_MS` is logged, `ntfy: …`, and dropped.
 */

/** What became of a set. */
export type DataSetActivity = 'added' | 'approved' | 'rejected' | 'withdrawn' | 'shown' | 'hidden' | 'edited';

/** A change to a set, as a notification says it. */
export interface DataSetEvent {
    /** The set's name, not its id. */
    name: string;
    activity: DataSetActivity;
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
export function notificationText({ name, activity, by, at }: DataSetEvent): string {
    const date = new Date(at);
    const two = (value: number) => String(value).padStart(2, '0');
    const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
    return `Dataset ${name}: ${activity}\nBy ${by} at ${stamp}`;
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
