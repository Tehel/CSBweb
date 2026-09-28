# Training: the fastest way to gain levels

A player's guide to grinding mastery levels in Dungeon Master, worked out from CSBWin's source
(`doc/CSBwin-src/`) and from the tables in the real Atari `graphics.dat` and `dungeon.dat`.
The companion page `doc/training.html` says the same thing in a form nicer to read.

Everything below is either read from the C++ or computed from the game's own tables, with the
citation next to it. The two practical observations from play (spells exploding on the party
when cast at an adjacent wall, and the two long staircases) are marked as such.

Levels are numbered from 1, the Hall of Champions level. A "tick" is one game tick, `d.Time`.

## How experience is scaled

Every gain goes through `AdjustSkills` (`doc/CSBwin-src/Magic.cpp:200-260`), which applies
three factors in this order:

1. **Skills 4-11 (Fighter and Ninja sub-skills) earn half** when no monster has attacked the
   party for 150 ticks (`d.LastMonsterAttackTime < d.Time - 150`).
2. **Everything is multiplied by the level's experience multiplier** when it is non-zero
   (`d.pCurLevelDesc->experienceMultiplier()`, the level the party is on).
3. **Every sub-skill (4-19) earns double** when a monster attacked in the last 25 ticks.
   The base skills 0-3 are never doubled.

Only `MonsterAttacks` sets `d.LastMonsterAttackTime` (`doc/CSBwin-src/Monster.cpp:982`); a
missile arriving at the party does not. See `doc/PROVEN_FACTS.md`, "Only `MonsterAttacks` sets
`d.LastMonsterAttackTime`".

A sub-skill's experience is also added to its base skill, and the level shown for a class is
the base skill's mastery. That mastery ignores both the temporary boost and item bonuses
(`DetermineMastery(chIdx, base | 0xc000)`). It starts at 1 and goes up by one each time the
experience, halved at every step, is still at least 500 (`doc/CSBwin-src/Code17818.cpp`). So
level *m* needs `500 × 2^(m-2)` experience. **Each level costs twice the last**, which is why
the multipliers below matter more and more as a champion grows.

### The level multipliers (from `dungeon.dat`)

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Multiplier | ×1 | ×1 | ×1 | ×2 | ×2 | ×2 | ×3 | ×3 | ×3 | ×4 | ×5 | ×5 | ×6 | ×6 |

Level 1's stored value is 0, meaning "don't multiply", so it counts as ×1.

**Putting it together:** the same action is worth up to **×6** at the bottom of the dungeon,
and a Fighter or Ninja skill is worth **×4** next to a monster that keeps attacking (×2
instead of ×½). A Ninja practising on level 14 beside a weak attacker earns 24 times what the
same Ninja earns alone on level 2.

## Quick wins

### The two long staircases (from play)

Two staircases, starting on levels 6 and 7, go straight down to the bottom levels. Once you
can reach them, train at the bottom: that turns ×2 or ×3 into ×5 or ×6 for everything below.

### Hit a closed door, not the air

`_Attack` sends BASH, HACK, BERZERK, KICK, SWING and CHOP at a door when the cell in front is
a door whose state is closed, `(flags & 7) == 4` (`doc/CSBwin-src/Attack.cpp:1794-1812`). It
does not check whether the door can be broken. `HitDoor` checks that afterwards and quietly
returns 0 for a door an axe can't open (`doc/CSBwin-src/Code11f52.cpp:2276-2281`). Either way
the attack leaves the switch with `successfulAttack` still at its starting value of 1, so it
is **not a miss**. The attack earns its **full** experience, with the busy time fixed at 6.

- **A door that can't be broken can be hit for ever.** A breakable door hit hard enough
  breaks two ticks later, and then the training is over.
- KICK earns 13 on a door against 6 in the air. BERZERK earns 40 on a door, with 6 ticks of
  busy time instead of 30 (and it costs 26+ stamina).
- The ×½ for having no monster nearby still applies.

| Attack | Skill | Exp at a closed door | Exp at the air |
|---|---|---|---|
| KICK | 9, Fight (Ninja) | 13 | 6 |
| BERZERK | 4, Swing (Fighter) | 40 | 20 |
| BASH | 6, Club (Fighter) | 11 | 5 |
| CHOP | 6, Club (Fighter) | 10 | 5 |
| HACK | 4, Swing (Fighter) | 9 | 4 |
| SWING | 4, Swing (Fighter) | 6 | 3 |

### Throw at the wall in front of you

