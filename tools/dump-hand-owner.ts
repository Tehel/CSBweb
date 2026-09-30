/**
 * Who owns the mouse cursor, and what happens to the inventory when nobody does.
 *
 * `d.HandChar` is invisible on screen — nothing is drawn differently when it is -1 —
 * but CSBWin gates every inventory-slot click on it
 * (`doc/CSBwin-src/Mouse.cpp:1600-1606`), so a party with no cursor owner silently
 * cannot pick anything up, from the floor or from a champion. This drives the four
 * places CSBWin moves ownership and then does the real thing a player does: click a
 * filled inventory slot and check the object actually reaches the hand.
 *
 * What to look for in the output: the owner column is 0 from the moment the first
 * champion joins, never -1 again while anyone lives, and the slot/hand pair swaps
 * cleanly in both directions.
 *
 * Run: `npx tsx tools/dump-hand-owner.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, Direction, OBJECT_ID_NULL, Position, decodeObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { Party, ensureHandOwner, setHandOwner } from '../src/engine/Party';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import type { AddCharacterTables } from '../src/engine/AddCharacter';
import { getChampionPossession, type Champion, type PartyState } from '../src/engine/gameTypes';
import { createUIState, type UIState } from '../src/renderer/ui/UIState';
import { CharacterStats } from '../src/engine/CharacterStats';
import { CharacterSystem } from '../src/engine/CharacterSystem';
import { CsbRandom } from '../src/core/random';
import { graphicsTablesOf, newContext } from './lib/game';
import { check, finish } from './lib/check';

/**
 * `ui/Mouse` reaches the debug chrome through `@/ui`, which touches `document` while its
 * modules load. Nothing this tool calls needs a DOM, so stub the two accessors those
 * module-scope lines use and import the click dispatcher dynamically, once the stub is
 * in place. Everything else here is a plain static import.
 */
async function importMouse(): Promise<typeof import('../src/renderer/ui/Mouse')> {
  const g = globalThis as Record<string, unknown>;
  if (!g.document) g.document = { getElementById: () => null, addEventListener: () => {} };
  if (!g.window) g.window = g;
  return import('../src/renderer/ui/Mouse');
}

function owner(party: PartyState): number {
  return party.cursorOwner ?? -1;
}

