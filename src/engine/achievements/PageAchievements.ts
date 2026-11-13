/**
 * The achievements of the game the player plays (`doc/ACHIEVEMENTS.md` → "The page"): the
 * tracker attached to the game, its history kept in each save's row (`GameSaves`), and
 * each unlock written to the store and shown, unless a teleport has touched the
 * playthrough. The page builds one for a game the player plays, never for a recording's
 * viewer (`src/main.ts`); the stand-in page builds one when its owner asks
 * (`StandInPage.track`).
 *
 * **Nothing in this file touches the DOM.**
 */
import { mergeFigures, type AchievementProof, type AchievementRow, type AchievementStore } from '../../data/saves/AchievementStore';
import type { Game } from '../Game';
import type { GameSaves } from '../GameSaves';
import { mergeAchievements, readAchievementFile, type AchievementDef } from './AchievementFile';
import { acrossUnlocked, type AchievementSnapshot, type GameFigures } from './AchievementState';
import { AchievementTracker, type PortraitSheet, type Unlock } from './AchievementTracker';
import type { AchievementSetFiles } from './DataCounts';

/** The VBLs a second, which the tracker counts the player's time in. */
const VBLS_PER_SECOND = 60;

/** The playthroughs a `?dev` teleport has touched (`keptTeleportedPlaythroughs`, `src/ui/gameEvents.ts`). */
export interface TouchedPlaythroughs {
  has(playthrough: number): boolean;
}

/** An unlock as the page shows it: the achievement, and its row once the store has it. */
export interface ShownUnlock {
  readonly def: AchievementDef;
  readonly unlock: Unlock;
}

/** The Dungeon Master sets, which all read `dm-atari.txt`: the Atari's, the Amiga's and the hidden ones. */
const DUNGEON_MASTER_SETS: ReadonlySet<string> = new Set([
  'dm-atari', 'dm-atari-1.0a', 'dm-atari-1.0b', 'dm-atari-1.1', 'dm-atari-1.2', 'dm-atari-1.2-de',
  'dm-atari-1.3-fr', 'dm-amiga', 'dm-windows', 'dm-minimum-item-picking',
]);

/**
 * The name of the project's own file of the set `setId`'s achievements,
 * `defs/<name>.txt` (`doc/ACHIEVEMENTS.md` → "The file"): `dm-atari` for every Dungeon
 * Master set, else the set's id, which has a file only where the project wrote one.
 */
export function achievementFileOf(setId: string): string {
  return DUNGEON_MASTER_SETS.has(setId) ? 'dm-atari' : setId;
}

/**
 * A set's achievements: `common`, the common file's text, merged with `own`, the set's own
 * file's (`mergeAchievements`), where it has one. A file that does not read throws, each
 * error with its line: the files are the project's, and a set's own is checked as it is
 * added (phase 18.7).
 */
export function setAchievementDefs(common: string, own: string | null): AchievementDef[] {
  const read = (text: string, what: string) => {
    const file = readAchievementFile(text);
    if (!file.ok) throw new Error(`${what} does not read: ${file.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`);
    return file.file;
  };
  return mergeAchievements(read(common, 'the common achievements'), own === null ? null : read(own, 'the set\'s achievements'));
}

export class PageAchievements {
  readonly tracker: AchievementTracker;
  private readonly byId: ReadonlyMap<string, AchievementDef>;
  private readonly shownListeners: ((shown: ShownUnlock) => void)[] = [];
  /** The writes under way, which `settled` awaits. */
  private writes: Promise<unknown> = Promise.resolve();
  /** The proof of each row of the set, by playthrough and id, as the store last said (`readProofs`). */
  private proofs = new Map<string, AchievementProof>();
  /** The set's achievements across games (`doc/ACHIEVEMENTS.md` → "Across games"). */
  private readonly across: readonly AchievementDef[];
  /** Each playthrough's figures of the set, as the store held them and this page has raised them since. */
  private readonly figures = new Map<number, Record<string, number>>();
  /** The achievements across games unlocked, in whichever playthrough. */
  private readonly acrossDone = new Set<string>();
  /** Whether the store's figures and rows have been read, before which nothing across games is tested. */
  private figuresRead = false;

  constructor(
    private readonly game: Game,
    /** The data set the game runs on, its `DataSet.id`, which each row names. */
    private readonly dataSet: string,
    readonly defs: readonly AchievementDef[],
    /** The set's object names (`d.ObjectNames`), which an event's `item` is. */
    objectNames: readonly string[],
    /** The set's champions' portraits, graphic 26, which tell a CSB adventure's prisoners (`AchievementTracker`). */
    portraits: PortraitSheet | null,
    private readonly store: AchievementStore,
    saves: GameSaves,
    private readonly touched: TouchedPlaythroughs,
    /** The set's dungeon files, which the counts are read from and a CSB adventure's start against (`AchievementTracker`). */
    files: AchievementSetFiles,
    /** A line for the console, with the error, where a row could not be written. */
    private readonly log: (message: string, error?: unknown) => void = () => {},
  ) {
    this.byId = new Map(defs.map((def) => [def.id, def]));
    this.tracker = new AchievementTracker(game, defs, objectNames, files, portraits);
    this.tracker.onUnlock((unlocks) => this.unlocked(unlocks));
    this.across = defs.filter((def) => def.across);
    if (this.across.length > 0) {
      this.tracker.onTested(() => this.tested());
      void this.readFigures();
    }
    this.tracker.attach();
    saves.trackAchievements(this.tracker);
    void this.readProofs();
  }

