import {
  DBType,
  OBJECT_ID_EOF,
  type ObjectID,
  type LocationRel,
  Position,
  RoomType,
  rnEquals,
  getRoomType,
} from '../core/types';
import { die } from './Die';
import type { ActuatorRecord, DsaDefinition } from '../data/dungeonTypes';
import {
  getActuatorDsaSelector,
  getActuatorDsaState,
  getActuatorParameterB,
  getActuatorType,
  setActuatorDsaState,
  setActuatorParameterB,
} from '../data/actuatorHelpers';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { TimerFunction } from './TimerQueue';
import type { TimerEntry, TimerQueue } from './TimerQueue';
import { messageParametersKey, readGlobalVariables } from '../data/CsbwinExpool';
import { DsaBank, DsaInterpreter, DsaOverride, type ExecutionPacket, type GearJump } from './dsa/DsaMachine';
import { DSA_OPERATIONS, type DsaOperationMachine } from './dsa/DsaOperations';
import { globalText } from './dsa/ops/messages';
import { DsaFilters } from './dsa/DsaFilters';
import { DsaVars } from './dsa/DsaTypes';

/**
 * `sizeof(ATTACKPARAMETERS)` — what `SetupDSAParam` writes into `pDSAparameters[0]`
 * (`doc/CSBwin-src/Attack.cpp:1361`). It is a byte count where every other filter
 * stores a word count, which is CSBWin's own inconsistency; since `PARAM_FETCH`
 * clamps its request to 100 first, an over-large count behaves as "all of them".
 */
const PARTY_ATTACK_PARAM_SIZEOF = 124;
/** The `ATTACKPARAMETERS` words, `sizeof(ATTACKPARAMETERS) / 4`. */
const PARTY_ATTACK_PARAM_WORDS = PARTY_ATTACK_PARAM_SIZEOF / 4;

