/**
 * A game's achievements as it goes (`doc/ACHIEVEMENTS.md` → "When an achievement
 * unlocks"): the aggregates the conditions read, kept as the events and the samples come,
 * the facts the tracker sets, and the achievements unlocked. A function of what it is told
 * and of nothing else, so that a live game and its replay unlock the same.
 *
 * Its state is saved (`snapshot`) beside a save and restored at its read (`restore`), each
 * aggregate by its key. An aggregate the saved state does not hold, one a condition added
 * since, is unknown from then on in that game, and so is every aggregate of a game whose
 * history starts at a save that held none (`whole` false): a condition that needs the whole
 * game and reads one never unlocks there.
 */
import type { AchievementDef, Aggregate, EventKind, Expr, FactName, Filter, SampleName } from './AchievementFile';
import { samplesOf } from './AchievementFile';

/** The VBLs a second, which `playTime` counts by. */
const VBLS_PER_SECOND = 60;

/** An event: its kind and its attributes, each a value as the file's vocabulary has it. */
export interface AchievementEvent {
  readonly kind: EventKind;
  readonly attrs: Readonly<Record<string, string>>;
}

/** The state saved beside a save. */
export interface AchievementSnapshot {
  readonly v: 1;
  /** Whether the history goes back to the game's start. */
  readonly whole: boolean;
  /** The achievements unlocked, and the conditions of one game met, by their keys, `games(…)`. */
  readonly unlocked: readonly string[];
  readonly vbls: number;
  /** Each sample by its key: `party`, or `party(where …)`. */
  readonly samples: Readonly<Record<string, number>>;
  /** Each known aggregate by its key: a count, a `max` or `min`, or a `distinct`'s values. */
  readonly aggregates: Readonly<Record<string, number | readonly string[]>>;
  /** The aggregates kept that are not known from the game's start. */
  readonly unknown: readonly string[];
}

type Kept = { agg: Aggregate; value: number; values: Set<string> | null; sampled: boolean; known: boolean };

/** A condition this game tests: an achievement of one game's, or a `games(…)`'s, by its key. */
interface Tested {
  readonly id: string;
  readonly when: Expr;
  readonly whole: boolean;
  readonly aggregates: readonly Aggregate[];
}

/**
 * A playthrough's figures, which the achievements across games read
 * (`doc/ACHIEVEMENTS.md` → "Across games"): 1 for each `games(…)` key whose condition its
 * history met, and each `total(…)` key's count.
 */
export type GameFigures = Readonly<Record<string, number>>;

/** Whether `id` is a condition of one game's key, `games(…)`, rather than an achievement's id. */
function isGameKey(id: string): boolean {
  return id.startsWith('games(');
}

export class AchievementState {
  private readonly kept = new Map<string, Kept>();
  private readonly unlockedIds = new Set<string>();
  /** The `games(…)` conditions this history has met, by key. */
  private readonly met = new Set<string>();
  private readonly tested: Tested[] = [];
  /** The `total(…)`s, each its key and the count it adds up. */
  private readonly totals = new Map<string, string>();
  private readonly samples: Record<string, number> = {};
  /** The `party(where …)` samples the conditions read, each its filter by its key. */
  private readonly partyFilters = new Map<string, Filter>();
  private vbls = 0;
  private gameTime = 0;
  private explored = 0;
  private end: 'won' | 'lost' | null = null;
  private changed = true;

  /**
   * A game's state from its start (`whole` true), or from a save that held none, its
   * history starting there.
   */
  constructor(defs: readonly AchievementDef[], private readonly whole: boolean) {
    const keep = (aggregates: readonly Aggregate[]): void => {
      for (const agg of aggregates) {
        if (!this.kept.has(agg.key)) {
          this.kept.set(agg.key, { agg, value: 0, values: agg.k === 'distinct' ? new Set() : null, sampled: false, known: whole });
        }
      }
    };
    const games = new Set<string>();
    for (const def of defs) {
      keep(def.aggregates);
      if (!def.across) this.tested.push(def);
      for (const agg of def.across ? def.aggregates : []) this.totals.set(`total(${agg.key})`, agg.key);
      for (const game of def.games) {
        if (games.has(game.key)) continue;
        games.add(game.key);
        keep(game.aggregates);
        this.tested.push({ id: game.key, when: game.when, whole: game.whole, aggregates: game.aggregates });
      }
    }
    for (const t of this.tested) for (const s of samplesOf(t.when)) if (s.where !== null) this.partyFilters.set(s.key, s.where);
  }

