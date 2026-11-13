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
 * adventure is a game of its own from there, and its history is the whole game's.
 */
import { fileDigest } from '../../data/DataSetFiles';
import { isNewAdventure } from '../Chaos';
import { OBJECT_ID_EOF, OBJECT_ID_NULL, DBType, type ObjectID } from '../../core/types';
import { OBJNI_NOT_AN_OBJECT } from '../../core/objectNameIndex';
import { FIRST_RUNE, RUNE_NAMES } from '../../core/runes';
import { isMagicSpellRn } from '../../core/spellRn';
import type { Game } from '../Game';
import type { Blow, BlowCause, Happening } from '../Happening';
import { NameIndex } from '../objectIndex';
import { isAlive } from '../rules';
import { AchievementState, type AchievementEvent, type AchievementSnapshot } from './AchievementState';
import type { AchievementDef, EventKind } from './AchievementFile';

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

/** What `kill`'s `by` and `hurt`'s are, for each blow's cause; a missile's is the kill's `throw` or `spell`. */
const KILL_BY: Partial<Record<BlowCause, string>> = {
  melee: 'melee', explosion: 'explosion', cloud: 'cloud', door: 'door', pit: 'pit', fusion: 'fusion',
};
const HURT_BY: Partial<Record<BlowCause, string>> = {
  monster: 'monster', missile: 'missile', explosion: 'explosion', cloud: 'cloud', door: 'door', pit: 'pit',
  wall: 'wall', poison: 'poison', starvation: 'starvation', thirst: 'thirst', fatigue: 'fatigue', potion: 'potion',
};

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
  private readonly blows: Blow[] = [];
  private vbls = 0;
  private readonly unlockListeners: ((unlocks: readonly Unlock[]) => void)[] = [];
  private readonly eventListeners: ((event: AchievementEvent) => void)[] = [];
  private readonly found: Unlock[] = [];

  /**
   * A tracker of `game`, for the achievements `defs` names, the objects named by
   * `objectNames` (`d.ObjectNames`, the set's `graphics.dat`), and `miniDat`, the set's
   * `mini.dat` where it has one, which a CSB adventure's start is read against. Until a
   * game is read it keeps a history that does not go back to the start.
   */
  constructor(
    private readonly game: Game, private readonly defs: readonly AchievementDef[], private readonly objectNames: readonly string[],
    private readonly miniDat: Uint8Array | null = null,
  ) {
    this.state = new AchievementState(defs, false);
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
    return { v: 1, state: this.state.snapshot(), missiles: party(this.missiles), clouds: party(this.clouds), causes: [...this.causes] };
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
      case 'blow': this.blows.push(h); return;
      case 'blow-end': this.blows.pop(); return;
      case 'vbl': this.vbls++; return;
      case 'monster-died': this.killed(h.type); return;
      case 'champion-hurt': this.hurt(h.chIdx); return;
      case 'champion-died': this.died(h.chIdx); return;
      case 'missile': this.missiles.set(h.missile, h.launcher >= 0 ? { party: true, champion: h.launcher } : NOBODY); return;
      case 'cloud': this.clouds.set(h.cloud, this.side(this.blows.length - 1)); return;
      case 'meal': {
        const item = h.nameIndex < 0 ? 'FOUNTAIN' : this.objectNames[h.nameIndex];
        this.record(h.eat ? 'eat' : 'drink', { champion: this.championName(h.chIdx), item });
        return;
      }
      case 'cast': {
        const runes = h.runes.filter((rune) => rune !== 0);
        // The power rune, first, is not the spell's (`"FUL IR"`).
        const spell = runes.slice(1).map((rune) => RUNE_NAMES[rune - FIRST_RUNE] ?? `${rune}`).join(' ');
        this.record('cast', { champion: this.championName(h.chIdx), spell, ok: yesNo(h.ok) });
        return;
      }
      case 'wear':
        this.record('wear', { champion: this.championName(h.chIdx), slot: WORN_SLOTS[h.slot], item: this.itemName(h.object) });
        return;
      case 'joined':
        this.record('join', { champion: this.championName(h.chIdx), how: h.reincarnated ? 'reincarnate' : 'resurrect' });
        return;
      case 'tick': this.tick(); return;
      case 'ended':
        this.sample();
        this.state.ended(h.won);
        this.evaluate();
        return;
      case 'new-game': this.begin(null, true); return;
      case 'saved': this.snapshots.set(fileDigest(h.file), this.snapshot()); return;
      case 'read': {
        const kept = this.snapshots.get(fileDigest(h.file)) ?? null;
        this.begin(kept, kept === null && this.miniDat !== null && isNewAdventure(h.file, this.miniDat));
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
    this.missiles.clear();
    this.clouds.clear();
    this.causes = [null, null, null, null];
    this.vbls = 0;
    if (!kept) {
      this.state = new AchievementState(this.defs, whole);
      return;
    }
    this.state = AchievementState.restore(this.defs, kept.state);
    for (const [rn, champion] of kept.missiles) this.missiles.set(rn, { party: true, champion });
    for (const [rn, champion] of kept.clouds) this.clouds.set(rn, { party: true, champion });
    this.causes = [...kept.causes];
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
    this.state.setGameTime(ctx.state.tickCount);
    this.state.addVbls(this.vbls);
    this.vbls = 0;
  }

  private evaluate(): void {
    const ids = this.state.evaluate();
    if (ids.length === 0) return;
    const gameTime = this.game.ctx.state.tickCount;
    const vbls = this.state.snapshot().vbls;
    const unlocks = ids.map((id) => ({ id, gameTime, vbls }));
    this.found.push(...unlocks);
    for (const listener of this.unlockListeners) listener(unlocks);
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

  private killed(type: number): void {
    const top = this.blows.length - 1;
    const b = this.blows[top];
    const attrs: Record<string, string | undefined> = { monster: MONSTER_NAMES[type] ?? `${type}` };
    if (b) {
      const side = this.side(top);
      attrs.party = yesNo(side.party);
      if (side.champion >= 0) attrs.champion = this.championName(side.champion);
      if (b.by === 'missile') {
        const spell = b.item !== undefined && isMagicSpellRn(b.item);
        attrs.by = spell ? 'spell' : 'throw';
        if (!spell && b.item !== undefined) attrs.item = this.itemName(b.item);
      } else {
        attrs.by = KILL_BY[b.by];
        if (b.by === 'melee' && b.item !== undefined) attrs.item = this.itemName(b.item);
        if (b.by === 'explosion') {
          // A bomb's blast is a blow inside its explosion's, which names the bomb.
          for (let i = top; i >= 0 && this.blows[i]!.by === 'explosion'; i--) {
            const item = this.blows[i]!.item;
            if (item !== undefined) { attrs.item = this.itemName(item); break; }
          }
        }
      }
    } else {
      attrs.party = 'no';
    }
    this.record('kill', attrs);
  }

  private hurt(chIdx: number): void {
    const top = this.blows.length - 1;
    const b = this.blows[top];
    const by = b ? HURT_BY[b.by] : undefined;
    if (chIdx >= 0 && chIdx < this.causes.length) this.causes[chIdx] = by ?? null;
    this.record('hurt', { champion: this.championName(chIdx), by, party: yesNo(b ? this.side(top).party : false) });
  }

  /** A death: inside a blow, the blow's cause; else the last damage the champion took, pending till the tick. */
  private died(chIdx: number): void {
    const b = this.blows[this.blows.length - 1];
    const cause = (b ? HURT_BY[b.by] : undefined) ?? this.causes[chIdx] ?? undefined;
    this.record('death', { champion: this.championName(chIdx), cause });
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

function yesNo(b: boolean): string {
  return b ? 'yes' : 'no';
}
