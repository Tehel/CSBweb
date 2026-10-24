/**
 * Which champion a UI click actually acts on, once the party has turned.
 *
 * A champion has two indices and they are not the same number:
 *
 * - the **box index** — its slot in the top bar and in `d.CH16482[]`, which never moves;
 * - `CHARDESC.charPosition` (`champion.partyPosition`) — the *corner of the cell* it
 *   stands in, which `setPartyFacing` rotates every time the party turns
 *   (`doc/CSBwin-src/Code11f52.cpp:4123`).
 *
 * Every click that names a champion names a box: `HandleClothingClick` resolves it as
 * `d.CH16482[D7W]` (`doc/CSBwin-src/CSBCode.cpp:7015`), and `_HandleMagicClick` hands a
 * box index to `SelectMagicCaster` (`doc/CSBwin-src/Magic.cpp:692-699`). Nothing on
 * screen shows the difference — the inventory of the champion you clicked *looks*
 * right, because it is drawn from the box index — so only a tool can see a click
 * routed to the wrong champion, and only after a turn, since the two indices agree
 * while the party still faces the direction it was built in.
 *
 * What to look for in the output: the `acted on` column must always be the box that
 * was clicked, both before and after the turn, and the other champions' slots must be
 * untouched.
 *
 * Run: `npm test -- --only=inventory-routing.ts`
 */
import { Direction, OBJECT_ID_NULL, Position } from '../../src/core/types';
import { initialPartyState, setHandOwner, setPartyFacing } from '../../src/engine/Party';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../../src/engine/AddCharacter';
import { getChampionPossession } from '../../src/core/charDesc';
import type { Champion, PartyState } from '../../src/engine/gameTypes';
import { type UIState } from '../../src/renderer/ui/UIState';
import { handleMagicClick } from '../../src/renderer/ui/MagicPanel';
import { gameTablesOf, newGame, presetHeroesOf, stockDungeon, stockGraphics } from '../lib/game';
import { newUIState } from '../lib/ui';
import { check, finish } from '../lib/check';
import { handleClothingClick } from '../../src/renderer/ui/Mouse';

/** The box index of whichever champion's slot changed, or -1 / -2 for none / several. */
function whoChanged(party: PartyState, before: Array<Array<number | null>>): number {
  let found = -1;
  for (let chIdx = 0; chIdx < party.champions.length; chIdx++) {
    let changed = false;
    for (let slot = 0; slot < 30; slot++) {
      if (getChampionPossession(party.champions[chIdx], slot) !== before[chIdx][slot]) changed = true;
    }
    if (!changed) continue;
    if (found !== -1) return -2;
    found = chIdx;
  }
  return found;
}

function snapshot(party: PartyState): Array<Array<number | null>> {
  return party.champions.map((champ) => {
    const slots: Array<number | null> = [];
    for (let slot = 0; slot < 30; slot++) slots.push(getChampionPossession(champ, slot));
    return slots;
  });
}

function row(what: string, clicked: number, acted: number): void {
  console.log([what, clicked, acted === -1 ? 'nobody' : acted === -2 ? 'SEVERAL' : acted].join('\t'));
}