A missile checks the next cell for a wall *before* it leaves its own
(`doc/CSBWIN_MISSILES_REFERENCE.md`, "Movement and collision"). A thrown object that stops
there is dropped at the missile's position (`ProcessObjectFromMissile`), which is the party's
own square. That is the same reason a fireball or a poison cloud cast at an adjacent wall
lands on the party, which play confirms. So facing a wall, each throw costs two clicks: pick
the object up, throw it. You never have to walk after it.

### Let the priest feed the fighters

A YA potion is the best priest training there is (see below), and it gives back stamina,
which is exactly what door-kicking and throwing use up. The priest casts YA into a flask and
hands it to the kicker, who drinks it. Drinking empties the flask, and the priest casts into
it again. Mana goes in; priest experience and fighter or ninja experience come out.

### Sleep to get mana back

`TenSecondUpdate`, which regenerates mana, runs every 64 ticks awake and every 16 asleep
(`doc/CSBwin-src/CSBCode.cpp:686-688`): **four times** as fast. Asleep, skill levels do
not count: every mastery reads 1 (`doc/CSBwin-src/Code17818.cpp:29-36`), so whether mana
comes back depends on Wisdom alone. Each point costs 14 stamina, even for a master.

### Keep a harmless monster busy on you

Next to a monster that keeps attacking, every sub-skill earns double. For Fighter and Ninja
skills it also lifts the ×½, so they earn ×4.

### Things that do not help

- **The weight of what you throw.** See below.
- **Punching the air.** It is a miss, and misses earn half (see below).
- **Skill increasers.** CSBWin has one (`SkillIncreaser(8, 300, …)`, local action 10,
  `doc/CSBwin-src/Mouse.cpp:209-256`), but no actuator in DM's `dungeon.dat` uses local
  action 10.
- **Gear, for levels.** The Firestaff, the Pendant Feral, the Ekkhard Cross, the Moonstone,
  the Gem of Ages and the Sceptre of Lyf all add mastery when casting, but the level-up check
  ignores them. They let you cast one power higher without failing, which saves a few clicks
  and nothing else.

## Ninja

### Throwing (skill 10, Throw)

`ThrowByCharacter` (`doc/CSBwin-src/Mouse.cpp:724-737`) awards:

- **8** for anything that is not a weapon, whether a compass or a boulder;
- **12** for a weapon;
- **12 + throw damage ÷ 4** (`uByte3 / 4`) for a weapon whose class `uByte1` is 12 or less.
  That includes the swords, maces and clubs (class 0) and the dagger and axes (class 2), not
  only the throwing weapons.

**Weight earns nothing.** It only costs stamina (`TAG016382`, `doc/CSBwin-src/Mouse.cpp:653`):
weight/2 in tenths of a kilo, clamped to 1-10, plus half of each further 10. Heavy objects
also fly a shorter distance. Throwing from the attack menu's THROW instead of the cursor adds
the menu's own **+5** to the same skill (`experienceForAttacking[THROW]`, applied in
`_Attack`'s tail, `doc/CSBwin-src/Attack.cpp:2157-2159`). Every throw makes the champion busy
for 4 ticks.

| Item | Weight | Exp per throw | Stamina |
|---|---|---|---|
| **Slayer** | 0.2 kg | **19** | 1 |
| Poison dart | 0.3 kg | 17 | 1 |
| Dagger | 0.5 kg | 16 | 2 |
| Throwing star | 0.1 kg | 16 | 1 |
| Rock | 1.0 kg | 16 | 5 |
| Arrow | 0.2 kg | 14 | 1 |
| Sword | 3.2 kg | 14 | 13 |
| Axe | 4.3 kg | 20 | 15 |
| Hardcleave | 6.5 kg | 23 | 28 |
| Stone club | 11.0 kg | 17 | 70 |
| Boulder (not a weapon) | 8.1 kg | 8 | 40 |

These are the values before the multipliers. Without a monster attacking, skill 10 earns half.

The Slayer is the better kind of arrow, normally shot from a bow. `dungeon.dat` has only four:
three on level 5 (two on the floor at x13,y13, one in a chest at x9,y28) and one on level 11
(x29,y2). Poison darts (level 4) and throwing stars (levels 1 and 5) are nearly as good and
easier to find. Coordinates are the port's map-preview grid: x left to right, y top to bottom.

### Hand-to-hand (skill 9, Fight)

`AttackWithPhysicalForce` returns 0 when there is no monster in the square
(`doc/CSBWIN_ATTACK_REFERENCE.md`, gate 2). `_Attack` then treats the attack as a miss and
halves both the experience and the busy time (`doc/CSBwin-src/Attack.cpp:1834-1838`). A wall
counts the same as empty air, unless it is a closed door (see above).