  /** The set's figures and its achievements across games already unlocked, read from the store. */
  private async readFigures(): Promise<void> {
    try {
      const [figures, rows] = await Promise.all([this.store.figures(this.dataSet), this.store.list(this.dataSet)]);
      for (const row of figures) this.figures.set(row.playthrough, mergeFigures(row.figures, this.figures.get(row.playthrough) ?? {}));
      const ids = new Set(this.across.map((def) => def.id));
      for (const row of rows) if (ids.has(row.id)) this.acrossDone.add(row.id);
      this.figuresRead = true;
      this.tested();
    } catch (error) {
      this.log('The achievements across games could not be read', error);
    }
  }

  /**
   * The conditions tested (`AchievementTracker.onTested`): the playthrough's figures raised
   * where its history passed them, written to the store, and each achievement across games
   * their sum now makes yes unlocked, as the playthrough's. Not in a playthrough a teleport
   * has touched, whose figures count for nothing.
   */
  private tested(): void {
    if (!this.figuresRead || this.teleported) return;
    const playthrough = this.playthrough;
    const live = this.tracker.figures();
    const old = this.figures.get(playthrough) ?? {};
    const raised = mergeFigures(old, live);
    if (Object.entries(raised).some(([key, v]) => old[key] !== v)) {
      this.figures.set(playthrough, raised);
      const row = { dataSet: this.dataSet, playthrough, figures: { ...live } };
      this.writes = this.writes.then(() => this.store.raiseFigures(row))
        .catch((error) => this.log('The figures across games could not be stored', error));
    }
    const ids = acrossUnlocked(this.across, this.figures.values()).filter((id) => !this.acrossDone.has(id));
    if (ids.length === 0) return;
    for (const id of ids) this.acrossDone.add(id);
    const gameTime = this.game.ctx.state.tickCount;
    const vbls = this.tracker.playedVbls;
    this.unlocked(ids.map((id) => ({ id, gameTime, vbls })));
  }

  /**
   * The proofs of the set's rows read again from the store, for the dialog: at the start,
   * and once the page has written their verdicts (`PageProofs.refresh`).
   */
  async readProofs(): Promise<void> {
    try {
      const rows = await this.store.list(this.dataSet);
      this.proofs = new Map(rows.map((row) => [`${row.playthrough}|${row.id}`, row.proof]));
    } catch (error) {
      this.log('The achievements could not be read', error);
    }
  }

  /** Told each unlock the page shows: the banner's (`AchievementBanner`). */
  onShown(listener: (shown: ShownUnlock) => void): void {
    this.shownListeners.push(listener);
  }

  /** The playthrough being played, `d.RandomGameID`. */
  get playthrough(): number {
    return this.game.ctx.state.block1.randomGameID;
  }

  /**
   * The figures the achievements across games read (`GameFigures`) of the history
   * `snapshot` of the playthrough `playthrough`, a save's as its file was made, or the
   * game's now for `null`: what a proof sends them for (`PageProofs`). None in a
   * playthrough a teleport has touched, whose figures count for nothing.
   */
  figuresOf(playthrough: number, snapshot: AchievementSnapshot | null): GameFigures {
    if (this.touched.has(playthrough)) return {};
    return snapshot === null ? this.tracker.figures() : this.tracker.figuresOf(snapshot);
  }

  /** Whether a teleport has touched the playthrough being played: it earns nothing. */
  get teleported(): boolean {
    return this.touched.has(this.playthrough);
  }

  /**
   * What the achievements dialog shows (`AchievementsView`): the set's, what the game's
   * history has unlocked, and how far the proof of each unlock of the playthrough has got.
   */
  view(): {
    readonly defs: readonly AchievementDef[]; readonly unlocked: ReadonlySet<string>; readonly whole: boolean;
    readonly proof: (id: string) => AchievementProof | null;
  } {
    const playthrough = this.playthrough;
    return {
      defs: this.defs, unlocked: this.acrossDone.size === 0 ? this.tracker.unlocked : new Set([...this.tracker.unlocked, ...this.acrossDone]),
      whole: this.tracker.whole,
      proof: (id) => this.proofs.get(`${playthrough}|${id}`) ?? null,
    };
  }

  /** The set's rows in the store, every playthrough's. */
  rows(): Promise<AchievementRow[]> {
    return this.store.list(this.dataSet);
  }

  /** The store's writes so far, done. */
  async settled(): Promise<void> {
    await this.writes;
  }

  /**
   * The tracker's unlocks (`AchievementTracker.onUnlock`), each written to the store as a
   * row of the playthrough and shown, in the file's order. In a playthrough a teleport
   * has touched, none: the statistics refuse it the same way (`GameEvents.teleported`).
   */
  unlocked(unlocks: readonly Unlock[]): void {
    const playthrough = this.playthrough;
    if (this.touched.has(playthrough)) return;
    const now = Date.now();
    const champions = this.game.ctx.party.state.champions
      .filter((champion, i) => champion && i !== this.game.ctx.party.state.potentialChampionIndex)
      .map((champion) => champion!.name);
    for (const unlock of unlocks) {
      const def = this.byId.get(unlock.id);
      if (!def) continue;
      const row: AchievementRow = {
        dataSet: this.dataSet, id: def.id, playthrough, unlockedAt: now,
        playTime: Math.round((unlock.vbls * 1000) / VBLS_PER_SECOND), gameTime: unlock.gameTime,
        champions, proof: 'unverified',
      };
      this.proofs.set(`${playthrough}|${def.id}`, this.proofs.get(`${playthrough}|${def.id}`) ?? 'unverified');
      this.writes = this.writes.then(() => this.store.unlock(row))
        .catch((error) => this.log(`The achievement ${def.id} could not be stored`, error));
      for (const listener of this.shownListeners) listener({ def, unlock });
    }
  }
}
