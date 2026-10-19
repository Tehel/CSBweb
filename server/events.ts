/**
 * What `api/event` accepts (`doc/STATISTICS.md`): the events the page's `GameEvents`
 * sends (`src/ui/gameEvents.ts`), checked field by field and rebuilt from what passed, so
 * that nothing the server has not checked reaches the store. The player is a UUID, the
 * build a short token, the set one of the `data_sets` table's, every number an integer in its
 * range, and the only text a modified page could store is a champion's name, of 7
 * characters at most, each one the game's (`NAME`).
 */

/** The largest body `api/event` reads. */
export const MAX_EVENT_BYTES = 4096;

const EVENT_TYPES = ['started', 'session', 'party', 'won', 'lost'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** `crypto.randomUUID()`'s form, which `playerId` draws. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether `value` has a `playerId`'s form (`src/ui/gameEvents.ts`). */
export function isPlayerId(value: unknown): value is string {
    return typeof value === 'string' && UUID.test(value);
}
/** A commit, or the image's `CSBWEB_BUILD`. */
const BUILD = /^[0-9A-Za-z._-]{1,40}$/;
/** `CHARDESC.name[8]`, its last byte the terminating NUL (`doc/CSBwin-src/CSB.h:2545`). */
const MAX_NAME = 7;
/**
 * The characters a name is made of: A to Z and the space, as a mirror's names are, the
 * Reincarnate screen's `. , ; :` (`src/renderer/ui/ReIncarnate.ts`), and, for a name a save
 * edited elsewhere carries, the accented capitals (Latin-1's À to Ý), the digits and the
 * punctuation `! ? ' - /`. Never a control character, a bidi override, a NUL (which
 * `json_extract` cuts) or markup, which `api/stats` would publish.
 */
const NAME = /^[A-Z0-9À-ÖØ-Ý .,;:!?'\/-]+$/;
/** `AddCharacter`'s `charID`, an `i16` (`doc/CSBwin-src/Character.cpp:457`). */
const MAX_ID = 0x7fff;
/** A party's slots. */
const MAX_CHAMPIONS = 4;
/** Fighter, ninja, priest and wizard. */
const MASTERIES = 4;
/** Bounds that hold any game, not CSBWin's: they only keep nonsense out. */
const MAX_MASTERY = 63;
const MAX_COORDINATE = 255;

export interface CheckedChampion {
    name: string;
    id: number | null;
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
    /** Whether `id` is a known data set's (`DataSetStore.hasSet`, `dataSets.ts`). */
    hasSet(id: string): boolean;
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
    if (!isPlayerId(player)) return 'player is not a UUID';
    if (typeof set !== 'string' || !rules.hasSet(set)) return 'unknown set';
    if (!isInteger(playthrough, 0, 0xffffffff)) return 'bad playthrough';
    if (typeof build !== 'string' || !BUILD.test(build)) return 'bad build';
    if (!isRecord(payload)) return 'payload is not an object';

    const checked = checkPayload(type as EventType, payload);
    if (typeof checked === 'string') return checked;
    return { type: type as EventType, player, set, playthrough, build, payload: checked };
}

function checkPayload(type: EventType, payload: Record<string, unknown>): CheckedEvent['payload'] | string {
    if (type === 'started') return {};
    if (type === 'session') {
        const { playTime } = payload;
        if (!isInteger(playTime, 0, Number.MAX_SAFE_INTEGER)) return 'bad playTime';
        return { playTime };
    }

    const champions = checkChampions(payload.champions, type === 'won');
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

function checkChampions(champions: unknown, won: boolean): CheckedChampion[] | string {
    if (!Array.isArray(champions) || champions.length > MAX_CHAMPIONS) return 'bad champions';
    const checked: CheckedChampion[] = [];
    for (const champion of champions) {
        if (!isRecord(champion)) return 'bad champion';
        const { name, id, reincarnated, masteries } = champion;
        if (typeof name !== 'string' || [...name].length > MAX_NAME || !NAME.test(name) || name.trim() === '') return 'bad name';
        if (id !== null && !isInteger(id, 0, MAX_ID)) return 'bad id';
        if (reincarnated !== undefined && reincarnated !== true) return 'bad reincarnated';
        const kept: CheckedChampion = { name, id };
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
