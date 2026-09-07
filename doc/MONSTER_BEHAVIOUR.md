# How Dungeon Master's monsters think

This is a plain-language account of monster behaviour, written after porting
`Monster.cpp` and its neighbours. It deliberately avoids CSBWin's variable names; if
you want those, `doc/CSBWIN_MONSTERS_REFERENCE.md` has the mapping and
`doc/PROVEN_FACTS.md` has the citations.

Everything here is behaviour I traced in the C++ and then watched happen in the port.
Where I could not work out *why* something is the way it is, it goes in
[Unsolved](#unsolved) at the end rather than being smoothed over.

**One machine, many parameters.** I had expected each monster type to have its own
logic and found the opposite: there is a single decision procedure, and the twenty-odd
creature types differ almost entirely by the numbers fed into it. So this is one
document rather than several. The exceptions — the giggler, Lord Chaos, and the
handful of creatures that throw things — are called out in
[Where types actually differ](#where-types-actually-differ).

---

## The unit of behaviour is the group, not the monster

A "monster" in the dungeon file is up to four creatures of one kind sharing a cell.
They move as one, they are hurt as one, they have one shared mood. Only in a fight do
they act individually, and even then only sometimes.

Each group occupies one cell and, within it, each member stands in one of four
corners — or the whole group is "centred", which is what a solitary monster does. A
worm is wide enough to occupy two corners; a dragon fills the cell entirely and can
never be more than one.

**A group only thinks while the party is on its level.** Off-level, the group leader
gets an occasional turn in which it takes one random step and then sleeps for a while
— longer the further away the party is. Everything else about the group is frozen. The
dungeon is not simulated behind you; it only twitches.

---

## What a monster can perceive

Two senses, and they fail in different ways.

### Sight

To see you, all of these must hold:

1. **You are not magically invisible** — unless this creature sees through that.
2. **You are in front of it.** Roughly a 45° cone, but one cell wider than that
   suggests: a monster facing north also sees a target directly to its side. A few
   creatures see in all directions and skip this test entirely.
3. **You are close enough.** Each type has a sight range. **Darkness halves it**, in
   proportion to how dark the screen actually is — the same value that dims your
   viewport shortens their vision. Some creatures see in the dark and are exempt.
   Even in pitch black, a monster still sees one cell.
4. **There is a clear line.** Walls block. Closed doors block, unless the door is one
   of the two "special" types the level designer marked as passable.

For a group, only *distinct* facings are tested. Four monsters all looking north
perform one test, not four.

The line-of-sight test is worth describing because it is not a ray cast. It walks from
**you** towards the monster, one cell at a time, choosing at each step whether to move
along x or y by whichever keeps the slope of the line closest to the original. If it
walks into a wall, the path is blocked — except on an exact tie between the two
choices, where it gets one retry along the other diagonal. Perfect diagonals are
special-cased: both orthogonal neighbours *and* the corner cell must be blocked before
the line is refused, so monsters can see you round the inside of a corner.

### Smell

If sight fails, a monster can still find you two ways.

**Close range.** Within roughly half its smelling range, and with a clear line that
**ignores doors**, it simply knows where you are. This is the mechanic that makes
hiding behind a closed door unreliable: it stops them seeing you, not smelling you.

**Your trail.** The game remembers the last two dozen squares the party stood on, each
with a staleness value. A monster standing on one of those squares may follow it. The
test is a random roll plus the print's staleness against a threshold — and the
threshold **falls as the creature's nose improves**, so a keen-nosed monster will
follow older, colder trails. A worm has by far the best nose in the game and can
scarcely see at all.

---

## Six moods

Behaviour is dominated by a single small state I will call the group's **mood**. There
are six in use:

| Mood | What it means | What it does |
| --- | --- | --- |
| **Calm** | Nothing is happening | Wanders; hunts by smell if it catches your trail |
| **Wary** | Aware, unbothered | Seeing you only makes it pause |
| **Alert** | Suspicious | Seeing you at range flips it to Charging |
| **Fleeing** | Panicking | Runs away, faster than it hunts |
| **Engaged** | In your face | Formation breaks — each member acts alone |
| **Charging** | Coming for you | Heads for where it last knew you to be |

The transitions are the interesting part:

- **You attack it, or walk into it** → *Engaged*, unless it is already Engaged or
  Fleeing. This is the fastest way to get a monster's full attention.
- **It takes damage** → if already Fleeing or Engaged, nothing changes. Otherwise it
  checks whether it can see you; if it cannot, it just turns on the spot, and if it
  can, it tries to move.
- **Calm or Alert, and it sees you at range** → *Charging*. Note *Wary* is the
  exception: a wary monster that sees you merely waits.
- **It reaches the square where it last saw you and you are not there** → *Calm*. The
  trail has gone cold.
- **A group member dies while Engaged** → the survivors may drop to *Fleeing*, and are
  likelier to the more of them have already died. Bravery is a per-type number; at the
  maximum a creature never breaks, whatever happens.
- **Fleeing runs out** — the panic is a countdown — or a fleeing monster is cornered
  next to you with nowhere to go → *Calm*. It stops panicking and turns to face you.

**Engaged is the only mood in which individual members get their own turns.** That
detail matters more than it sounds: several other parts of the code only bother
renumbering or clearing per-member state when the group is Engaged, because that is
the only time per-member state exists.

---

## One turn, as a decision tree

A group's turn arrives as a scheduled event. Roughly:

```
Is this group's level the party's level?
├─ No ──▶ only the leader acts: one random step, then sleep
│         (longer the further the party's level is)
└─ Yes
   │
   ├─ Is any member at zero health?
   │  └─ Yes ──▶ remove it, re-queue this turn for right now, stop
   │             (the group reconsiders once it has shrunk)
   │
   ├─ Is life magically frozen, and is this creature not invincible?
   │  └─ Yes ──▶ do nothing, try again in a moment
   │
   └─ Act, according to why this turn happened:
      │
      ├─ "I was attacked"  ──▶ break formation, everyone turn to face the party
      │
      ├─ "I was damaged"   ──▶ can I see them?
      │                        ├─ no  ──▶ turn on the spot, reschedule
      │                        └─ yes ──▶ try to move
      │
      ├─ "A cloud or door hurt me" ──▶ try every direction from a random start
      │
      ├─ An individual member's turn (only when Engaged)
      │                        ──▶ see "Deciding to attack" below
      │
      └─ The group's ordinary turn ──▶ dispatch on mood (see below)
```

The ordinary group turn, expanded:

```
Mood?
├─ Fleeing  ──▶ run away
├─ Charging ──▶ can I see them?
│               ├─ yes, and close enough, and lined up ──▶ break formation
│               ├─ yes, otherwise ──▶ close in at double speed
│               └─ no  ──▶ head for where I last saw them
├─ Wary/Alert/Calm ──▶ can I see them?
│    ├─ yes, close enough and lined up ──▶ break formation
│    ├─ yes, and I am Wary             ──▶ wait one move interval
│    ├─ yes, otherwise                 ──▶ become Charging, act next tick
│    └─ no:
│         ├─ Wary or Alert ──▶ wait one move interval
│         └─ Calm ──▶ can I smell them or their trail?
│                      ├─ yes ──▶ move that way
│                      └─ no  ──▶ coin flip:
│                                  ├─ wander in a random direction
│                                  └─ try all four directions from a random start
└─ Engaged ──▶ (the group as a whole does little; members act on their own turns)
```

"Break formation" means: mood becomes *Engaged*, note where the party is, and give
every member its own turn — member 0 always turns to face you, the rest on a coin
flip.

---

## Choosing a direction

When a monster has somewhere it wants to go, it tries four directions in a fixed
order, taking the first that works:

1. The direction it wants.
2. The **secondary** direction — when the target is off at an angle, the other of the
   two directions bracketing it, chosen at random when the angle is an exact diagonal.
3. That secondary reversed.
4. The wanted direction reversed — but only one time in four.

If none work, it turns to face where it wanted to go and waits out a move interval.
Monsters therefore look like they are "thinking" when boxed in: they face the right
way and shuffle.

Two touches that make movement feel less mechanical:

- **It will not immediately double back** to the square it just left — or rather, it
  will one time in four. This is what stops monsters oscillating between two cells.
- **A step only happens if enough time has passed.** If not, the monster keeps the
  turn but shortens its own next interval, so its motion stays smooth rather than
  stuttering.

A step is refused by walls, stairs, open pits (unless the creature floats), closed
false walls, doors too far shut for a creature of that height, another monster, and by
the party. Some creatures recognise *illusory* pits and false walls and will walk onto
them; most are fooled. Only a few types are willing to use teleporters at all.

**Speed is mood-dependent**: fleeing is a quarter faster than normal, and charging is
twice as fast. A cornered monster that turns to fight is genuinely slower than the
same monster running away from you.

---

## Deciding to attack

An individual member, on its own turn, and not already mid-swing:

```
Can it see the party?          ── no ──▶ can the group see them?
│                                        ├─ yes ──▶ turn towards them, wait
│                                        └─ no  ──▶ become Charging, head for
│                                                   last known position
└─ yes
   │
   ├─ Is it facing them? (or does it see in all directions?)
   │   └─ no ──▶ as above
   │
   ├─ Is the party within this creature's reach?
   ├─ Are they orthogonally lined up (same row or column)?
   ├─ Does it win a roll against its own reach?
   │   └─ any "no" ──▶ become Charging, close in at double speed
   │
   └─ all yes ──▶ ATTACK
```

Before a melee attack — reach 1 only — a monster standing in an awkward corner of its
cell will often **sidestep** to a better one first, and that shuffle can walk it onto a
missile you left lying there.

The attack itself is not a single decision but a **filled-in form**: who to hit,
whether to throw something instead, what to throw, how far, how hard, which sound. The
form is handed to a dungeon script that may rewrite any field, and only then acted on.
That is why custom dungeons can make monsters behave in ways the original never did.

**Who gets hit** is either the nearest reachable champion — determined by which side of
the cell the blow comes from, then a fixed order per side — or, for a handful of
creature types, a *randomly chosen* living champion regardless of position.

**Whether it lands** has two independent escapes before damage is even rolled: being
quicker than the attacker (and still needing to win a 3-in-4 roll), and being lucky.
Luck is a spendable resource — succeeding at a luck check *lowers* your luck.

**How much it hurts** goes through a deliberately convoluted chain: a base from the
creature's attack rating, reduced by twice your fighting skill, then halved, then grown
by three separate random terms, then quartered, then possibly reduced again. Armour
then scales it, averaged over the body parts the blow could land on. A large enough hit
also **wounds** a body part, and because the wound threshold doubles each time, one big
blow can mark several places while a hundred small ones mark none.

---

## Where types actually differ

Almost all variation is numeric. From the shipped data:

| Creature | Moves every | Sight | Smell | Reach | Bravery | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Muncher | 1 | 2 | 4 | 1 | max | Fastest thing in the game |
| Giggler | 3 | 6 | 3 | 1 | **0** | Steals instead of hurting; the biggest coward |
| Couatl | 5 | 3 | 3 | 1 | 3 | Fills a cell |
| Zytaz | 5 | 8 | 2 | 3 | 7 | Throws poison clouds or fireballs |
| Skeleton | 7 | 3 | — | 1 | 9 | No sense of smell at all |
| Oitu | 7 | 2 | 5 | 1 | 6 | |
| Scorpion | 8 | 3 | 1 | 1 | 9 | Fills a cell |
| Hellhound | 9 | 4 | 5 | 1 | max | Two-corner creature |
| Flying Eye | 10 | **10** | 2 | 3 | 10 | Sees everything, everywhere; throws lightning |
| Vexirk | 10 | 5 | 3 | 4 | 5 | Throws one of five different spells |
| Demon | 10 | 4 | 3 | 4 | max | Breathes fire |
| Rive | 11 | 3 | 4 | 1 | 6 | Passes through walls and doors; sees invisible |
| Lord Chaos | 12 | 9 | 3 | 6 | 3 | Invincible; see below |
| Lord Order | 12 | 9 | 3 | 6 | 3 | Unnamed in CSBWin; appears only mid-fusion |
| Grey Lord | 12 | 9 | 3 | 6 | 3 | The endgame. Never acts |
| Ant Man | 13 | 3 | 3 | 1 | 4 | |
| Dragon | 13 | 5 | 6 | 2 | 7 | Fills a cell; breathes fire |
| Deth Knight | 14 | 5 | — | 1 | max | Flips its sprite mid-swing, audibly |
| Slime Devil | 15 | 2 | 1 | 3 | 10 | Spits poison |
| Mummy | 17 | 4 | 2 | 1 | 9 | |
| (unnamed, type 5) | 20 | 2 | 2 | 1 | 3 | Two-corner creature |
| Worm | 18 | **1** | **10** | 1 | 10 | Nearly blind, best nose in the game |
| Stone Golem | 21 | 3 | — | 1 | max | No sense of smell |
| Water Elemental | 25 | 1 | 3 | 1 | 7 | Passes through walls |
| Screamer | **120** | **1** | 1 | 1 | max | Almost blind, almost immobile, fearless |
| Rock Pile | **185** | 3 | 4 | 1 | 12 | Slowest thing in the game |
| Black Flame | — | 4 | 3 | 1 | 10 | **Never moves at all** |

Read the "moves every" column as ticks between steps — smaller is faster. A muncher
takes a step 185 times as often as a rock pile.

Four genuine behavioural differences, rather than numeric ones:

**The giggler** does not damage you. It steals an item and, having stolen, is put into
a special agitated state and runs. It is also the only creature in the game with zero
bravery, so it flees at the slightest provocation.

**The throwers** — slime devil, flying eye, vexirk, zytaz, demon, dragon, Lord Chaos —
each have a fixed repertoire. A vexirk or Lord Chaos rolls between a fireball and one
of four spells; a flying eye throws lightning seven times in eight and something else
otherwise. A thrower standing *next to* you will sometimes punch instead, on a coin
flip. Everything else in the game has no ranged attack at all.

**The Deth Knight** is the only creature that visibly flips its sprite mid-attack, on a
coin toss, with a sound cue.

**Lord Chaos, Lord Order and the Grey Lord** are one being in three aspects, which is
why all three share a single identical set of statistics. The endgame is a
transformation between them, and it explains a great deal about how they are written.

Lord Chaos alone is a creature you can meet and fight. Fusing him with Lord Order — the
being CSBWin leaves unnamed, and the aspect representing pure order — produces the
Grey Lord, and the Grey Lord is not an opponent at all. It appears, the game is won,
and it ends.

The fusion sequence bears that out step for step: the game-won flag is set at the very
start, all three party shields are raised to 100, fireball clouds swell, and the
creature ahead of you flickers **between Chaos and Order twelve times**, slowing as it
goes, before settling as the Grey Lord. Every other monster on the level is then
deleted, the dungeon's text is read out, and the game prints "THE END." and rolls the
credits.

This makes sense of two things that look like defects in isolation. The Grey Lord has a
long reach, which would normally qualify it to throw something, yet it appears in no
table of what any creature throws — because it is never meant to act. And the check
that stops an invincible creature taking turns once the game is won exists precisely
so that, in the seconds between the Grey Lord appearing and the credits, it stands
there and does nothing.

Lord Chaos himself is a different animal to everything else you actually fight:

- He cannot be damaged at all. Nothing you do reduces his health.
- He moves **two squares at a time**, and buzzes as he arrives.
- The only thing that blocks him is a **Fluxcage**. That is not a general mechanic —
  the fluxcage check sits inside an "am I invincible?" branch, so a fluxcage is inert
  against every other creature in the game. It exists for this one purpose: herding
  him into position for the fusion.
- If he ends up somewhere he cannot be placed, he gets a 25% chance per retry to
  wander one square and try again — so he can escape a corner you have walled him
  into, given time.

**Two-corner and cell-filling creatures** (worms, hellhounds; dragons, scorpions,
couatls, golems, elementals, Lord Chaos) constrain group size — you cannot have four
dragons in a cell — and two-corner creatures must turn both halves together.

---

## Unsolved

Things I could not explain, in rough order of how much they bother me. Paul Stevens'
comments show he hit several of the same walls, and I have quoted him where he did.

**The condition that cannot fail.** One branch tests whether the mood is Calm or Alert
*and* not Charging — but the first test already excludes Charging. Stevens wrote: "The
following line makes no sense. But I have studied the original machine language over
and over again. This is what it did." He suggests it may have been written backwards.
My compiler independently flagged it as unreachable, which is a strange kind of
corroboration across thirty years.

**The footprint trail is acknowledged broken and still load-bearing.** The routine that
writes trail staleness gets Stevens' bluntest comment: "I think this is much hogwash.
Does nothing useful. Is full of errors. Perhaps an old, abandoned debug trace." He is
right that it is wrong — it overwrites every entry it walks past with a single value,
and the routine that *deletes* an entry shifts the tail the wrong way. But it is the
only thing that writes the staleness values that smelling reads. Whatever it does, the
game's tracking behaviour depends on it, and it cannot simply be repaired without
changing how monsters hunt.

**A branch that does nothing but consume randomness.** In the pre-melee sidestep there
is a 50% branch whose only statement is commented out in CSBWin. It still draws a
random number, so it still shifts everything downstream. I ported it as written. It
looks like a behaviour that was removed and whose removal was never finished.

**Two moods are never used.** Of eight possible values only six appear. One of the
unused ones shows up solely in a "reset anything at or above this" cleanup, which
suggests there were once more states than survive in the shipped game.

**Undocumented flags that turned out to matter.** Two per-type flags are marked only
"????" in CSBWin. I worked out that one of them selects random targeting over nearest
targeting — that is why some creatures hit the back rank seemingly at random. The other
appears only in the sidestep condition and I still do not know what it means; the types
that have it (screamer, vexirk, water elemental, dragon, and all three aspects of the
Lord) do not obviously have anything in common.

**A value read before it is written.** On rare paths a variable reaches the movement
code uninitialised. Stevens patched the Atari binary to force it to a fixed number,
noting that the uninitialised value was usually "part of an address" and that leaving
it made the two builds impossible to compare. So the original game had a real bug here,
and its effect was "slightly erratic behaviour" that nobody ever noticed.

**A number reused as two different things.** In the corner-shuffling code one value is
used as both a position and a bitfield within a few lines. Stevens: "I think there is
something wrong with D5 here." I ported it as written because I could not determine
what the correct version would even be.

**Why the willingness-to-teleport threshold is what it is.** Whether a creature will
step into a teleporter is decided by a per-type number being at least 10. The types
that pass are vexirk, zytaz, demon, dragon and the three aspects of the Lord. Why that field, and why 10, I
have no idea — the same field is not obviously used for anything else.

---

## What this adds up to

The impression from outside is that Dungeon Master's monsters are cunning. Having read
the code, I would say the effect comes from four cheap tricks layered well:

1. **Senses that fail differently.** Sight is blocked by doors and darkness, smell is
   not. So a monster that has lost you often still knows roughly where you went, and
   the two failure modes together read as searching.
2. **Commitment.** A monster that has seen you keeps heading for where you *were*, and
   only calms down on arriving and finding nothing. That single behaviour produces most
   of the game's best moments.
3. **Reluctance to backtrack.** One rule — do not immediately re-enter the square you
   just left — removes nearly all of the twitching that would otherwise expose the
   machinery.
4. **Speed tied to intent.** Fleeing is faster than hunting; charging is faster still.
   The pace of a fight changes as the monster's mood changes, and that reads as
   emotion.

None of it is planning. There is no pathfinding — a monster that cannot see a way
towards you simply tries four directions and gives up. Put a pillar between you and a
rock pile and it will lose you completely. But the failure modes are quiet, and the
successes are legible, which is the whole trick.