export class DsaSystem {
  private readonly dungeon: DungeonState;
  private readonly timers: TimerQueue;
  /** `d.Byte1596`, the room-type timer functions. */
  private readonly byte1596: ArrayLike<number>;
  private parameters: Int32Array = new Int32Array(101);
  /** The filter sites, which hand a dungeon's DSAs a block and read back what they leave. */
  readonly filters: DsaFilters;
  private adjustSkillsParameters = new Int32Array(5);
  /**
   * `globalVariables` — where a dungeon's DSAs keep their puzzle progress, so a read
   * has to carry them (`getGlobalVariables` / `setGlobalVariables`). Its length is
   * `numGlobalVariables`: a game read takes both from its `EXPOOL`
   * (`readGlobalVariables`), and a save puts them back (`Expool.storeGlobalVariables`).
   */
  private globalVariables: Int32Array;
  /**
   * `parameterMessageSequence` (`doc/CSBwin-src/data.cpp:89`): the `uByte5` of the next
   * `TT_ParameterMessage` timer, so that two set at one time run in the order they were
   * set (`TIMER::operator<`, `Timer.cpp:779-791`). Back to 0 at every `d.Time++`
   * (`CSBCode.cpp:686`, `Attack.cpp:2212`) and at a load (`SaveGame.cpp:1749`).
   */
  parameterMessageSequence = 0;
  /**
   * `disableSaves` (`doc/CSBwin-src/data.cpp:58`), which `&DISABLESAVES` sets: while it
   * holds, nothing saves the game (`GameSaves`). A read takes it from its `EXPOOL` record
   * (`readDisableSaves`), and a save writes that record (`Expool.writeDisableSaves`).
   */
  disableSaves = false;
  /** The `&` operations warned of once; the interpreter warns of its commands apart. */
  private warnedOps = new Set<number>();
  private readonly override = new DsaOverride();
  /** `Execute` and its commands, which run a DSA's programs. */
  private readonly interpreter: DsaInterpreter;
  /** What the operations of `DSA_OPERATIONS` reach of the machine, and what a tool hands one of them. */
  readonly operationMachine: DsaOperationMachine;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.timers = ctx.timers;
    this.byte1596 = ctx.tables.byte1596;
    this.globalVariables = Int32Array.from(readGlobalVariables(ctx.dungeon.getData()));
    this.interpreter = new DsaInterpreter({
      ctx,
      override: this.override,
      globalVariables: () => this.globalVariables,
      executeAmpersand: (subcode, bank, exPkt) => this.executeAmpersand(subcode, bank, exPkt),
      queueDsaSwitchAction: (delay, tmrAct, level, x, y, pos, morD) =>
        this.queueDsaSwitchAction(delay, tmrAct, level, x, y, pos, morD),
    });
    this.filters = new DsaFilters(ctx, {
      setParameters: (count, values) => this.setParameters(count, values),
      setParameter: (index, value) => { this.parameters[1 + index] = value; },
      getParameter: (index) => this.getParameter(index),
      newDsaParameters: (fn) => this.newDsaParameters(fn),
      storeAttackParameters: (words) => this.storeAttackParameters(words),
      adjustSkillsParameters: () => this.adjustSkillsParameters,
      runFilterDsa: (rn, timer, location, vars) => { this.processTimer6Internal(rn, timer, location, true, vars); },
      findFirstDsaActuator: (position) => this.findFirstDsaActuator(position),
      globalText: (index) => globalText(this.dungeon, index),
      isValidObjectId: (objectId): objectId is ObjectID => this.isValidObjectId(objectId),
    });
    this.operationMachine = {
      ctx,
      filters: this.filters,
      override: this.override,
      parameters: () => this.parameters,
      nextParameterMessageSequence: () => this.parameterMessageSequence++,
      setDisableSaves: (disable) => { this.disableSaves = disable; },
      isValidObjectId: (objectId): objectId is ObjectID => this.isValidObjectId(objectId),
      adjustSkillsParameters: () => this.adjustSkillsParameters,
      execute: (exPkt, bank) => this.interpreter.execute(exPkt, bank),
      executeAmpersand: (subcode, bank, exPkt) => this.executeAmpersand(subcode, bank, exPkt),
    };
  }

  setParameters(count: number, values: ArrayLike<number>): void {
    const n = Math.min(Math.max(count, 0), 100);
    this.parameters[0] = n;
    for (let i = 0; i < n; i++) {
      this.parameters[1 + i] = values[i] ?? 0;
    }
  }

  /**
   * What a room timer leaves in the DSA parameters before it reaches its square's DSAs
   * (`ProcessTT_FALSEWALL`, `doc/CSBwin-src/Timer.cpp:1399-1407`; `ProcessTT_OPENROOM`,
   * `:1699-1707`; `ProcessTT_STONEROOM`, `:2178-2186`): a parameter message's own, which
   * leave `EXPOOL`, with a count of -1 when the record is gone (`EXPOOL::Read`'s -1); a
   * count of 0 for any other timer. The words past the count stay as they were.
   */
  readRoomTimerParameters(timer: TimerEntry): void {
    if (timer.function !== TimerFunction.TT_PARAMETER_MESSAGE) {
      this.parameters[0] = 0;
      return;
    }
    const record = this.dungeon.readExpoolRecord(messageParametersKey(timer.index));
    this.parameters[0] = record === null ? -1 : record.length;
    record?.forEach((value, i) => { this.parameters[1 + i] = value; });
  }

  getParameter(index: number): number {
    if (index < 0 || index >= 100) return 0;
    return this.parameters[1 + index] ?? 0;
  }

  /**
   * `NEWDSAPARAMETERS` (`doc/CSBwin-src/CSB.h:4286-4301`): `fn` runs on a parameter array
   * of its own, whose count is 0, and the caller's is back once it returns. Every filter
   * but the party attack's is called so, and so is a DSA that `ActivateDSA` starts
   * (`doc/CSBwin-src/Timer.cpp:1525`); a program that runs one, `&EXPERIENCE+` reaching
   * the adjust-skills filter, finds its own parameters after it. CSBWin leaves the words
   * past the count uninitialised; `&PARAM@` reads none past the count, so the port's
   * zeros cannot be told from them.
   */
  newDsaParameters<T>(fn: () => T): T {
    const saved = this.parameters;
    this.parameters = new Int32Array(101);
    try {
      return fn();
    } finally {
      this.parameters = saved;
    }
  }

  /**
   * `SetupDSAParam`'s part in the DSA parameters (`doc/CSBwin-src/Attack.cpp:1358-1360`):
   * `_Attack` lays its `ATTACKPARAMETERS` over the current array, with no
   * `NEWDSAPARAMETERS`, so at every attack, filter or none, the count becomes 124 and
   * the 31 words 0. The words past them keep what they held.
   */
  setupAttackParameters(): void {
    this.parameters[0] = PARTY_ATTACK_PARAM_SIZEOF;
    this.parameters.fill(0, 1, 1 + PARTY_ATTACK_PARAM_WORDS);
  }

  /**
   * The attack's words, which CSBWin writes into the current array as it goes: the port
   * keeps them in `AttackSystem`'s `PartyAttackParameters`, and copies them in before a
   * party attack filter runs and when the attack is over, where a DSA can read them.
   */
  storeAttackParameters(words: ArrayLike<number>): void {
    for (let i = 0; i < PARTY_ATTACK_PARAM_WORDS; i++) this.parameters[1 + i] = words[i] ?? 0;
  }

  /**
   * `ProcessDSATimer5` (`doc/CSBwin-src/DSA.cpp:5297-5303`): the DSA `rn` at `location`,
   * which `timer` reaches, on variables of its own and not as a filter's. `ProcessTT_OPENROOM`
   * runs it (`Timer.cpp:1757`), and so does `ActivateDSA` (`:1534`). True when the run
   * deleted `rn`, so the caller's walk of the square's chain stops.
   */
  processTimer5(rn: ObjectID, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  /**
   * `ProcessDSATimer6` as `ProcessTT_STONEROOM` calls it (`doc/CSBwin-src/Timer.cpp:2230`):
   * `processTimer5`'s run, on variables of its own and not as a filter's.
   */
  processTimer6(rn: ObjectID, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  /**
   * `ProcessDSATimer7` (`doc/CSBwin-src/DSA.cpp:5305-5311`), which `ProcessTT_FALSEWALL`
   * runs (`Timer.cpp:1433`): `processTimer5`'s run.
   */
  processTimer7(rn: ObjectID, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  /** The DSA global variables, all `numGlobalVariables`, for the state a read restores (`RuntimeSave.ts`). */
  getGlobalVariables(): number[] {
    return Array.from(this.globalVariables);
  }

  /** `globalVariables[index]`, or null at or past `numGlobalVariables` (`SubstituteGlobalVariable`). */
  getGlobalVariable(index: number): number | null {
    return index >= 0 && index < this.globalVariables.length ? this.globalVariables[index]! : null;
  }

  /** The DSA global variables, and their number, `numGlobalVariables`. */
  setGlobalVariables(values: readonly number[]): void {
    this.globalVariables = Int32Array.from(values, (value) => value | 0);
  }

  private processTimer6Internal(
    rn: ObjectID,
    timer: TimerEntry,
    location: Position,
    filter: boolean,
    vars: DsaVars,
  ): boolean {
    const action = this.ctx.systems.timer.getTimerAction(timer);
    if (action === 3) return false;
    const level = location.z;
    const slaveRecord = this.dungeon.getActuatorRecord(rn);
    if (!slaveRecord) return false;
    const slaveSelector = getActuatorDsaSelector(slaveRecord);
    const slaveIndex = this.getAbsDsaIndex(level, slaveSelector);
    if (slaveIndex === null) return false;
    const slaveDsa = this.getDsa(slaveIndex);
    if (!slaveDsa) return false;

    const locrSlave: LocationRel = {
      l: level,
      x: location.x,
      y: location.y,
      p: this.dungeon.rnMaps.pos(rn) & 3,
    };
    const master = this.findMaster(slaveDsa, rn, timer.uByte6, timer.uByte7, locrSlave);
    const masterRecord = this.dungeon.getActuatorRecord(master.rn);
    if (!masterRecord) return false;
    const masterSelector = getActuatorDsaSelector(masterRecord);
    const masterIndex = this.getAbsDsaIndex(level, masterSelector);
    if (masterIndex === null) return false;
    const masterDsa = this.getDsa(masterIndex);
    if (!masterDsa) return false;

    const currentState = this.getState(masterRecord, masterDsa);
    const msgType = 3 * (timer.uByte8 & 3) + action;
    // An `OVERRIDE` no operation used dies with its run (`doc/CSBwin-src/DSA.cpp:5417`),
    // and a run nested in another's clears the caller's.
    this.override.p = false;

    const bank = new DsaBank(vars, (line) => this.ctx.host.trace(line), (errorNum, underflow) =>
      die(this.ctx.host, errorNum, underflow ? this.interpreter.debugMessage('DSA stack underflow') : 'SystemError'));
    bank.stack.clear();
    bank.filter = filter;
    const finalState = this.interpreter.execute({
      curState: currentState,
      column: msgType,
      locrMaster: master.locr,
      locrSlave,
      rnMaster: master.rn,
      rnSlave: rn,
      master: masterDsa,
      slave: slaveDsa,
      subroutineLevel: 0,
    }, bank);

    // `PutState` whatever `Execute` returned, -1 included (`doc/CSBwin-src/DSA.cpp:5463-5464`).
    const nextState = bank.forceState >= 0 ? bank.forceState : finalState;
    this.putState(masterRecord, masterDsa, nextState);
    // `ProcessDSATimer6` returns `deletedSlave` (`doc/CSBwin-src/DSA.cpp:5484-5487`),
    // and every timer walk that runs a DSA breaks out of the cell's chain on it
    // (`Timer.cpp:1433`, `:1757`, `:2230`) — the slave's link is no longer the cell's.
    return this.consumateDeletes(bank, rn);
  }

  /**
   * `DSADBANK::ConsumateDeletes` (`doc/CSBwin-src/DSA.cpp:179-192`) — free everything
   * `&DEL` condemned during the run, and say whether the DSA's own actuator was among
   * it. `==` on an `RN` compares the indirect index alone (`CSBTypes.h:355`).
   */
  private consumateDeletes(bank: DsaBank, rnSlave: ObjectID): boolean {
    let result = false;
    while (bank.objectDeleteList !== OBJECT_ID_EOF) {
      const obj = bank.objectDeleteList;
      if (rnEquals(obj, rnSlave)) result = true;
      bank.objectDeleteList = this.dungeon.getDBRecordLink(obj);
      this.dungeon.deleteDBEntry(obj);
    }
    return result;
  }

  /**
   * `EX_AMPERSAND`'s switch (`doc/CSBwin-src/DSA.cpp:2393-4983`): an operation of
   * `DSA_OPERATIONS`, else the default's warning, once a subcode. Public so that `tools/`
   * can watch an operation run, in the middle of a program.
   */
  executeAmpersand(subcode: number, bank: DsaBank, exPkt: ExecutionPacket): GearJump | void {
    const operation = DSA_OPERATIONS.get(subcode);
    if (operation) return operation(bank, exPkt, this.operationMachine);
    if (!this.warnedOps.has(subcode)) {
      this.warnedOps.add(subcode);
      this.ctx.host.trace(`Unimplemented DSA & opcode ${subcode}`);
    }
  }

  private getDsa(index: number): DsaDefinition | null {
    const dsaIndex = this.dungeon.getData().dsaIndex;
    if (!dsaIndex) return null;
    return dsaIndex.entries[index] ?? null;
  }

  private getAbsDsaIndex(level: number, selector: number): number | null {
    const idx = this.dungeon.getDsaLevelIndex(level, selector);
    if (idx === null || idx === undefined) return null;
    if (idx > 255) return null;
    return idx;
  }

  /**
   * `FindMaster` (`doc/CSBwin-src/DSA.cpp:535-548`). CSBWin implements no slave DSA: a
   * DSA is its own master unless its `LocalState()` is 3 (`IsMaster`, `Data.h:2479-2482`),
   * and for one that is, it warns and runs the slave as its master all the same. The
   * slave's master coordinates are then left unset, so the port takes the timer's, as
   * for a master. No dungeon here has a DSA whose local state is 3.
   */
  private findMaster(slave: DsaDefinition, rnSlave: ObjectID, x: number, y: number, locrSlave: LocationRel): {
    rn: ObjectID;
    locr: LocationRel;
  } {
    if (slave.localState !== 3) {
      return { rn: rnSlave, locr: { l: locrSlave.l, x, y, p: locrSlave.p } };
    }
    this.ctx.host.trace('Slave DSA Not Implemented');
    return { rn: rnSlave, locr: { l: locrSlave.l, x, y, p: locrSlave.p } };
  }

  private getState(rec: ActuatorRecord, dsa: DsaDefinition): number {
    switch (dsa.localState) {
      case 0:
        return getActuatorDsaState(rec);
      case 1:
        return dsa.state;
      case 2:
        return getActuatorParameterB(rec);
      default:
        this.ctx.host.trace(`Illegal DSA localState ${dsa.localState}`);
        return 0;
    }
  }

  private putState(rec: ActuatorRecord, dsa: DsaDefinition, state: number): void {
    switch (dsa.localState) {
      case 0:
        setActuatorDsaState(rec, state);
        break;
      case 1:
        // `void State(i32 s){m_state = (ui16)s;}` (`doc/CSBwin-src/Data.h:2483`).
        dsa.state = state & 0xffff;
        break;
      case 2:
        setActuatorParameterB(rec, state);
        break;
      default:
        this.ctx.host.trace(`Illegal DSA localState ${dsa.localState}`);
        break;
    }
  }

  /**
   * `QueueDSASwitchAction` (`doc/CSBwin-src/DSA.cpp:486-533`): a set, clear or toggle
   * (`tmrAct` 0, 1, 2) sent `delay` ticks on to a cell, as the timer its room type takes
   * (`'M'`), or as a `TT_DESSAGE` (`'D'`). A DSA's `MESSAGE` sends it, and so does a
   * portrait the Hall of Champions disables (`PortraitTranslateDisable`,
   * `CSBCode.cpp:6648-6671`).
   */
  queueDsaSwitchAction(
    delay: number,
    tmrAct: number,
    level: number,
    targetX: number,
    targetY: number,
    targetPos: number,
    morD: 'M' | 'D',
  ): void {
    const actionTime = (this.ctx.state.tickCount + delay) >>> 0;

    if (morD === 'M') {
      const map = this.dungeon.getMap(level);
      if (!map) return;
      const cellFlag = map.cellFlags[targetX]?.[targetY];
      if (cellFlag === undefined) return;
      const roomType = getRoomType(cellFlag);
      if (roomType !== RoomType.STONE && roomType !== RoomType.FALSEWALL) {
        targetPos = 0;
      }
      const mapping = this.byte1596[roomType]!;
      if (mapping === 0) {
        this.ctx.host.trace(`Illegal DSA timer target (${targetX},${targetY}) L${level}`);
        return;
      }
      this.timers.createTimer({
        function: mapping,
        uByte6: targetX,
        uByte7: targetY,
        uByte8: targetPos,
        uByte9: tmrAct,
        time: actionTime,
        level,
      });
      return;
    }

    this.timers.createTimer({
      function: TimerFunction.TT_DESSAGE,
      uByte6: targetX,
      uByte7: targetY,
      uByte8: targetPos,
      uByte9: tmrAct,
      time: actionTime,
      level,
    });
  }

  private findFirstDsaActuator(position: Position): ObjectID {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      if (getActuatorType(rec) === 47) return rn;
    }
    return OBJECT_ID_EOF;
  }

  /** `RN::checkIndirectIndex(i)` (`doc/CSBwin-src/data.cpp:530-535`): a slot of the maps. */
  private isValidObjectId(objectId: number): objectId is ObjectID {
    return objectId >= 0 && this.dungeon.rnMaps.checkIndirectIndex(objectId);
  }

}
