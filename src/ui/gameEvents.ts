/**
 * The game's events for the server's statistics (`doc/STATISTICS.md`): a game
 * started or entered, a champion joined, a game won or lost. The engine sends nothing: the page
 * reports what its hooks see, and a failure to send is ignored, so nothing here delays or
 * breaks the game.
 *
 * Every event names the player (`playerId`), the data set, the game's playthrough
 * (`d.RandomGameID`, `doc/SAVES.md` → "A playthrough") and the build. Nothing else about
 * the player is sent: no address, no browser fingerprint. A champion goes by their name as
 * it stands, a reincarnated one's included, with the mirror's name REINCARNATE replaced where
 * the page saw it (`ChampionReport.hero`), and by their portrait's `charID` where the page
 * knows it (`ChampionReport.id`).
 *
 * The player can turn them off (`GameEventsDeps.enabled`): then nothing is read or sent,
 * the player's id not even drawn. Nor is anything for a player's own set
 * (`src/data/LocalDataSets.ts`), whose id the server would not take, nor for a game a
 * `?dev` teleport has touched (`GameEvents.teleported`).
 */

import { isLocalDataSetId } from '../data/LocalDataSets';
import type { Game } from '../engine/Game';
import type { JoinedChampion } from '../engine/GameHost';
import type { Champion } from '../engine/gameTypes';
import { determineMastery } from '../engine/skills';

export type GameEventType = 'started' | 'session' | 'party' | 'won' | 'lost';

/** What the page sends to `api/event`, as JSON. */
export interface GameEvent {
    type: GameEventType;
    player: string;
    set: string;
    playthrough: number;
    build: string;
    payload: StartedPayload | SessionPayload | PartyPayload | WonPayload | LostPayload;
}

/** A champion as an event names them. */
export interface ChampionReport {
    /** Their name as it stands: the mirror's, or the one typed on the Reincarnate screen. */
    name: string;
    /**
     * `AddCharacter`'s `charID` (`Champion.portraitGraphic`): a cell of graphic 26, or past
     * 23 a `CSBgraphics.dat` portrait. `null` for a champion read from a save, who carries
     * the portrait's pixels and no id, as in CSBWin. Stored, not used yet.
     */
    id: number | null;
    /** Joined in this page by REINCARNATE. */
    reincarnated?: true;
    /** A reincarnated champion's name before REINCARNATE, the mirror's, by which the statistics count them. */
    hero?: string;
}

/** A champion of a won game, with the four masteries the won screen shows. */
export interface WonChampionReport extends ChampionReport {
    /** `DetermineMastery(chIdx, skill | 0xc000)` for fighter, ninja, priest and wizard. */
    masteries: number[];
}

export type StartedPayload = Record<string, never>;

/**
 * A game entered: the play time it enters with (`Game.playTime`, ms), 0 for a new game and a
 * save's own for a save. The server keeps no row of it, only its week's count and the
 * game's largest play time.
 */
export interface SessionPayload {
    playTime: number;
}

/** The party once a champion has joined, in the order of its slots. */
export interface PartyPayload {
    champions: ChampionReport[];
}

/** How long the game took: `d.Time`, in ticks, and the player's time in it, in ms (`Game.playTime`). */
interface Duration {
    gameTime: number;
    playTime: number;
}

export interface WonPayload extends Duration {
    champions: WonChampionReport[];
}

/** A lost game, with where the party died: `party.state.position`. */
export interface LostPayload extends Duration {
    champions: ChampionReport[];
    level: number;
    x: number;
    y: number;
}

export interface GameEventsDeps {
    game: Game;
    /** The data set's id. */
    set: string;
    build: string;
    /** The player's id, read when an event is sent (`playerId`). */
    player: () => string;
    /** Whether events are sent, read at each one: the player's setting (`SettingsValues.statistics`). */
    enabled: () => boolean;
    /** Where an event goes: `sendBeacon` in a production build, nowhere otherwise. */
    send: (event: GameEvent) => void;
    /** The playthroughs a teleport has touched, which send nothing (`keptTeleportedPlaythroughs`). */
    teleported: TeleportedPlaythroughs;
}

export class GameEvents {
    /** The champions this page saw join by REINCARNATE, and the name their mirror gave them. */
    private readonly reincarnated = new WeakMap<Champion, string>();
    /** A new game has been read, whose first tick sends `started`. */
    private newGame = false;
    /** A game has been read, whose first tick sends `session` with this play time; `null` for none. */
    private entering: number | null = null;
    /** The playthroughs this page has sent a `session` of, or would have: one each. */
    private readonly entered = new Set<number>();

    constructor(private readonly deps: GameEventsDeps) {}

    /** A new game has been read: the boot's, the end screen's, or RISE's adventure. */
    newGameRead(): void {
        this.newGame = true;
        this.entering = this.deps.game.playTime();
    }

    /** Any other game has been read: a save, at the entrance or by CONTINUE. */
    savedGameRead(): void {
        this.newGame = false;
        this.entering = this.deps.game.playTime();
    }

    /**
     * The main loop's tick: a new game's first sends `started`, and the first after a read
     * sends `session`, once a page and playthrough, so that loads in a page count once.
     */
    tick(): void {
        if (this.newGame) {
            this.newGame = false;
            this.emit('started', () => ({}));
        }
        if (this.entering === null) return;
        const playTime = this.entering;
        this.entering = null;
        const playthrough = this.deps.game.ctx.state.block1.randomGameID;
        if (this.entered.has(playthrough)) return;
        this.entered.add(playthrough);
        this.emit('session', () => ({ playTime }));
    }

