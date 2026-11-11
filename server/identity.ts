/**
 * The players' identities (`doc/ACHIEVEMENTS.md` → "Identity"): a public name, its public
 * id, and the `playerId`s that share it, in the store's `identities`, `identity_players`
 * and `retired_names` tables (`store.ts`). `app.ts` takes each request, names its asker
 * (`dataSetViewer`) and reads its body; this module decides.
 *
 *   GET  PROFILE_ROUTE            what the server holds of the asker (`profileText`)
 *   POST PROFILE_ROUTE            a name chosen, a browser linked, a key drawn (`changeProfile`)
 *   POST IDENTITIES_ROUTE/<id>    a name reset by a moderator (`resetName`)
 *
 * A **public name** is what the Hall of Fame will show (phase 18.6): 3 to 16 ASCII letters,
 * digits, `-`, `_` and `.`, words a single space apart (`publicNameProblem`), unique
 * regardless of case (the column's `NOCASE`). Its **public id**, ten characters of
 * Crockford's base 32 drawn by the server (`PUBLIC_ID`), is what the Hall's pages will link
 * by, and never changes. A `playerId` belongs to one identity at most, and an identity to
 * as many as are linked to it: the first chose its name, and the others gave its
 * **identity key**, 25 characters of the same alphabet, some 125 bits, drawn at the name's
 * choice and answered that once. The server keeps only its SHA-256: a key so drawn needs
 * no salt nor a slow hash to stand against a guess, and a store that leaks gives none away.
 * A key drawn again (`key`) refuses the old one. A browser linked to another identity
 * leaves its own, which keeps its name and its other browsers.
 *
 * A moderator resets a name: the identity keeps its id, its key and its browsers, and has
 * no name until its player chooses another; the name reset is retired, refused to everyone
 * from then on.
 *
 * Every answer is JSON, and none holds a `playerId`, which is the player's secret
 * (`dataSets.ts`): an identity answers with its name, its id and how many browsers share it.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

import {
    IDENTITY_ALPHABET, IDENTITY_KEY_LENGTH, identityKeyOf, PROFILE_ACTIONS, PUBLIC_ID, publicNameProblem,
    type PlayerProfile, type ProfileAction, type ProfileIdentity, type ProfileState,
} from '../src/data/DataSets.ts';
import { samePlayerId, type DataSetStore, type DataSetViewer } from './dataSets.ts';
import type { ProofStore } from './proofs.ts';
import type { RecordingStore } from './recordings.ts';
import type { StatsStore } from './stats.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS identities (
    id           TEXT    PRIMARY KEY,                  -- the public id (PUBLIC_ID)
    name         TEXT    UNIQUE COLLATE NOCASE,        -- the public name, NULL once a moderator reset it
    key_hash     TEXT    NOT NULL UNIQUE,              -- the identity key's SHA-256, hexadecimal
    created_at   INTEGER NOT NULL                      -- ms since the epoch
);
CREATE TABLE IF NOT EXISTS identity_players (
    player       TEXT    PRIMARY KEY,                  -- a playerId
    identity     TEXT    NOT NULL REFERENCES identities (id)
);
CREATE INDEX IF NOT EXISTS identity_players_by_identity ON identity_players (identity);
CREATE TABLE IF NOT EXISTS retired_names (
    name         TEXT    PRIMARY KEY COLLATE NOCASE    -- a name a moderator reset: nobody's again
);
`;

/** The largest body `POST PROFILE_ROUTE` and `POST IDENTITIES_ROUTE/<id>` read. */
export const MAX_PROFILE_BYTES = 1024;

/** An identity: its public id and its name, `null` once a moderator reset it. */
export interface Identity {
    id: string;
    name: string | null;
}

/** `length` characters of `IDENTITY_ALPHABET`, each of 5 random bits: 256 is a multiple of 32, so each is as likely. */
function drawn(length: number): string {
    return [...randomBytes(length)].map((byte) => IDENTITY_ALPHABET[byte & 31]).join('');
}

/** What the store keeps of a key: its SHA-256, of the key as `identityKeyOf` reads it. */
function keyHash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
}