| Attack | Base exp | Exp at the air | Busy after a miss | Stamina |
|---|---|---|---|---|
| PUNCH | 8 | 4 | 0 | 1-2 |
| HIT | 10 | 5 | 2 | 3-4 |
| KICK | 13 | 6 | 2 | 3-4 |
| STAB (Fight) | 15 | 7 | 2 | 3-4 |

Each attack takes two clicks, and the one input queue handles one click per tick, shared by
the whole party. **Clicks are the real limit**, not busy time. With several champions taking
turns, a busy time of up to about 6 ticks costs nothing, so choose the attack that earns the
most per attack. That makes a KICK at a closed door (13) the best Fight training by far.

## Priest

Casting has no busy time. The experience of a cast (`CastSpell`,
`doc/CSBwin-src/Magic.cpp:1197-1211`) is

```
D = spell's required skill + power      (power: LO=1 … MON=6)
exp = random(0-7) + 16·D + 8·(power-1)·required + D²
```

and it goes to the skill in the spell's own record (`byte5`, graphics `0x230`), whatever the
caster's class. The mana is the rune table `Byte19010`: the power rune costs 1-6, and every
later rune costs its base × (8, 12, 16, 20, 24, 28)[power] shifted right by 3, so a
remainder is dropped (`TAG01b990`, `doc/CSBwin-src/CSBCode.cpp:8973-8979`).

| Potion | Skill | Exp per mana, LO → MON |
|---|---|---|
| **YA** (stamina) | 13, Heal | **20.2 → 21.2** |
| VI (health) | 13, Heal | 9.9 → 12.8 |
| YA BRO DAIN (wisdom) | 13, Heal | 8.3 → 9.0 |
| YA BRO NETA (vitality) | 13, Heal | 7.8 → 8.3 |
| OH BRO ROS (dexterity) | 13, Heal | 7.8 → 8.3 |
| FUL BRO KU (strength) | 13, Heal | 7.2 → 7.8 |
| YA BRO (shield) | 15, Defend | 6.0 → 7.4 |
| VI BRO (cure poison) | 13, Heal | 3.6 → 5.1 |
| ZO BRO RA (mana) | 2, Priest base (never doubled) | 4.0 → 4.6 |

Priest spells, for comparison: YA IR 6.0 → 7.4, FUL BRO NETA 6.4 → 6.9, OH EW RA 5.2 → 6.0,
DES IR SAR 1.9 → 2.7. HEAL cast from a staff (the attack) earns 2 per 2 mana, so about 1.

**Recipe: YA at the highest power you can cast without risk.** Exp per mana hardly grows with
power, so a higher power mostly means fewer casts and fewer flasks. What matters is not
failing. If your mastery of the spell's skill is *k* levels short of `required + power`,
`CastSpell` makes *k* wisdom tests, each passed with probability
`(min(Wisdom + 15, 115) + 1) / 128`. A failure burns the mana, makes no potion, and earns
experience ÷ 2^k (`doc/CSBwin-src/Magic.cpp:1216-1232`). A potion needs an empty flask in
hand (`GetFlaskInHand`), and without one the mana is lost and nothing is learned.

## Wizard

| Spell | Skill | Lowest mastery (LO) | Exp per mana, LO → MON |
|---|---|---|---|
| **OH VEN** (poison cloud) | 19, Water | 4 | **9.3 → 10.2** |
| **FUL** (light) | 16, Fire | 2 | 6.6 → 8.9 |
| FUL IR (fireball) | 16, Fire | 4 | 6.4 → 7.4 |
| OH KATH RA (lightning) | 17, Air | 5 | 6.4 → 6.8 |
| OH IR RA | 17, Air | 5 | 6.0 → 6.5 |
| ZO (open door) | 17, Air | 2 | 4.9 → 6.8 |
| ZO VEN (poison potion) | 19, Water | 3 | 5.0 → 6.3 |
| OH EW SAR | 17, Air | 4 | 4.9 → 5.7 |
| DES VEN (poison bolt) | 19, Water | 2 | 3.6 → 5.0 |
| DES EW, YA BRO ROS | 18, Earth | 2 | 3.3 → 4.6 |
| ZO KATH RA | 3, Wizard base (never doubled) | 1 | 1.0 → 1.9 |

All four elements feed the Wizard level equally. **Recipe:** FUL while the wizard is young.
It is harmless, can be cast anywhere, and gets better with power. Switch to OH VEN once
mastery 4 is reached, but **cast it down a long corridor**: cast at an adjacent wall, the
cloud lands on the party, just as a fireball explodes on it.

## Worked example

A priest with mastery 8 in Heal, on level 13 or 14, with a monster attacking in the last 25
ticks, casts YA at MON: 276 × 6 × 2 ≈ **3,300 experience for 13 mana**. The same cast on
level 2 earns 276.
