/**
 * `HallOfChampions` — recruiting a champion from a mirror: `AddCharacter`
 * (`doc/CSBwin-src/Character.cpp:456`), `_ResurrectReincarnateCancel`
 * (`CSBCode.cpp:6615`) and the tail of `ReIncarnate` (`Code13ea4.cpp:155-160`). The hero
 * text parsing and the possession sorting are `AddCharacter.ts`'s free functions.
 *
 * One system for three CSBWin files, not one per file (`DEBT.md` E2): the three share
 * `reincarnateAttributePenalty` / `reincarnateStatPenalty`, which `AddCharacter` writes
 * and `_ResurrectReincarnateCancel` reads, and two of the files have no other port.
 * Moved out of `Game` by E2; `ActuatorSystem`'s mirror click reaches it as
 * `ctx.systems.hallOfChampions`.
 */
import type { ActuatorRecord, DatabaseRecord } from '../data/dungeonTypes';
import {
  PORTRAIT_INACTIVE,
  PORTRAIT_RESPONSE_CLEAR,
  PORTRAIT_RESPONSE_SET,
  PORTRAIT_RESPONSE_TOGGLE,
  blocksDisables,
  getActuatorDisableMessage,
  getActuatorPosition,
  getActuatorState,
  getActuatorType,
  setActuatorType,
} from '../data/actuatorHelpers';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../core/types';
import {
  assignAddCharacterPossessions,
  computeChampionFingerprint,
  createChampionFromHeroText,
  findFreeCharPosition,
  readHeroText,
  type HeroText,
  type AddCharacterItem,
  type AddCharacterTables,
} from './AddCharacter';
import {
  attributeCurrent,
  attributeMaximum,
  attributeMinimum,
  setAttributeCurrent,
  setAttributeMaximum,
} from './attributes';
import type { GameContext } from './GameContext';
import { emptyPossessions, type Champion } from './gameTypes';
import { setClockTick } from './LoopState';
import { DELTA_X, DELTA_Y } from './MonsterPerception';
import { selectMagicCaster, setHandOwner } from './Party';

export class HallOfChampions {
  /** `d.ObjDesc[].word4` and `d.CarryLocation[]`, the two `AddCharacter` reads. */
  private readonly addCharacterTables: AddCharacterTables;
  /**
   * `reincarnateAttributePenalty` / `reincarnateStatPenalty`
   * (`doc/CSBwin-src/Character.cpp:14`) — CSBWin holds them in file-scope globals that
   * `AddCharacter` fills in while parsing the hero text and
   * `_ResurrectReincarnateCancel` reads back. Same lifetime here.
   */
  private reincarnationSource: HeroText | null = null;

  constructor(private readonly ctx: GameContext) {
    this.addCharacterTables = { objDescWord4: ctx.tables.objDescWord4, carryLocation: ctx.tables.carryLocation };
  }

  /**
   * A champion built outside a mirror joins the party — how the tools' champions join.
   * `AddCharacter`'s two steps such a champion still needs: the fingerprint, given once,
   * on joining (doc/CSBwin-src/Character.cpp:513-516), and `if (d.NumCharacter == 1)
   * SetHandOwner(0)` — the first champion to join gets the cursor (`:706-710`). Every
   * inventory click is gated on someone owning it.
   */
  addChampion(champion: Champion): boolean {
    const party = this.ctx.party;
    const pos = party.state.position;
    champion.fingerprint = computeChampionFingerprint(party.state.champions, this.ctx.dungeon, pos.z, pos.x, pos.y);
    if (!party.addChampion(champion)) return false;
    if (party.state.champions.length === 1) {
      setHandOwner(party.state, 0, this.ctx.host);
    }
    return true;
  }

