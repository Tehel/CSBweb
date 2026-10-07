/**
 * The game's events for the server's statistics (`PLAN.md` Phase 17, step 4): a game
 * started, a champion joined, a game won or lost. The engine sends nothing: the page
 * reports what its hooks see, and a failure to send is ignored, so nothing here delays or
 * breaks the game.
 *
 * Every event names the player (`playerId`), the data set, the game's playthrough
 * (`d.RandomGameID`, `doc/SAVES.md` → "A playthrough") and the build. Nothing else about
 * the player is sent: no address, no browser fingerprint. A champion goes by their name as
 * it stands, a reincarnated one's included, and by their portrait's `charID` where the
 * page knows it (`ChampionReport.id`).
 */

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
    /** Where an event goes: `sendBeacon` in a production build, nowhere otherwise. */
    send: (event: GameEvent) => void;
}

export class GameEvents {
    /** The champions this page saw join by REINCARNATE. */
    private readonly reincarnated = new WeakSet<Champion>();
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
        this.emit('started', () => ({}));
    }

    /** `GameHost.championJoined`: the party as it now stands. */
    championJoined(joined: JoinedChampion): void {
        if (joined.reincarnated) this.reincarnated.add(joined.champion);
        this.emit('party', () => ({ champions: this.champions().map((c) => this.report(c)) }));
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
        return {
            name: champion.name,
            id: champion.portraitGraphic ?? null,
            ...(this.reincarnated.has(champion) ? { reincarnated: true as const } : {}),
        };
    }

    /** The event, read and sent now. Nothing it does can fail the game. */
    private emit(type: GameEventType, payload: () => GameEvent['payload']): void {
        try {
            const { set, build } = this.deps;
            const playthrough = this.deps.game.ctx.state.block1.randomGameID;
            this.deps.send({ type, player: this.deps.player(), set, playthrough, build, payload: payload() });
        } catch {
            // An event is never worth the game.
        }
    }
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

/** Where the page's events go: the server's `api/event`, by `sendBeacon`, its failure ignored. */
export function sendBeacon(event: GameEvent): void {
    try {
        navigator.sendBeacon('api/event', JSON.stringify(event));
    } catch {
        // An event is never worth the game.
    }
}
