/**
 * The proofs the page sends of its unlocks, and their verdicts (`doc/ACHIEVEMENTS.md` →
 * "Proofs"): the package of a point the store keeps (`RecordingPoints`, `RecordingPackage`)
 * sent to the server with the unlocks it claims (`POST PROOFS_ROUTE`), and the server's
 * verdicts asked for and written into the store's rows (`GET PROOFS_ROUTE`).
 *
 * A proof is sent only by a player with a public name (`ProofsDeps.named`), and claims the
 * rows of the playthrough that its history holds and no replay has verified
 * (`claimableRows`). Its replay also keeps its history's figures, which the Hall works the
 * achievements across games out of (`GameFigures`), so a proof is sent where they grew past
 * the last this page sent of the playthrough, though it claims nothing:
 *
 * - **at the game's end**, when it claims anything or its figures grew;
 * - **at a save**, when it claims an unlock no proof has claimed yet or its figures grew,
 *   and the last proof of the playthrough this page sent is `PROOF_INTERVAL_MS` old or more.
 *
 * Each row claimed keeps the proof's id (`AchievementRow.proofs`), and the playthrough's
 * figures row every proof sent of it (`AchievementFiguresRow.proofs`); `refresh` asks for the
 * verdicts of every row that awaits one, or of every proof sent, and writes them
 * (`judgedRows`), an unlock the replay granted unclaimed a row of its own (`grantedRows`).
 *
 * **Nothing in this file touches the DOM**: the page hands it the server's routes
 * (`src/main.ts`), and the tools a stand-in (`tools/checks/achievement-proofs.ts`).
 */
import {
  claimableRows, grantedRows, judgedRows, knownProofs, mergeFigures, pendingProofs, type AchievementRow, type AchievementStore,
} from '../../data/saves/AchievementStore';
import type { RecordingEntry, RecordingStore } from '../../data/saves/RecordingStore';
import type { SaveEntry, SaveStore } from '../../data/saves/SaveStore';
import { MAX_CLAIMS, type ProofVerdict } from '../../data/DataSets';
import { packageOfEnd, packageOfSave, writeRecordingPackage, type RecordingPackageText } from '../RecordingPackage';
import { pointInfo, pointMadeAt, pointPath, storedPoints, type StoredPoint } from '../RecordingPoints';
import type { GameFigures } from './AchievementState';
import type { PageAchievements } from './PageAchievements';

/** The least time between two proofs a page sends of one playthrough at its saves: ten minutes. */
export const PROOF_INTERVAL_MS = 10 * 60 * 1000;

/** What a proof's package says of itself: it is a proof, and its player's name is the server's to know. */
const PROOF_TEXT: RecordingPackageText = { title: 'Proof', author: '', description: '' };

/** What the page's proofs need of the page. */
export interface ProofsDeps {
    /** Whether this browser's player has a public name, as the server says. */
    named(): Promise<boolean>;
    /** `bytes`, a package, sent claiming `claims`: the proof's id, or a throw saying why not. */
    send(bytes: Uint8Array, claims: readonly string[]): Promise<string>;
    /** The verdicts of the proofs `ids` (`ProofVerdict`), those of this player's the server holds. */
    ask(ids: readonly string[]): Promise<readonly ProofVerdict[]>;
    /** The package of `point`, the store's (`storedPackage`). */
    packageOf(point: 'end' | SaveEntry): Promise<Uint8Array | null>;
    /** Milliseconds since the epoch. */
    now(): number;
    /** A line for the console, with the error, where a proof could not be sent. */
    log(message: string, error?: unknown): void;
}

/** What the proofs read of the page's achievements (`PageAchievements`). */
export type ProofsAchievements = Pick<PageAchievements, 'playthrough' | 'settled' | 'readProofs' | 'figuresOf'> & { readonly tracker: { readonly unlocked: ReadonlySet<string> } };

/** The stores a package is read from: the page's own (`src/main.ts`). */
export interface ProofSources {
    /** The game's recording written to its store up to now (`RecordingWriter.flush`). */
    flush(): Promise<void>;
    recordings: Pick<RecordingStore, 'list' | 'read'>;
    saves: Pick<SaveStore, 'list' | 'read'>;
}

/**
 * The package of `point` of the set `dataSet`, as the book's UPLOAD packs a browser's point
 * (`uploadPoint`, `src/ui/welcomePage.ts`): a save's, whose recording the store holds up to
 * its point, or, for `'end'`, the latest game's end the store keeps of the set. `null` where
 * the store holds no such point: a save made before its recording was written, a page
 * closed before its write.
 */
