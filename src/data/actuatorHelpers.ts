import type { ActuatorRecord } from './dungeonTypes';

// CSBWin DB3 (Actuator) bitfield helpers from CSB.h/data.cpp.
export enum ActuatorAction {
  SET = 0,
  CLEAR = 1,
  TOGGLE = 2,
  CONSTPRESSURE = 3,
}

export function getActuatorType(rec: ActuatorRecord): number {
  return rec.word2 & 0x7f;
}

export function setActuatorType(rec: ActuatorRecord, type: number): void {
  rec.word2 = (rec.word2 & ~0x7f) | (type & 0x7f);
}

export function getActuatorValue(rec: ActuatorRecord): number {
  return (rec.word2 >> 7) & 0x1ff;
}

export function setActuatorValue(rec: ActuatorRecord, value: number): void {
  const masked = value & 0x1ff;
  rec.word2 = (rec.word2 & 0x7f) | (masked << 7);
}

export function getActuatorDsaSelector(rec: ActuatorRecord): number {
  return (rec.word2 >> 7) & 0x1f;
}

export function getActuatorDsaState(rec: ActuatorRecord): number {
  return (rec.word2 >> 12) & 0xf;
}

export function setActuatorDsaState(rec: ActuatorRecord, state: number): void {
  rec.word2 = (rec.word2 & ~(0xf << 12)) | ((state & 0xf) << 12);
}

export function getActuatorDelay(rec: ActuatorRecord): number {
  return (rec.word4 >> 7) & 0xf;
}

export function getActuatorAction(rec: ActuatorRecord): ActuatorAction {
  return ((rec.word4 >> 3) & 0x3) as ActuatorAction;
}

export function isActuatorOnceOnly(rec: ActuatorRecord): boolean {
  return (rec.word4 & 0x4) !== 0;
}

export function isActuatorNormallyClosed(rec: ActuatorRecord): boolean {
  return (rec.word4 & 0x20) !== 0;
}

export function isActuatorAudible(rec: ActuatorRecord): boolean {
  return (rec.word4 & 0x40) !== 0;
}

export function isActuatorLocalActionOnly(rec: ActuatorRecord): boolean {
  return (rec.word4 & 0x800) !== 0;
}

export function getActuatorWallGraphicOrdinal(rec: ActuatorRecord): number {
  return (rec.word4 >> 12) & 0xf;
}

export function getActuatorTargetX(rec: ActuatorRecord): number {
  return (rec.word6 >> 6) & 0x1f;
}

export function getActuatorTargetY(rec: ActuatorRecord): number {
  return (rec.word6 >> 11) & 0x1f;
}

export function getActuatorTargetPos(rec: ActuatorRecord): number {
  return (rec.word6 >> 4) & 0x3;
}

export function getActuatorLocalActionType(rec: ActuatorRecord): number {
  return (rec.word6 >> 4) & 0xfff;
}

export function getActuatorHitPointMultiplier(rec: ActuatorRecord): number {
  return (rec.word6 >> 4) & 0xf;
}

export function getActuatorEnergyRemaining(rec: ActuatorRecord): number {
  return (rec.word6 >> 4) & 0xff;
}

export function getActuatorDisableTime(rec: ActuatorRecord): number {
  return (rec.word6 >> 8) & 0xff;
}

export function setActuatorDisableTime(rec: ActuatorRecord, value: number): void {
  rec.word6 = (rec.word6 & 0x00ff) | ((value & 0xff) << 8);
}

export function getActuatorAndOrEdge(rec: ActuatorRecord): number {
  return rec.word6 & 0x7;
}

export function getActuatorDrawAsSize4(rec: ActuatorRecord): boolean {
  return (rec.word6 & 0x1) !== 0;
}

export function getActuatorSetResponses(rec: ActuatorRecord): number {
  return (rec.word6 >> 6) & 0x3f;
}

export function getActuatorClearResponses(rec: ActuatorRecord): number {
  return rec.word6 & 0x3f;
}

export function getActuatorToggleResponses(rec: ActuatorRecord): number {
  return rec.word4 & 0x3f;
}

export function getActuatorDisableMessage(rec: ActuatorRecord): number {
  return (rec.word4 >> 6) & 0x3;
}

/** `PORTRAIT_InActive` (`doc/CSBwin-src/CSB.h:916`) — a mirror that has been used up. */
export const PORTRAIT_INACTIVE = 1;

/**
 * `PORTRAIT_Response*` (`doc/CSBwin-src/CSB.h:920-923`), what a portrait's two-bit
 * response fields hold, its `DisableMessage` among them; 0 is none.
 */
