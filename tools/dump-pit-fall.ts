/**
 * Falling down a pit, and what it costs.
 *
 * `MoveObject`'s pit branch (`doc/CSBwin-src/Code11f52.cpp:3016-3106`) is the only
 * place the party's own fall damage happens, and none of it is visible on a frame.
 * Three outcomes share the branch:
 *
 *   - an uncontrolled fall: `DamageAllCharacters(20, 48, 2)` — mask 48 is legs and
 *     feet, kind 2 halves the armour — plus sound 6 if anyone was hurt;
 *   - a climb down a rope, with `d.SupressPitDamage` set: each living champion pays
 *     `25 * load / MaxLoad + 1` stamina instead, so a heavily laden champion pays more;
 *   - a monster group: `DamageMonsterGroup(rec, oldX, oldY, 20, …)` at the cell it
 *     fell *from*, because nothing has been relinked yet.
 *
 * This finds a real pit in the shipped dungeon, drops the party down it, and reads the
 * damage off the champions.
 *
 * Run: `npx tsx tools/dump-pit-fall.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';

function champion(i: number, name: string): Champion {
  return {
    ...addCharacterDefaults(),
    name,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.addChampion(champion(i, `HERO${i}`));
  return game;
}

/**
 * Stand the party on the pit's level and drop it in, `MoveObject(RNnul, -1, 0, x, y)`,
 * then run the top of the next tick, which loads the level it reached
 * (`d.newPartyLevel`), and say where it landed.
 */
function fall(g: Game, pit: Position): Position {
  g.party.state.position = new Position(pit.x, pit.y, pit.z);
  g.worldMove.moveParty(-1, 0, pit.x, pit.y);
  // The next tick: the level below loaded, then `DisplayCharacterDamage` takes the fall
  // off the HP (doc/CSBwin-src/CSBCode.cpp:615-657).
  g.loadNewPartyLevel();
  g.monsterAttack.displayCharacterDamage();
  return g.party.state.position;
}

/** An open, active pit in the shipped dungeon that actually leads somewhere. */
function findOpenPit(game: Game): Position | null {
  const dungeon = game.dungeonState;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const flag = map.cellFlags[x]?.[y];
        if (flag === undefined) continue;
        if (((flag >> 5) & 0x7) !== RoomType.PIT) continue;
        if ((flag & 0x08) === 0) continue; // not active
        if ((flag & 0x01) !== 0) continue; // an "imaginary" pit
        const here = new Position(x, y, z);
        if (!dungeon.incrementLevel(here, 1)) continue; // PitGoesSomewhere
        return here;
      }
    }
  }
  return null;
}

function healths(game: Game): number[] {
  return game.party.state.champions.map((c) => c.attributes.health);
}

function staminas(game: Game): number[] {
  return game.party.state.champions.map((c) => c.attributes.stamina);
}

function main(): void {
  const probe = makeGame();
  const pit = findOpenPit(probe);
  if (!pit) {
    console.log('No open pit found in dungeon.dat — cannot test the fall.');
    finish();
    return;
  }
  const below = probe.dungeonState.incrementLevel(pit, 1)!;
  console.log(`=== the pit at level ${pit.z} (${pit.x},${pit.y}), which drops to level ${below.z} ===`);

  /* ------------------------------------------------- 1. an ordinary fall -------- */

  console.log('');
  console.log('=== an uncontrolled fall: DamageAllCharacters(20, 48, 2) ===');
  console.log(['champion', 'health before', 'health after'].join('\t'));

  {
    const g = makeGame();
    const before = healths(g);
    const staminaBefore = staminas(g);
    const resolved = fall(g, pit);
    const after = healths(g);
    for (let i = 0; i < after.length; i++) {
      console.log([`HERO${i}`, before[i], after[i]].join('\t'));
    }
    console.log(`landed at level ${resolved.z} (${resolved.x},${resolved.y})`);

    check(resolved.z !== pit.z, 'the party fell');
    check(resolved.z === below.z, 'and landed one level down');
    const hurt = after.filter((h, i) => h < before[i]!).length;
    check(hurt > 0, `the fall hurt someone (${hurt} of ${after.length})`);
    // The spread is `damage/8 + 1` either side of `damage - spread`, so nobody takes
    // the same wound and nobody escapes entirely.
    check(after.every((h, i) => h < before[i]!), 'in fact it hurt everybody');
    check(staminas(g).every((s, i) => s === staminaBefore[i]), 'and cost no stamina');
  }

  /* ------------------------------------------------- 2. a climb down ------------ */

  console.log('');
  console.log('=== a rope climb: stamina in proportion to load, no blood ===');
  console.log(['champion', 'stamina before', 'stamina after', 'health after'].join('\t'));

  {
    const g = makeGame();
    const healthBefore = healths(g);
    const staminaBefore = staminas(g);
    const resolved = g.worldMove.withSupressedPitDamage(() => fall(g, pit));
    const staminaAfter = staminas(g);
    const healthAfter = healths(g);
    for (let i = 0; i < staminaAfter.length; i++) {
      console.log([`HERO${i}`, staminaBefore[i], staminaAfter[i], healthAfter[i]].join('\t'));
    }

    check(resolved.z !== pit.z, 'the party still fell');
    check(healthAfter.every((h, i) => h === healthBefore[i]), 'a climb down costs no health');
    check(staminaAfter.every((s, i) => s < staminaBefore[i]!), 'but every champion paid stamina');
    // Empty-handed champions pay the floor of 1.
    check(staminaAfter.every((s, i) => staminaBefore[i]! - s === 1),
      'an unladen champion pays the minimum of 1');
  }

  {
    // A loaded champion pays more. `25 * load / MaxLoad + 1` with load at half MaxLoad
    // is 13; the tool sets the load by hand rather than filling a backpack.
    const g = makeGame();
    const champ = g.party.state.champions[0]!;
    const maxLoad = g.characterStats.maxLoad(champ);
    const before = champ.attributes.stamina;
    g.monsterAttack.adjustStamina(0, Math.trunc(((25 * Math.trunc(maxLoad / 2)) & 0xffff) / maxLoad) + 1);
    const paid = before - champ.attributes.stamina;
    console.log(`a champion at half MaxLoad (${maxLoad}) would pay ${paid} stamina`);
    check(paid === 13, `half-loaded costs 13 stamina (got ${paid})`);
  }

  /* ------------------------------------------------- 3. the flag is one-shot ---- */

  console.log('');
  console.log('=== the suppression covers one move, not the rest of the game ===');

  {
    const g = makeGame();
    g.worldMove.withSupressedPitDamage(() => fall(g, pit));
    const healthBefore = healths(g);
    // Put the party back at the pit and fall again, this time without a rope.
    fall(g, pit);
    const healthAfter = healths(g);
    check(healthAfter.some((h, i) => h < healthBefore[i]!), 'the next fall hurts again');
  }

  /* ------------------------------------------------- 4. a dead champion --------- */

  console.log('');
  console.log('=== a corpse pays no stamina ===');

  {
    const g = makeGame();
    const dead = g.party.state.champions[1]!;
    dead.alive = false;
    dead.attributes.health = 0;
    const staminaBefore = dead.attributes.stamina;
    g.worldMove.withSupressedPitDamage(() => fall(g, pit));
    check(dead.attributes.stamina === staminaBefore, 'a dead champion is skipped by the climb cost');
  }

  console.log('');
  finish();
}

main();