  /**
   * `AddCharacter` (`doc/CSBwin-src/Character.cpp:456`) — a click on a Hall of
   * Champions mirror.
   *
   * `charID` picks the portrait bitmap and nothing else: the name, title, stats and
   * skills come from the `dbTEXT` object lying in the **party's own** cell, and the
   * possessions from the mirror's cell. The champion is only *provisionally* added
   * here — `potentialChampionIndex` marks them, and
   * `resurrectReincarnateCancel` either confirms or undoes it.
   */
  addCharacter(charID: number): boolean {
    const party = this.ctx.party.state;
    // `if (d.EmptyHanded == 0) return; if (d.NumCharacter == 4) return;` (`:477-479`)
    if (party.objectInHand !== OBJECT_ID_NULL) return false;
    if (party.champions.length >= 4) return false;
    // One mirror at a time: a second click while the menu is up would push a
    // champion that `_ResurrectReincarnateCancel` can no longer reach.
    if (party.potentialChampionIndex >= 0) return false;

    // `:535-549`: the first `dbTEXT` in the party's cell, read through `DecodeText`, or
    // `legalHero` when there is none. The penalties it gives wait for
    // `_ResurrectReincarnateCancel`, as CSBWin's globals do.
    const hero = readHeroText(this.heroTextInPartyCell());
    this.reincarnationSource = hero;

    const index = party.champions.length; // LOCAL_2
    const possessions = emptyPossessions();
    const champion = createChampionFromHeroText(
      hero,
      charID,
      findFreeCharPosition(party.champions, party.facing),
      possessions,
    );
    // `pcA3->facing = pcA3->facing3 = d.partyFacing` (`:522`, `:531`) — the corner
    // the champion stands in is chosen above, but they face the way the party does.
    champion.facing = party.facing;
    champion.damageFromDirection = party.facing;
    champion.fingerprint = computeChampionFingerprint(
      party.champions,
      this.ctx.dungeon,
      party.position.z,
      party.position.x,
      party.position.y,
    );
    // `(STRandom() & 0xff) + 1500` twice (`:533-534`).
    champion.food = (this.ctx.random.next() & 0xff) + 1500;
    champion.water = (this.ctx.random.next() & 0xff) + 1500;
    // `if (pcA3->HP() == 0) return;` (`:703`): a text whose health reads zero.
    if (champion.attributes.maxHealth === 0) return false;

    if (!this.ctx.party.addChampion(champion)) return false;
    // `d.PotentialCharacterOrdinal = LOCAL_2 + 1; d.NumCharacter++;` (`:704-705`).
    party.potentialChampionIndex = index;
    if (party.champions.length === 1) {
      setHandOwner(party, 0, this.ctx.host);
    }

    this.collectMirrorPossessions(index, possessions);

    // `ShowHideInventory(LOCAL_2)` (`:796`) — the inventory opens on the new
    // champion, and `potentialChampionIndex` turns its eye panel into the
    // Resurrect/Reincarnate/Cancel menu, and sets `videoMode = VM_INVENTORY`
    // (`CSBCode.cpp:7487`). Then `TAG02076e()` (`:797`).
    party.selectedCharacterIndex = index;
    this.ctx.loop.videoMode = 'VM_INVENTORY';
    this.ctx.host.tag02076e();
    return true;
  }

