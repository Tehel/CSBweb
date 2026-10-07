/**
 * The game's events for the server's statistics (`PLAN.md` Phase 17, step 4): a game
 * started, a champion joined, a game won or lost. The engine sends nothing: the page
 * reports what its hooks see, and a failure to send is ignored, so nothing here delays or
 * breaks the game.
 *
 * Every event names the player (`playerId`), the data set, the game's playthrough
 * (`d.RandomGameID`, `doc/SAVES.md` → "A playthrough") and the build. Nothing else about
 * the player is sent: no name, no address, no browser fingerprint. A name typed on the
 * Reincarnate screen is the player's own text, so a champion is reported by the name of
 * their mirror (`JoinedChampion.mirror`), flagged when reincarnated. A champion this page
 * did not see join (a loaded game's, RISE's) has a name nobody vouched for, which is
 * reported only if it is one of the data set's mirrors (`mirrorNames`), and `null`
 * otherwise.
 */

import { DungeonLoader } from '../data/DungeonLoader';
import { extractPresetHeroes } from '../data/HeroExtractor';
import type { Game } from '../engine/Game';
import type { JoinedChampion } from '../engine/GameHost';
import type { Champion } from '../engine/gameTypes';
import { determineMastery } from '../engine/skills';

export type GameEventType = 'started' | 'party' | 'won' | 'lost';

/** What the page sends to `api/event`, as JSON. */
export interface GameEvent {
    type: GameEventType;
    player: string;
    set: string;
    playthrough: number;
    build: string;
    payload: StartedPayload | PartyPayload | WonPayload | LostPayload;
}

/** A champion as an event names them: by their mirror, or `null` for a name nobody vouched for. */
export interface ChampionReport {
    name: string | null;
    reincarnated?: true;
}

/** A champion of a won game, with the four masteries the won screen shows. */
export interface WonChampionReport extends ChampionReport {
    /** `DetermineMastery(chIdx, skill | 0xc000)` for fighter, ninja, priest and wizard. */
    masteries: number[];
}

export type StartedPayload = Record<string, never>;

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
    /** The names of the data set's mirrors (`mirrorNames`): read once, and awaited by each event. */
    mirrors: () => Promise<ReadonlySet<string>>;
    /** Where an event goes: `sendBeacon` in a production build, nowhere otherwise. */
    send: (event: GameEvent) => void;
}

export class GameEvents {
    /** The champions this page saw join, with their mirror's name. */
    private readonly joined = new WeakMap<Champion, JoinedChampion>();
    /** A new game has been read, whose first tick sends `started`. */
    private newGame = false;

    constructor(private readonly deps: GameEventsDeps) {}

    /** A new game has been read: the boot's, the end screen's, or RISE's adventure. */
    newGameRead(): void {
        this.newGame = true;
    }

    /** Any other game has been read: a save. */
    savedGameRead(): void {
        this.newGame = false;
    }

    /** The main loop's tick: a new game's first sends `started`. */
    tick(): void {
        if (!this.newGame) return;
        this.newGame = false;
        void this.emit('started', () => ({}));
    }

    /** `GameHost.championJoined`: the party as it now stands. */
    championJoined(joined: JoinedChampion): void {
        this.joined.set(joined.champion, joined);
        const champions = this.champions();
        void this.emit('party', (mirrors) => ({ champions: champions.map((c) => this.report(c, mirrors)) }));
    }

    /** `showEndOfGame`: the game is won or lost, its party and clock read now. */
    ended(won: boolean): void {
        const { party, state } = this.deps.game.ctx;
        const champions = this.champions();
        const duration: Duration = { gameTime: state.tickCount, playTime: this.deps.game.playTime() };
        const partySleeping = party.state.sleeping;
        const masteries = champions.map((champion) => [0, 1, 2, 3].map((skill) => determineMastery(champion, skill | 0xc000, { partySleeping })));
        const { x, y, z } = party.state.position;
        if (won) {
            void this.emit('won', (mirrors) => ({
                ...duration,
                champions: champions.map((c, i) => ({ ...this.report(c, mirrors), masteries: masteries[i]! })),
            }));
        } else {
            void this.emit('lost', (mirrors) => ({
                ...duration,
                champions: champions.map((c) => this.report(c, mirrors)),
                level: z, x, y,
            }));
        }
    }

    private champions(): Champion[] {
        return [...this.deps.game.ctx.party.state.champions];
    }

    private report(champion: Champion, mirrors: ReadonlySet<string>): ChampionReport {
        const joined = this.joined.get(champion);
        const name = joined?.mirror ?? champion.name;
        return {
            name: mirrors.has(name) ? name : null,
            ...(joined?.reincarnated ? { reincarnated: true as const } : {}),
        };
    }

    /**
     * The event, its common fields read now and its payload once the mirrors are known,
     * from what the caller read now: a champion may join while they are read.
     * Nothing it does can fail the game.
     */
    private async emit(type: GameEventType, payload: (mirrors: ReadonlySet<string>) => GameEvent['payload']): Promise<void> {
        try {
            const { set, build } = this.deps;
            const playthrough = this.deps.game.ctx.state.block1.randomGameID;
            const player = this.deps.player();
            const mirrors = await this.deps.mirrors().catch(() => new Set<string>());
            this.deps.send({ type, player, set, playthrough, build, payload: payload(mirrors) });
        } catch {
            // An event is never worth the game.
        }
    }
}

/** The names of the heroes behind `dungeonDat`'s mirrors, the texts that read as one. */
export function mirrorNames(dungeonDat: Uint8Array, game: Game): Set<string> {
    const data = new DungeonLoader().loadDungeonDat(dungeonDat);
    return new Set(extractPresetHeroes(data, game.ctx.tables.textDecode)
        .filter((hero) => !hero.illegal)
        .map((hero) => hero.name));
}

const PLAYER_ID_KEY = 'dmweb_player_v1';

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

/** Where the page's events go: the server's `api/event`, by `sendBeacon`, its failure ignored. */
export function sendBeacon(event: GameEvent): void {
    try {
        navigator.sendBeacon('api/event', JSON.stringify(event));
    } catch {
        // An event is never worth the game.
    }
}
