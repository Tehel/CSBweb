/**
 * The predefined spell/projectile RNs (`doc/CSBwin-src/CSBTypes.h:236-249`).
 *
 * These are not database references: everything from `RNFireball` up is a *reserved*
 * RN standing for a kind of missile that has no record behind it, which is why
 * `RN::IsMagicSpell()` is a bare `>= RNFireball` and `constructPredefinedMissile`
 * builds an object for one on demand.
 *
 * ```cpp
 * RNFireball        =0xff80,
 * RNPoison          =0xff81,
 * RNLightning       =0xff82,
 * RNDispellMissile  =0xff83,
 * RNZoSpell         =0xff84,
 * RNPoisonBolt      =0xff86,
 * RNPoisonCloud     =0xff87,
 * RNMonsterDeath    =0xffa8,
 * RNFluxCage        =0xffb2,
 * RNffe4            =0xffe4,
 * ```
 *
 * **Single source of truth.** These were re-declared in `MonsterAttack`,
 * `AttackSystem`, `TimerSystem` and `BytecodeInterpreter`, and two of the four copies
 * had drifted: `RN_POISON_BOLT` was `0xff81` (which is `RNPoison`) and `RN_POISON` was
 * `0xff88`, an RN the enum does not contain at all. A Slime Devil therefore threw a
 * projectile nothing recognised, and the Invoke attack threw a poison cloud where the
 * player should have got a poison bolt — the two take different arms of
 * `DetermineMagicDamage` and differ in damage, mitigation kind and poison.
 *
 * Note the gap at `0xff85`: it is deliberate, and `RNPoisonBolt` is 0xff86.
 */
export const RN_FIREBALL = 0xff80;
export const RN_POISON = 0xff81;
export const RN_LIGHTNING = 0xff82;
export const RN_DISPELL_MISSILE = 0xff83;
export const RN_ZO_SPELL = 0xff84;
export const RN_POISON_BOLT = 0xff86;
export const RN_POISON_CLOUD = 0xff87;
export const RN_MONSTER_DEATH = 0xffa8;
export const RN_FLUX_CAGE = 0xffb2;
/** The Altar of Vi's resurrection cloud. CSBWin never named this one. */
export const RN_FFE4 = 0xffe4;

/** `RN::IsMagicSpell()` (`doc/CSBwin-src/CSBTypes.h:372`). */
export function isMagicSpellRn(rn: number): boolean {
  return (rn & 0xffff) >= RN_FIREBALL;
}

/** `RN::IsNonPhysicalSpell()` (`doc/CSBwin-src/CSBTypes.h:373`). */
export function isNonPhysicalSpellRn(rn: number): boolean {
  return (rn & 0xffff) >= RN_DISPELL_MISSILE;
}
