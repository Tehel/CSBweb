# The champion's attack

Source: `doc/CSBwin-src/Attack.cpp` (the engine) and `doc/CSBwin-src/Character.cpp` plus
`doc/CSBwin-src/CSBCode.cpp:8823-8967` (the menu). Ported to
`src/engine/AttackSystem.ts` and `src/renderer/ui/Attack.ts`.

Monsters hitting the party is the other half and lives in `doc/CSBWIN_MONSTERS_REFERENCE.md`.

## The shape to understand first

`_Attack` (`Attack.cpp:1628`) does not compute a blow and apply it. It fills in an
`ATTACKPARAMETERS` block (`:412`) describing the blow, hands the block to the **Party
Attack Filter** DSA three times, and acts on whatever the block says by the end:

| `msg` | when | what the block holds |
| --- | --- | --- |
| 0 | before anything is decided | who, what type, the target square, the monster there, the skill, stamina, experience, busy time, mana |
| 1 | after the attack type's own code has run | the above **plus** the type-specific arm of `ATTDEP` — the damage rolled, the spell's range, the door's strength, the coin's face |
| 2 | after everything has been applied | the final values |

A dungeon can therefore rewrite any part of any attack, including the damage. That is why
the block is a struct in CSBWin and stays one in the port, and why the damage functions
return *through it* rather than by value.

`ATTACKPARAMETERS` is 31 `i32` words: 14 named, `userInfo[10]`, `dataType`, then a 6-word
union. The DSA sees them flat from index 0, and `pDSAparameters[0]` is set to
`sizeof(ATTACKPARAMETERS)` = 124 — a byte count where every other filter stores a word
count, which is CSBWin's own inconsistency and harmless because `PARAM_FETCH` clamps to 100
first.

`SetupDSAParam` (`:1346`) finds the filter **once**, by looking for an actuator of type 47
at special location `ESL_PARTYATTACKFILTER` (4). `CallAttackFilter` (`:457`) then runs that
same actuator each time, and clamps `charIdx` back to 0 with a message box if the DSA set
it out of range.

## Physical attacks

`AttackWithPhysicalForce` (`:1048`) → `DeterminePhysicalAttackDamage` (`:532`) →
`PhysicalAttackFilter` (`:483`) → `DamageMonster`.

`PhysicalAttackFilter` is the one filter call that *applies* rather than only reads: the
stamina cost, the skill gain and `DamageMonster` all happen on its far side. Every exit
from `DeterminePhysicalAttackDamage` — including every miss — goes through it, so a miss
still costs `2 + random(1)` stamina and a filter that zeroes `monsterDamage` really does
make the blow harmless.

Order of gates, all in `AttackWithPhysicalForce`:

1. Sound 16, always.
2. No monster in the square → 0.
3. `DetermineAttackOrdinal` (`:22`) picks **which group member** takes the blow, from the
   champion's own corner through `DetermineAttackOrder`'s `Byte586` row. 0 → nothing
   reachable → 0.
4. The back rank cannot swing past the front rank → `attackDamageToDisplay = -1`,
   "CAN'T REACH".
5. `atk_DISRUPT` against a *material* monster → 0.
6. `Byte20002[attackType]` and `Byte19958[attackType]` are read as `p7` and `p8`. `p7`
   only ever appears as `75 - p7`, the luck threshold; `p8` scales the throwing distance
   into damage, over 32.

Then `DeterminePhysicalAttackDamage`: a hit check on `Quickness` with two independent
second chances (a flat 1-in-4, then `IsCharacterLucky`), a damage roll, and a **second
noisier roll** when the first came out at 1 or below. See `doc/PROVEN_FACTS.md` — "A blow
has two damage rolls", "Skill makes a champion's blows harder, not more frequent" and
"Three named blades are special-cased in the damage formula".

Every intermediate is truncated to a signed 16-bit word and several steps can go negative,
so the `sw()` calls are load-bearing.

## The other attack types

`_Attack`'s switch, in CSBWin's order. Two fallthroughs are deliberate and both are
preserved.

| type | what happens |
| --- | --- |
| LIGHTNING / DISPELL / FIREBALL / SPIT | `AttackWithSpell` at range 180 / 150 / 150 / 250 |
| INVOKE | `AttackWithSpell` at `random(128) + 100` with a projectile picked from `random(6)` — poison bolt, poison cloud, dispell, else fireball |
| BASH / HACK / BERZERK / KICK / SWING / CHOP | a **breakable, closed** door (`roomType == 4 && (flags & 7) == 4`) gets `HitDoor` at the champion's throwing distance, busy time forced to 6, sounds 16 and 4. Anything else *falls through* to the melee code |
| DISRUPT / JAB / PARRY / STAB2 / STAB1 / STUN / THRUST / MELEE / SLASH / CLEAVE / PUNCH | melee. A miss halves both the experience and the busy time |
| CONFUSE | spends a charge, then *falls through* to the shouts |
| WARCRY / CALM / BRANDISH / BLOWHORN | `WarCryEtc` |
| SHOOT | fires the shield hand's contents, if it is the matching ammunition class |
| FLIP | `STRandomBool()`, which the attack filter may change, → "IT COMES UP HEADS" / "TAILS" through `PrintWithSubstitution(…, 4, true)`: one print-queue entry, its linefeed first (`Attack.cpp:1915-1925`; `tools/dump-flip.ts`) |
| SPELLSHIELD / FIRESHIELD | `MagicShield` at strength 0x118. A return of 0 — the champion had under four mana and got half a shield — quarters the experience and halves the busy time instead of spending a charge |
| FLUXCAGE | `FluxCage` |
| FUSE | Lord Chaos's endgame. **Not ported** |
| HEAL | two mana a helping, `min(10, mastery(13))` HP each, and the experience grows by 2 per helping — so a badly hurt champion learns far more from one HEAL |
| WINDOW | `d.SeeThruWalls++` and a `TT_73` at `random(mastery + 8) + 5` |
| CLIMBDOWN | into an **empty** pit only; anything in it and the champion does not even lose a turn |
| FREEZELIFE | see `doc/PROVEN_FACTS.md`, "FREEZE LIFE is capped twice" |
| LIGHT | `d.Brightness += Word1074[2]`, then a decay timer at rate -2 over 2500 |
| THROW | `ThrowByCharacter` from the fighting hand, with the filter able to override range, damage, decay and busy time |
| anything else (BLOCK, HIT) | `ADT_Default` — the filter runs and nothing else happens |

