/**
 * The achievements' watcher (`doc/ACHIEVEMENTS.md` → "Watching the engine"): what the
 * engine tells its host (`GameHost.observe`, `src/engine/Happening.ts`) turned into the
 * evaluator's events and samples (`AchievementState`), the conditions tested at each
 * tick's end and at the game's end.
 *
 * It is a function of what it observes and of nothing else, so a live game and its replay
 * unlock the same. It writes nothing of the game's and draws no random number.
 *
 * Its state is kept beside each save, by the MD5 of the save's file (`saved`), and put
 * back when that file is read (`read`): a replay, whose joins read the files their parents
 * made, so takes up the history its parent had at each save. A file read with no state
 * kept for it starts a history of its own, which needs-the-whole-game conditions never
 * read (`AchievementState`), unless it is a CSB adventure's start (`isNewAdventure`): the
 * adventure is a game of its own from there, and its history is the whole game's. Every
 * other read is a `load`, in the history it takes up.
 *
 * A CSB adventure's start raises its party, each champion `prison` where their portrait is
 * a cell of the set's own champions' sheet, graphic 26, the portraits its mirrors give:
 * the prison's, which REINCARNATE keeps under a new name; `dm` where it is a DM champion's,
 * as the utility disk's portraits hold them (`UtilityPortraits`); `imported` otherwise.
 *
 * The counts a condition reads of the set's own files (`dataCounts`) are worked out once,
 * as the tracker is made, from the game's tables and the set's dungeon files, and put in
 * the conditions (`withCounts`), and so are the floor squares the party walks on
 * (`floorSquares`), which `explored` counts.
 */
import { fileDigest } from '../../data/DataSetFiles';
import { isNewAdventure } from '../Chaos';
import { OBJECT_ID_EOF, OBJECT_ID_NULL, DBType, Position, type ObjectID } from '../../core/types';
import { OBJNI_NOT_AN_OBJECT } from '../../core/objectNameIndex';
import { CHARFLAG_MALE, getChampionPossession } from '../../core/charDesc';
import { PORTRAIT_HEIGHT, PORTRAIT_WIDTH } from '../../data/CsbwinCharacters';
import { GraphicsLoader } from '../../data/GraphicsLoader';
import { UtilityPortraits } from '../../data/UtilityPortraits';
import { FIRST_RUNE, RUNE_NAMES } from '../../core/runes';
import { isMagicSpellRn } from '../../core/spellRn';
import type { Game } from '../Game';
import type { Champion } from '../gameTypes';
import { determineMastery } from '../skills';
import type { Blow, BlowCause, Happening } from '../Happening';
import { NameIndex } from '../objectIndex';
import { isAlive } from '../rules';
import { AchievementState, type AchievementEvent, type AchievementSnapshot, type GameFigures } from './AchievementState';
import { EMPTY_HAND, FOUNTAIN, withCounts, type AchievementDef, type DataCounts, type EventKind } from './AchievementFile';
import { dataCounts, floorSquares, setDungeons, type AchievementSetFiles } from './DataCounts';
import { TimerFunction } from '../TimerQueue';

/**
 * A monster type's name: CSBWin's `monsterNames` (`doc/CSBwin-src/Statistics.cpp:16-44`),
 * which its statistics name the dead by when the dungeon's `EXPOOL` names them not
 * (`GetMonsterName`, `:48-89`). No game file names a monster.
 */
export const MONSTER_NAMES: readonly string[] = [
  'Scorpion', 'SlimeDevil', 'Giggler', 'FlyingEye', 'Hellhound', '5', 'Screamer', 'RockPile',
  'Rive', 'StoneGolem', 'Mummy', 'BlackFlame', 'Skeleton', 'Couatl', 'Vexirk', 'Worm', 'AntMan',
  'Muncher', 'DethKnight', 'Zytaz', 'WaterElemental', 'Oitu', 'Demon', 'LordChaos', 'Dragon',
  '25', 'GreyLord',
];

/**
 * The worn places by possession slot: the slots whose `CarryLocation` in `graphics.dat`
 * (`d.CarryLocation`, `doc/CSBwin-src/Data.h:1442`) is the head's, the neck's, the
 * torso's, the legs' or the feet's mask (`doc/CSBwin-src/CSB.h:1682-1687`), which
 * `tools/checks/achievements-tracker.ts` reads.
 */
