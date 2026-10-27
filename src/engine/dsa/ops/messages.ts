import { DBType, OBJECT_ID_EOF, Position, locationRelFromInteger, locationRelToInteger } from '../../../core/types';
import { decodeCharField } from '../../../data/CsbwinSaveInfo';
import { globalTextBytes, globalTextKey, messageParametersKey } from '../../../data/CsbwinExpool';
import { GetText } from '../../../data/DecodeText';
import type { DungeonState } from '../../DungeonState';
import type { GameContext } from '../../GameContext';
import { findChampionByFingerprint } from '../../Party';
import { printWithSubstitution } from '../../PrintWithSubstitution';
import { TimerFunction } from '../../TimerQueue';
import { locateInWings } from '../../Wings';
import { StkOp } from '../DsaTypes';
import type { ViewingFilterContext } from '../DsaFilters';
import type { DsaOperation } from '../DsaOperations';

/**
 * `ModifyDescription` (`doc/CSBwin-src/Character.cpp:3814-3847`): the phrase `index` of
 * the viewing filter's description, its colour, and its text from the square's texts.
 */
function modifyDescription(ctx: GameContext, viewing: ViewingFilterContext | null, locrInt: number, index: number, color: number): void {
  if (!viewing) return;
  if (index < 0 || index > 7) return;
  viewing.phraseColorOverrides[index] = color | 0;
  if (locrInt === -1) {
    viewing.phraseMask |= 1 << index;
    return;
  }
  if (locrInt === -2) {
    viewing.phraseMask &= ~(1 << index);
    return;
  }
  // Every text at the location sets the phrase, so the last wins, and an empty one
  // enables it too. CSBWin checks no `IsValid`: `FindFirstObject` finds nothing off the
  // level's cells, and the port nothing on a level that does not exist, where CSBWin
  // reads past its tables.
  const dungeon = ctx.dungeon;
  const locr = locationRelFromInteger(locrInt);
  const pos = new Position(locr.x, locr.y, locr.l);
  for (let rn = dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const { category, position } = dungeon.rnMaps.decode(rn);
    if (category !== DBType.TEXT) continue;
    if (position !== locr.p) continue;
    const record = dungeon.getTextRecord(rn);
    if (!record) continue;
    viewing.phraseTextOverrides[index] = GetText(dungeon.getData(), record.textOffset, ctx.tables.textDecode);
    viewing.phraseMask |= 1 << index;
  }
}

/**
 * `(char *)pRecord` of the `EXPOOL`'s global text `index`, as the action name filter reads
 * it (`doc/CSBwin-src/CSBCode.cpp:8807-8815`): its bytes, in memory order, up to the first
 * 0. Null when there is no such record, or an empty one.
 */
export function globalText(dungeon: DungeonState, index: number): string | null {
  const record = dungeon.locateExpoolRecord(globalTextKey(index));
  if (record === null || record.length === 0) return null;
  return String.fromCharCode(...globalTextBytes(record));
}

/**
 * `SetGlobalText` (`doc/CSBwin-src/CSBCode.cpp:5360-5372`): the text, at most 99 bytes
 * and its zero, as the `EXPOOL` record `(EDT_GlobalText << 24) | index`, four bytes to a
 * longword in memory order. The record is `(len + 4) / 4` longwords; CSBWin fills the
 * bytes past the zero from an uninitialised buffer, the port with zeros. A new record
 * goes in front of the old, which stays in the pool.
 */
function setGlobalText(dungeon: DungeonState, text: string, index: number): void {
  const len = Math.min(text.length, 99);
  const record = new Array<number>(Math.floor((len + 4) / 4)).fill(0);
  for (let i = 0; i < len; i++) record[i >> 2] = (record[i >> 2]! | ((text.charCodeAt(i) & 0xff) << (8 * (i & 3)))) >>> 0;
  dungeon.writeExpoolRecord(globalTextKey(index), record);
}

/**
 * Text, messages and the sound: `EX_AMPERSAND`'s cases (`doc/CSBwin-src/DSA.cpp:3046`,
 * `:3138-3253`, `&SOUND` at `:4613`, `&DESCRIBE` at `:4640` and `&MODIFYMESSAGE` at
 * `:4932`), in the order the port's switch had them.
 */