  /** The state a save kept, read for the achievements `defs` names now. */
  static restore(defs: readonly AchievementDef[], snapshot: AchievementSnapshot): AchievementState {
    const state = new AchievementState(defs, snapshot.whole);
    for (const id of snapshot.unlocked) (isGameKey(id) ? state.met : state.unlockedIds).add(id);
    state.vbls = snapshot.vbls;
    for (const [key, v] of Object.entries(snapshot.samples)) state.samples[key] = v;
    const unknown = new Set(snapshot.unknown);
    for (const [key, kept] of state.kept) {
      const saved = snapshot.aggregates[key];
      if (saved === undefined) { kept.known = false; continue; }
      if (Array.isArray(saved) !== (kept.values !== null)) { kept.known = false; continue; }
      if (Array.isArray(saved)) kept.values = new Set(saved as readonly string[]);
      else { kept.value = saved as number; kept.sampled = true; }
      kept.known = snapshot.whole && !unknown.has(key);
    }
    return state;
  }

  snapshot(): AchievementSnapshot {
    const aggregates: Record<string, number | readonly string[]> = {};
    const unknown: string[] = [];
    for (const [key, kept] of this.kept) {
      aggregates[key] = kept.values !== null ? [...kept.values].sort() : kept.value;
      if (!kept.known) unknown.push(key);
    }
    return {
      v: 1,
      whole: this.whole,
      unlocked: [...this.unlockedIds, ...this.met].sort(),
      vbls: this.vbls,
      samples: { ...this.samples },
      aggregates,
      unknown,
    };
  }

  /** The achievements of one game unlocked. */
  get unlocked(): ReadonlySet<string> {
    return this.unlockedIds;
  }

  /** The figures the achievements across games read of this history (`GameFigures`). */
  figures(): GameFigures {
    const out: Record<string, number> = {};
    for (const key of this.met) out[key] = 1;
    for (const [key, agg] of this.totals) out[key] = this.kept.get(agg)?.value ?? 0;
    return out;
  }

  /** An event happened. */
  record(event: AchievementEvent): void {
    for (const kept of this.kept.values()) {
      const agg = kept.agg;
      if (agg.k !== 'count' && agg.k !== 'distinct') continue;
      if (agg.event !== event.kind || !accepts(agg.where, event.attrs)) continue;
      if (agg.k === 'count') kept.value++;
      else {
        const v = event.attrs[agg.attr];
        if (v !== undefined) kept.values?.add(v.toUpperCase());
      }
    }
    this.changed = true;
  }

  /** A sample read at a tick's end. */
  sample(name: SampleName, value: number): void {
    this.setSample(name, value);
  }

  /** Whether a condition reads the champions, `party(where …)`, which `champions` is told. */
  get readsChampions(): boolean {
    return this.partyFilters.size > 0;
  }

  /**
   * The party's champions at a tick's end, each by its attributes
   * (`CHAMPION_ATTRIBUTES`): each `party(where …)` is the number its filter accepts.
   */
  champions(members: readonly Readonly<Record<string, string>>[]): void {
    for (const [key, where] of this.partyFilters) this.setSample(key, members.filter((attrs) => accepts(where, attrs)).length);
  }

  private setSample(key: string, value: number): void {
    if (this.samples[key] === value) return;
    this.samples[key] = value;
    for (const kept of this.kept.values()) {
      const agg = kept.agg;
      if ((agg.k !== 'max' && agg.k !== 'min') || agg.sample.key !== key) continue;
      if (!kept.sampled) { kept.value = value; kept.sampled = true; }
      else kept.value = agg.k === 'max' ? Math.max(kept.value, value) : Math.min(kept.value, value);
    }
    this.changed = true;
  }

  /** VBLs the game has run, which `playTime` counts. */
  addVbls(n: number): void {
    this.vbls += n;
  }

  /** The game's clock, `d.Time`. */
  setGameTime(ticks: number): void {
    if (ticks === this.gameTime) return;
    this.gameTime = ticks;
    this.changed = true;
  }

  /** The share of the dungeon's floor squares the party has stood on, in percent. */
  setExplored(percent: number): void {
    if (percent === this.explored) return;
    this.explored = percent;
    this.changed = true;
  }

  /** The game has ended. */
  ended(won: boolean): void {
    this.end = won ? 'won' : 'lost';
    this.changed = true;
  }

  /**
   * Test the conditions that are not unlocked yet, if anything they read has changed:
   * the ids unlocked by this test, in the file's order. `playTime` alone changes without
   * saying so; the tracker sets the clock each tick, which does. A `games(…)` condition
   * met is kept (`figures`), and not among them.
   */
  evaluate(): string[] {
    if (!this.changed) return [];
    this.changed = false;
    const out: string[] = [];
    for (const t of this.tested) {
      const game = isGameKey(t.id);
      if ((game ? this.met : this.unlockedIds).has(t.id)) continue;
      if (t.whole && (!this.whole || !t.aggregates.every(a => this.kept.get(a.key)?.known === true))) continue;
      if (this.truth(t.when)) {
        if (game) this.met.add(t.id);
        else {
          this.unlockedIds.add(t.id);
          out.push(t.id);
        }
      }
    }
    return out;
  }