export const WORN_SLOTS: Readonly<Record<number, string>> = { 2: 'head', 3: 'torso', 4: 'legs', 5: 'feet', 10: 'neck' };

/**
 * A champion's places by possession slot, which `party(where …)` names: the worn places,
 * and the hands, the ready hand slot 0 and the action hand 1 (`Possession(1)`, the hand
 * `DetermineMastery` reads the Firestaff in, `doc/CSBwin-src/Code17818.cpp:76`).
 */
const CHAMPION_PLACES: Readonly<Record<number, string>> = { ...WORN_SLOTS, 0: 'ready', 1: 'action' };

/** The power runes, `LO` to `MON`: the first row of `RUNE_NAMES`. */
const POWER_RUNES = 6;

/** The four classes, skills 0 to 3, as `party(where …)` names them. */
const CLASSES = ['fighter', 'ninja', 'priest', 'wizard'] as const;

/**
 * The highest rank, ARCHMASTER: `d.Pointer16770`'s last, which the inventory shows for
 * every mastery from 16 up (`doc/CSBwin-src/CSBCode.cpp:380-394`).
 */
const ARCHMASTER_MASTERY = 16;

/**
 * What `kill`'s and `hit`'s `by` and `hurt`'s are, for each blow's cause; a missile's is the
 * kill's `throw` or `spell`.
 */
const KILL_BY: Partial<Record<BlowCause, string>> = {
  melee: 'melee', explosion: 'explosion', cloud: 'cloud', door: 'door', pit: 'pit', fusion: 'fusion', landing: 'landing',
};
const HURT_BY: Partial<Record<BlowCause, string>> = {
  monster: 'monster', missile: 'missile', explosion: 'explosion', cloud: 'cloud', door: 'door', pit: 'pit',
  wall: 'wall', poison: 'poison', starvation: 'starvation', thirst: 'thirst', fatigue: 'fatigue', potion: 'potion',
};

/** The set's champions' portraits, graphic 26: 32x29 cells, eight a row (`AddCharacter`, `doc/CSBwin-src/Character.cpp:487-509`). */
export interface PortraitSheet {
  readonly width: number;
  readonly height: number;
  readonly pixels: ArrayLike<number>;
}

/** Who struck: the party, by a champion's slot (-1 for none named), or not. */
interface Side {
  readonly party: boolean;
  readonly champion: number;
}
const NOBODY: Side = { party: false, champion: -1 };

/** The tracker's state kept beside a save. */
export interface TrackerSnapshot {
  readonly v: 1;
  readonly state: AchievementSnapshot;
  /** The party's missiles and clouds in the world, by RN, with the champion who made them. */
  readonly missiles: readonly (readonly [number, number])[];
  readonly clouds: readonly (readonly [number, number])[];
  /** Each champion's last damage, by party slot, which a death pending names. */
  readonly causes: readonly (string | null)[];
  /**
   * Whether each champion's last damage was the party's, by party slot, which a death
   * pending says; left out by a state kept before it was kept, as none.
   */
  readonly sides?: readonly boolean[];
  /** The level the party was on at the last tick's end; left out by a state kept before it was kept, as none. */
  readonly level?: number;
  /** The objects groups took from the party (`theft`); left out by a state kept before they were kept, as none. */
  readonly stolen?: readonly number[];
  /** How many times the Vi altar has revived each champion, by name; left out by a state kept before they were kept, as none. */
  readonly revivals?: readonly (readonly [string, number])[];
  /**
   * The floor squares the party has stood on at a tick's end, a bit each in
   * `floorSquares`' order, in base 64; left out by a state kept before they were kept, as none.
   */
  readonly visited?: string;
}

/** An achievement unlocked, with the game's clock and the player's time then. */
export interface Unlock {
  readonly id: string;
  readonly gameTime: number;
  readonly vbls: number;
}

