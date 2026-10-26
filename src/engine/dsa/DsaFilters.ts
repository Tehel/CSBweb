import {
  DBType,
  OBJECT_ID_EOF,
  OBJECT_ID_NULL,
  type ObjectID,
  type LocationRel,
  locationRelFromInteger,
  locationRelToInteger,
  Position,
} from '../../core/types';
import { getActuatorType } from '../../data/actuatorHelpers';
import { Esl, specialLocationKey } from '../../data/CsbwinExpool';
import type { DungeonState } from '../DungeonState';
import type { GameContext } from '../GameContext';
import type { TimerEntry } from '../TimerQueue';
import { MonsterEvents, type MmRecord } from '../MmRecord';
import type { SpellParameters } from '../magicTypes';
import {
  ATTACK_PARAMETER_WORDS, attackParametersFromWords, attackParametersToWords, type AttackParameters,
  DELETE_MONSTER_PARAMETER_WORDS, deleteMonsterParametersFromWords, deleteMonsterParametersToWords, type DeleteMonsterParameters,
  FEED_PARAMETER_WORDS, feedParametersFromWords, feedParametersToWords, type FeedParameters,
  PARTY_MOVE_DATA_WORDS, partyMoveDataFromWords, partyMoveDataToWords, type PartyMoveData,
  SPELL_PARAMETER_WORDS, spellParametersFromWords, spellParametersToWords,
} from '../filterParameters';
import { DsaVars, ViewingFilterSite, type CursorFilterPacket, type PartyAttackFilter, type ViewingFilterOptions, type ViewingFilterResult } from './DsaTypes';

/** `gameVolume`'s default (`doc/CSBwin-src/Data.h:42`, `data.cpp:278`). */
const VOLUME_FULL = 0;

/**
 * What the filters ask of the DSA machine: the parameters, `pDSAparameters`, and a run of
 * one DSA as `ProcessDSAFilter` starts it (`doc/CSBwin-src/DSA.cpp:5316-5328`).
 */
export interface DsaFilterMachine {
  setParameters(count: number, values: ArrayLike<number>): void;
  /** Word `index` alone, the count and the other words left as they are. */
  setParameter(index: number, value: number): void;
  getParameter(index: number): number;
  newDsaParameters<T>(fn: () => T): T;
  storeAttackParameters(words: ArrayLike<number>): void;
  /** `adjustSkillsParameters`, which `&SETADJUSTSKILLSPARAMETERS!` sets. */
  adjustSkillsParameters(): ArrayLike<number>;
  /** `ProcessDSATimer6` with `filter` true: the DSA `rn` at `location`, on `timer` and `vars`. */
  runFilterDsa(rn: ObjectID, timer: TimerEntry, location: Position, vars: DsaVars): void;
  findFirstDsaActuator(position: Position): ObjectID;
  globalText(index: number): string | null;
  isValidObjectId(objectId: number): objectId is ObjectID;
}

/**
 * The phrases a viewing filter's `&DESCRIBE` changes (`ModifyDescription`,
 * `doc/CSBwin-src/Character.cpp:3814-3847`), while its DSAs run.
 */
export interface ViewingFilterContext {
  phraseMask: number;
  phraseTextOverrides: Array<string | null>;
  phraseColorOverrides: Array<number | null>;
}

/**
 * A filter's parameter block, as a site hands it to each of its DSAs: `count` and the
 * words `toWords` makes of the block as the DSA before left it, and `fromWords` reading
 * back what the DSA leaves, `word(i)` its longword `i`. A site that reads nothing back
 * has no `fromWords`.
 */
interface FilterCodec {
  count: number;
  toWords(): ArrayLike<number>;
  fromWords?(word: (index: number) => number): void;
}

/**
 * How a site runs its DSAs. `newParameters` is its `NEWDSAPARAMETERS`: one around the
 * whole site, or one around each DSA; without it, the DSAs run on the caller's
 * parameters and leave them theirs. `firstOnly` is a site that `break`s once its first
 * DSA has run.
 */
interface FilterOptions {
  newParameters?: 'site' | 'each';
  firstOnly?: boolean;
}

/**
 * The timer a filter site hands `ProcessDSAFilter`: the filter's square on its level, with
 * function and position 0 (`doc/CSBwin-src/CSBCode.cpp:8788-8794`, `Sound.cpp:729-732`).
 */
function filterTimer(position: Position): TimerEntry {
  return {
    index: -1,
    time: 0,
    level: position.z & 0xff,
    function: 0,
    uByte5: 0,
    uByte6: position.x & 0xff,
    uByte7: position.y & 0xff,
    uByte8: 0,
    uByte9: 0,
    sequence: 0,
    timerWord8: 0,
    timerWord6: 0,
  };
}

/**
 * `MONSTERMOVEFILTERLOCATION` (`doc/CSBwin-src/CSB.h:441-447`): where a level's monster
 * move filter is, and when it runs. `partyLevelOnly` is the record's bit 18, or 0xffff
 * when there is no record; `filterObj` is the first type-47 actuator at `locr`, or
 * `OBJECT_ID_EOF`.
 */