  private truth(e: Expr): boolean {
    switch (e.k) {
      case 'and': return this.truth(e.a) && this.truth(e.b);
      case 'or': return this.truth(e.a) || this.truth(e.b);
      case 'not': return !this.truth(e.a);
      case 'ever': return this.aggregate(e.agg) > 0;
      case 'never': return this.aggregate(e.agg) === 0;
      case 'fact': return this.fact(e.name) !== 0;
      case 'cmp': {
        const a = this.number(e.a);
        const b = this.number(e.b);
        switch (e.op) {
          case '=': return a === b;
          case '!=': return a !== b;
          case '<': return a < b;
          case '<=': return a <= b;
          case '>': return a > b;
          case '>=': return a >= b;
        }
      }
      // A number is never a condition: the reader refuses one (`typeOf`).
      default: return false;
    }
  }

  private number(e: Expr): number {
    switch (e.k) {
      case 'num': return e.value;
      // `mergeAchievements` puts every named value in its place.
      case 'value': throw new Error(`the value {${e.name}} was never given`);
      // `withCounts` puts every count of the data in its place.
      case 'data': throw new Error(`the count ${e.name} was never given`);
      case 'fact': return this.fact(e.name);
      case 'sample': return this.samples[e.sample.key] ?? 0;
      case 'agg': return this.aggregate(e.agg);
      // An achievement across games is never tested here (`acrossUnlocked`).
      case 'games': case 'total': return 0;
      default: return this.truth(e) ? 1 : 0;
    }
  }

  private fact(name: FactName): number {
    switch (name) {
      case 'won': return this.end === 'won' ? 1 : 0;
      case 'lost': return this.end === 'lost' ? 1 : 0;
      case 'ended': return this.end !== null ? 1 : 0;
      case 'gameTime': return this.gameTime;
      case 'playTime': return Math.floor(this.vbls / VBLS_PER_SECOND);
      case 'explored': return this.explored;
    }
  }

  private aggregate(agg: Aggregate): number {
    const kept = this.kept.get(agg.key);
    if (kept === undefined) return 0;
    return kept.values !== null ? kept.values.size : kept.value;
  }
}

/** Whether a filter takes an event's attributes; an attribute the event lacks matches nothing. */
function accepts(f: Filter | null, attrs: Readonly<Record<string, string>>): boolean {
  if (f === null) return true;
  switch (f.k) {
    case 'and': return accepts(f.a, attrs) && accepts(f.b, attrs);
    case 'or': return accepts(f.a, attrs) || accepts(f.b, attrs);
    case 'not': return !accepts(f.a, attrs);
    default: break;
  }
  const raw = attrs[f.attr];
  if (raw === undefined) return false;
  const v = raw.toUpperCase();
  switch (f.k) {
    case 'cmp':
      switch (f.op) {
        case '=': return v === f.value.toUpperCase();
        case '!=': return v !== f.value.toUpperCase();
        // Only a number is ordered (`parseCondition`).
        case '<': return Number(v) < Number(f.value);
        case '<=': return Number(v) <= Number(f.value);
        case '>': return Number(v) > Number(f.value);
        case '>=': return Number(v) >= Number(f.value);
      }
      return false;
    case 'in': return f.values.some(x => x.toUpperCase() === v) !== f.negated;
    case 'like': return globMatches(f.pattern, v);
  }
}

/** `*` any run of characters, `?` one. */
function globMatches(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return re.test(value);
}

/**
 * The achievements across games of `defs` whose conditions the playthroughs' figures
 * `games` make yes (`doc/ACHIEVEMENTS.md` → "Across games"): `games(…)` the number of
 * playthroughs that met it, `total(…)` the sum of their counts. In the file's order.
 */
export function acrossUnlocked(defs: readonly AchievementDef[], games: Iterable<GameFigures>): string[] {
  const all = [...games];
  const sum = (key: string): number => all.reduce((n, figures) => n + (figures[key] ?? 0), 0);
  const number = (e: Expr): number => {
    switch (e.k) {
      case 'num': return e.value;
      case 'games': return all.filter((figures) => (figures[e.game.key] ?? 0) > 0).length;
      case 'total': return sum(e.key);
      default: return truth(e) ? 1 : 0;
    }
  };
  const truth = (e: Expr): boolean => {
    switch (e.k) {
      case 'and': return truth(e.a) && truth(e.b);
      case 'or': return truth(e.a) || truth(e.b);
      case 'not': return !truth(e.a);
      case 'cmp': {
        const a = number(e.a);
        const b = number(e.b);
        switch (e.op) {
          case '=': return a === b;
          case '!=': return a !== b;
          case '<': return a < b;
          case '<=': return a <= b;
          case '>': return a > b;
          case '>=': return a >= b;
        }
      }
      // The reader refuses anything else across games (`gameFactOutside`).
      default: return false;
    }
  };
  return defs.filter((def) => def.across && truth(def.when)).map((def) => def.id);
}

