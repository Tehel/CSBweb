/**
 * The two periodic updates the main loop runs: `NinetySecondUpdate` (`CSBCode.cpp`) and
 * `TenSecondUpdate` (`Code17818.cpp`). The cadence tests are the loop's
 * (`doc/CSBwin-src/CSBCode.cpp:690-698`) and `Game.gameTick` makes them; they are here,
 * beside the bodies, so that the tools test the same two predicates the tick does.
 * Neither update has state of its own, so they are functions over the context, as
 * `wakeUp` is.
 */
import { OBJECT_ID_NULL } from '../core/types';
import { sw } from '../core/intCast';
import { OBJNI_EKKHARD_CROSS, OBJNI_TORCH_A, OBJNI_TORCH_D } from '../core/objectNameIndex';
import {
    AttributeIndex,
    attributeCurrent,
    attributeMaximum,
    championAttribute,
    incrAttributeCurrent,
} from './attributes';
import { nameIndexOf, type GameContext } from './GameContext';
import { CHARFLAG_CHEST_OR_SCROLL, getChampionPossession } from '../core/charDesc';
import { selectPaletteForLightLevel } from './LightLevel';
import { drawAllCharacterState } from './Party';
import { GetBasicObjectType } from './objectIndex';
import { settleMasteryGains } from './MasteryGains';
import { ensureSkills } from './skills';
import { isAlive, masteryOf } from './rules';

/** `(d.Time&511)==0` — the loop's test for `NinetySecondUpdate` (doc/CSBwin-src/CSBCode.cpp:690). */
export function isNinetySecondTick(time: number): boolean {
    return (time & 511) === 0;
}

/**
 * `(d.Time & (d.PartySleeping ? 15 : 63)) == 0` — the loop's test for `TenSecondUpdate`
 * (doc/CSBwin-src/CSBCode.cpp:696-698).
 */
export function isTenSecondTick(time: number, sleeping: boolean): boolean {
    return (time & (sleeping ? 15 : 63)) === 0;
}

/**
 * `NinetySecondUpdate` (`doc/CSBwin-src/CSBCode.cpp:7398-7446`), called from the
 * game tick whenever `(d.Time & 511) == 0` (`doc/CSBwin-src/CSBCode.cpp:690-693`) —
 * every 512 ticks, about 85 seconds, despite the name.
 *
 * Each torch in a champion's hands loses one charge, and one that burns out loses its
 * `important` flag. The loop runs over `d.NumCharacter`, less one while
 * `d.PotentialCharacterOrdinal != 0`: a Hall of Champions recruit is always the last
 * champion, and their torch does not burn. The dead are not skipped (their hands are
 * empty anyway).
 *
 * Then `SelectPaletteForLightLevel` and `DrawEightHands`, whether or not a torch
 * changed (`:7443-7444`). `DrawEightHands` has no counterpart here: the hands are drawn
 * from live state every frame.
 */
export function ninetySecondUpdate(ctx: GameContext): void {
    const party = ctx.party.state;
    let count = party.champions.length;
    if (party.potentialChampionIndex >= 0) count--;
    for (let chIdx = 0; chIdx < count; chIdx++) {
        const champion = party.champions[chIdx];
        if (!champion) continue;
        // `for (D6W=2; (D6W--) != 0;)` — hand 1, then hand 0.
        for (let hand = 1; hand >= 0; hand--) {
            const obj = getChampionPossession(champion, hand);
            if (obj === OBJECT_ID_NULL) continue;
            const nameIndex = nameIndexOf(ctx, obj);
            if (nameIndex < OBJNI_TORCH_A || nameIndex > OBJNI_TORCH_D) continue;
            const weapon = ctx.dungeon.getWeaponRecord(obj);
            if (!weapon) continue;
            const charges = weapon.charges & 0x0f;
            if (charges === 0) continue;
            const next = (charges - 1) & 0x0f;
            weapon.charges = next;
            if (next === 0) weapon.important = false;
        }
    }
    selectPaletteForLightLevel(ctx);
}

/**
 * `TenSecondUpdate` (`doc/CSBwin-src/Code17818.cpp:160-436`), called from the game
 * tick whenever `(d.Time & (d.PartySleeping ? 15 : 63)) == 0`
 * (`doc/CSBwin-src/CSBCode.cpp:696-698`) — every 16 s awake, 4 s asleep, despite
 * the name.
 *
 * Per living champion: mana regeneration, `tempAdjust` decay, food and water
 * consumption paid for in stamina, HP regeneration, and — every 256 ticks (64
 * asleep) — one point of each attribute's Current drawn back toward its Maximum.
 * That last step is what clears the red a level gain paints on the stats panel:
 * `LevelUp` raises only Maximum (`doc/CSBwin-src/Magic.cpp:101-151`).
 *
 * Not ported: the `d.Word11750` countdown (`:375-383`). It is a cursor-redraw
 * counter armed only by `CSBCode.cpp:969-975`, which this port has no equivalent
 * of, so it is always zero and the branch is dead. The trailing
 * `charFlags |= CHARFLAG_statsChanged` has no counterpart either: the panels are
 * redrawn from live state every frame. `CHARFLAG_chestOrScroll` has, for the champion
 * whose inventory is open with the eye held or food and water in its panel
 * (`:433-443`), and `DrawAllCharacterState` draws it (`:448`).
 */