  /**
   * `_ResurrectReincarnateCancel` (`doc/CSBwin-src/CSBCode.cpp:6615`). `button` is
   * CSBWin's own id from `Buttons18372`: 160 Resurrect, 161 Reincarnate, 162 Cancel.
   */
  resurrectReincarnateCancel(button: number): boolean {
    const party = this.ctx.party.state;
    const index = party.potentialChampionIndex;
    if (index < 0) return false;
    // `pcA3 = &d.CH16482[d.NumCharacter-1]` — the potential champion is always last.
    const champion = party.champions[party.champions.length - 1];
    if (!champion) return false;

    party.potentialChampionIndex = -1;

    if (button === 162) {
      // Cancel (`:6629-6658`): hide the inventory and take the champion back out.
      // Their possessions were never removed from the mirror, so they stay there.
      // `ShowHideInventory(4)` sets `d.clockTick = 1` (`:7441`) and `videoMode =
      // VM_ADVENTURE` (`:7453`).
      party.selectedCharacterIndex = -1;
      this.ctx.loop.videoMode = 'VM_ADVENTURE';
      setClockTick(this.ctx, 1);
      if (party.champions.length === 1) {
        setHandOwner(party, -1, this.ctx.host);
      }
      // `d.NumCharacter--` and no more: the record stays in its slot, possessions and all.
      party.vacantCharacters[party.champions.length - 1] = champion;
      party.champions.pop();
      this.ctx.host.tag0207cc(); // `:6657`
      return true;
    }

    const mirror = this.getMirrorCell();
    // `RemoveObjectFromRoom` for each possession (`:6668-6677`). `AddCharacter` left
    // them linked in the mirror's cell *as well as* on the champion; this is where
    // the room finally lets go of them.
    for (const value of champion.possessions) {
      if (value === OBJECT_ID_NULL) continue;
      this.ctx.dungeon.removeObjectFromCell(mirror, value);
    }

    this.disableMirrorActuators(mirror);

    if (button === 161) {
      // `ReIncarnate(_2_, pcA3)` (`:6738`) is the *first* thing this branch does,
      // and in CSBWin it blocks until the player has typed a name. Here it opens
      // a modal screen and returns, so everything after it — the skill wipe, the
      // penalties, the tail below — is deferred to `finishReincarnate`, which the
      // screen calls when it is answered. The champion stays potential-free but
      // still last in the party throughout, which is all the deferred half needs.
      this.ctx.host.openReincarnateScreen(party.champions.length - 1);
      return true;
    }

    this.finishResurrectReincarnate(champion, button);
    return true;
  }

  /**
   * `_ResurrectReincarnateCancel` from `ReIncarnate`'s return to the end
   * (`doc/CSBwin-src/CSBCode.cpp:6739-6800`).
   */
  private finishResurrectReincarnate(champion: Champion, button: number): void {
    const party = this.ctx.party.state;
    if (button === 161) {
      this.reincarnate(champion);
    }

    // `:6786-6793`
    if (party.champions.length === 1) {
      setHandOwner(party, 0, this.ctx.host);
      selectMagicCaster(party, 0);
    }

    const messages = this.ctx.host.messages;
    const color = this.ctx.systems.actuators.getChampionMessageColor(party.champions.length - 1);
    messages.printLinefeed();
    messages.quePrintLines(color, champion.name);
    messages.quePrintLines(color, button === 160 ? ' RESURRECTED' : ' REINCARNATED');

    // `ShowHideInventory(4)` (`:6807`), with its `d.clockTick = 1` (`:7441`) and
    // `videoMode = VM_ADVENTURE` (`:7453`), then `TAG0207cc()` (`:6808`).
    party.selectedCharacterIndex = -1;
    this.ctx.loop.videoMode = 'VM_ADVENTURE';
    setClockTick(this.ctx, 1);
    this.ctx.host.tag0207cc();
    this.ctx.host.championJoined({ champion, reincarnated: button === 161 });
  }

  /**
   * The name-entry screen has been answered (`doc/CSBwin-src/Code13ea4.cpp:155-160`).
   * The champion takes the typed name and title, and the rest of the Reincarnate
   * branch runs — including the message, which prints the **new** name.
   */
  reincarnateNamed(chIdx: number, name: string, title: string): void {
    const champion = this.ctx.party.state.champions[chIdx];
    if (!champion) return;
    champion.name = name;
    champion.title = title;
    this.finishResurrectReincarnate(champion, 161);
  }