export class IdentityStore {
    private readonly db: DatabaseSync;
    private readonly ofPlayer: StatementSync;
    private readonly byId: StatementSync;
    private readonly byKey: StatementSync;
    private readonly playersOf: StatementSync;
    private readonly named: StatementSync;
    private readonly retired: StatementSync;
    private readonly insert: StatementSync;
    private readonly join: StatementSync;
    private readonly updateName: StatementSync;
    private readonly updateKey: StatementSync;
    private readonly retire: StatementSync;
    private readonly now: () => number;

    constructor(db: DatabaseSync, now: () => number = Date.now) {
        this.db = db;
        this.now = now;
        db.exec(SCHEMA);
        this.ofPlayer = db.prepare('SELECT i.id, i.name FROM identity_players p JOIN identities i ON i.id = p.identity WHERE p.player = ?');
        this.byId = db.prepare('SELECT id, name FROM identities WHERE id = ?');
        this.byKey = db.prepare('SELECT id, name FROM identities WHERE key_hash = ?');
        this.playersOf = db.prepare('SELECT player FROM identity_players WHERE identity = ? ORDER BY player');
        this.named = db.prepare('SELECT id FROM identities WHERE name = ?');
        this.retired = db.prepare('SELECT 1 FROM retired_names WHERE name = ?');
        this.insert = db.prepare('INSERT INTO identities (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)');
        this.join = db.prepare('INSERT INTO identity_players (player, identity) VALUES (?1, ?2) ON CONFLICT (player) DO UPDATE SET identity = ?2');
        this.updateName = db.prepare('UPDATE identities SET name = ? WHERE id = ?');
        this.updateKey = db.prepare('UPDATE identities SET key_hash = ? WHERE id = ?');
        this.retire = db.prepare('INSERT INTO retired_names (name) VALUES (?) ON CONFLICT DO NOTHING');
    }

    /** The identity `player` is linked to, or `null`. */
    of(player: string): Identity | null {
        return (this.ofPlayer.get(player) as Identity | undefined) ?? null;
    }

    get(id: string): Identity | null {
        return (this.byId.get(id) as Identity | undefined) ?? null;
    }

    /** The `playerId`s linked to the identity `id`. Never answered. */
    players(id: string): string[] {
        return (this.playersOf.all(id) as { player: string }[]).map((row) => row.player);
    }

    /** Why `name`, in any case, is not free for the identity `self` (`null` for a new one): another's, or retired; `null` where it is free. */
    taken(name: string, self: string | null): 'taken' | 'retired' | null {
        if (this.retired.get(name) !== undefined) return 'retired';
        const holder = this.named.get(name) as { id: string } | undefined;
        return holder !== undefined && holder.id !== self ? 'taken' : null;
    }

    /** A new identity named `name`, `player` its first browser, and its key, which the store does not keep. */
    create(player: string, name: string): { identity: Identity; key: string } {
        const key = drawn(IDENTITY_KEY_LENGTH);
        // Ten characters of 32: a draw the table holds is unlikely, and drawn again.
        let id = drawn(10).toLowerCase();
        while (this.get(id) !== null) id = drawn(10).toLowerCase();
        this.transaction(() => {
            this.insert.run(id, name, keyHash(key), this.now());
            this.join.run(player, id);
        });
        return { identity: { id, name }, key };
    }

    rename(id: string, name: string): void {
        this.updateName.run(name, id);
    }

    /** `player` linked to the identity whose key `key` is, as `identityKeyOf` reads it, leaving any other: that identity, or `null` for a key that is none's. */
    link(player: string, key: string): Identity | null {
        const identity = (this.byKey.get(keyHash(key)) as Identity | undefined) ?? null;
        if (identity !== null) this.join.run(player, identity.id);
        return identity;
    }

    /** A new key for the identity `id`, the old one refused from then on. */
    newKey(id: string): string {
        const key = drawn(IDENTITY_KEY_LENGTH);
        this.updateKey.run(keyHash(key), id);
        return key;
    }

    /** The identity `id`'s name taken off and retired. */
    reset(id: string): void {
        this.transaction(() => {
            const identity = this.get(id);
            if (identity?.name) this.retire.run(identity.name);
            this.updateName.run(null, id);
        });
    }