interface MonsterMoveFilterLocation {
  locr: LocationRel;
  maxDistance: number;
  partyLevelOnly: number;
  filterObj: ObjectID;
}

/**
 * The filters: the sites where the game hands a dungeon's DSAs a parameter block before it
 * acts on it, and reads back what they leave. Most find their DSAs at a special location,
 * an `EXPOOL` record (`Esl`), and run them through `runFilter` with the block's codec; the
 * others keep a DSA found once (the action name, the monster move and the party attack
 * filters), or walk the square their own way (the sound, equip and viewing filters).
 */
export class DsaFilters {
  private readonly dungeon: DungeonState;
  /**
   * `monsterMoveFilterActive` (`doc/CSBwin-src/data.cpp:86`), which `ProcessDSAFilter`
   * sets while the monster move filter runs (`Monster.cpp:3233`, `:3363`) and
   * `&MONL&D` reads: before a group's turn and after it.
   */
  monsterMoveFilterActive = false;
  /**
   * `monsterMoveFilterCache` (`doc/CSBwin-src/Monster.cpp:3063`): each level's
   * `MONSTERMOVEFILTERLOCATION` once a turn on it has looked, and the dungeon's, which
   * every level without a key of its own copies. Nothing empties it (`Clear`,
   * `CSB.h:458`, has no body and no caller), so it holds for as long as the system lives.
   */
  private readonly monsterMoveFilterLocations = new Map<number, MonsterMoveFilterLocation>();
  private monsterMoveFilterGlobal: MonsterMoveFilterLocation | null = null;
  /** `SoundFilter`'s `filterActive` (`doc/CSBwin-src/Sound.cpp:677`): its DSAs are running. */
  private soundFilterActive = false;
  /**
   * `actionNameDSA` (`doc/CSBwin-src/CSBCode.cpp:8736`): `OBJECT_ID_NULL` until
   * `actionNameFilter` first looks, then the filter's DSA, or `OBJECT_ID_EOF` for none, for
   * as long as the system lives. `actionNameFilterPos` is `actionNameFilterLocr` (`:8735`).
   */
  private actionNameDsa: ObjectID = OBJECT_ID_NULL;
  private actionNameFilterPos: Position | null = null;
  /** The phrases `&DESCRIBE` changes, while a viewing filter's DSAs run; null otherwise. */
  viewingFilterContext: ViewingFilterContext | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly machine: DsaFilterMachine,
  ) {
    this.dungeon = ctx.dungeon;
  }

  /**
   * The DSAs of the filter at special location `esl`, as CSBWin's looping filter sites run
   * them (`SoundFilter`'s, `doc/CSBwin-src/Sound.cpp:686-753`, is one): `EXPOOL`'s record
   * `(EDT_SpecialLocations << 24) | esl` names the location, and every type-47 actuator on
   * its square runs in turn, a filter call apiece (`ProcessDSAFilter`), on a timer that
   * names the square with function and position 0, and on the current parameters: a site
   * with a `NEWDSAPARAMETERS` calls this inside `newDsaParameters`. `each` sets a DSA's
   * parameters, calls `run`, and reads back what it needs. False when none ran. A site
   * that `break`s once its DSA has run (`KillCharacter`'s, `Character.cpp:2591`) passes
   * `firstOnly`, and only the first runs. Each DSA has its `DSAVARS` (`Sound.cpp:726`),
   * which every `run` of it shares: `SetPossession` calls one DSA twice, the second time
   * with timer function 0 after the first's 1 (`Character.cpp:2980-2991`).
   */
  private forEachFilterDsa(esl: Esl, each: (run: (timerFunction?: number) => void) => void, firstOnly = false): boolean {
    const special = this.dungeon.getSpecialLocation(specialLocationKey(esl));
    if (special === null) return false;
    return this.forEachDsaAt(locationRelFromInteger(special), each, firstOnly);
  }

  /**
   * `forEachFilterDsa` at a location the site has found by other means: the spell
   * filter's is the dungeon's `SpellFilterLocation`, not an `EXPOOL` record. False when the
   * location is not in the dungeon, or no DSA ran.
   */
  private forEachDsaAt(
    locrFilter: LocationRel,
    each: (run: (timerFunction?: number) => void) => void,
    firstOnly = false,
  ): boolean {
    if (!this.dungeon.isValidLocation(locrFilter)) return false;
    const filterPos = new Position(locrFilter.x, locrFilter.y, locrFilter.l);
    const timer = filterTimer(filterPos);
    let found = false;
    for (let rn = this.dungeon.findFirstObject(filterPos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec || getActuatorType(rec) !== 47) continue;
      found = true;
      const vars = new DsaVars();
      each((timerFunction = 0) => {
        timer.uByte9 = timerFunction;
        this.machine.runFilterDsa(rn, timer, filterPos, vars);
      });
      if (firstOnly) break;
    }
    return found;
  }

  /**
   * A filter site that hands each DSA its block and reads it back: the DSAs at special
   * location `where`, or at `where` itself, run as `forEachFilterDsa` runs them, each on
   * `codec.count` and `codec.toWords()`, and `codec.fromWords` reads what it leaves.
   * `options` are the site's `NEWDSAPARAMETERS` and its `break`. False when none ran.
   */
  private runFilter(where: Esl | LocationRel, codec: FilterCodec, options: FilterOptions = {}): boolean {
    const once = (run: () => void): void => {
      this.machine.setParameters(codec.count, codec.toWords());
      run();
      codec.fromWords?.((i) => this.machine.getParameter(i));
    };
    const each = options.newParameters === 'each'
      ? (run: () => void) => this.machine.newDsaParameters(() => once(run))
      : once;
    const site = (): boolean => typeof where === 'number'
      ? this.forEachFilterDsa(where, each, options.firstOnly)
      : this.forEachDsaAt(where, each, options.firstOnly);
    return options.newParameters === 'site' ? this.machine.newDsaParameters(site) : site();
  }

  /**
   * `SoundFilter` (`doc/CSBwin-src/Sound.cpp:675-761`), which `QueueSound` calls with the
   * volume it chose, -1 for a sound out of earshot (`doc/CSBwin-src/CSBCode.cpp:1906`), and
   * the sound's square on its level. Every DSA at `ESL_SOUNDFILTER`'s location runs, and
   * plays the sound if it pleases (`&SOUND`). 0 when one ran, and the sound is theirs; 1
   * when none did; 2 while they run, so a sound queued meanwhile plays on.
   *
   * The nine parameters (`:735-744`): the sound's ordinal plus 1, the volume, the squared
   * distance to the party, the level, x and y, `gameVolume`, `NoSound`, and the distance in
   * hundredths, three Newton steps from the larger of `dx` and `dy`. The port has no volume
   * menu and no recording's `#NoSound` (`doc/CSBwin-src/Recording.cpp:327`): its page sets
   * its own volume, so the two are CSBWin's defaults, `VOLUME_FULL` (0) and false
   * (`doc/CSBwin-src/data.cpp:250`, `:278`).
   */
  soundFilter(soundNumber: number, highVolume: number, level: number, x: number, y: number): number {
    if (this.soundFilterActive) return 2;
    const party = this.ctx.party.state.position;
    const dx = Math.abs(party.x - x);
    const dy = Math.abs(party.y - y);
    const distanceSquared = dx * dx + dy * dy;
    let distance100 = 100 * (dx > dy ? dx : dy);
    if (distanceSquared > 0) {
      const d2 = distanceSquared * 10000;
      for (let i = 0; i < 3; i++) distance100 = Math.trunc((distance100 + Math.trunc(d2 / distance100)) / 2);
    }
    this.machine.newDsaParameters(() => this.forEachFilterDsa(Esl.SOUND_FILTER, (run) => {
      this.machine.setParameters(9, [
        soundNumber + 1, highVolume, distanceSquared, level, x, y, VOLUME_FULL, 0, distance100,
      ]);
      this.soundFilterActive = true;
      run();
    }));
    if (!this.soundFilterActive) return 1;
    this.soundFilterActive = false;
    return 0;
  }

  /**
   * The feeding filter (`doc/CSBwin-src/Character.cpp:4305-4361`), which `_FeedCharacter`
   * runs once it has worked out what the object is worth, and before anything changes:
   * every DSA at `ESL_FEEDINGFILTER`'s location in turn, each on the block as the DSA
   * before it left it, a count of 27 and the block's longwords (`:4350-4353`). Back comes
   * the block, which is what the feeding then does. `_FeedCharacter` has no
   * `NEWDSAPARAMETERS`, so the DSAs run on the caller's parameters and leave them theirs.
   */
  feedingFilter(fp: FeedParameters): FeedParameters {
    let block = fp;
    this.runFilter(Esl.FEEDING_FILTER, {
      count: FEED_PARAMETER_WORDS,
      toWords: () => feedParametersToWords(block),
      fromWords: (word) => { block = feedParametersFromWords(word); },
    });
    return block;
  }

  /**
   * `CursorFilter` (`doc/CSBwin-src/MoveObject.cpp:797-858`), which a site calls before
   * it does something to the object on the cursor: every DSA at `ESL_CURSORFILTER`'s
   * location in turn, each on the packet as the DSA before it left it, a count of 6 and
   * the packet's six words (`:846-847`). Back comes the whole packet, into `cfp`
   * (`:849`); a site that can be cancelled reads its `type` against
   * `CursorFilterType.Cancel`. There is no `NEWDSAPARAMETERS`, so the DSAs run on the
   * caller's parameters and leave them theirs.
   */
  cursorFilter(cfp: CursorFilterPacket): void {
    this.runFilter(Esl.CURSOR_FILTER, {
      count: 6,
      toWords: () => [cfp.object, cfp.type, cfp.p1, cfp.p2, cfp.p3, cfp.p4],
      fromWords: (word) => {
        cfp.object = word(0);
        cfp.type = word(1);
        cfp.p1 = word(2);
        cfp.p2 = word(3);
        cfp.p3 = word(4);
        cfp.p4 = word(5);
      },
    });
  }

  /**
   * The character death filter (`doc/CSBwin-src/Character.cpp:2540-2594`), which
   * `KillCharacter` runs before it touches the champion: the first DSA at
   * `ESL_CHARDEATHFILTER`'s location, on parameters of its own, a count of 1 and the
   * champion's index. Nothing comes back.
   */
  charDeathFilter(chIdx: number): void {
    this.runFilter(Esl.CHAR_DEATH_FILTER, { count: 1, toWords: () => [chIdx] }, { newParameters: 'site', firstOnly: true });
  }

  /**
   * The equip filter (`doc/CSBwin-src/Character.cpp:2922-3003`), which
   * `CHARDESC::SetPossession` runs before it writes slot `slot` of champion `chIdx`: the
   * first DSA at `ESL_EQUIPFILTER`'s location, on parameters of its own, a count of 4 and
   * the champion's index, the slot, an object and 0, set once (`:2973-2976`). It runs
   * twice on the same variables and parameters, only the object (`pDSAparameters[3]`) set
   * again: with timer function 1 for `leaving`, what the slot holds, and with 0 for
   * `arriving`, each when it is not `RNnul` (`:2980-2991`). Nothing comes back.
   */
  equipFilter(chIdx: number, slot: number, leaving: ObjectID, arriving: ObjectID): void {
    this.machine.newDsaParameters(() => this.forEachFilterDsa(Esl.EQUIP_FILTER, (run) => {
      this.machine.setParameters(4, [chIdx, slot, 0, 0]);
      if (leaving !== OBJECT_ID_NULL) {
        this.machine.setParameter(2, leaving);
        run(1);
      }
      if (arriving !== OBJECT_ID_NULL) {
        this.machine.setParameter(2, arriving);
        run(0);
      }
    }, true));
  }

  /**
   * `CallPartyMoveFilter` (`doc/CSBwin-src/CSBCode.cpp:7875-7935`), which `_TurnParty`,
   * `MoveParty` and `TraverseStairway` run before the party moves: the first DSA at
   * `ESL_PARTYMOVEFILTER`'s location, on parameters of its own, a count of 13 and the
   * block's longwords (`:7922-7923`). Back comes the block, all of it (`:7926`), which
   * the move then obeys; `pmd` when no DSA stands there.
   */
  partyMoveFilter(pmd: PartyMoveData): PartyMoveData {
    let block = pmd;
    this.runFilter(Esl.PARTY_MOVE_FILTER, {
      count: PARTY_MOVE_DATA_WORDS,
      toWords: () => partyMoveDataToWords(block),
      fromWords: (word) => { block = partyMoveDataFromWords(word); },
    }, { newParameters: 'site', firstOnly: true });
    return block;
  }

  /**
   * The monster attack filter (`doc/CSBwin-src/Monster.cpp:1129-1175`), which
   * `MonsterAttacks` runs once the block is filled and before it acts on it: every DSA at
   * `ESL_MONSTERATTACKFILTER`'s location in turn, each on the block as the DSA before it
   * left it, a count of 20 and the block's longwords (`:1168-1169`), and on parameters of
   * its own, a `NEWDSAPARAMETERS` apiece (`:1157`). Back comes the whole block, into `p`
   * (`:1171`).
   */
  monsterAttackFilter(p: AttackParameters): void {
    this.runFilter(Esl.MONSTER_ATTACK_FILTER, {
      count: ATTACK_PARAMETER_WORDS,
      toWords: () => attackParametersToWords(p),
      fromWords: (word) => attackParametersFromWords(p, word),
    }, { newParameters: 'each' });
  }

  /**
   * The delete monster filter (`doc/CSBwin-src/Code11f52.cpp:1000-1054`), which
   * `ProcessMonsterDeleteFilter` runs once it has counted the kill: every DSA at
   * `ESL_DELETEMONSTERFILTER`'s location in turn, each on the block as the DSA before it
   * left it, a count of 8 and the block's longwords (`:1046-1047`). Back comes the whole
   * block, into `p` (`:1049`). The function has one `NEWDSAPARAMETERS` (`:963`), so the
   * DSAs run on parameters of their own, which they share.
   */
  deleteMonsterFilter(p: DeleteMonsterParameters): void {
    this.runFilter(Esl.DELETE_MONSTER_FILTER, {
      count: DELETE_MONSTER_PARAMETER_WORDS,
      toWords: () => deleteMonsterParametersToWords(p),
      fromWords: (word) => deleteMonsterParametersFromWords(p, word),
    }, { newParameters: 'site' });
  }

  /**
   * `MONSTERMOVEFILTERCACHE::GetLocation` (`doc/CSBwin-src/Monster.cpp:3081-3170`): the
   * level's own record, keyed with `(level + 1) << 8`, and failing that the dungeon's,
   * looked up once. The record's bits 0-17 are the location, bit 18 `partyLevelOnly` and
   * bits 19-23 `maxDistance`. A level with a record of its own keeps it even when no
   * type-47 actuator stands there, and then has no filter.
   */
  private monsterMoveFilterLocation(level: number): MonsterMoveFilterLocation {
    const cached = this.monsterMoveFilterLocations.get(level);
    if (cached) return cached;
    const fromRecord = (record: number | null): MonsterMoveFilterLocation => {
      if (record === null) {
        return { locr: { l: 0, x: 0, y: 0, p: 0 }, maxDistance: 0, partyLevelOnly: 0xffff, filterObj: OBJECT_ID_EOF };
      }
      const locr = locationRelFromInteger(record & 0x03ffff);
      const filterObj = this.dungeon.isValidLocation(locr)
        ? this.machine.findFirstDsaActuator(new Position(locr.x, locr.y, locr.l))
        : OBJECT_ID_EOF;
      return { locr, maxDistance: (record & 0xf80000) >>> 19, partyLevelOnly: (record & 0x040000) >>> 18, filterObj };
    };
    let location = fromRecord(this.dungeon.getSpecialLocation(specialLocationKey(Esl.MONSTER_MOVE_FILTER, level)));
    if (location.partyLevelOnly === 0xffff) {
      this.monsterMoveFilterGlobal ??= fromRecord(this.dungeon.getSpecialLocation(specialLocationKey(Esl.MONSTER_MOVE_FILTER)));
      location = { ...this.monsterMoveFilterGlobal };
    }
    this.monsterMoveFilterLocations.set(level, location);
    return location;
  }

  /**
   * The monster move filter before a group's turn (`doc/CSBwin-src/Monster.cpp:3319-3365`),
   * which `ProcessTimers29to41` runs once it has cleared `monsterMoveInhibit`, for the
   * group `monster` at `mapX, mapY` on `level`, whose timer function is `timerFunction`.
   * It runs when that function is above 0, so never for a reaction (`TT_M1` to `TT_M3`),
   * when the level's location has a DSA, when the group is on the party's level or the
   * location's `partyLevelOnly` is 0, and when the group is within `maxDistance` of the
   * party, squared distances compared.
   *
   * Only `filterObj` runs, on parameters of its own, a count of 7: the level, the group's
   * square, the group, and the party's level and square (`:3348-3355`). Its timer has
   * function and position 0, the level, and the group's square with x in `uByte7` and y
   * in `uByte6` (`:3332-3337`), the other way round from every other filter's, so the
   * DSA's master stands at `(y, x)` (`ProcessDSATimer6`, `DSA.cpp:5409-5414`). The timer,
   * the group, its square and the DSA's variables go into `mmr`, the turn's record, for
   * the post-move filter, which runs only when this one did.
   */
  monsterMoveFilter(
    level: number,
    mapX: number,
    mapY: number,
    monster: ObjectID,
    timerFunction: number,
    mmr: MmRecord,
  ): void {
    const mmfloc = this.monsterMoveFilterLocation(level);
    const party = this.ctx.party.state.position;
    const partyX = party.x | 0;
    const partyY = party.y | 0;
    if (timerFunction <= 0 || mmfloc.filterObj === OBJECT_ID_EOF) return;
    if (mmfloc.partyLevelOnly !== 0 && level !== (party.z | 0)) return;
    if ((mapX - partyX) * (mapX - partyX) + (mapY - partyY) * (mapY - partyY) > mmfloc.maxDistance * mmfloc.maxDistance) return;
    // The group's square the other way round: x in `uByte7`, y in `uByte6`.
    mmr.timer = filterTimer(new Position(mapY, mapX, level));
    mmr.objMonster = monster;
    mmr.locr = { l: level, x: mapX, y: mapY, p: 0 };
    mmr.finalLocr = { ...mmr.locr };
    mmr.calledPreMoveFilter = true;
    this.machine.newDsaParameters(() => {
      this.machine.setParameters(7, [level, mapX, mapY, monster, party.z | 0, partyX, partyY]);
      this.runMonsterMoveFilter(mmfloc, mmr);
    });
  }

  /**
   * `ProcessPostMonsterMoveFilter` (`doc/CSBwin-src/Monster.cpp:3173-3237`), which every
   * `return` of `ProcessTimers29to41` runs, from `:3381` to `:4461`: the same DSA again,
   * when the pre-move filter ran, on the record's timer with function 1, so the DSA's
   * column 1, and the record's variables.
   *
   * Its parameters, a count of 9: where the group ended (`finalLocr`, level -1 once it
   * has left the dungeon), the group, the party's level and square, and the two words of
   * the turn's flags. `MonMove_differentCell` is set first when the group ended on
   * another square than its turn began on.
   */
  postMonsterMoveFilter(mmr: MmRecord): void {
    if (!mmr.calledPreMoveFilter || !mmr.timer) return;
    const mmfloc = this.monsterMoveFilterLocation(mmr.locr.l);
    this.machine.newDsaParameters(() => {
      const { locr, finalLocr } = mmr;
      if (locr.l !== finalLocr.l || locr.x !== finalLocr.x || locr.y !== finalLocr.y) {
        mmr.setflg(MonsterEvents.MonMove_differentCell);
      }
      mmr.timer!.function = 1;
      mmr.timer!.uByte9 = 1;
      mmr.timer!.uByte8 = 0;
      const party = this.ctx.party.state.position;
      this.machine.setParameters(9, [
        finalLocr.l, finalLocr.x, finalLocr.y, mmr.objMonster,
        party.z | 0, party.x | 0, party.y | 0, mmr.flgs[0]!, mmr.flgs[1]!,
      ]);
      this.runMonsterMoveFilter(mmfloc, mmr);
    });
  }

  /** `ProcessDSAFilter` on the level's filter DSA, the record's timer and variables. */
  private runMonsterMoveFilter(mmfloc: MonsterMoveFilterLocation, mmr: MmRecord): void {
    const filterPos = new Position(mmfloc.locr.x, mmfloc.locr.y, mmfloc.locr.l);
    this.monsterMoveFilterActive = true;
    this.machine.runFilterDsa(mmfloc.filterObj, mmr.timer!, filterPos, mmr.dsaVars);
    this.monsterMoveFilterActive = false;
  }

  /**
   * The damage filter (`doc/CSBwin-src/Character.cpp:2834-2898`), which `DamageCharacter`
   * runs on the damage it is about to add to `d.PendingDamage`: the first DSA at
   * `ESL_DAMAGECHARFILTER`'s location, on parameters of its own, a count of 7 and the
   * champion's index and fingerprint, the damage asked for, the damage worked out, the
   * wound mask, the kind, and 0 (`:2881-2888`). Back comes word 3, the damage worked out,
   * as a whole longword, of which `DamageCharacter` uses the low word (`:2891`, `:2905`);
   * `dealt` when no DSA stands there.
   */
  damageCharFilter(chIdx: number, fingerprint: number, damage: number, dealt: number, mask: number, kind: number): number {
    let result = dealt;
    this.runFilter(Esl.DAMAGE_CHAR_FILTER, {
      count: 7,
      toWords: () => [chIdx, fingerprint, damage, dealt, mask, kind, 0],
      fromWords: (word) => { result = word(3); },
    }, { newParameters: 'site', firstOnly: true });
    return result;
  }

  /**
   * `ActionNameFilter` (`doc/CSBwin-src/CSBCode.cpp:8739-8818`), which `DrawLegalAttackTypes`
   * calls for each option it offers (`:8882`): champion `charIndex`'s option
   * `actionNumber`, of `numAttackOption`, whose attack type is `attackType`. The first
   * type-47 actuator at `ESL_ACTIONNAMEFILTER`'s location runs, and only it (`:8774-8775`),
   * found at the first call and kept from then on (`actionNameDsa`).
   *
   * Its five parameters (`:8796-8801`): the champion, the option, -1, the option count and
   * the attack type. Back come parameter 4, the option's attack type from now on, as an
   * `i8` (`:8804`), and parameter 2, which below 0x10000 names a global text to show
   * instead of the attack's name, if there is such a record (`:8805-8816`); `name` is null
   * otherwise. Null when there is no DSA.
   *
   * The `NEWDSAPARAMETERS` is in the block that looks for the DSA (`:8758`), and gone when
   * it runs, so the DSA runs on the caller's parameters and leaves them its own.
   */
  actionNameFilter(
    charIndex: number,
    actionNumber: number,
    numAttackOption: number,
    attackType: number,
  ): { attackType: number; name: string | null } | null {
    if (this.actionNameDsa === OBJECT_ID_NULL) {
      this.actionNameDsa = OBJECT_ID_EOF;
      const special = this.dungeon.getSpecialLocation(specialLocationKey(Esl.ACTION_NAME_FILTER));
      if (special !== null) {
        const locr = locationRelFromInteger(special);
        if (this.dungeon.isValidLocation(locr)) {
          this.actionNameFilterPos = new Position(locr.x, locr.y, locr.l);
          this.actionNameDsa = this.machine.findFirstDsaActuator(this.actionNameFilterPos);
        }
      }
    }
    const filterPos = this.actionNameFilterPos;
    if (this.actionNameDsa === OBJECT_ID_EOF || filterPos === null) return null;
    this.machine.setParameters(5, [charIndex, actionNumber, -1, numAttackOption, attackType]);
    this.machine.runFilterDsa(this.actionNameDsa, filterTimer(filterPos), filterPos, new DsaVars());
    const textIndex = this.machine.getParameter(2) >>> 0;
    return {
      attackType: (this.machine.getParameter(4) << 24) >> 24,
      name: textIndex < 0x10000 ? this.machine.globalText(textIndex) : null,
    };
  }

  /**
   * `MissileEncounterFilter` (`doc/CSBwin-src/Code11f52.cpp:1661-1728`), which
   * `ProcessMissileEncounter` calls as a missile meets something: the first DSA at
   * `ESL_MISSILEENCOUNTERFILTER`'s location, on parameters of its own, a count of 7 and 0
   * (the default action), the encounter's type, its square and corner as a `LOCATIONREL`,
   * the missile, the projectile, the missile's direction and `index` (`:1710-1717`). Back
   * comes word 0, the action, which is not 0 when the encounter is to change (`:1719`); 0
   * when no DSA stands there.
   */
  processMissileEncounterFilter(options: {
    type: number;
    position: Position;
    posInCell: number;
    missile: number;
    projectile: number;
    direction: number;
    index: number;
  }): number {
    const encounterLoc = locationRelToInteger({
      l: options.position.z & 0x3f,
      x: options.position.x & 0x1f,
      y: options.position.y & 0x1f,
      p: options.posInCell & 0x3,
    });
    let result = 0;
    this.runFilter(Esl.MISSILE_ENCOUNTER_FILTER, {
      count: 7,
      toWords: () => [
        0,
        options.type | 0,
        encounterLoc,
        options.missile | 0,
        options.projectile | 0,
        options.direction | 0,
        options.index | 0,
      ],
      fromWords: (word) => { result = word(0); },
    }, { newParameters: 'site', firstOnly: true });
    return result;
  }

  /**
   * The viewing filter at one of `DescribeObject`'s sites: every type-47 actuator at
   * `ESL_VIEWINGFILTER`'s location runs in turn, a filter call apiece
   * (`doc/CSBwin-src/Character.cpp:3490-3532`, `:3753-3787`). No parameter comes back
   * into the mask, which only `&DESCRIBE` changes (`ModifyDescription`, `:3814-3847`).
   * At the scroll site, an object a DSA names in parameter 1 becomes the loop's own `obj`,
   * so the loop goes on down that object's chain, and is drawn if it is a scroll
   * (`:3523-3532`). `TAG019036`'s site runs them as the description's does, with
   * parameter 0 always 0 (`:4583-4586`). Null when no DSA stands there.
   */
  processViewingFilter(options: ViewingFilterOptions): ViewingFilterResult | null {
    const special = this.dungeon.getSpecialLocation(specialLocationKey(Esl.VIEWING_FILTER));
    if (special === null) return null;
    const locrFilter = locationRelFromInteger(special);
    if (!this.dungeon.isValidLocation(locrFilter)) return null;
    const filterPos = new Position(locrFilter.x, locrFilter.y, locrFilter.l);
    const timer = filterTimer(filterPos);

    const scrollSite = options.site === ViewingFilterSite.SCROLL;
    const descriptionSite = options.site === ViewingFilterSite.DESCRIPTION;
    const objectParameter = options.site === ViewingFilterSite.ATTRIBUTES ? -1 : options.objectId | 0;
    return this.machine.newDsaParameters(() => {
      const ctx: ViewingFilterContext = {
        phraseMask: options.phraseMask | 0,
        phraseTextOverrides: Array.from({ length: 8 }, () => null),
        phraseColorOverrides: Array.from({ length: 8 }, () => null),
      };
      this.viewingFilterContext = ctx;
      let found = false;
      let scroll = options.objectId;
      try {
        for (let rn = this.dungeon.findFirstObject(filterPos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
          if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
          const rec = this.dungeon.getActuatorRecord(rn);
          if (!rec || getActuatorType(rec) !== 47) continue;
          found = true;
          this.machine.setParameters(3, [
            descriptionSite ? ctx.phraseMask : 0,
            objectParameter,
            options.selectedCharacter | 0,
          ]);
          this.machine.runFilterDsa(rn, timer, filterPos, new DsaVars());
          if (!scrollSite) continue;
          const named = this.machine.getParameter(1);
          if (!this.machine.isValidObjectId(named)) continue;
          rn = named;
          if (this.dungeon.rnMaps.dbType(rn) === DBType.SCROLL) scroll = rn;
        }
      } finally {
        this.viewingFilterContext = null;
      }
      if (!found) return null;
      return {
        phraseMask: ctx.phraseMask,
        objectId: scroll,
        phraseTextOverrides: ctx.phraseTextOverrides,
        phraseColorOverrides: ctx.phraseColorOverrides,
      };
    });
  }

  /**
   * The adjust skills filter (`doc/CSBwin-src/Magic.cpp:256-316`), which `AdjustSkills`
   * runs once it has worked out the experience, and before the skill takes it: every DSA
   * at `ESL_ADJUSTSKILLSFILTER`'s location in turn, on the parameters of the function's
   * one `NEWDSAPARAMETERS` (`:199`), which they share, a count of 9 and the champion's
   * index, the skill, the experience, why, and the five `adjustSkillsParameters` that
   * `&SETADJUSTSKILLSPARAMETERS!` set (`:300-305`). Back come the first four words, which the
   * next DSA is handed; the first three, masked by the caller, are what the skill then
   * takes. Null when no DSA stands there. C187: CSBWin hands each DSA the first three
   * masked, and its own `why`.
   */
  processAdjustSkillsFilter(options: {
    chIdx: number;
    skillNumber: number;
    experience: number;
    why: number;
  }): { chIdx: number; skillNumber: number; experience: number } | null {
    let chIdx = options.chIdx | 0;
    let skillNumber = options.skillNumber | 0;
    let experience = options.experience | 0;
    let why = options.why | 0;
    const adjustSkillsParameters = this.machine.adjustSkillsParameters();

    const found = this.runFilter(Esl.ADJUST_SKILLS_FILTER, {
      count: 9,
      toWords: () => [
        chIdx,
        skillNumber,
        experience,
        why,
        adjustSkillsParameters[0] ?? 0,
        adjustSkillsParameters[1] ?? 0,
        adjustSkillsParameters[2] ?? 0,
        adjustSkillsParameters[3] ?? 0,
        adjustSkillsParameters[4] ?? 0,
      ],
      fromWords: (word) => {
        chIdx = word(0);
        skillNumber = word(1);
        experience = word(2);
        why = word(3);
      },
    }, { newParameters: 'site' });

    if (!found) return null;
    return { chIdx, skillNumber, experience };
  }

  /**
   * `SetupDSAParam` (`doc/CSBwin-src/Attack.cpp:1346`) — locate the Party Attack
   * Filter once, at the top of `_Attack`, so every later `CallAttackFilter` runs the
   * *same* actuator rather than re-searching the cell.
   *
   * Returns null when the dungeon has no such filter, which is the common case and
   * the reason `CallAttackFilter` is free.
   */
  findPartyAttackFilter(): PartyAttackFilter | null {
    const special = this.dungeon.getSpecialLocation(specialLocationKey(Esl.PARTY_ATTACK_FILTER));
    if (special === null) return null;
    const locrFilter = locationRelFromInteger(special);
    if (!this.dungeon.isValidLocation(locrFilter)) return null;
    const position = new Position(locrFilter.x, locrFilter.y, locrFilter.l);
    const actuator = this.machine.findFirstDsaActuator(position);
    return actuator === OBJECT_ID_EOF ? null : { position, actuator };
  }

  /**
   * `CallAttackFilter` (`doc/CSBwin-src/Attack.cpp:457`).
   *
   * `_Attack` calls this three times for one blow — `msg` 0 before it decides
   * anything, 1 once the attack type's own code has filled in its half of the block,
   * and 2 after everything has been applied — and the DSA sees the *same* parameter
   * block each time, mutated in place. So the caller keeps the words and passes them
   * back in; this only marshals them across.
   *
   * `msg` rides in the timer's `uByte9` (`timerFunction`), which is how the DSA tells
   * the three calls apart.
   */
  callPartyAttackFilter(filter: PartyAttackFilter, words: ArrayLike<number>, msg: number): number[] {
    const timer = filterTimer(filter.position);
    timer.uByte9 = msg & 0xff;
    this.machine.storeAttackParameters(words);
    this.machine.runFilterDsa(filter.actuator, timer, filter.position, new DsaVars());

    const out = new Array<number>(words.length);
    for (let i = 0; i < words.length; i++) out[i] = this.machine.getParameter(i);
    return out;
  }

  /**
   * `CallSpellFilter` (`doc/CSBwin-src/Magic.cpp:875-924`), which `CastMagic` and
   * `&FILTEREDCAST` run on a spell's parameters before it is cast: when the dungeon's
   * `spellFilterLocation` has its top bit, every DSA at the location its other bits name,
   * in turn, each on the block as the DSA before it left it, a count of 14 and the
   * block's longwords (`:913-916`), on parameters of their own, which they share. Back
   * comes the whole block. Null when no DSA stands there.
   */
  processSpellFilter(params: SpellParameters): SpellParameters | null {
    const location = this.dungeon.getSpellFilterLocation();
    if ((location & 0x80000000) === 0) return null;
    let updated: SpellParameters = { ...params };
    const found = this.runFilter(locationRelFromInteger(location & 0x7fffffff), {
      count: SPELL_PARAMETER_WORDS,
      toWords: () => spellParametersToWords(updated),
      fromWords: (word) => { updated = spellParametersFromWords(word); },
    }, { newParameters: 'site' });
    if (!found) return null;
    return updated;
  }
}