export function tenSecondUpdate(ctx: GameContext): void {
    const party = ctx.party.state;
    const time = ctx.state.tickCount;
    const sleeping = party.sleeping;
    if (party.champions.length === 0) return;

    ctx.footprints.ageFootprints(party.position);

    const random112 = (time & 0x40)
        | ((time & 0x80) >> 2)
        | ((time & 0x100) >> 4);

    for (let chIdx = 0; chIdx < party.champions.length; chIdx++) {
        const champ = party.champions[chIdx];
        if (!champ) continue;
        const attrs = champ.attributes;
        if (!isAlive(champ)) continue;
        if (party.potentialChampionIndex === chIdx) continue;
        const maxMana = attrs.maxMana | 0;
        const mana = attrs.mana | 0;
        if (mana < maxMana) {
            // Asleep, `DetermineMastery` reports 1 for every skill
            // (doc/CSBwin-src/Code17818.cpp:29-36): the roll is Wisdom + 2, and each
            // point costs 14 stamina, whatever the champion's levels.
            const magicMastery =
                masteryOf(ctx, champ, 3) + masteryOf(ctx, champ, 2);
            const wisdom = championAttribute(champ, AttributeIndex.Wisdom);
            if (random112 >= magicMastery + wisdom) {
                if (mana > maxMana) {
                    attrs.mana = Math.max(maxMana, mana - 1);
                }
            } else {
                let manaAdjust = Math.trunc(maxMana / 40);
                if (sleeping) manaAdjust *= 2;
                manaAdjust += 1;
                const staminaAdjust = manaAdjust * Math.max(7, 16 - magicMastery);
                ctx.systems.championDamage.adjustStamina(chIdx, staminaAdjust);
                const deltaMana = Math.min(manaAdjust, maxMana - mana);
                attrs.mana = mana + deltaMana;
            }
        } else if (mana > maxMana) {
            attrs.mana = Math.max(maxMana, mana - 1);
        }

        const skills = ensureSkills(champ.skills);
        for (const entry of skills) {
            if (entry.tempAdjust > 0) entry.tempAdjust -= 1;
        }
        champ.skills = skills;

        // Food and water (`:291-344`). D6 grows by 2 for each halving of
        // MaxStamina that Stamina is still below — a tired champion eats more.
        let d6 = 4;
        for (let d4 = attrs.maxStamina | 0; (d4 >>= 1), (attrs.stamina | 0) < d4; d6 += 2) {
            // empty
        }
        let d4 = 0;
        // `ApplyLimits(1, (MaxStamina>>8)-1, 6)`
        let local4 = Math.min(6, Math.max(1, ((attrs.maxStamina | 0) >> 8) - 1));
        if (sleeping) local4 <<= 1;
        const sinceMove = sw(time - ctx.footprints.getLastPartyMoveTime());
        if (sinceMove > 80) {
            local4++;
            if (sinceMove > 250) local4++;
        }
        do {
            const d5 = d6 <= 4;
            if (champ.food < -512) {
                if (d5) {
                    d4 += local4;
                    champ.food -= 2;
                }
            } else {
                if (champ.food >= 0) d4 -= local4;
                champ.food -= d5 ? 2 : Math.trunc(d6 / 2);
            }
            if (champ.water < -512) {
                if (d5) {
                    d4 += local4;
                    champ.water -= 1;
                }
            } else {
                if (champ.water >= 0) d4 -= local4;
                champ.water -= d5 ? 1 : Math.trunc(d6 / 2);
            }
            d6--;
            if (d6 === 0) break;
        } while ((attrs.stamina | 0) < (attrs.maxStamina | 0) + d4);

        ctx.systems.championDamage.adjustStamina(chIdx, d4);
        if (champ.food < -1024) champ.food = -1024;
        if (champ.water < -1024) champ.water = -1024;

        // HP regeneration (`:350-372`).
        if ((attrs.health | 0) < (attrs.maxHealth | 0)) {
            if ((attrs.stamina | 0) >= Math.trunc((attrs.maxStamina | 0) / 4)) {
                if (random112 < championAttribute(champ, AttributeIndex.Vitality) + 12) {
                    let local4Hp = ((attrs.maxHealth | 0) >> 7) + 1;
                    if (sleeping) local4Hp *= 2;
                    const necklace = getChampionPossession(champ, 10);
                    if (necklace !== OBJECT_ID_NULL && GetBasicObjectType(ctx.dungeon, ctx.tables.objDescObjectType, necklace) === OBJNI_EKKHARD_CROSS) {
                        local4Hp = local4Hp + Math.trunc(local4Hp / 2) + 1;
                    }
                    attrs.health += Math.min(local4Hp, (attrs.maxHealth | 0) - (attrs.health | 0));
                }
            }
        }

        // Attributes drift back to Maximum, one point at a time (`:384-414`).
        if ((time & (sleeping ? 63 : 255)) === 0) {
            for (const attr of attrs.stats) {
                const maximum = attributeMaximum(attr);
                const current = attributeCurrent(attr);
                if (current < maximum) {
                    incrAttributeCurrent(attr, 1);
                } else if (current > maximum) {
                    incrAttributeCurrent(attr, -Math.trunc(current / (maximum === 0 ? 1 : maximum)));
                }
            }
            // An extra's note, not CSBWin's: a mastery gain whose attributes are back (`MasteryGains.ts`).
            settleMasteryGains(champ);
        }

        // A champion left facing elsewhere turns back with the party once no
        // monster has struck for 60 ticks (`:416-430`).
        if (!sleeping && champ.facing !== party.facing) {
            if (party.lastMonsterAttackTime < time - 60) {
                champ.facing = party.facing;
                champ.maxRecentDamage = 0;
            }
        }
        if (chIdx === party.selectedCharacterIndex
            && (ctx.interface.pressingMouth || ctx.interface.pressingEye
                || ctx.interface.displayResurrectChestOrScroll === 0)) {
            champ.charFlags |= CHARFLAG_CHEST_OR_SCROLL;
        }
    }
    drawAllCharacterState(ctx);
}