export class AchievementTracker {
  private state: AchievementState;
  private readonly snapshots = new Map<string, TrackerSnapshot>();
  private readonly missiles = new Map<number, Side>();
  private readonly clouds = new Map<number, Side>();
  private causes: (string | null)[] = [null, null, null, null];
  private sides: boolean[] = [false, false, false, false];
  /**
   * The objects a group took from the party, by RN, which a group carries until its last
   * member dies: a kill's `thief`.
   */
  private readonly stolen = new Set<number>();
  /** How many times the Vi altar has revived each champion, by name: a revival's `times`. */
  private readonly revivals = new Map<string, number>();
  private readonly blows: Blow[] = [];
  /**
   * The kills of the strike under way, by the square of the group (`squareKey`): an
   * outermost blow's, and the blows after it, in the same tick, of the same missile, its
   * meeting and its explosion. `strikeMissile` is that missile, `null` for a strike of none.
   */
  private readonly strikeKills = new Map<number, number>();
  private strikeMissile: ObjectID | null = null;
  private vbls = 0;
  private readonly unlockListeners: ((unlocks: readonly Unlock[]) => void)[] = [];
  private readonly eventListeners: ((event: AchievementEvent) => void)[] = [];
  private readonly testListeners: (() => void)[] = [];
  private readonly found: Unlock[] = [];

  /** The counts of the set's own files its conditions read (`dataCounts`). */
  readonly counts: DataCounts;
  private readonly defs: readonly AchievementDef[];
  private readonly miniDat: Uint8Array | null;
  /** The cells of the set's champions' portraits, each its pixels joined: a champion raised from the prison wears one. */
  private readonly prisonFaces = new Set<string>();
  /** A DM champion's faces, DM's own and the utility disk's, each its pixels joined: a champion raised from DM wears one. */
  private readonly dmFaces = new Set<string>();
  /** Each floor square's bit in `visited`, by `squareKey`. */
  private readonly floors = new Map<number, number>();
  private visited: Uint8Array;
  private visitedCount = 0;
  /** The level the party was on at the last tick's end, -1 before the first. */
  private level = -1;

  /**
   * A tracker of `game`, for the achievements `defs` names, the objects named by
   * `objectNames` (`d.ObjectNames`, the set's `graphics.dat`), and `files`, the set's
   * dungeon files: the counts are read from them, and a CSB adventure's start is read
   * against its `mini.dat`, its party raised against `portraits`, the set's graphic 26,
   * and the utility's portraits of DM's champions.
   * Until a game is read it keeps a history that does not go back to the start.
   */
  constructor(
    private readonly game: Game, defs: readonly AchievementDef[], private readonly objectNames: readonly string[],
    files: AchievementSetFiles, portraits: PortraitSheet | null,
  ) {
    const dungeons = setDungeons(files);
    this.counts = dataCounts(game.ctx.tables, dungeons);
    this.defs = defs.map((def) => withCounts(def, this.counts));
    const played = dungeons[dungeons.length - 1];
    if (played) for (const square of floorSquares(played)) this.floors.set(squareKey(square.z, square.x, square.y), this.floors.size);
    this.visited = new Uint8Array((this.floors.size + 7) >> 3);
    this.miniDat = files.miniDat;
    if (portraits) for (const cell of portraitCells(portraits)) this.prisonFaces.add(cell);
    if (files.utilityPortraits) {
      const sheet = new GraphicsLoader();
      sheet.loadFromArray(files.utilityPortraits);
      for (const cell of new UtilityPortraits(sheet).dungeonMasterFaces()) this.dmFaces.add(cell);
    }
    this.state = new AchievementState(this.defs, false);
  }

  /** The engine's happenings sent here. */
  attach(): void {
    const host = this.game.ctx.host;
    host.observe = (happening) => this.observe(happening);
    host.observing = true;
  }

  /** The engine's happenings sent nowhere again. */
  detach(): void {
    const host = this.game.ctx.host;
    host.observe = () => {};
    host.observing = false;
  }

  /** Told the achievements each test unlocks, in the file's order. */
  onUnlock(listener: (unlocks: readonly Unlock[]) => void): void {
    this.unlockListeners.push(listener);
  }

  /**
   * Told each time the conditions are tested, at a tick's end and at the game's end, after
   * the unlocks: when the figures (`figures`) may have changed.
   */
  onTested(listener: () => void): void {
    this.testListeners.push(listener);
  }

  /** The figures the achievements across games read of the history (`GameFigures`). */
  figures(): GameFigures {
    return this.state.figures();
  }