export async function storedPackage(point: 'end' | SaveEntry, dataSet: string, sources: ProofSources): Promise<Uint8Array | null> {
    await sources.flush();
    const rows: RecordingEntry[] = await sources.recordings.list();
    const points = storedPoints(point === 'end' ? [] : [point], rows, dataSet);
    const stored: StoredPoint | undefined = point === 'end'
        ? points.filter((one) => one.kind === 'end').sort((a, b) => pointMadeAt(b) - pointMadeAt(a))[0]
        : points.find((one) => one.kind === 'save');
    if (!stored) return null;
    const path = await pointPath(sources.recordings, stored);
    const { recordedAt, endedAt, playTime, champions } = pointInfo(stored, path, rows);
    const times = { recordedAt, endedAt, playTime, ...(champions ? { champions } : {}) };
    return writeRecordingPackage(stored.kind === 'save'
        ? packageOfSave(path, stored.save.recording, await sources.saves.read(stored.save.id), PROOF_TEXT, times)
        : packageOfEnd(path, PROOF_TEXT, times));
}

/**
 * The verdicts of the proofs `store`'s rows of `dataSet` await, asked (`ask`) and written:
 * the rows they change or add. With `all`, those of every proof the browser sent of the set
 * (`knownProofs`), since a replay again against the set's achievements as they now are
 * (`doc/ACHIEVEMENTS.md` → "An edit of a set's achievements") may have changed any: at the
 * page's start and as the book's ACHIEVEMENTS tab opens. A verdict's unlock granted
 * unclaimed adds a row (`grantedRows`). Nothing is asked where none awaits one.
 */
export async function refreshVerdicts(
    store: Pick<AchievementStore, 'list' | 'update' | 'unlock' | 'figures'>, ask: ProofsDeps['ask'], dataSet: string, all = false,
): Promise<AchievementRow[]> {
    const [rows, figures] = await Promise.all([store.list(dataSet), store.figures(dataSet)]);
    const asked = all ? knownProofs(rows, figures) : pendingProofs(rows);
    if (asked.length === 0) return [];
    const verdicts: ProofVerdict[] = [];
    for (let at = 0; at < asked.length; at += MAX_CLAIMS) verdicts.push(...await ask(asked.slice(at, at + MAX_CLAIMS)));
    const keyOf = (row: AchievementRow) => `${row.playthrough}|${row.id}`;
    const granted = new Map(grantedRows(rows, figures, verdicts, dataSet).map((row) => [keyOf(row), row]));
    const held = new Set(rows.map(keyOf));
    const merged = [...rows.map((row) => granted.get(keyOf(row)) ?? row), ...[...granted.values()].filter((row) => !held.has(keyOf(row)))];
    const changed = new Map([...granted].filter(([key]) => held.has(key)));
    for (const row of judgedRows(merged, verdicts)) changed.set(keyOf(row), row);
    const added = [...granted.values()].filter((row) => !held.has(keyOf(row))).map((row) => changed.get(keyOf(row)) ?? row);
    for (const row of added) changed.delete(keyOf(row));
    await store.update([...changed.values()]);
    for (const row of added) await store.unlock(row);
    return [...changed.values(), ...added];
}

