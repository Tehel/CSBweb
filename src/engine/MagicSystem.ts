/**
 * `MagicSystem` — the engine half of CSBWin's `Magic.cpp`: `CastMagic` and `CastSpell`,
 * their messages (`SpellErrorMsg`, `StandardSpellMessage`), `CharacterThrowsSpell`,
 * `LaunchObject`, `LaunchMissile` (which every launch goes through, a monster's, a
 * throw's and a missile launcher's too), `DisableCharacterAction`, `SetBrightnessTimer`,
 * and `AdjustSkills` bound to the context. The rune panel, `Magic.cpp`'s UI half, is
 * `src/renderer/ui/MagicPanel.ts`.
 *
 * The other systems reach it as `ctx.systems.magic`.
 */
import type { SpellDefinition } from '../data/spellTypes';
import { applyLimits, sb, sw } from '../core/intCast';
import { OBJNI_EMPTY_FLASK } from '../core/objectNameIndex';
import { OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../core/types';
import { MSG_COLOR_SPELL } from './ActuatorSystem';
import { AttributeIndex, championAttribute } from './attributes';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { CHARFLAG_ATTACK_DISABLE, getChampionPossession } from '../core/charDesc';
import type { Champion, PartyState } from './gameTypes';
import { markAllPortraitsChanged } from './Party';
import { selectPaletteForLightLevel } from './LightLevel';
import { setClockTick, waitForButtonFlash } from './LoopState';
import type { SpellParameters } from './magicTypes';
import { encodeMissileTimerWord8, spellObjectId } from './missileHelpers';
import { GetBasicObjectType } from './objectIndex';
import { AdjustSkillsWhy } from './skills';
import { adjustSkillsOnPartyLevel, isAlive, masteryOf } from './rules';
import { TimerFunction, type TimerQueue } from './TimerQueue';

export class MagicSystem {
  private readonly dungeon: DungeonState;
  private readonly timers: TimerQueue;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.timers = ctx.timers;
  }

  /**
   * `LaunchMissile` (`doc/CSBwin-src/Magic.cpp:17`): a missile record for
   * `projectileObject`, set down in the launch cell, and its `TT_Missile` timer (or
   * `TT_Missile0` without `missileDelay`) at `startTime + 1`. CSBWin launches on
   * `d.LoadedLevel` and returns the timer index, or -1 when the missile database is
   * full; this takes the level and says whether the missile flew.
   */
  launchMissile(
    projectileObject: ObjectID,
    launchX: number,
    launchY: number,
    level: number,
    position: number,
    direction: number,
    rangeRemaining: number,
    damageRemaining: number,
    decayRate: number,
    startTime: number,
    missileDelay: boolean,
  ): boolean {
    const rn = this.createMissileRecord(projectileObject, rangeRemaining, damageRemaining, 0xffff, position);
    if (rn === null) return false;
    if (!this.dungeon.addObjectToCell(new Position(launchX, launchY, level), rn)) return false;
    const functionType = missileDelay ? TimerFunction.TT_MISSILE : TimerFunction.TT_MISSILE0;
    const timerWord8 = encodeMissileTimerWord8(launchX, launchY, direction, decayRate);
    const entry = this.timers.createTimer(functionType, launchX, launchY, 0, 0, (startTime + 1) >>> 0, level, rn, timerWord8);
    const missile = this.dungeon.getMissileRecord(rn);
    if (missile) missile.timerIndex = entry.index & 0xffff;
    return true;
  }

  /** `LaunchMissile` from a `Position`, with no delay: what a throw and a spell launch. */
  launchThrownMissile(
    projectileObject: ObjectID,
    position: Position,
    posInCell: number,
    direction: number,
    rangeRemaining: number,
    damageRemaining: number,
    decayRate: number,
    startTime: number,
  ): boolean {
    return this.launchMissile(
      projectileObject,
      position.x,
      position.y,
      position.z,
      posInCell,
      direction,
      rangeRemaining,
      damageRemaining,
      decayRate,
      startTime,
      false,
    );
  }

  private createMissileRecord(
    projectileObject: ObjectID,
    rangeRemaining: number,
    damageRemaining: number,
    timerIndex: number,
    position: number,
  ): ObjectID | null {
    // `FindEmptyDB14Entry` (`doc/CSBwin-src/CSBCode.cpp:5121`).
    const rn = this.dungeon.findEmptyDBEntry('missiles', {
      nextObject: OBJECT_ID_EOF,
      projectileObject: (projectileObject & 0xffff) as ObjectID,
      rangeRemaining: rangeRemaining & 0xff,
      damageRemaining: damageRemaining & 0xff,
      timerIndex: timerIndex & 0xffff,
    });
    return rn === OBJECT_ID_NULL ? null : this.dungeon.rnMaps.setPos(rn, position & 0x3);
  }

  /** `SetBrightnessTimer` (`doc/CSBwin-src/Magic.cpp:830-843`). */
  setBrightnessTimer(deltaSteps: number, delayTicks: number): void {
    const time = (this.ctx.state.tickCount + delayTicks) >>> 0;
    this.ctx.systems.timer.queueBrightnessTimer(deltaSteps, time);
    selectPaletteForLightLevel(this.ctx);
  }

  private castMagic(casterIdx: number): number {
    // `WaitForButtonFlash(); // If any are active.` (doc/CSBwin-src/Magic.cpp:942).
    waitForButtonFlash(this.ctx);
    const party = this.ctx.party.state;
    const champion = party.champions[casterIdx];
    if (!champion) return 0;
    if (champion.incantation.length === 0) return 0;
    const params = this.fillSpellParameters(casterIdx, champion.incantation, party);
    const filtered = this.ctx.systems.dsa.processSpellFilter(params);
    return this.castSpell(casterIdx, filtered ?? params);
  }

  /**
   * `DSACastSpell` (`doc/CSBwin-src/Magic.cpp:1408-1418`), for `&CAST` and `&FILTEREDCAST`:
   * the first fourteen words of the DSA parameters are the spell's parameters, run through
   * the spell filter for the second, and champion 0 casts unless they name another.
   * CSBWin loads the party's level around it, which is the level `castSpell` works on.
   */
  dsaCastSpell(filter: boolean): void {
    const dsa = this.ctx.systems.dsa;
    let params: SpellParameters = {
      action: dsa.getParameter(0),
      incantation: dsa.getParameter(1),
      chIdx: dsa.getParameter(2),
      disableTime: dsa.getParameter(3),
      missileType: dsa.getParameter(4),
      locationAbs: dsa.getParameter(5),
      facing: dsa.getParameter(6),
      skillRequired: dsa.getParameter(7),
      spellByte5: dsa.getParameter(8),
      spellClass: dsa.getParameter(9),
      unused1: dsa.getParameter(10),
      unused2: dsa.getParameter(11),
      unused3: dsa.getParameter(12),
      unused4: dsa.getParameter(13),
    };
    if (filter) params = dsa.processSpellFilter(params) ?? params;
    this.castSpell(0, params);
  }

  /**
   * The spell's parameters as `CastMagic` fills them for an incantation. Public so that
   * `tools/` can cast with parameters of their own (`castSpell`).
   */
  fillSpellParameters(casterIdx: number, incantation: number[], party: PartyState): SpellParameters {
    let value = 0;
    let multiplier = 1000;
    for (let i = 0; i < 4 && multiplier > 0; i += 1, multiplier = Math.floor(multiplier / 10)) {
      const rune = incantation[i] ?? 0;
      if (rune === 0) break;
      value += (rune - 0x60 - 6 * i + 1) * multiplier;
    }
    return {
      action: 0,
      incantation: value,
      chIdx: casterIdx,
      disableTime: -1,
      missileType: -1,
      locationAbs: this.encodeLocationAbs(party.position),
      facing: party.facing,
      skillRequired: -1,
      spellByte5: -1,
      spellClass: -1,
      unused1: -1,
      unused2: -1,
      unused3: -1,
      unused4: -1,
    };
  }

  /**
   * `CastSpell` (`doc/CSBwin-src/Magic.cpp:1092`). A spell filter's `action` is handled
   * before the caster is even looked at (`:1112-1151`), so its message prints for a
   * dead caster too; an `action` with no message (0, or 8 and up) casts normally.
   * Public so that `tools/` can cast with parameters of their own, as a spell filter would.
   */
  castSpell(chIdx: number, spellParameters: SpellParameters): number {
    let casterIdx = chIdx;
    if (spellParameters.chIdx !== -1) casterIdx = spellParameters.chIdx & 0xffff;
    const champion = this.ctx.party.state.champions[casterIdx];

    const abortText = this.getSpellAbortMessage(spellParameters.action);
    if (abortText !== null) {
      if (abortText !== '') this.emitSpellMessage(this.substituteSpellName(abortText, champion));
      if (spellParameters.disableTime !== -1) {
        this.disableCharacterAction(casterIdx, spellParameters.disableTime);
      }
      return 0;
    }
    // `if (chIdx >= d.NumCharacter) return 0;` and `if (pcA3->HP() == 0) return 0;` (`:1152-1155`).
    if (!champion) return 0;
    if (!isAlive(champion)) return 0;

    // The facing is checked, and nothing else reads it (`:1157-1163`).
    let facing = this.ctx.party.state.facing;
    if (spellParameters.facing !== -1) facing = spellParameters.facing;
    if (facing < 0 || facing > 3) return 0;

    let incantation = champion.incantation;
    if (spellParameters.incantation !== -1) {
      incantation = this.decodeIncantationOverride(spellParameters.incantation);
    }

    const spell = this.incantationToSpell(incantation);
    if (!spell) {
      if (spellParameters.disableTime !== -1) {
        this.disableCharacterAction(casterIdx, spellParameters.disableTime);
      }
      this.spellErrorMsg(champion, 1, 0);
      return 0;
    }

    const spellPower = (incantation[0] ?? 0) - 95;
    if (spellPower < 1 || spellPower > 6) return 0;

    let skillRequired = spell.skillRequired;
    if (spellParameters.skillRequired !== -1) skillRequired = spellParameters.skillRequired;

    let spellByte5 = spell.byte5;
    if (spellParameters.spellByte5 !== -1) spellByte5 = spellParameters.spellByte5;

    let missileType = (spell.word6 >> 4) & 0x3f;
    if (spellParameters.missileType !== -1) missileType = spellParameters.missileType;

    // `D4W = sw(pSpell->skillRequired + spellPower)` — the spell's *own* skill sets the
    // difficulty; a filter's `skillRequired` only enters the experience's middle term
    // (`:1208-1213`).
    const required = sw(spell.skillRequired + spellPower);
    const w4 = this.computeSpellExperience(required, spellPower, skillRequired);
    const mastery = masteryOf(this.ctx, champion, spellByte5);

    if (mastery < required) {
      const wisdom = championAttribute(champion, AttributeIndex.Wisdom);
      const threshold = Math.min(wisdom + 15, 115);
      const diff = required - mastery;
      for (let i = 0; i < diff; i += 1) {
        if (this.randomInt(128) > threshold) {
          const gained = w4 >> diff;
          adjustSkillsOnPartyLevel(this.ctx, casterIdx, spellByte5, gained, AdjustSkillsWhy.CastSpell1);
          this.spellErrorMsg(champion, 0, spellByte5);
          return 0;
        }
      }
    }

    let spellClass = spell.word6 & 0xf;
    if (spellParameters.spellClass !== -1) spellClass = spellParameters.spellClass;

    switch (spellClass) {
      case 1: {
        const flask = this.getFlaskInHand(champion);
        if (!flask) {
          this.spellErrorMsg(champion, 10, 0);
          return 3;
        }
        const potion = this.dungeon.getPotionRecord(flask);
        if (!potion) return 3;
        potion.potionType = (spell.word6 >> 4) & 0x3f;
        potion.power = (40 * spellPower + this.randomInt(16)) & 0xff;
        break;
      }
      case 2: {
        // The caster turned to the party's facing, and the spell thrown along it: a Spell
        // Filter's facing does not reach the missile (`doc/CSBwin-src/Magic.cpp:1267-1287`).
        champion.facing = this.ctx.party.state.facing;
        let masteryForRange = mastery;
        if (missileType === 4) masteryForRange *= 2;
        this.characterThrowsSpell(
          casterIdx,
          spellObjectId(missileType),
          applyLimits(21, (2 * masteryForRange + 4) * (spellPower + 2), 255),
          0,
        );
        break;
      }
      case 3: {
        let d6 = 4 * (spellPower + 1);
        switch (missileType) {
          case 0: {
            let delay = 10000 + (d6 - 8) * 512;
            d6 = Math.trunc(d6 / 2) - 1;
            if (d6 < 0) d6 = 0;
            this.ctx.systems.timer.applyBrightnessSteps(d6, 1);
            this.setBrightnessTimer(-d6, delay);
            break;
          }
          case 5: {
            let delay = 4000 + 128 * (d6 - 3);
            d6 = Math.trunc(d6 / 4) + 1;
            this.ctx.systems.timer.applyBrightnessSteps(d6, 1);
            this.setBrightnessTimer(-d6, delay);
            break;
          }
          case 1: {
            d6 = Math.trunc(d6 / 4);
            this.ctx.systems.timer.applyBrightnessSteps(d6, -1);
            this.setBrightnessTimer(d6, 98);
            break;
          }
          case 2: {
            this.ctx.party.state.seeThruWalls = sb(this.ctx.party.state.seeThruWalls + 1);
            d6 = Math.trunc(d6 / 2);
            const duration = d6 * d6;
            this.queueUtilityTimer(TimerFunction.TT_73, duration, 0);
            break;
          }
          case 3: {
            this.ctx.party.state.invisible = sb(this.ctx.party.state.invisible + 1);
            this.queueUtilityTimer(TimerFunction.TT_71, d6, 0);
            break;
          }
          case 4: {
            let shieldAdd = d6;
            if (this.ctx.party.state.partyShield > 50) {
              shieldAdd = Math.trunc(shieldAdd / 4);
            }
            this.ctx.party.state.partyShield = sw(this.ctx.party.state.partyShield + shieldAdd);
            markAllPortraitsChanged(this.ctx);
            const duration = d6 * d6;
            this.queueUtilityTimer(TimerFunction.TT_74, duration, shieldAdd);
            break;
          }
          case 6: {
            this.ctx.party.state.magicFootprintsActive = sb(this.ctx.party.state.magicFootprintsActive + 1);
            this.ctx.footprints.markMagicFootprints(spellPower);
            const duration = d6 * d6;
            this.queueUtilityTimer(TimerFunction.TT_79, duration, 0);
            break;
          }
          case 7: {
            const zokathra = this.createMiscObject(51);
            if (zokathra) {
              // The first empty hand, the shield hand first (`doc/CSBwin-src/Magic.cpp:1362-1380`).
              const hand = getChampionPossession(champion, 0) === OBJECT_ID_NULL ? 0
                : getChampionPossession(champion, 1) === OBJECT_ID_NULL ? 1 : -1;
              if (hand !== -1) {
                this.ctx.systems.character.addCharacterPossession(casterIdx, zokathra, hand);
              } else {
                // Both hands full: dropped in the party's cell like any drop, so it presses
                // a pad there (`MoveObject(obj_2, -1, 0, d.partyX, d.partyY)`, `:1382-1389`).
                const at = this.ctx.party.state.position;
                this.ctx.systems.worldMove.moveObject(zokathra, -1, 0, at.x, at.y, at.z);
              }
            }
            break;
          }
          case 8: {
            this.ctx.systems.attack.applyMagicShield(champion, false, d6 * d6 + 100, 0);
            break;
          }
          default:
            break;
        }
        break;
      }
      default:
        break;
    }

    adjustSkillsOnPartyLevel(this.ctx, casterIdx, spellByte5, w4, AdjustSkillsWhy.CastSpell2);
    let disableTime = (spell.word6 >> 10) & 0x3f;
    if (spellParameters.disableTime !== -1) disableTime = spellParameters.disableTime;
    this.disableCharacterAction(casterIdx, disableTime);
    return 1;
  }

  private incantationToSpell(incantation: number[]): SpellDefinition | null {
    if ((incantation[1] ?? 0) === 0) return null;
    let packed = 0;
    let shift = 24;
    for (let i = 0; i < 4; i++) {
      const value = incantation[i] ?? 0;
      packed |= (value & 0xff) << shift;
      if ((incantation[i + 1] ?? 0) === 0) break;
      shift -= 8;
      if (shift < 0) break;
    }
    for (const spell of this.ctx.tables.spells) {
      if ((spell.spellId & 0xff000000) !== 0) {
        if ((packed >>> 0) === (spell.spellId >>> 0)) return spell;
      } else if (((packed >>> 0) & 0xffffff) === (spell.spellId >>> 0)) {
        return spell;
      }
    }
    return null;
  }

  private decodeIncantationOverride(value: number): number[] {
    const incantation = new Array<number>(4).fill(0);
    let n = Math.max(0, value | 0);
    for (let i = 3; i >= 0; i -= 1) {
      const digit = n % 10;
      n = Math.floor(n / 10);
      if (digit <= 0) {
        incantation[i] = 0;
      } else {
        incantation[i] = 0x60 + 6 * i + digit - 1;
      }
    }
    return incantation;
  }

  private encodeLocationAbs(position: Position): number {
    return ((position.z & 0x3f) << 10) | ((position.x & 0x1f) << 5) | (position.y & 0x1f);
  }

  private getFlaskInHand(champion: Champion): ObjectID | null {
    for (let slot = 0; slot < 2; slot += 1) {
      const obj = getChampionPossession(champion, slot);
      if (obj === OBJECT_ID_NULL) continue;
      if (GetBasicObjectType(this.dungeon, this.ctx.tables.objDescObjectType, obj) === OBJNI_EMPTY_FLASK) return obj;
    }
    return null;
  }

  private computeSpellExperience(required: number, spellPower: number, skillRequired: number): number {
    const rand = this.randomInt(8);
    const term = (spellPower - 1) * skillRequired;
    return rand + 16 * required + 8 * term + required * required;
  }

  queueUtilityTimer(functionType: number, duration: number, timerWord6: number): void {
    const party = this.ctx.party.state;
    this.timers.createTimer(
      functionType,
      0,
      0,
      0,
      0,
      (this.ctx.state.tickCount + Math.max(0, duration | 0)) >>> 0,
      party.position.z,
      undefined,
      0,
      timerWord6,
    );
  }

  private createMiscObject(miscType: number): ObjectID | null {
    const rn = this.dungeon.findEmptyDBEntry('misc', {
      nextObject: OBJECT_ID_EOF,
      specialState: 0,
      important: false,
      miscType: miscType & 0x7f,
    });
    return rn === OBJECT_ID_NULL ? null : rn;
  }

  /**
   * `DisableCharacterAction` (`doc/CSBwin-src/Magic.cpp:505`) — busy the champion for
   * `timeDelay` ticks, or stretch the busy timer they already have. Any delay is taken,
   * 0 or less included, as CSBWin has no guard.
   */
  disableCharacterAction(chIdx: number, timeDelay: number): void {
    const party = this.ctx.party.state;
    const champion = party.champions[chIdx];
    if (!champion) return;
    let targetTime = (this.ctx.state.tickCount + (timeDelay | 0)) >>> 0;
    const existingIndex = champion.busyTimerIndex;
    if (existingIndex >= 0) {
      const existing = this.timers.getTimer(existingIndex);
      if (existing) {
        const existingTime = existing.time >>> 0;
        if (targetTime >= existingTime) {
          targetTime = (targetTime + ((existingTime - this.ctx.state.tickCount) >> 1)) >>> 0;
        } else {
          // `timeDelay/2`, C's division, which truncates a negative delay toward 0.
          targetTime = (existingTime + Math.trunc((timeDelay | 0) / 2)) >>> 0;
        }
      }
      this.timers.deleteTimer(existingIndex);
    } else {
      // `CHARFLAG_weaponAttack` and `DrawCharacterState` are the redraw, which this port
      // does every frame.
      champion.charFlags |= CHARFLAG_ATTACK_DISABLE;
    }
    const entry = this.timers.createTimerWithUByte5(
      TimerFunction.TT_11,
      0,
      0,
      0,
      0,
      targetTime,
      party.position.z,
      chIdx,
    );
    champion.busyTimerIndex = entry.index;
  }

  /**
   * `CharacterThrowsSpell` (`doc/CSBwin-src/Magic.cpp:473`).
   *
   * The decay rate comes from the champion's *maximum* mana, not the current amount,
   * so a naturally powerful caster's bolts keep their damage longer regardless of how
   * drained they are. A spell whose range is short relative to its decay gets three
   * extra cells and one less decay — a small bonus for close-range casting.
   */
  characterThrowsSpell(chIdx: number, projectile: number, range: number, neededMana: number): number {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return 0;
    if ((champion.attributes.mana | 0) < neededMana) return 0;
    champion.attributes.mana = (champion.attributes.mana | 0) - neededMana;

    let decayRate = 10 - Math.min(8, Math.trunc((champion.attributes.maxMana | 0) / 8));
    let adjustedRange = range;
    if (adjustedRange < 4 * decayRate) {
      adjustedRange += 3;
      decayRate -= 1;
    }
    return this.launchObject(chIdx, projectile as ObjectID, adjustedRange, 90, decayRate);
  }

  /**
   * `LaunchObject` (`doc/CSBwin-src/Magic.cpp:452`) — throw from the champion's own
   * side of the cell, so a bolt cast by the front-right champion leaves on the right.
   */
  launchObject(
    chIdx: number,
    object: ObjectID,
    range: number,
    damage: number,
    decayRate: number,
  ): number {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return 0;
    const facing = champion.facing & 3;
    const posInCell = ((((champion.partyPosition - facing + 1) & 2) >> 1) + facing) & 3;
    const launched = this.launchThrownMissile(
      object,
      this.ctx.party.state.position,
      posInCell,
      facing,
      range,
      damage,
      decayRate,
      this.ctx.state.tickCount,
    );
    return launched ? 1 : 0;
  }

  /** `CastSpell`'s `spellParameters.action` switch (`doc/CSBwin-src/Magic.cpp:1112-1138`): '' aborts silently, null casts. */
  private getSpellAbortMessage(action: number): string | null {
    let msg: string | null = null;
    switch (action | 0) {
      case 1:
        msg = '';
        break;
      case 2:
        msg = 'THAT IS A DIFFICULT SPELL.  STUDY IT.';
        break;
      case 3:
        msg = 'THE SPELL FIZZLES.';
        break;
      case 4:
        msg = 'THE SPELL FIZZLES AND DIES.';
        break;
      case 5:
        msg = 'THIS SPELL IS TOO DIFFICULT.';
        break;
      case 6:
        msg = '% NEEDS MORE PRACTICE WITH THIS SPELL.';
        break;
      case 7:
        msg = 'THIS SPELL REQUIRES A COMPONENT.';
        break;
      default:
        msg = null;
        break;
    }
    return msg;
  }

  private substituteSpellName(text: string, champion: Champion | undefined): string {
    const idx = text.indexOf('%');
    if (idx < 0) return text;
    return `${text.slice(0, idx)}${champion?.name ?? ''}${text.slice(idx + 1)}`;
  }

  /**
   * CSBWin `StandardSpellMessage()` (`doc/CSBwin-src/Magic.cpp:1060`): a linefeed, then the
   * text in colour 4, with '%' replaced by the caster's name. One logical line — the
   * message area word-wraps it.
   */
  emitSpellMessage(text: string): void {
    const messages = this.ctx.host.messages;
    if (!text) return;
    messages.printLinefeed();
    messages.quePrintLines(MSG_COLOR_SPELL, text);
  }

  /**
   * CSBWin `SpellErrorMsg()` (`doc/CSBwin-src/Magic.cpp:1007`).
   *
   * Emitted as a linefeed followed by separate fragments, all colour 4. The fragments carry
   * their own leading/trailing spaces and flow onto a single wrapped line — CSBWin never
   * puts a hard newline between the champion name and the message body.
   */
  private spellErrorMsg(champion: Champion, code: number, skillNumber: number): void {
    const messages = this.ctx.host.messages;

    let base = skillNumber | 0;
    if (base > 3) base = Math.floor((base - 4) / 4);

    messages.printLinefeed();
    messages.quePrintLines(MSG_COLOR_SPELL, champion.name);

    switch (code | 0) {
      case 0: {
        const labels = ['FIGHTER', 'NINJA', 'PRIEST', 'WIZARD'];
        const label = labels[base] ?? 'SKILL';
        messages.quePrintLines(MSG_COLOR_SPELL, ' NEEDS MORE PRACTICE WITH THIS ');
        messages.quePrintLines(MSG_COLOR_SPELL, label);
        messages.quePrintLines(MSG_COLOR_SPELL, ' SPELL.');
        break;
      }
      case 1:
        messages.quePrintLines(MSG_COLOR_SPELL, ' MUMBLES A MEANINGLESS SPELL.');
        break;
      case 10:
        messages.quePrintLines(MSG_COLOR_SPELL, ' NEEDS AN EMPTY FLASK IN HAND FOR POTION.');
        break;
      default:
        messages.quePrintLines(MSG_COLOR_SPELL, ' UNKNOWN SPELL ERROR');
        break;
    }
  }

  private randomInt(maxExclusive: number): number {
    return this.ctx.random.below(maxExclusive);
  }

  /**
   * The magic panel's cast button. CSBWin's caller hands `CastMagic` nothing but the
   * caster (`doc/CSBwin-src/Magic.cpp:567`): the mana was spent rune by rune. It sets
   * `d.clockTick` to what `CastMagic` returns, which is `CastSpell`'s result with 3 made 0,
   * and any other result clears the incantation (`:948-959`). The raw result is returned,
   * for the tools.
   */
  castSpellFromUi(chIdx: number): number {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return 0;
    const result = this.castMagic(chIdx);
    if (result !== 3) champion.incantation = [];
    setClockTick(this.ctx, result === 3 ? 0 : result);
    return result;
  }
}
