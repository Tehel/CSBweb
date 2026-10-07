/**
 * What `api/event` accepts (PLAN.md Phase 17, step 5): the events the page's `GameEvents`
 * sends (`src/ui/gameEvents.ts`), checked field by field and rebuilt from what passed, so
 * that nothing the server has not checked reaches the store. A modified page cannot store
 * free text: the player is a UUID, the build a short token, the set one of the manifest's,
 * every number an integer in its range, and a champion's name one of the set's mirrors,
 * or `null`.
 */

/** The largest body `api/event` reads. */
export const MAX_EVENT_BYTES = 4096;

const EVENT_TYPES = ['started', 'party', 'won', 'lost'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** `crypto.randomUUID()`'s form, which `playerId` draws. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A commit, or the image's `DMWEB_BUILD`. */
const BUILD = /^[0-9A-Za-z._-]{1,40}$/;
/** A party's slots. */
const MAX_CHAMPIONS = 4;
/** Fighter, ninja, priest and wizard. */
const MASTERIES = 4;
/** Bounds that hold any game, not CSBWin's: they only keep nonsense out. */
const MAX_MASTERY = 63;
const MAX_COORDINATE = 255;

export interface CheckedChampion {
    name: string | null;
    reincarnated?: true;
    masteries?: number[];
}

/** An event as it is stored: the page's fields, the payload rebuilt from what was checked. */
export interface CheckedEvent {
    type: EventType;
    player: string;
    set: string;
    playthrough: number;
    build: string;
    payload: Record<string, number | CheckedChampion[]>;
}

export interface EventRules {
    /** The manifest's data sets' ids. */
    sets: ReadonlySet<string>;
    /** The names of a set's mirrors: a champion named otherwise is stored as `null`. */
    mirrors: (set: string) => ReadonlySet<string>;
}

/** The event `body` holds, or why it is refused. */
export function checkEvent(body: string, rules: EventRules): CheckedEvent | string {
    let event: unknown;
    try {
        event = JSON.parse(body);
    } catch {
        return 'not JSON';
    }
    if (!isRecord(event)) return 'not an object';
    const { type, player, set, playthrough, build, payload } = event;
    if (!EVENT_TYPES.includes(type as EventType)) return 'unknown type';
    if (typeof player !== 'string' || !UUID.test(player)) return 'player is not a UUID';
    if (typeof set !== 'string' || !rules.sets.has(set)) return 'unknown set';
    if (!isInteger(playthrough, 0, 0xffffffff)) return 'bad playthrough';
    if (typeof build !== 'string' || !BUILD.test(build)) return 'bad build';
    if (!isRecord(payload)) return 'payload is not an object';

    const checked = checkPayload(type as EventType, payload, rules.mirrors(set));
    if (typeof checked === 'string') return checked;
    return { type: type as EventType, player, set, playthrough, build, payload: checked };
}

function checkPayload(type: EventType, payload: Record<string, unknown>, mirrors: ReadonlySet<string>): CheckedEvent['payload'] | string {
    if (type === 'started') return {};

    const champions = checkChampions(payload.champions, mirrors, type === 'won');
    if (typeof champions === 'string') return champions;
    if (type === 'party') return { champions };

    const { gameTime, playTime } = payload;
    if (!isInteger(gameTime, 0, Number.MAX_SAFE_INTEGER)) return 'bad gameTime';
    if (!isInteger(playTime, 0, Number.MAX_SAFE_INTEGER)) return 'bad playTime';
    if (type === 'won') return { gameTime, playTime, champions };

    const { level, x, y } = payload;
    if (!isInteger(level, 0, MAX_COORDINATE) || !isInteger(x, 0, MAX_COORDINATE) || !isInteger(y, 0, MAX_COORDINATE)) return 'bad square';
    return { gameTime, playTime, champions, level, x, y };
}

function checkChampions(champions: unknown, mirrors: ReadonlySet<string>, won: boolean): CheckedChampion[] | string {
    if (!Array.isArray(champions) || champions.length > MAX_CHAMPIONS) return 'bad champions';
    const checked: CheckedChampion[] = [];
    for (const champion of champions) {
        if (!isRecord(champion)) return 'bad champion';
        const { name, reincarnated, masteries } = champion;
        if (name !== null && typeof name !== 'string') return 'bad name';
        if (reincarnated !== undefined && reincarnated !== true) return 'bad reincarnated';
        const kept: CheckedChampion = { name: name !== null && mirrors.has(name) ? name : null };
        if (reincarnated) kept.reincarnated = true;
        if (won) {
            if (!Array.isArray(masteries) || masteries.length !== MASTERIES || !masteries.every((m) => isInteger(m, 0, MAX_MASTERY))) {
                return 'bad masteries';
            }
            kept.masteries = [...masteries];
        }
        checked.push(kept);
    }
    return checked;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * At most `limit` events per address in each window of `windowMs`, counted in memory. The
 * map is emptied at each new window, so it holds one window's addresses at most.
 */
export class RateLimit {
    private readonly counts = new Map<string, number>();
    private windowStart = -Infinity;
    private readonly limit: number;
    private readonly windowMs: number;

    constructor(limit: number, windowMs: number) {
        this.limit = limit;
        this.windowMs = windowMs;
    }

    allow(address: string, now: number): boolean {
        if (now - this.windowStart >= this.windowMs) {
            this.counts.clear();
            this.windowStart = now;
        }
        const count = (this.counts.get(address) ?? 0) + 1;
        this.counts.set(address, count);
        return count <= this.limit;
    }
}