    private transaction(change: () => void): void {
        this.db.exec('BEGIN');
        try {
            change();
            this.db.exec('COMMIT');
        } catch (error) {
            if (this.db.isTransaction) this.db.exec('ROLLBACK');
            throw error;
        }
    }
}

/** What `profileText` reads. */
export interface ProfileSources {
    identities: IdentityStore;
    dataSets: DataSetStore;
    recordings: RecordingStore;
    stats: StatsStore;
    proofs: ProofStore;
}

/** The `playerId`s `player` speaks for: their identity's, or theirs alone. */
function playersOf(identities: IdentityStore, player: string): { identity: Identity | null; players: string[] } {
    const identity = identities.of(player);
    return { identity, players: identity === null ? [player] : identities.players(identity.id) };
}

/**
 * The answer to `GET PROFILE_ROUTE` for `player`, a `playerId`: everything the server holds
 * of them and of the other browsers their identity links (`PlayerProfile`). Their identity;
 * the sets they published, whatever their state; the recordings they shared, and how many
 * of them are listed; their `started`, `won` and `lost` events by set, which the statistics
 * log keeps with their `playerId` (`StatsStore.playerCounts`); and their achievements, those
 * a replay of their proofs verified (`ProofStore.verifiedBy`), by set, each once, the first
 * verified first. A set the table no longer holds goes by its id.
 */
export function profileText(player: string, { identities, dataSets, recordings, stats, proofs }: ProfileSources): string {
    const { identity, players } = playersOf(identities, player);
    const theirs = (owner: string | null) => owner !== null && players.some((one) => samePlayerId(one, owner));
    const sets = dataSets.read().dataSets;
    const nameOf = (id: string) => sets.find((set) => set.id === id)?.name ?? id;
    const state = (item: { pending: boolean; hidden: boolean }): ProfileState => item.pending ? 'pending' : item.hidden ? 'hidden' : 'approved';
    const shared = recordings.uploadedBy(players);
    const profile: PlayerProfile = {
        identity: identity && { ...identity, browsers: players.length },
        dataSets: sets.filter((set) => theirs(set.owner)).map((set) => ({ id: set.id, name: set.name, state: state(set) })),
        recordings: shared.map((recording) => ({
            id: recording.id, dataSet: recording.dataSet, name: nameOf(recording.dataSet), title: recording.title,
            state: state(recording), broken: recording.broken, uploadedAt: recording.uploadedAt,
        })),
        replays: shared.filter((recording) => !recording.pending && !recording.hidden && !recording.broken).length,
        statistics: stats.playerCounts(players).map((row) => ({ ...row, name: nameOf(row.dataSet) })),
        achievements: achievementsBySet(proofs.verifiedBy(players), nameOf),
    };
    return JSON.stringify(profile);
}

/** `verified`, the achievements of a player's proofs verified, grouped by set, each set at its first. */
function achievementsBySet(verified: readonly { dataSet: string; achievement: string }[], nameOf: (id: string) => string): PlayerProfile['achievements'] {
    const bySet = new Map<string, string[]>();
    for (const { dataSet, achievement } of verified) {
        const unlocked = bySet.get(dataSet) ?? [];
        unlocked.push(achievement);
        bySet.set(dataSet, unlocked);
    }
    return [...bySet].map(([dataSet, unlocked]) => ({ dataSet, name: nameOf(dataSet), unlocked }));
}

/** The status and the JSON body `POST PROFILE_ROUTE` and `POST IDENTITIES_ROUTE/<id>` answer with. */
export interface ProfileAnswer {
    status: number;
    body: ProfileIdentity | { id: string } | { error: string };
}

/** The keys each action's body holds, `action` among them, and nothing else. */
const FIELDS: Record<ProfileAction, readonly string[]> = { name: ['action', 'name'], link: ['action', 'key'], key: ['action'] };