function row(what: string, party: PartyState): void {
  const hand = party.objectInHand === OBJECT_ID_NULL ? '-' : String(party.objectInHand);
  console.log([what, party.champions.length, owner(party), hand].join('\t'));
}

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const uiTables = graphicsTablesOf(graphics).ui;
  const objectTables = graphicsTablesOf(graphics).objects;
  const addTables: AddCharacterTables = {
    carryLocation: uiTables.graphic232.carryLocation,
    objDescWord4: objectTables.objDescWord4,
  };

  // The real champions from the Hall of Champions, with the possessions the mirrors
  // hand them — no synthesised heroes. Not every hero starts with something: DAROOU's
  // inventory is genuinely empty, so take the first two who carry anything, and say
  // who they are so the output can be checked against the manual.
  const heroes = (data.presetHeroes ?? []).filter((h) => (h.inventory?.length ?? 0) > 0);
  if (heroes.length < 2) throw new Error('dungeon.dat carries no equipped preset heroes');
  console.log(`champions: ${heroes[0].name} and ${heroes[1].name}\n`);
  const makeChampion = (heroIndex: number, partyPosition: number): Champion =>
    createChampionFromPreset(
      heroes[heroIndex],
      partyPosition,
      assignPresetHeroPossessions(heroes[heroIndex].inventory, addTables),
    );

  console.log(['step', 'champions', 'cursorOwner', 'objectInHand'].join('\t'));

  // ---- 1. `SetHandOwner(0)` when the party gets its first champion.
  //         (doc/CSBwin-src/Character.cpp:706-710)
  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  row('empty party', party.state);
  check(owner(party.state) === -1, 'an empty party should own no cursor');

  party.addChampion(makeChampion(0, 0));
  if (party.state.champions.length === 1) setHandOwner(party.state, 0);
  row('first champion', party.state);
  check(owner(party.state) === 0, 'the first champion should own the cursor');

  party.addChampion(makeChampion(1, 1));
  row('second champion', party.state);
  check(owner(party.state) === 0, 'a second champion should not take the cursor');

  // ---- 2. The guards: a dead champion cannot own it, -1 clears it.
  //         (doc/CSBwin-src/CSBCode.cpp:8395-8397 and :8409-8413)
  const second = party.state.champions[1];
  second.attributes.health = 0;
  setHandOwner(party.state, 1);
  row('give to a corpse', party.state);
  check(owner(party.state) === 0, 'a dead champion must not be given the cursor');

  setHandOwner(party.state, -1);
  row('setHandOwner(-1)', party.state);
  check(owner(party.state) === -1, 'setHandOwner(-1) should clear the owner');

  // ---- 3. `ensureHandOwner` repairs a state that has champions but no owner — what a
  //         quick-save written before any of this existed restores.
  ensureHandOwner(party.state);
  row('restore repair', party.state);
  check(owner(party.state) === 0, 'a restored party with champions must end up with an owner');
  check(party.state.champions[1].attributes.health === 0, 'the repair must skip the dead champion');

  const empty = new Party(new Position(1, 1, 0), Direction.NORTH);
  ensureHandOwner(empty.state);
  check(owner(empty.state) === -1, 'the repair must leave an empty party alone');

  // ---- 4. The cursor leaves a dying owner for a living champion.
  //         (doc/CSBwin-src/Character.cpp:2670-2686)
  second.attributes.health = 40;
  setHandOwner(party.state, 1);
  check(owner(party.state) === 1, 'the second champion should now own the cursor');
  const dying = party.state.champions[1];
  dying.attributes.health = 0;
  if (owner(party.state) === 1) {
    const living = party.state.champions.findIndex((c) => c.attributes.health !== 0);
    setHandOwner(party.state, living >= 0 ? party.state.champions[living].partyPosition : -1);
  }
  row('owner died', party.state);
  check(owner(party.state) === 0, 'the cursor should pass to a living champion');

  // ---- 5. The thing a player actually does: click a filled inventory slot and check
  //         the object lands in the hand, then clicking again puts it back.
  //         (`HandleClothingClick`, doc/CSBwin-src/CSBCode.cpp:6928)
  const dungeon = new DungeonState(data);
  const { handleClothingClick } = await importMouse();
  const ctx = newContext(data, graphics, { dungeon, party, random: new CsbRandom(0x12345678) });
  ctx.systems.characterStats = new CharacterStats(ctx);
  const ui: UIState = createUIState(graphics, ctx, {
    getGraphicBitmap: () => null,
    renderLastFrame: () => {},
  });
  ui.uiTables = uiTables;
  ui.objectTables = objectTables;
  // The inventory click's `RemoveCharacterPossession` / `AddCharacterPossession`, as `main.ts` wires them.
  const character = new CharacterSystem(ctx);
  ui.onRemoveCharacterPossession = (chIdx, slot) => character.removeCharacterPossession(chIdx, slot);
  ui.onAddCharacterPossession = (chIdx, object, slot) => character.addCharacterPossession(chIdx, object, slot);
  ui.partyState = party.state;
  party.state.selectedCharacterIndex = 0;

  const first = party.state.champions[0];
  let slot = -1;
  for (let s = 0; s < 30; s++) {
    if (getChampionPossession(first, s) !== OBJECT_ID_NULL) { slot = s; break; }
  }
  check(slot >= 0, 'the preset hero should be carrying something');
  if (slot >= 0) {
    const object = getChampionPossession(first, slot);
    const { category, index } = decodeObjectID(object);
    console.log(`\nchampion 0 (${first.name}) slot ${slot} holds ${object}`
      + ` = ${DBType[category] ?? category}#${index}`);
    // Canary: this is a real record out of dungeon.dat, not a bare object type. HALK's
    // weapon hand comes back as WEAPON#88, rn 37976 — the same rn
    // `tools/dump-level-items.ts` reports lying in HALK's mirror cell (7,8) on level 0,
    // which is where the mirror hands it over from. Slot 1 is the weapon hand
    // (doc/CSBwin-src/CSBCode.cpp:6947).
    check(slot === 1 && category === DBType.WEAPON,
      `slot 1 should hold a WEAPON record, got slot ${slot} ${DBType[category] ?? category}`);

    // CSBWin numbers the inventory buttons from 8: slot = button - 8.
    handleClothingClick(ui, slot + 8);
    row('clicked the slot', party.state);
    check(party.state.objectInHand === object, 'the slot object should be in the hand');
    check(getChampionPossession(first, slot) === OBJECT_ID_NULL, 'the slot should now be empty');

    handleClothingClick(ui, slot + 8);
    row('clicked it again', party.state);
    check(party.state.objectInHand === OBJECT_ID_NULL,
      'the hand should be empty again');
    check(getChampionPossession(first, slot) === object, 'the object should be back in its slot');
  }

  finish();
}

main();