async function main(): Promise<void> {
  const data = stockDungeon();

  const graphics = stockGraphics();
  const addTables = gameTablesOf(graphics);

  // Four real preset heroes, each carrying something, one per box.
  const heroes = presetHeroesOf(data, graphics).filter((h) => (h.inventory?.length ?? 0) > 0);
  if (heroes.length < 4) throw new Error('dungeon.dat carries fewer than four equipped preset heroes');
  // The game's own party, so that the inventory click reaches its systems.
  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  const party = game.ctx.party;
  party.setState(initialPartyState(new Position(1, 1, 0), Direction.NORTH));
  for (let box = 0; box < 4; box++) {
    const champ: Champion = createChampionFromPreset(
      heroes[box],
      box,
      assignPresetHeroPossessions(heroes[box].inventory, addTables),
    );
    // The magic tabs only exist for champions with mana; three of the four mirrors
    // hand out none, so give everyone some rather than synthesise a party.
    champ.attributes.mana = 20;
    champ.attributes.maxMana = 20;
    party.addChampion(champ);
  }
  setHandOwner(game.ctx, 0);
  console.log('champions: ' + party.state.champions.map((c, i) => `${i}=${c.name}`).join(' ') + '\n');

  const ui: UIState = newUIState(graphics, game.ctx);

  // Not every mirror hands its hero a weapon, so pick, per box, a slot that really
  // holds something. Nothing is moved or synthesised — these are the possessions the
  // Hall of Champions gives out.
  const testSlot: number[] = [];
  for (let box = 0; box < 4; box++) {
    let slot = -1;
    for (let s = 0; s < 30; s++) {
      if (getChampionPossession(party.state.champions[box], s) !== OBJECT_ID_NULL) { slot = s; break; }
    }
    if (slot < 0) throw new Error(`champion ${box} (${party.state.champions[box].name}) carries nothing`);
    testSlot.push(slot);
    console.log(`box ${box} (${party.state.champions[box].name}): testing slot ${slot}`
      + ` = ${getChampionPossession(party.state.champions[box], slot)}`);
  }
  console.log('');

  console.log(['step', 'clicked box', 'acted on'].join('\t'));

  /**
   * Click inventory slot `slot` of the champion whose *box* is `box`, and report
   * which champion the click actually touched. CSBWin numbers the inventory buttons
   * from 8 (`slot = button - 8`, doc/CSBwin-src/CSBCode.cpp:7003).
   */
  function clickInventorySlot(what: string, box: number, slot: number): number {
    party.state.selectedCharacterIndex = box;
    const before = snapshot(party.state);
    handleClothingClick(ui, slot + 8);
    const acted = whoChanged(party.state, before);
    row(what, box, acted);
    return acted;
  }

  /** Click hand `hand` in the top-bar portrait box `box` (button = 2*box + hand). */
  function clickTopBarHand(what: string, box: number, hand: number, selected: number): number {
    party.state.selectedCharacterIndex = selected;
    const before = snapshot(party.state);
    handleClothingClick(ui, 2 * box + hand);
    const acted = whoChanged(party.state, before);
    row(what, box, acted);
    return acted;
  }

  // ---- 1. Facing NORTH, as the party was built: box index and charPosition agree,
  //         so this passes either way. It is the control.
  for (let box = 0; box < 4; box++) {
    check(party.state.champions[box].partyPosition === box, `champion ${box} starts in corner ${box}`);
  }
  for (let box = 0; box < 4; box++) {
    const slot = testSlot[box];
    const acted = clickInventorySlot(`north: slot ${slot} of box ${box}`, box, slot);
    check(acted === box, `facing north, clicking box ${box}'s slot ${slot} must act on champion ${box}`);
    handleClothingClick(ui, slot + 8); // put it back
  }

  // ---- 2. Turn the party. `setPartyFacing` rotates every charPosition, so champion
  //         `i` now stands in corner `(i+1)&3` and the two indices disagree.
  setPartyFacing(party.state, Direction.EAST);
  console.log('\nturned east: ' + party.state.champions
    .map((c, i) => `box ${i} -> corner ${c.partyPosition}`).join(', ') + '\n');
  for (let box = 0; box < 4; box++) {
    check(party.state.champions[box].partyPosition === ((box + 1) & 3),
      `after one turn, champion ${box} should stand in corner ${(box + 1) & 3}`);
  }

  // ---- 3. The same clicks again. Resolving the box index through `partyPosition`
  //         picks the champion who drifted into that corner instead — champion 3 for
  //         box 0 — which is the "it took it from the wrong hero" bug.
  for (let box = 0; box < 4; box++) {
    const slot = testSlot[box];
    const acted = clickInventorySlot(`east: slot ${slot} of box ${box}`, box, slot);
    check(acted === box, `after the turn, clicking box ${box}'s slot ${slot} must still act on champion ${box}`);
    handleClothingClick(ui, slot + 8);
  }

  // ---- 4. A backpack slot, and the top-bar hands, which take the other branch of
  //         `HandleClothingClick` (`button < 8`, doc/CSBwin-src/CSBCode.cpp:6992-7001).
  // Putting an object *into* an empty slot is the other direction, and the one a
  // player notices most — it is the click that makes an item vanish into the wrong
  // backpack. `HandleClothingClick`'s slots run 0-12 for the hands and the paper doll
  // and 13-29 for the backpack (`doc/CSBwin-src/CSBCode.cpp:6980-6984`, where they are
  // named by button number), so slot 20 is a backpack pocket — empty for every preset
  // hero, and it takes anything.
  for (let box = 0; box < 4; box++) {
    party.state.selectedCharacterIndex = box;
    handleClothingClick(ui, testSlot[box] + 8); // pick the object up
    const before = snapshot(party.state);
    handleClothingClick(ui, 20 + 8); // and drop it into the backpack
    const acted = whoChanged(party.state, before);
    row(`east: put into backpack of box ${box}`, box, acted);
    check(acted === box, `after the turn, a drop into box ${box}'s backpack must reach champion ${box}`);
    check(getChampionPossession(party.state.champions[box], 20) !== OBJECT_ID_NULL,
      `champion ${box} should now hold the object in slot 20`);
    handleClothingClick(ui, 20 + 8);
    handleClothingClick(ui, testSlot[box] + 8);
  }
  for (let box = 0; box < 4; box++) {
    const hand = getChampionPossession(party.state.champions[box], 1) !== OBJECT_ID_NULL ? 1
      : getChampionPossession(party.state.champions[box], 0) !== OBJECT_ID_NULL ? 0 : -1;
    if (hand < 0) continue;
    // `if (D7W+1 == d.SelectedCharacterOrdinal) return;` — the open champion's own
    // hands are inert in the top bar, so keep someone else's inventory open.
    const selected = box === 0 ? 1 : 0;
    const acted = clickTopBarHand(`east: top-bar hand ${hand} of box ${box}`, box, hand, selected);
    check(acted === box, `after the turn, the top-bar hand of box ${box} must act on champion ${box}`);
    handleClothingClick(ui, 2 * box + hand);
  }

  // ---- 5. The magic tabs, the same defect one module over: `drawSpellControls` lays
  //         them out by box index, so the hit test must read the same index.
  party.state.selectedCharacterIndex = -1;
  party.state.objectInHand = OBJECT_ID_NULL;
  // The middle of box `box`'s tab with `caster` casting (`DrawSpellControls`,
  // `doc/CSBwin-src/Character.cpp:5027-5110`): 12 pixels wide, 14 apart, and the
  // caster's own 45 wide.
  const tabX = (box: number, caster: number): number =>
    box < caster ? 233 + 14 * box + 5 : box > caster ? 266 + 14 * box + 5 : 233 + 14 * box + 22;
  const tabY = 45;
  for (let box = 0; box < 4; box++) {
    party.state.magicCasterIndex = 0;
    handleMagicClick(ui, tabX(box, party.state.magicCasterIndex), tabY);
    row(`east: magic tab of box ${box}`, box, party.state.magicCasterIndex);
    check(party.state.magicCasterIndex === box,
      `after the turn, the magic tab of box ${box} must select champion ${box}`);
  }

  // With every champion able to cast, reading `partyPosition` here happens to land on
  // the right *number* — a uniform rotation cancels out. It stops cancelling as soon as
  // one champion is skipped: strip the mana of champion 3, who after the turn stands in
  // corner 0, and box 0's tab has no champion at `partyPosition == 0` left to match.
  party.state.champions[3].attributes.mana = 0;
  party.state.champions[3].attributes.maxMana = 0;
  party.state.magicCasterIndex = 1;
  handleMagicClick(ui, tabX(0, party.state.magicCasterIndex), tabY);
  row('east: magic tab of box 0, champion 3 manaless', 0, party.state.magicCasterIndex);
  check(party.state.magicCasterIndex === 0,
    "box 0's magic tab must select champion 0 even when the champion in corner 0 cannot cast");

  finish();
}

main();