  /**
   * The Reincarnate half of `_ResurrectReincarnateCancel` (`:6739-6784`), everything
   * after `ReIncarnate` has returned a name.
   */
  private reincarnate(champion: Champion): void {
    // `ClearMemory(pcA3->skills92, 120)` — all 20 skills, temporary adjust included.
    for (const skill of champion.skills) {
      skill.experience = 0;
      skill.tempAdjust = 0;
    }

    const hero = this.reincarnationSource;
    const attributePenalty = hero?.reincarnateAttributePenalty ?? 2;
    const statPenalty = hero?.reincarnateStatPenalty ?? 8;

    // Both penalties only `if (!DM_rules)` (`:6740`, `:6761`). Attributes 1..6 only — Luck
    // (0) is left alone.
    if (!this.ctx.rules.dmRules) {
      for (let index = 1; index <= 6; index++) {
        const attribute = champion.attributes.stats[index];
        if (!attribute) continue;
        let value = attributeCurrent(attribute);
        value -= Math.trunc((value * attributePenalty) / 16);
        value = Math.max(value, attributeMinimum(attribute));
        setAttributeCurrent(attribute, value);
        setAttributeMaximum(attribute, value);
      }
    }

    if (!this.ctx.rules.dmRules) {
      const scale = (value: number): number => Math.trunc((value * (16 - statPenalty)) / 16);
      const stats = champion.attributes;
      stats.health = scale(stats.health);
      stats.maxHealth = scale(stats.maxHealth);
      stats.stamina = scale(stats.stamina);
      stats.maxStamina = scale(stats.maxStamina);
      stats.mana = scale(stats.mana);
      stats.maxMana = scale(stats.maxMana);
    }

    // Twelve random attribute points, Current and Maximum together (`:6777-6783`).
    // CSBWin parses a `randomPoints` field out of the hero text and then ignores it
    // here; twelve is hardcoded.
    for (let i = 0; i < 12; i++) {
      const attribute = champion.attributes.stats[(this.ctx.random.next() & 0xffff) % 7];
      if (!attribute) continue;
      setAttributeCurrent(attribute, attributeCurrent(attribute) + 1);
      setAttributeMaximum(attribute, attributeMaximum(attribute) + 1);
    }
  }

  /** The cell the party is facing — CSBWin's `mapX/mapY` in both halves of the flow. */
  private getMirrorCell(): Position {
    const party = this.ctx.party.state;
    const facing = party.facing & 3;
    return new Position(
      party.position.x + DELTA_X[facing],
      party.position.y + DELTA_Y[facing],
      party.position.z,
    );
  }

  /**
   * `doc/CSBwin-src/Character.cpp:715-790` — every object at the mirror's wall becomes
   * a possession. CSBWin does *not* unlink them from the room here: they stay in the
   * cell until Resurrect or Reincarnate is pressed, so a Cancel leaves them there.
   */
  private collectMirrorPossessions(chIdx: number, possessions: ObjectID[]): void {
    const party = this.ctx.party.state;
    const mirror = this.getMirrorCell();
    const wall = (party.facing + 2) & 3;

    const items: AddCharacterItem[] = [];
    for (
      let rn = this.ctx.dungeon.findFirstObject(mirror);
      rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
      rn = this.ctx.dungeon.getDBRecordLink(rn)
    ) {
      const decoded = this.ctx.dungeon.rnMaps.decode(rn);
      if (decoded.category <= DBType.ACTUATOR) continue;
      if (decoded.position !== wall) continue;
      items.push({
        rn,
        category: decoded.category,
        record: this.getObjectRecord(rn),
      });
    }

    // Each object goes in with `AddCharacterPossession` (`doc/CSBwin-src/Character.cpp:789`),
    // so a recruit arrives with the bonuses of what they carry, their torch lit and their
    // Illumulet lighting the party. Cancel undoes none of it (`CSBCode.cpp:6629-6658`).
    assignAddCharacterPossessions(items, this.addCharacterTables, possessions,
      (rn, slot) => this.ctx.systems.character.addCharacterPossession(chIdx, rn, slot));
  }