export class PageProofs {
    /** When this page last sent a proof of each playthrough. */
    private readonly sentAt = new Map<number, number>();
    /** The figures of the proofs this page sent of each playthrough, each key at the largest. */
    private readonly sentFigures = new Map<number, GameFigures>();
    /** The proofs under way, one at a time, which `settled` awaits. */
    private sending: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly achievements: ProofsAchievements,
        /** The data set the game runs on, its `DataSet.id`. */
        private readonly dataSet: string,
        private readonly store: AchievementStore,
        private readonly deps: ProofsDeps,
    ) {}

    /**
     * A save written (`GameSaves.onSaved`): its proof sent, where the history its row kept as
     * its file was made (`SaveEntry.achievements`) claims an unlock no proof has or has
     * figures grown, and none was sent of the playthrough for `PROOF_INTERVAL_MS`.
     */
    saved(entry: SaveEntry): Promise<void> {
        const unlocked = new Set(entry.achievements?.state.unlocked ?? []);
        const figures = entry.achievements ? this.achievements.figuresOf(entry.playthrough, entry.achievements.state) : {};
        return this.queue(async () => {
            const claims = await this.claims(entry.playthrough, unlocked);
            if (!claims.some((row) => !row.proofs?.length) && !this.grew(entry.playthrough, figures)) return;
            if (this.deps.now() - (this.sentAt.get(entry.playthrough) ?? -Infinity) < PROOF_INTERVAL_MS) return;
            await this.sendClaims(entry.playthrough, claims, figures, () => this.deps.packageOf(entry));
        });
    }

    /** The game's end (`showCredits`): its proof sent, where its history claims anything or has figures grown. */
    ended(): Promise<void> {
        const playthrough = this.achievements.playthrough;
        const unlocked = new Set(this.achievements.tracker.unlocked);
        const figures = this.achievements.figuresOf(playthrough, null);
        return this.queue(async () => {
            const claims = await this.claims(playthrough, unlocked);
            await this.sendClaims(playthrough, claims, figures, () => this.deps.packageOf('end'));
        });
    }

    /**
     * `bytes`, a package, sent claiming each of `ids` that the playthrough's rows hold, unless
     * a replay verified it: the proof's id, or `null` where nothing was sent. The probes'
     * (`tools/probe-frames.ts`), which send a corpus recording.
     */
    async send(bytes: Uint8Array, ids: readonly string[]): Promise<string | null> {
        const playthrough = this.achievements.playthrough;
        const rows = (await this.store.list(this.dataSet)).filter((row) => row.playthrough === playthrough && row.proof !== 'verified' && ids.includes(row.id));
        let id: string | null = null;
        await this.queue(async () => { id = await this.sendClaims(playthrough, rows, {}, async () => bytes); });
        return id;
    }

    /**
     * The verdicts the set's rows await, or with `all` those of every proof sent of the set
     * (`refreshVerdicts`), asked and written, and the dialog's read again: how many rows
     * changed or were added.
     */
    async refresh(all = false): Promise<number> {
        try {
            const changed = await refreshVerdicts(this.store, this.deps.ask, this.dataSet, all);
            if (changed.length > 0) await this.achievements.readProofs();
            return changed.length;
        } catch (error) {
            this.deps.log('The proofs\' verdicts could not be asked', error);
            return 0;
        }
    }

    /** The proofs under way, sent. */
    async settled(): Promise<void> {
        await this.sending;
    }

    private queue(work: () => Promise<void>): Promise<void> {
        const next = this.sending.then(work).catch((error) => this.deps.log('A proof could not be sent', error));
        this.sending = next;
        return next;
    }

    /** The rows a proof of `playthrough` claims, its history `unlocked`, once the unlocks so far are written. */
    private async claims(playthrough: number, unlocked: ReadonlySet<string>): Promise<AchievementRow[]> {
        await this.achievements.settled();
        return claimableRows(await this.store.list(this.dataSet), this.dataSet, playthrough, unlocked);
    }

    /** Whether `figures` of `playthrough` hold a key past the proofs this page sent of it. */
    private grew(playthrough: number, figures: GameFigures): boolean {
        const sent = this.sentFigures.get(playthrough) ?? {};
        return Object.entries(figures).some(([key, v]) => v > (sent[key] ?? 0));
    }

    /**
     * `claims` of `playthrough`, its history's figures `figures`, sent with the package
     * `packed` makes, by a player with a name, where it claims anything or the figures grew,
     * and the proof's id kept in each: the id, or `null`.
     */
    private async sendClaims(
        playthrough: number, claims: readonly AchievementRow[], figures: GameFigures, packed: () => Promise<Uint8Array | null>,
    ): Promise<string | null> {
        if ((claims.length === 0 && !this.grew(playthrough, figures)) || !await this.deps.named()) return null;
        const bytes = await packed();
        if (bytes === null) return null;
        const sent = claims.slice(0, MAX_CLAIMS);
        const id = await this.deps.send(bytes, sent.map((row) => row.id));
        this.sentAt.set(playthrough, this.deps.now());
        this.sentFigures.set(playthrough, mergeFigures(this.sentFigures.get(playthrough) ?? {}, figures));
        await this.store.raiseFigures({ dataSet: this.dataSet, playthrough, figures: {}, proofs: [id] });
        if (sent.length > 0) await this.store.update(sent.map((row) => ({ ...row, proofs: [...(row.proofs ?? []), id] })));
        return id;
    }
}