/** The action `body` asks and its fields, or `null` where it is not one of `PROFILE_ACTIONS` with its fields alone, each a string. */
function profileRequest(body: string): { action: ProfileAction; fields: Record<string, string> } | null {
    let json: unknown;
    try {
        json = JSON.parse(body);
    } catch {
        return null;
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
    const fields = json as Record<string, unknown>;
    const action = fields.action as ProfileAction;
    if (!PROFILE_ACTIONS.includes(action)) return null;
    const keys = Object.keys(fields);
    if (keys.length !== FIELDS[action].length || !FIELDS[action].every((key) => typeof fields[key] === 'string')) return null;
    return { action, fields: fields as Record<string, string> };
}

/**
 * `POST PROFILE_ROUTE`: `body`, sent by `player`, checked and, where it passes, done. The
 * body is JSON, and nothing else:
 *
 *   {"action": "name", "name": …}  the name chosen: a new identity, `player` its first
 *                                  browser, 201 with its key; or the identity's renamed, 200
 *   {"action": "link", "key": …}   `player` linked to the identity of that key, 200
 *   {"action": "key"}              the identity's new key, the old refused from then, 200
 *
 * `app.ts` has counted it against its address's rate, named its player and read a body
 * of at most `MAX_PROFILE_BYTES`. The rules, in order, each answered with nothing changed:
 *
 *   400  a body that is not one of those; a name `publicNameProblem` refuses, saying why;
 *        a key that is none's form (`identityKeyOf`)
 *   403  a key that is no identity's
 *   409  a name another identity holds, in any case, or a moderator retired; a new key
 *        asked of a browser no identity links
 *
 * 200 or 201 answers the identity (`ProfileIdentity`), with its key where one was drawn; a
 * refusal `{"error": "<why>"}`.
 */
export function changeProfile(body: string, player: string, identities: IdentityStore): ProfileAnswer {
    const refuse = (status: number, error: string): ProfileAnswer => ({ status, body: { error } });
    const request = profileRequest(body);
    if (request === null) return refuse(400, `The body is not {"action": "name", "name": …}, {"action": "link", "key": …} or {"action": "key"}.`);
    const own = identities.of(player);
    if (request.action === 'name') {
        const name = request.fields.name!;
        const problem = publicNameProblem(name);
        if (problem !== null) return refuse(400, problem);
        const taken = identities.taken(name, own?.id ?? null);
        if (taken === 'retired') return refuse(409, 'A moderator has withdrawn this name.');
        if (taken === 'taken') return refuse(409, 'This name is taken.');
        if (own !== null) {
            identities.rename(own.id, name);
            return { status: 200, body: { id: own.id, name } };
        }
        const { identity, key } = identities.create(player, name);
        return { status: 201, body: { ...identity, key } };
    }
    if (request.action === 'link') {
        const key = identityKeyOf(request.fields.key!);
        if (key === null) return refuse(400, 'This is not an identity key.');
        const identity = identities.link(player, key);
        return identity === null ? refuse(403, 'This key is no name\'s.') : { status: 200, body: identity };
    }
    if (own === null) return refuse(409, 'No name is chosen here.');
    return { status: 200, body: { ...own, key: identities.newKey(own.id) } };
}

/**
 * `POST IDENTITIES_ROUTE/<id>`: `body`, sent by `viewer` about the identity `id`, checked
 * and, where it passes, done. The body is `{"action": "reset"}` and nothing else. The
 * rules, in order, each answered with nothing changed: 413 a body over `MAX_PROFILE_BYTES`
 * (`app.ts`); 400 another body; 404 an id the table does not hold; 403 an asker who is not
 * a moderator; 409 an identity with no name. 200 answers `{"id": "<id>"}`.
 */
export function resetName(id: string, body: string, viewer: DataSetViewer, identities: IdentityStore): ProfileAnswer {
    const refuse = (status: number, error: string): ProfileAnswer => ({ status, body: { error } });
    let action: unknown = null;
    try {
        const json: unknown = JSON.parse(body);
        if (typeof json === 'object' && json !== null && !Array.isArray(json) && Object.keys(json).length === 1) action = (json as { action?: unknown }).action;
    } catch {
        // Refused below.
    }
    if (action !== 'reset') return refuse(400, 'The body is not {"action": "reset"}.');
    const identity = PUBLIC_ID.test(id) ? identities.get(id) : null;
    if (identity === null) return refuse(404, 'The site has no name of this id.');
    if (viewer.moderator === null) return refuse(403, 'Only a moderator may reset a name.');
    if (identity.name === null) return refuse(409, 'This name is reset already.');
    identities.reset(id);
    console.log(`identity ${id} reset`);
    return { status: 200, body: { id } };
}