export const messageOperations: ReadonlyMap<StkOp, DsaOperation> = new Map<StkOp, DsaOperation>([
  [StkOp.MESSAGE, (bank, _exPkt, machine) => {
    // `STKOP_Message` (`doc/CSBwin-src/DSA.cpp:3046-3090`): a `TT_ParameterMessage`
    // timer to the target, and the first `numParam` DSA parameters in `EXPOOL` under
    // its index, for the DSAs it reaches (`readRoomTimerParameters`).
    const { ctx, override } = machine;
    const delay = bank.stack.pop() >>> 0;
    const numParam = bank.stack.pop() >>> 0;
    const msgType = bank.stack.pop();
    const target = locationRelFromInteger(bank.stack.pop());
    if (numParam > 29) return;
    if (override.p) {
      target.p = override.pos & 3;
      override.p = false;
    }
    const actionTime = (ctx.state.tickCount + delay) >>> 0;
    const timer = ctx.timers.createTimer({
      function: TimerFunction.TT_PARAMETER_MESSAGE,
      uByte5: machine.nextParameterMessageSequence(),
      uByte6: target.x,
      uByte7: target.y,
      uByte8: target.p,
      uByte9: msgType,
      time: actionTime,
      level: target.l,
    });
    ctx.dungeon.writeExpoolRecord(messageParametersKey(timer.index), Array.from(machine.parameters().subarray(1, 1 + numParam)));
  }],
  [StkOp.SOUND, (bank, _exPkt, { ctx }) => {
    // `STKOP_Sound` (`doc/CSBwin-src/DSA.cpp:4613-4625`).
    bank.stack.pop(); // flags, which `PlayCustomSound` does not use
    const volume = bank.stack.pop();
    const soundNum = bank.stack.pop();
    ctx.sounds.playCustomSound(soundNum, volume);
  }],
  [StkOp.DESCRIBE, (bank, _exPkt, { ctx, filters, override }) => {
    // `doc/CSBwin-src/DSA.cpp:4640-4663`.
    const color = bank.stack.pop();
    const index = bank.stack.pop();
    let locrInt = bank.stack.pop();
    if (override.p) {
      override.p = false;
      if (locrInt >= 0) {
        const locr = locationRelFromInteger(locrInt);
        locr.p = override.pos & 0x3;
        locrInt = locationRelToInteger(locr);
      }
    }
    modifyDescription(ctx, filters.viewingFilterContext, locrInt, index, color);
  }],
  [StkOp.MODIFY_MESSAGE, (bank, _exPkt, { ctx }) => {
    // Popped `unsigned int` and capped at 3, no action (`doc/CSBwin-src/DSA.cpp:4936-4944`).
    const s = Math.min(bank.stack.pop() >>> 0, 3);
    const c = Math.min(bank.stack.pop() >>> 0, 3);
    const t = Math.min(bank.stack.pop() >>> 0, 3);
    const modifier = ctx.systems.timer.timerTypeModifier;
    modifier[0] = s;
    modifier[1] = c;
    modifier[2] = t;
  }],
  [StkOp.SAY, (bank, _exPkt, { ctx }) => {
    // `DSA.cpp:3138-3161`: the first text of the square, at any corner.
    const dungeon = ctx.dungeon;
    const color = bank.stack.pop();
    const locr = locationRelFromInteger(bank.stack.pop());
    if (!dungeon.isValidLocation(locr)) return;
    let rn = dungeon.findFirstObject(new Position(locr.x, locr.y, locr.l));
    while (rn !== OBJECT_ID_EOF && dungeon.rnMaps.dbType(rn) !== DBType.TEXT) {
      rn = dungeon.getDBRecordLink(rn);
    }
    if (rn === OBJECT_ID_EOF) return;
    const record = dungeon.getTextRecord(rn);
    if (!record) return;
    const text = dungeon.decodeTextString(record, 0x8002, ctx.tables.textDecode, 999) ?? '';
    printWithSubstitution(ctx, text, color);
  }],
  [StkOp.DISCARD_TEXT, (_bank, _exPkt, { ctx }) => {
    // `DSA.cpp:3162-3168`.
    ctx.host.messages.discardText();
  }],
  [StkOp.TEXT_FETCH, (bank, _exPkt, machine) => {
    // `DSA.cpp:3169-3194`.
    const dungeon = machine.ctx.dungeon;
    const textIndex = bank.stack.pop() >>> 0;
    const objIndex = bank.stack.pop();
    if (textIndex > 9) return;
    if (!machine.isValidObjectId(objIndex)) return;
    if (dungeon.rnMaps.dbType(objIndex) !== DBType.TEXT) return;
    const record = dungeon.getTextRecord(objIndex);
    if (!record) return;
    bank.setText(dungeon.decodeTextString(record, 0x8002, machine.ctx.tables.textDecode, 999) ?? '', textIndex);
  }],
  [StkOp.GLOBAL_TEXT_STORE, (bank, _exPkt, { ctx }) => {
    // `DSA.cpp:3195-3203`.
    const globalIndex = bank.stack.pop();
    const localIndex = bank.stack.pop();
    setGlobalText(ctx.dungeon, bank.getText(localIndex), globalIndex);
  }],
  [StkOp.CHAR_NAME_FETCH, (bank, _exPkt, { ctx }) => {
    // `DSA.cpp:3205-3238`: the first champion with the fingerprint, else the one in
    // the wings (`LocateInWings`).
    // `SetText(pName, 8, index)` copies nine bytes, the name's eight and a ninth:
    // only a name of eight letters, which runs on into the title, would show it.
    const index = bank.stack.pop() & 0xffff;
    const fingerprint = bank.stack.pop() & 0xffff;
    const party = ctx.party.state;
    const charIdx = findChampionByFingerprint(party, fingerprint);
    const inWings = charIdx >= 0 ? null : locateInWings(ctx.dungeon, fingerprint);
    const name = charIdx >= 0 ? party.champions[charIdx]!.name : inWings ? decodeCharField(inWings.subarray(0, 8)) : '';
    bank.setText(name.slice(0, 8), index);
  }],
  [StkOp.TEXT_SAY, (bank, _exPkt, { ctx }) => {
    // `DSA.cpp:3240-3253`.
    const color = bank.stack.pop();
    const index = bank.stack.pop();
    printWithSubstitution(ctx, bank.getText(index), color);
  }],
]);