  /**
   * `doc/CSBwin-src/CSBCode.cpp:6679-6734` — disable the first *active* portrait
   * actuator on the mirror's wall, then, unless it blocks disables, every actuator
   * on that wall. Each portrait disabled sends its `DisableMessage` first
   * (`portraitTranslateDisable`).
   */
  private disableMirrorActuators(mirror: Position): void {
    const wall = (this.ctx.party.state.facing + 2) & 3;
    const actuators: ActuatorRecord[] = [];
    for (
      let rn = this.ctx.dungeon.findFirstObject(mirror);
      rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
      rn = this.ctx.dungeon.getDBRecordLink(rn)
    ) {
      const decoded = this.ctx.dungeon.rnMaps.decode(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      if (decoded.position !== wall) continue;
      const record = this.ctx.dungeon.getActuatorRecord(rn);
      if (record) actuators.push(record);
    }

    let block = false;
    for (const record of actuators) {
      if (getActuatorType(record) !== 127) continue;
      if ((getActuatorState(record) & PORTRAIT_INACTIVE) !== 0) continue;
      this.portraitTranslateDisable(record, mirror);
      setActuatorType(record, 0);
      if (blocksDisables(record)) block = true;
      break;
    }

    for (const record of actuators) {
      if (block) break;
      if (getActuatorType(record) === 127) {
        this.portraitTranslateDisable(record, mirror);
        block = blocksDisables(record);
      }
      setActuatorType(record, 0);
    }
  }

  /**
   * `PortraitTranslateDisable` (`doc/CSBwin-src/CSBCode.cpp:6589-6612`): an active
   * portrait whose `DisableMessage` is set, clear or toggle sends it to its own cell, at
   * the wall its `Position` names, through the DSA's `QueueDSASwitchAction` with no
   * delay. CSBWin passes `d.LoadedLevel`, the party's level at a click. No portrait in
   * the shipped dungeons carries a message.
   */
  private portraitTranslateDisable(portrait: ActuatorRecord, mirror: Position): void {
    if ((getActuatorState(portrait) & PORTRAIT_INACTIVE) !== 0) return;
    let action: number;
    switch (getActuatorDisableMessage(portrait)) {
      case PORTRAIT_RESPONSE_SET: action = 0; break;
      case PORTRAIT_RESPONSE_CLEAR: action = 1; break;
      case PORTRAIT_RESPONSE_TOGGLE: action = 2; break;
      default: return;
    }
    this.ctx.systems.dsa.queueDsaSwitchAction(
      0, action, mirror.z, mirror.x, mirror.y, getActuatorPosition(portrait), 'M');
  }

  /**
   * The hero text `AddCharacter` reads (`doc/CSBwin-src/Character.cpp:535-549`): the
   * first `dbTEXT` in the party's own cell, at any corner, as `DecodeText(…, 0x8002, 990)`
   * makes it with the game's escape tables. Null when the cell holds none.
   */
  private heroTextInPartyCell(): Uint8Array | null {
    const dungeon = this.ctx.dungeon;
    for (
      let rn = dungeon.findFirstObject(this.ctx.party.state.position);
      rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
      rn = dungeon.getDBRecordLink(rn)
    ) {
      if (dungeon.rnMaps.dbType(rn) !== DBType.TEXT) continue;
      const record = dungeon.getTextRecord(rn);
      return record ? dungeon.decodeTextBytes(record, 0x8002, 990, this.ctx.tables.textDecode) : null;
    }
    return null;
  }

  /** The database record behind an object id, for the categories `AddCharacter` sorts on. */
  private getObjectRecord(rn: ObjectID): DatabaseRecord | null {
    switch (this.ctx.dungeon.rnMaps.dbType(rn)) {
      case DBType.WEAPON: return this.ctx.dungeon.getWeaponRecord(rn);
      case DBType.CLOTHING: return this.ctx.dungeon.getClothingRecord(rn);
      case DBType.SCROLL: return this.ctx.dungeon.getScrollRecord(rn);
      case DBType.POTION: return this.ctx.dungeon.getPotionRecord(rn);
      case DBType.CHEST: return this.ctx.dungeon.getContainerRecord(rn);
      case DBType.MISC: return this.ctx.dungeon.getMiscRecord(rn);
      default: return null;
    }
  }
}