export const PORTRAIT_RESPONSE_SET = 1;
export const PORTRAIT_RESPONSE_CLEAR = 2;
export const PORTRAIT_RESPONSE_TOGGLE = 3;

/**
 * `DB3::BlockDisables` (`doc/CSBwin-src/CSB.h:1058`). Set on a portrait actuator, it
 * stops the Hall of Champions from disabling the *other* actuators on the same wall
 * (`doc/CSBwin-src/CSBCode.cpp:6759`).
 */
export function blocksDisables(rec: ActuatorRecord): boolean {
  return (rec.word4 & 0x100) !== 0;
}

export function getActuatorState(rec: ActuatorRecord): number {
  return (rec.word4 >> 9) & 0x7;
}

export function setActuatorState(rec: ActuatorRecord, state: number): void {
  rec.word4 = (rec.word4 & ~(0x7 << 9)) | ((state & 0x7) << 9);
}

export function getActuatorPosition(rec: ActuatorRecord): number {
  return (rec.word6 >> 12) & 0x3;
}

/**
 * A big actuator's `word8` as CSBWin holds it. `DB3::swap` turns `word2`, `word4` and
 * `word6` into the host's order but leaves `word8` as the file has it
 * (`doc/CSBwin-src/data.cpp:1321-1327`), so the little-endian build reads its two bytes
 * swapped, and writes them back so to a save. The record keeps the file's word read
 * big-endian, as its other words, so the file and a save read and write unchanged.
 */
export function csbwinWord8(fileWord8: number): number {
  return ((fileWord8 >> 8) | (fileWord8 << 8)) & 0xffff;
}

/**
 * `DB3::ParameterA` and `ParameterB` (`doc/CSBwin-src/data.cpp:1338-1346`): `word4` and
 * `word6`, each with two bits of `word8` above it, read as CSBWin holds it (`csbwinWord8`).
 * `word8BigEndian` (`Behaviour.actuatorWord8BigEndian`) reads the record's word as it is.
 */
export function getActuatorDsaParameters(rec: ActuatorRecord, word8BigEndian = false): { paramA: number; paramB: number } {
  if (word8BigEndian) {
    const word8 = rec.word8 ?? 0;
    const paramA = ((rec.word4 & 0xffff) | ((word8 & 0x03) << 16)) >>> 0;
    const paramB = ((rec.word6 & 0xffff) | ((word8 & 0x0c) << 14)) >>> 0;
    return { paramA, paramB };
  }
  const word8 = csbwinWord8(rec.word8 ?? 0);
  return {
    paramA: ((rec.word4 & 0xffff) | ((word8 & 3) << 16)) >>> 0,
    paramB: ((rec.word6 & 0xffff) | ((word8 & 0x0c) << 14)) >>> 0,
  };
}

export function getActuatorParameterA(rec: ActuatorRecord, word8BigEndian = false): number {
  return getActuatorDsaParameters(rec, word8BigEndian).paramA;
}

export function getActuatorParameterB(rec: ActuatorRecord, word8BigEndian = false): number {
  return getActuatorDsaParameters(rec, word8BigEndian).paramB;
}

/** `void DB3::ParameterA(ui32 v)` (`doc/CSBwin-src/data.cpp:1348-1352`), on `csbwinWord8`. */
export function setActuatorParameterA(rec: ActuatorRecord, value: number, word8BigEndian = false): void {
  if (word8BigEndian) {
    const v = value >>> 0;
    rec.word4 = v & 0xffff;
    const word8 = rec.word8 ?? 0;
    rec.word8 = (word8 & 0xfffc) | ((v >> 16) & 0x03);
    return;
  }
  const v = value >>> 0;
  rec.word4 = v & 0xffff;
  rec.word8 = csbwinWord8((csbwinWord8(rec.word8 ?? 0) & 0xfffc) | ((v >> 16) & 3));
}

/** `void DB3::ParameterB(ui32 v)` (`doc/CSBwin-src/data.cpp:1354-1358`), on `csbwinWord8`. */
export function setActuatorParameterB(rec: ActuatorRecord, value: number, word8BigEndian = false): void {
  if (word8BigEndian) {
    const v = value >>> 0;
    rec.word6 = v & 0xffff;
    const word8 = rec.word8 ?? 0;
    rec.word8 = (word8 & 0xfff3) | ((v >> 14) & 0x0c);
    return;
  }
  const v = value >>> 0;
  rec.word6 = v & 0xffff;
  rec.word8 = csbwinWord8((csbwinWord8(rec.word8 ?? 0) & 0xfff3) | ((v >> 14) & 0x0c));
}