The tail, in order and after the `msg` 2 filter call: busy timer, stamina, experience, and
**last of all** the monster wake-up. The wake-up is deliberately deferred to the very end
(`:2174-2187`) because activating a group re-enters the Monster Move Filter, and CSBWin
would rather not have two DSA filters nested.

### `WarCryEtc`

`random(base + mastery(14)) >= bravery`, where `base` is 3 for WARCRY, 7 for CALM, 6 for
BRANDISH and BLOWHORN, 12 for CONFUSE. Bravery 15 means the monster cannot be frightened at
all. On success the group drops to `StateOfFear5` and its `ITEM16.uByte5` pause becomes
`4 * (16 - bravery) / timePerMove`; a group already in state 6 — broken formation, mid
attack — has its attack cleared and its movement timers restarted first. On failure the
skill reward is halved. Either way skill 14 is credited.

### `_Fusion`

`atk_FUSE` aims at the square in front of the party, runs the `msg` 1 filter, then
`_Fusion` (`:1965-1974`). A dispell cloud lands on the square, and if Lord Chaos stands
there he tries to escape, in shuffled directions: a square next to him first, then one two
away, which lets him jump over the party or a monster but never through a Fluxcage or a
wall. Boxed in, `_FusionSequence` starts. The rules are in `doc/PROVEN_FACTS.md` → "The
fusion: a dispell cloud, then Lord Chaos's escape"; the port is `AttackSystem.fusion`, the
evidence `tools/dump-fusion.ts`. `_FusionSequence` (`:2222`), the ending itself, holds the
main loop to the credits: `doc/PROVEN_FACTS.md` → "`_FusionSequence`: the end of the
game", ported as `AttackSystem.fusionSequence`.

## The menu

The strip under the viewport is a two-state panel, and `d.Word20252` is the state:

- **1** — four attack buttons, one per champion, each showing the icon of the weapon in
  its fighting hand (`objNI_Special_c`, the bare fist, for an empty hand; nothing for a
  held object with attack class 0). A dead champion's button is black rather than blue;
  the button is shaded while the champion is busy or the party sleeps.
- **0** — that champion's legal attacks, up to three, named from `AttackNames`. The
  backdrop rectangle is chosen by how many options there are —
  `wRectPos20202` / `20210` / `20218` for three / two / one.

`d.Word20250` means "the panel owes a redraw" and `TAG01b29a` (`CSBCode.cpp:8904`), called
once per game tick, is what services it: it flashes `d.attackDamageToDisplay` if there is
one, and otherwise puts the buttons back. It is also where each champion turns to face
whatever hit them hardest since the last tick — the flinch you see in play.

Clicks arrive as button 111 and are routed by `TAG019fac` (`Character.cpp:4678`) to
whichever button list matches the state: `Buttons17952` (ids 116-119, pick a champion) or
`Buttons17892` (id 112 PASS, 113-115 the options). Only the options below `d.Word20248` are
live.

Each option offered goes through `ActionNameFilter` (`CSBCode.cpp:8739-8818`) as its row is
drawn: a DSA at `ESL_ACTIONNAMEFILTER`'s location may name it with a global text, and may
change the attack it is (`doc/PROVEN_FACTS.md` → "The action name filter runs its
location's first DSA, found once, for each option offered"). The port decides the names in
`drawLegalAttackTypes`, once per CSBWin drawing, and `drawAttackPanel` draws what it chose.

`_FlashAttackDamage` (`Attack.cpp:949`) draws one of three starburst sizes — over 40, over
15, the rest — with the number written right-to-left from x=274 in 3-pixel steps, so it
centres itself whatever its width. The big burst is graphic 14 (96x45) blitted as it is
into `d.wRectPos20202`; the other two are graphic 14 passed through `ShrinkBLT` to 64x37
and 42x37 (`Attack.cpp:1011`) and blitted into `d.wRectPos20226` and `d.wRectPos20234`,
rectangles of those widths. The burst is drawn off-centre in graphic 14 so that all three
centre on x=274, under the digits. Two negative values are messages instead: -1
"CAN'T REACH", -2 "NEED AMMO".

## Deliberately not ported

- **`_FlashAttackDamage`'s `VBLDelay(15)`**, which stops the whole game for a quarter of a
  second. A browser cannot block the frame loop, so the flash is a timed overlay of the
  same duration and the game keeps running underneath — as it already does for the feeding
  animation.

`FluxCage`'s neighbour test is kept **as written**: CSBWin checks `(LCX, LCY-1)` twice and
never looks south (`:1626-1630`), so a cage count of 3 is reachable in only three of the
four directions. That is the behaviour the real game has.