    /** `GameHost.championJoined`: the party as it now stands. */
    championJoined(joined: JoinedChampion): void {
        if (joined.reincarnated) this.reincarnated.set(joined.champion, joined.hero);
        this.emit('party', () => ({ champions: this.champions().map((c) => this.report(c)) }));
    }

    /**
     * The map dialog's teleport, on a `?dev` page, has moved the party: the game's
     * playthrough sends nothing more, in this page or a later one that reads a save of it.
     */
    teleported(): void {
        try {
            this.deps.teleported.add(this.deps.game.ctx.state.block1.randomGameID);
        } catch {
            // An event is never worth the game.
        }
    }

    /** `showEndOfGame`: the game is won or lost, its party and clock read now. */
    ended(won: boolean): void {
        this.emit(won ? 'won' : 'lost', () => {
            const { party, state } = this.deps.game.ctx;
            const duration: Duration = { gameTime: state.tickCount, playTime: this.deps.game.playTime() };
            const partySleeping = party.state.sleeping;
            const champions = this.champions();
            if (won) {
                return {
                    ...duration,
                    champions: champions.map((c) => ({
                        ...this.report(c),
                        masteries: [0, 1, 2, 3].map((skill) => determineMastery(c, skill | 0xc000, { partySleeping })),
                    })),
                };
            }
            const { x, y, z } = party.state.position;
            return { ...duration, champions: champions.map((c) => this.report(c)), level: z, x, y };
        });
    }

    private champions(): Champion[] {
        return [...this.deps.game.ctx.party.state.champions];
    }

    private report(champion: Champion): ChampionReport {
        const hero = this.reincarnated.get(champion);
        return {
            name: champion.name,
            id: champion.portraitGraphic ?? null,
            ...(hero !== undefined ? { reincarnated: true as const, hero } : {}),
        };
    }

    /** The event, read and sent now. Nothing it does can fail the game. */
    private emit(type: GameEventType, payload: () => GameEvent['payload']): void {
        try {
            const { set, build } = this.deps;
            if (isLocalDataSetId(set) || !this.deps.enabled()) return;
            const playthrough = this.deps.game.ctx.state.block1.randomGameID;
            if (this.deps.teleported.has(playthrough)) return;
            this.deps.send({ type, player: this.deps.player(), set, playthrough, build, payload: payload() });
        } catch {
            // An event is never worth the game.
        }
    }
}

/** The playthroughs a teleport has touched (`GameEvents.teleported`). */
export interface TeleportedPlaythroughs {
    has(playthrough: number): boolean;
    add(playthrough: number): void;
}

const TELEPORTED_KEY = 'csbweb_teleported_v1';
/** How many touched playthroughs are kept: the latest. */
const TELEPORTED_KEPT = 64;

/**
 * The playthroughs a teleport has touched, kept in `storage` (`csbweb_teleported_v1`, the
 * latest 64), so that a save of such a game sends nothing in a later page either; for
 * this page alone where there is no `storage`, or it refuses.
 */
export function keptTeleportedPlaythroughs(storage: Storage | null): TeleportedPlaythroughs {
    const page = new Set<number>();
    const kept = (): number[] => {
        try {
            const list: unknown = JSON.parse(storage?.getItem(TELEPORTED_KEY) ?? '[]');
            return Array.isArray(list) ? list.filter((p): p is number => typeof p === 'number') : [];
        } catch {
            return [];
        }
    };
    return {
        has: (playthrough) => page.has(playthrough) || kept().includes(playthrough),
        add: (playthrough) => {
            page.add(playthrough);
            try {
                storage?.setItem(TELEPORTED_KEY, JSON.stringify([...kept().filter((p) => p !== playthrough), playthrough].slice(-TELEPORTED_KEPT)));
            } catch {
                // This page's alone.
            }
        },
    };
}

const PLAYER_ID_KEY = 'csbweb_player_v1';

/**
 * The player's id: a `crypto.randomUUID()` drawn at first start and kept in
 * `localStorage`. A player who clears it gets a new one, and a page that cannot keep it
 * draws one for itself: the id counts players, it does not know them.
 */
export function playerId(): string {
    try {
        const kept = localStorage.getItem(PLAYER_ID_KEY);
        if (kept) return kept;
        const drawn = crypto.randomUUID();
        localStorage.setItem(PLAYER_ID_KEY, drawn);
        return drawn;
    } catch {
        return pagePlayerId ??= crypto.randomUUID();
    }
}

let pagePlayerId: string | undefined;

/**
 * The player's id where one is kept, without drawing one: what the page sends to
 * `api/data-sets` (`PLAYER_ID_HEADER`, `src/data/DataSets.ts`), so that the server offers
 * the player their own pending sets. It is sent whatever the statistics setting, since it
 * says who owns a set, not what they play, and the server stores nothing of that request.
 */
export function keptPlayerId(): string | null {
    try {
        return localStorage.getItem(PLAYER_ID_KEY) || null;
    } catch {
        return pagePlayerId ?? null;
    }
}

/** Where the page's events go: the server's `api/event`, by `sendBeacon`, its failure ignored. */
export function sendBeacon(event: GameEvent): void {
    try {
        navigator.sendBeacon('api/event', JSON.stringify(event));
    } catch {
        // An event is never worth the game.
    }
}