  /** Told each event as it is recorded. */
  onEvent(listener: (event: AchievementEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /** Every achievement this tracker saw unlock, in order. */
  get unlocks(): readonly Unlock[] {
    return this.found;
  }

  /** The achievements the game's history has unlocked, those restored with it included. */
  get unlocked(): ReadonlySet<string> {
    return this.state.unlocked;
  }

  /** Whether the history goes back to the game's start. */
  get whole(): boolean {
    return this.state.snapshot().whole;
  }

  /** The share of the dungeon's floor squares the history has stood on, in percent: `explored`. */
  get explored(): number {
    return this.floors.size === 0 ? 0 : Math.floor((this.visitedCount * 100) / this.floors.size);
  }

  /** The player's time the history counts, in VBLs. */
  get playedVbls(): number {
    return this.state.snapshot().vbls + this.vbls;
  }

  /** The state now, as a save keeps it, the VBLs run since the last tick counted. */
  snapshot(): TrackerSnapshot {
    this.state.addVbls(this.vbls);
    this.vbls = 0;
    const party = (tags: Map<number, Side>): [number, number][] =>
      [...tags].filter(([, side]) => side.party).map(([rn, side]) => [rn, side.champion]);
    return {
      v: 1, state: this.state.snapshot(), missiles: party(this.missiles), clouds: party(this.clouds), causes: [...this.causes],
      sides: [...this.sides], stolen: [...this.stolen], revivals: [...this.revivals], level: this.level, visited: toBase64(this.visited),
    };
  }

  /** The state kept for the save whose file has `md5`, if any. */
  snapshotOf(md5: string): TrackerSnapshot | undefined {
    return this.snapshots.get(md5);
  }

  /** `snapshot` kept for the save whose file has `md5`: the page's, from the store. */
  keep(md5: string, snapshot: TrackerSnapshot): void {
    this.snapshots.set(md5, snapshot);
  }

  observe(h: Happening): void {
    switch (h.k) {
      case 'blow': this.strike(h); this.blows.push(h); return;
      case 'blow-end': this.blows.pop(); return;
      case 'vbl': this.vbls++; return;
      case 'monster-hit': this.hit(h.type, h.damage); return;
      case 'monster-died': this.killed(h.type, squareKey(h.level, h.x, h.y), h.possession); return;
      case 'champion-hurt': this.hurt(h.chIdx); return;
      case 'champion-died': this.died(h.chIdx); return;
      case 'missile': this.missiles.set(h.missile, h.launcher >= 0 ? { party: true, champion: h.launcher } : NOBODY); return;
      case 'cloud': this.clouds.set(h.cloud, this.side(this.blows.length - 1)); return;
      case 'meal': {
        const item = h.nameIndex < 0 ? FOUNTAIN : this.objectNames[h.nameIndex];
        this.record(h.eat ? 'eat' : 'drink', { champion: this.championName(h.chIdx), item });
        return;
      }
      case 'cast': {
        const runes = h.runes.filter((rune) => rune !== 0);
        // The power rune, first, is not the spell's (`"FUL IR"`), but the cast's `power`.
        const first = (runes[0] ?? 0) - FIRST_RUNE;
        const power = first >= 0 && first < POWER_RUNES ? RUNE_NAMES[first] : undefined;
        const spell = runes.slice(1).map((rune) => RUNE_NAMES[rune - FIRST_RUNE] ?? `${rune}`).join(' ');
        this.record('cast', { champion: this.championName(h.chIdx), spell, power, ok: yesNo(h.ok), why: h.failure });
        return;
      }
      case 'wear':
        this.record('wear', { champion: this.championName(h.chIdx), slot: WORN_SLOTS[h.slot], item: this.itemName(h.object) });
        return;
      case 'joined':
        this.record('join', { champion: this.championName(h.chIdx), how: h.reincarnated ? 'reincarnate' : 'resurrect' });
        return;
      case 'revived': {
        const champion = this.championName(h.chIdx) ?? `#${h.chIdx}`;
        const times = (this.revivals.get(champion) ?? 0) + 1;
        this.revivals.set(champion, times);
        this.record('revive', { champion, times: `${times}` });
        return;
      }
      case 'theft':
        this.stolen.add(h.object);
        this.record('theft', { champion: this.championName(h.chIdx), item: this.itemName(h.object), monster: MONSTER_NAMES[h.type] ?? `${h.type}` });
        return;
      case 'swap': this.record('swap', { item: this.itemName(h.given), took: this.itemName(h.taken) }); return;
      case 'trigger':
        this.record('trigger', {
          level: `${h.level}`, x: `${h.x}`, y: `${h.y}`, item: h.hand && h.item === OBJECT_ID_NULL ? EMPTY_HAND : this.itemName(h.item),
        });
        return;
      case 'sleep': this.record('sleep', {}); return;
      case 'oracle': this.record('oracle', {}); return;
      case 'tick': this.strikeMissile = null; this.strikeKills.clear(); this.tick(); return;
      case 'ended':
        this.sample();
        this.state.ended(h.won);
        this.evaluate();
        return;
      case 'new-game': this.begin(null, true); return;
      case 'saved': this.snapshots.set(fileDigest(h.file), this.snapshot()); return;
      case 'read': {
        const kept = this.snapshots.get(fileDigest(h.file)) ?? null;
        const adventure = kept === null && this.miniDat !== null && isNewAdventure(h.file, this.miniDat);
        this.begin(kept, adventure);
        if (adventure) this.raised();
        else this.record('load', {});
        return;
      }
    }
  }

  /**
   * A history begun: a new game's or a CSB adventure's from its start, or a save's from
   * what was kept for it.
   */
  private begin(kept: TrackerSnapshot | null, whole: boolean): void {
    this.blows.length = 0;
    this.strikeKills.clear();
    this.strikeMissile = null;
    this.missiles.clear();
    this.clouds.clear();
    this.stolen.clear();
    this.revivals.clear();
    this.causes = [null, null, null, null];
    this.sides = [false, false, false, false];
    this.vbls = 0;
    this.level = kept?.level ?? -1;
    const visited = kept?.visited !== undefined ? fromBase64(kept.visited) : null;
    this.visited = visited?.length === this.visited.length ? visited : new Uint8Array(this.visited.length);
    this.visitedCount = 0;
    for (const byte of this.visited) for (let b = byte; b !== 0; b &= b - 1) this.visitedCount++;
    if (!kept) {
      this.state = new AchievementState(this.defs, whole);
      return;
    }
    this.state = AchievementState.restore(this.defs, kept.state);
    for (const [rn, champion] of kept.missiles) this.missiles.set(rn, { party: true, champion });
    for (const [rn, champion] of kept.clouds) this.clouds.set(rn, { party: true, champion });
    this.causes = [...kept.causes];
    if (kept.sides) this.sides = [...kept.sides];
    for (const rn of kept.stolen ?? []) this.stolen.add(rn);
    for (const [champion, times] of kept.revivals ?? []) this.revivals.set(champion, times);
  }

  /**
   * A CSB adventure's party, each champion `prison` where their portrait is one of the
   * set's own champions', `dm` where it is a DM champion's, else `imported`: a party a
   * utility put in from another game.
   */
  private raised(): void {
    const party = this.game.ctx.party.state;
    for (let i = 0; i < party.champions.length; i++) {
      const champ = party.champions[i];
      if (!champ || i === party.potentialChampionIndex) continue;
      const face = champ.portrait?.join();
      const from = face === undefined ? 'imported' : this.prisonFaces.has(face) ? 'prison' : this.dmFaces.has(face) ? 'dm' : 'imported';
      this.record('raise', { champion: champ.name, from });
    }
  }

  private tick(): void {
    this.sample();
    this.evaluate();
  }

  /** The samples, the clock and the VBLs, at a tick's end. */
  private sample(): void {
    const { ctx } = this.game;
    const party = ctx.party.state;
    let members = 0;
    let alive = 0;
    let coins = 0;
    for (let i = 0; i < party.champions.length; i++) {
      const champ = party.champions[i];
      if (!champ || i === party.potentialChampionIndex) continue;
      members++;
      if (isAlive(champ)) alive++;
      for (const rn of champ.possessions) coins += this.coinsIn(rn);
    }
    coins += this.coinsIn(party.objectInHand);
    this.state.sample('party', members);
    this.state.sample('alive', alive);
    this.state.sample('coins', coins);
    if (this.state.readsChampions) {
      const champions: Record<string, string>[] = [];
      for (let i = 0; i < party.champions.length; i++) {
        const champ = party.champions[i];
        if (champ && i !== party.potentialChampionIndex) champions.push(this.championAttrs(champ));
      }
      this.state.champions(champions);
    }
    this.where();
    this.state.setGameTime(ctx.state.tickCount);
    this.state.addVbls(this.vbls);
    this.vbls = 0;
  }

  /**
   * Where the party stands at a tick's end: a level entered, and the one left with whether
   * a monster is alive on it, the samples of its level and square, and the floor square
   * walked on. A party moved to another
   * level in the tick's input stands there from the next tick, which loads the level
   * (`Game.loadNewPartyLevel`): until then its square is the new level's, and its level
   * the old one.
   */
  private where(): void {
    const { ctx } = this.game;
    if (ctx.loop.newPartyLevel !== -1) return;
    const { x, y, z } = ctx.party.state.position;
    if (z !== this.level) {
      if (this.level >= 0) this.record('leave', { level: `${this.level}`, cleared: yesNo(!this.monsterOn(this.level)) });
      this.record('enter', { level: `${z}` });
      this.level = z;
    }
    this.state.sample('level', z);
    this.state.sample('x', x);
    this.state.sample('y', y);
    const bit = this.floors.get(squareKey(z, x, y));
    if (bit !== undefined && (this.visited[bit >> 3]! & (1 << (bit & 7))) === 0) {
      this.visited[bit >> 3]! |= 1 << (bit & 7);
      this.visitedCount++;
    }
    this.state.setExplored(this.explored);
  }

  /**
   * Whether a monster is alive on `level`: a group on one of its squares, or one waiting
   * to be put on one, which `CreateMovementTimer` parks on a `TT_60` or `TT_61` timer
   * (`doc/CSBwin-src/Code11f52.cpp:2481`) until its square is free.
   */
  private monsterOn(level: number): boolean {
    const { dungeon, timers } = this.game.ctx;
    const map = dungeon.getMap(level);
    if (map) {
      for (let x = 0; x < map.descriptor.width; x++) {
        for (let y = 0; y < map.descriptor.height; y++) {
          if (dungeon.findFirstMonster(new Position(x, y, level)) !== OBJECT_ID_EOF) return true;
        }
      }
    }
    return timers.getTimers().some((timer) =>
      (timer.function === TimerFunction.TT_60 || timer.function === TimerFunction.TT_61) && (timer.level & 0xff) === level
      && timer.object !== undefined && dungeon.rnMaps.dbType(timer.object) === DBType.CREATURE);
  }

  private evaluate(): void {
    const ids = this.state.evaluate();
    if (ids.length > 0) {
      const gameTime = this.game.ctx.state.tickCount;
      const vbls = this.state.snapshot().vbls;
      const unlocks = ids.map((id) => ({ id, gameTime, vbls }));
      this.found.push(...unlocks);
      for (const listener of this.unlockListeners) listener(unlocks);
    }
    for (const listener of this.testListeners) listener();
  }

  /**
   * A champion's attributes (`CHAMPION_ATTRIBUTES`): the name, the sex (`CHARFLAG_male`),
   * alive or not, what each worn place and hand holds, the rank in each class, and the load.
   *
   * A rank is the class's mastery as the credits show it, `DetermineMastery(chIdx, skill |
   * 0xc000)` (`doc/CSBwin-src/Code17818.cpp:13`): the experience alone, no object's bonus
   * (the Firestaff's, a pendant's) and no temporary adjustment, and the champion's own while
   * the party sleeps, when `DetermineMastery` reports 1. It is that mastery less one, up to
   * ARCHMASTER: 0 for none shown, 1 NEOPHYTE, 8 EXPERT, 9 to 14 the six masters, 15
   * ARCHMASTER. The load is `CHARDESC.load` with the object in hand on its owner, in percent
   * of `MaxLoad` (`doc/CSBwin-src/Code11f52.cpp:4318`), rounded up: 50 is half the most at
   * most.
   */
  private championAttrs(champ: Champion): Record<string, string> {
    const attrs: Record<string, string> = {
      sex: (champ.charFlags & CHARFLAG_MALE) !== 0 ? 'male' : 'female',
      alive: yesNo(isAlive(champ)),
    };
    if (champ.name) attrs.champion = champ.name;
    for (const [slot, place] of Object.entries(CHAMPION_PLACES)) {
      const item = this.itemName(getChampionPossession(champ, Number(slot)));
      if (item) attrs[place] = item;
    }
    CLASSES.forEach((role, skill) => {
      attrs[role] = `${Math.min(ARCHMASTER_MASTERY, determineMastery(champ, skill | 0xc000)) - 1}`;
    });
    const stats = this.game.ctx.systems.characterStats;
    const max = stats.maxLoad(champ);
    attrs.load = `${max > 0 ? Math.floor((stats.characterLoad(champ) * 100 + max - 1) / max) : 0}`;
    return attrs;
  }

  /** The coins `rn` is, or holds: a chest's contents, the open chest's in its slots. */
  private coinsIn(rn: ObjectID): number {
    if (rn === OBJECT_ID_NULL || rn === OBJECT_ID_EOF) return 0;
    const { ctx } = this.game;
    let n = this.itemName(rn)?.endsWith('COIN') ? 1 : 0;
    if (ctx.dungeon.rnMaps.dbType(rn) !== DBType.CHEST) return n;
    if (ctx.interface.openChestId === rn) {
      for (const inside of ctx.interface.openChestContents) n += this.coinsIn(inside);
      return n;
    }
    let inside = ctx.dungeon.getContainerRecord(rn)?.containedObject ?? OBJECT_ID_EOF;
    for (let guard = 0; inside !== OBJECT_ID_EOF && inside !== OBJECT_ID_NULL && guard < 1000; guard++) {
      n += this.coinsIn(inside);
      inside = ctx.dungeon.getDBRecordLink(inside);
    }
    return n;
  }

  /** The side of the blow at `index` of the stack: its own, its missile's or cloud's, or the blow around it. */
  private side(index: number): Side {
    for (let i = index; i >= 0; i--) {
      const b = this.blows[i]!;
      if (b.party !== undefined) return { party: b.party, champion: b.champion ?? -1 };
      const tag = b.missile !== undefined ? this.missiles.get(b.missile) : b.cloud !== undefined ? this.clouds.get(b.cloud) : undefined;
      if (tag) return tag;
      if (b.missile !== undefined || b.cloud !== undefined) return NOBODY;
    }
    return NOBODY;
  }

  /**
   * A blow begun: an outermost one begins a strike, unless it is of the missile the strike
   * under way is, whose meeting and explosion are one strike.
   */
  private strike(b: Blow): void {
    if (this.blows.length !== 0) return;
    if (b.missile === undefined || b.missile !== this.strikeMissile) this.strikeKills.clear();
    this.strikeMissile = b.missile ?? null;
  }

  /**
   * What the blow on top of the stack is, for a monster it hits or kills: who struck, how,
   * and with what. A melee blow's empty hand is `EMPTY_HAND`.
   */
  private blowAttrs(type: number): Record<string, string | undefined> {
    const top = this.blows.length - 1;
    const b = this.blows[top];
    const attrs: Record<string, string | undefined> = { monster: MONSTER_NAMES[type] ?? `${type}` };
    if (!b) {
      attrs.party = 'no';
      return attrs;
    }
    const side = this.side(top);
    attrs.party = yesNo(side.party);
    if (side.champion >= 0) attrs.champion = this.championName(side.champion);
    if (b.by === 'missile') {
      const spell = b.item !== undefined && isMagicSpellRn(b.item);
      attrs.by = spell ? 'spell' : 'throw';
      if (!spell && b.item !== undefined) attrs.item = this.itemName(b.item);
    } else {
      attrs.by = KILL_BY[b.by];
      if (b.by === 'melee' && b.item !== undefined) attrs.item = b.item === OBJECT_ID_NULL ? EMPTY_HAND : this.itemName(b.item);
      if (b.by === 'explosion') {
        // A bomb's blast is a blow inside its explosion's, which names the bomb.
        for (let i = top; i >= 0 && this.blows[i]!.by === 'explosion'; i--) {
          const item = this.blows[i]!.item;
          if (item !== undefined) { attrs.item = this.itemName(item); break; }
        }
      }
    }
    return attrs;
  }

  private hit(type: number, damage: number): void {
    this.record('hit', { ...this.blowAttrs(type), damage: `${damage}` });
  }

  /**
   * A kill, how many of its group, on square `square`, the strike has killed so far, and
   * whether the group carries, among the objects from `possession` on, one it took from the
   * party: a member of the thieves' group, which drops what it carries only as its last
   * member dies.
   */
  private killed(type: number, square: number, possession: ObjectID): void {
    let group = 1;
    if (this.blows.length > 0) {
      group = (this.strikeKills.get(square) ?? 0) + 1;
      this.strikeKills.set(square, group);
    }
    this.record('kill', { ...this.blowAttrs(type), group: `${group}`, thief: yesNo(this.carriesStolen(possession)) });
  }

  /** Whether the objects from `rn` on, a group's possessions, hold one taken from the party. */
  private carriesStolen(rn: ObjectID): boolean {
    if (this.stolen.size === 0) return false;
    const { dungeon } = this.game.ctx;
    for (let guard = 0; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL && guard < 1000; guard++) {
      if (this.stolen.has(rn)) return true;
      rn = dungeon.getDBRecordLink(rn);
    }
    return false;
  }

  private hurt(chIdx: number): void {
    const top = this.blows.length - 1;
    const b = this.blows[top];
    const by = b ? HURT_BY[b.by] : undefined;
    const party = b ? this.side(top).party : false;
    if (chIdx >= 0 && chIdx < this.causes.length) {
      this.causes[chIdx] = by ?? null;
      this.sides[chIdx] = party;
    }
    this.record('hurt', { champion: this.championName(chIdx), by, party: yesNo(party) });
  }

  /**
   * A death: inside a blow, the blow's cause and side; else the last damage the champion
   * took, pending till the tick, and whose it was.
   */
  private died(chIdx: number): void {
    const top = this.blows.length - 1;
    const b = this.blows[top];
    const by = b ? HURT_BY[b.by] : undefined;
    const cause = by ?? this.causes[chIdx] ?? undefined;
    const party = by !== undefined ? this.side(top).party : this.sides[chIdx] ?? false;
    this.record('death', { champion: this.championName(chIdx), cause, party: yesNo(party) });
  }

  private record(kind: EventKind, attrs: Record<string, string | undefined>): void {
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== '') kept[key] = value;
    const event: AchievementEvent = { kind, attrs: kept };
    this.state.record(event);
    for (const listener of this.eventListeners) listener(event);
  }

  private championName(chIdx: number): string | undefined {
    return this.game.ctx.party.state.champions[chIdx]?.name;
  }

  /** `rn`'s name as the game shows it (`RN::NameIndex`), or nothing for no object or a spell. */
  private itemName(rn: ObjectID): string | undefined {
    if (rn === OBJECT_ID_NULL || rn === OBJECT_ID_EOF || isMagicSpellRn(rn)) return undefined;
    const { ctx } = this.game;
    const index = NameIndex(ctx.dungeon, ctx.tables, ctx.party.state.facing, rn);
    return index === OBJNI_NOT_AN_OBJECT ? undefined : this.objectNames[index];
  }
}

/** Each cell of `sheet`, laid out as graphic 26, its pixels joined. */
function portraitCells(sheet: PortraitSheet): string[] {
  const cells: string[] = [];
  const cols = Math.floor(sheet.width / PORTRAIT_WIDTH);
  const rows = Math.floor(sheet.height / PORTRAIT_HEIGHT);
  for (let charID = 0; charID < cols * rows; charID++) {
    const ox = (charID % cols) * PORTRAIT_WIDTH;
    const oy = Math.floor(charID / cols) * PORTRAIT_HEIGHT;
    const cell: number[] = [];
    for (let y = 0; y < PORTRAIT_HEIGHT; y++) {
      for (let x = 0; x < PORTRAIT_WIDTH; x++) cell.push(sheet.pixels[(oy + y) * sheet.width + ox + x]!);
    }
    cells.push(cell.join());
  }
  return cells;
}

function yesNo(b: boolean): string {
  return b ? 'yes' : 'no';
}

/** A square's key in `floors`. */
function squareKey(z: number, x: number, y: number): number {
  return (z << 16) | (x << 8) | y;
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** `text`'s bytes, or `null` where it is no base 64. */
function fromBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
