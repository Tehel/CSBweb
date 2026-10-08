/**
 * The keyboard bindings (`src/renderer/ui/Keyboard.ts`).
 *
 * A key press is invisible to `tools/check-frames.sh` — the frames are captured from a
 * fixed state, and nothing here changes a pixel until the panel it opened is drawn — so
 * this is where the table is proved. It presses the real keys against the real
 * `UIState` and checks the state each one leaves behind: which attack menu is open,
 * which champion's inventory, which rune the incantation just took.
 *
 * The three things worth watching in the output: `ordinal` is the 1-based champion whose
 * attack menu is up (0 for none), `inv` is `selectedCharacterIndex`, and `runes` is the
 * incantation being assembled. The replace-not-stack rule is the point of the middle
 * block — a second attack or inventory key must move the panel, never leave two open.
 * The last block is a row per entry of the graphics.dat key tables: the mode, the table,
 * the button, the keyscan and the browser key that reaches it.
 *
 * Run: `npx tsx tools/dump-key-bindings.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { setHandOwner } from '../src/engine/Party';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import type { AddCharacterTables } from '../src/engine/AddCharacter';
import type { Champion, PartyState } from '../src/engine/gameTypes';
import { UIMode, type UIState } from '../src/renderer/ui/UIState';
import { CHARFLAG_ATTACK_DISABLE } from '../src/engine/gameTypes';
import type { LoopScript } from '../src/engine/LoopState';
import { graphicsTablesOf, newGame, presetHeroesOf } from './lib/game';
import { newUIState } from './lib/ui';
import { check, finish } from './lib/check';
import { handleUIKey, keyScanOf, tableKeyButton, translateKey } from '../src/renderer/ui/Keyboard';
import { attackPanelTick, closeAttackMenu, handleAttackAreaClick } from '../src/renderer/ui/Attack';
import { updateButtonLists } from '../src/renderer/ui/Mouse';

function runes(party: PartyState): string {
  const caster = party.magicCasterIndex >= 0 ? party.champions[party.magicCasterIndex] : null;
  if (!caster || caster.incantation.length === 0) return '-';
  return caster.incantation.map((c) => String.fromCharCode(c)).join('');
}

function row(ui: UIState, key: string, taken: boolean): void {
  const party = ui.partyState as PartyState;
  console.log([
    key,
    taken ? 'taken' : 'passed',
    ui.attackingCharacterOrdinal,
    party.selectedCharacterIndex,
    party.magicCasterIndex,
    runes(party),
  ].join('\t'));
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

  // Real champions out of the Hall of Champions, and the spell keys need someone who
  // can actually cast: `drawSpellControls` gives no tab to a champion with no mana, and
  // `selectCaster` refuses the same champion for the same reason.
  const heroes = presetHeroesOf(data, graphics);
  const casters = heroes
    .map((hero, index) => ({ hero, index }))
    .filter(({ hero }) => hero.mana > 0)
    .sort((a, b) => b.hero.mana - a.hero.mana);
  check(casters.length >= 2, 'dungeon.dat should carry at least two heroes with mana');
  if (casters.length < 2) { finish(); return; }

  const makeChampion = (heroIndex: number, partyPosition: number): Champion =>
    createChampionFromPreset(
      heroes[heroIndex],
      partyPosition,
      assignPresetHeroPossessions(heroes[heroIndex].inventory, addTables),
    );

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  const ctx = game.ctx;
  const party = ctx.party;
  party.addChampion(makeChampion(casters[0].index, 0));
  party.addChampion(makeChampion(casters[1].index, 1));
  setHandOwner(party.state, 0, ctx.host);

  const ui: UIState = newUIState(graphics, ctx);
  ui.partyState = party.state;

  let attacks: Array<{ chIdx: number; attackType: number }> = [];
  game.systems.character.executeAttack = (chIdx: number, attackType: number) => {
    attacks.push({ chIdx, attackType });
    return 1;
  };
  // `d.clockTick` as the handlers leave it (`LoopState.setClockTick`).
  const clockTick = (): string => (ctx.loop.clockTick ? 'due' : 'not due');
  let casts: Array<{ chIdx: number; incantation: number[] }> = [];
  // Stands in for `CastMagic`, which clears the runes of a cast it does not refuse;
  // `tools/dump-magic-panel.ts` drives the real one.
  game.systems.magic.castSpellFromUi = (chIdx: number) => {
    const champion = party.state.champions[chIdx]!;
    casts.push({ chIdx, incantation: [...champion.incantation] });
    champion.incantation = [];
    return 0;
  };

  let held = false;
  // A rune key's `_MagicSelection` holds the loop for its flashes (`magicSelectionScript`):
  // the VBLs go by, as a player's next key would wait for them, before the row is read.
  // Not the script `hold` below, which only `held` lets go.
  const press = (key: string): boolean => {
    const taken = handleUIKey(ui, key);
    while (game.isRunningScript() && !held) game.runFrame();
    row(ui, key, taken);
    return taken;
  };

  console.log(`champions: ${party.state.champions[0].name} and ${party.state.champions[1].name}`);
  console.log(['key', 'claimed', 'ordinal', 'inv', 'caster', 'runes'].join('\t'));

  // ---- 1. The attack keys are a column per champion. A key of a champion whose menu is
  //         not open opens it, replacing any other — never stacking.
  attacks = [];
  press('q');
  check(ui.attackingCharacterOrdinal === 1, "'q' should open champion 1's attack menu");
  check(ui.word20252 === 0, "'q' should put the panel into its option-list state");
  check(ui.word20248 >= 1, 'an empty hand should still offer at least one attack');
  const offered = ui.word20248;

  press('x');
  check(ui.attackingCharacterOrdinal === 2, "'x' should replace the open menu with champion 2's, not stack on it");
  check(attacks.length === 0, "'x' should open champion 2's menu, not attack for champion 1");

  press('w');
  check(attacks.length === 1 && attacks[0].chIdx === 1,
    "'w' with champion 2's menu open should perform their first attack");
  check(ui.attackingCharacterOrdinal === 0, 'performing an attack should close the menu');
  check(clockTick() === 'due',
    "and set d.clockTick to what it returned, as the click does (Character.cpp:4733-4734)");
  check(ui.word20250 === 1, 'closing the menu should leave the panel owing a redraw');

  // ---- 2. Any of the column's three keys opens the menu; with it open, each is its row,
  //         and only a row that `word20248` says is real (`handleAttackAreaClick`).
  attacks = [];
  press('z');
  check(ui.attackingCharacterOrdinal === 1 && attacks.length === 0,
    "'z' with no menu open should open champion 1's, and attack nothing");
  press('z');
  if (offered < 3) {
    check(attacks.length === 0, `only ${offered} attack(s) offered, so 'z' must do nothing`);
    check(ui.attackingCharacterOrdinal === 1, 'a dead option must leave the menu open');
    press('q');
  } else {
    check(attacks.length === 1, "'z' should perform the third attack when one is offered");
  }
  check(ui.attackingCharacterOrdinal === 0, 'the panel should be closed again');

  press('a');
  press('a');
  if (offered < 2) {
    check(ui.attackingCharacterOrdinal === 1, `only ${offered} attack offered, so 'a' must do nothing`);
    closeAttackMenu(ui);
  } else {
    check(attacks.length >= 1 && attacks[attacks.length - 1].chIdx === 0 && ui.attackingCharacterOrdinal === 0,
      "'a' should perform champion 1's second attack");
  }

  // ---- 3. The inventory keys, the same toggle `handleInventoryToggle` gives a click.
  press('7');
  check(party.state.selectedCharacterIndex === 0, "'7' should open champion 1's inventory");
  press('8');
  check(party.state.selectedCharacterIndex === 1, "'8' should replace it with champion 2's");
  press('8');
  check(party.state.selectedCharacterIndex === -1, "'8' again should close it");
  press('9');
  check(party.state.selectedCharacterIndex === -1,
    "'9' should do nothing — there is no third champion");
  press('e');
  check(ui.attackingCharacterOrdinal === 0, "'e' should do nothing — there is no third champion");

  // ---- 4. The magic keys. No caster, no keypad (button id 100's guard in `Mouse.ts`).
  check(party.state.magicCasterIndex === -1, 'no caster should be selected yet');
  press('1');
  check(runes(party.state) === '-', 'a rune key with no caster selected should do nothing');

  // F1-F4 select the caster, not the inventories `Byte18400` binds them to (`DEBT.md` H).
  press('F1');
  check(party.state.magicCasterIndex === 0, 'F1 should select the first champion as caster');
  press('F2');
  check(party.state.magicCasterIndex === 1, 'F2 should move the caster to the second champion');
  check(party.state.selectedCharacterIndex === -1, 'and open no inventory');
  press('F1');
  check(party.state.magicCasterIndex === 0, 'F1 should bring it back');

  const caster = party.state.champions[0];
  const manaBefore = caster.attributes.mana;
  press('1');
  check(caster.incantation.length === 1 && caster.incantation[0] === 96,
    "'1' should push the first rune of the first step");
  check(caster.attributes.mana < manaBefore, 'a rune should cost mana');

  press('3');
  check(caster.incantation.length === 2 && caster.incantation[1] === 96 + 6 + 2,
    "'3' should push the third rune of the second step");

  press('`');
  check(caster.incantation.length === 1, 'the backspace key should take the last rune back');

  casts = [];
  press('Tab');
  check(casts.length === 1, 'Tab should cast the incantation');
  check(casts[0]?.chIdx === 0 && casts[0]?.incantation.length === 1,
    'the cast should carry the caster and the runes assembled');

  casts = [];
  press('Tab');
  check(casts.length === 0, 'Tab with an empty incantation should cast nothing');

  // ---- 5. Case, and the keys the table does **not** claim: `GameInput.keyDown` routes those
  //         to movement, so a bound key leaking through would walk the party instead.
  check(press('Q'), "'Q' should be claimed the same as 'q'");
  check(ui.attackingCharacterOrdinal === 1, 'a capital should reach the same binding');
  closeAttackMenu(ui);

  for (const key of ['k', 'j', 'l', 'm', ',', '.', 'F5', 'F9']) {
    check(!handleUIKey(ui, key), `'${key}' must be left for the movement and debug keys`);
  }
  for (const key of TABLE_KEYS.filter((key) => !CASTER_KEYS.includes(key))) {
    check(!handleUIKey(ui, key), `'${key}' must be left for the key tables`);
  }

  // ---- 6. `d.PotentialCharacterOrdinal` makes every panel inert
  //         (`doc/CSBwin-src/Mouse.cpp:1717-1789`), keys included.
  party.state.potentialChampionIndex = 0;
  press('q');
  check(ui.attackingCharacterOrdinal === 0, 'no attack menu while a champion is only provisional');
  press('7');
  check(party.state.selectedCharacterIndex === -1, 'no inventory either');
  press('1');
  check(runes(party.state) === '-', 'and no runes');
  party.state.potentialChampionIndex = -1;

  // ---- 7. A busy champion opens no menu, by key or by a click on their hand:
  //         `PrepareAttack` returns on `CHARFLAG_attackDisable`
  //         (`doc/CSBwin-src/Character.cpp:4941`). The stub attack busies the attacker, as
  //         the real one's `DisableCharacterAction` does.
  game.systems.character.executeAttack = (chIdx: number, attackType: number) => {
    attacks.push({ chIdx, attackType });
    party.state.champions[chIdx].charFlags |= CHARFLAG_ATTACK_DISABLE;
    return 1;
  };
  const hand = ui.uiTables.graphic231.buttons.buttons17952.find((b) => b.word0 === 116);
  check(hand !== undefined, 'buttons17952 should hold champion 1\'s hand, button 116');
  const clickHand = (): void => {
    if (!hand) return;
    handleAttackAreaClick(ui, (hand.x1 + hand.x2) >> 1, (hand.y1 + hand.y2) >> 1);
    row(ui, 'hand', true);
  };
  attacks = [];
  press('q');
  press('q');
  attackPanelTick(ui); // the tick brings the hands back: word20252 = 1
  check(attacks.length === 1 && (party.state.champions[0].charFlags & CHARFLAG_ATTACK_DISABLE) !== 0,
    'the attack should leave champion 1 busy');
  press('q');
  check(ui.attackingCharacterOrdinal === 0, "'q' should open no menu for a busy champion");
  clickHand();
  check(ui.attackingCharacterOrdinal === 0, 'a click on a busy champion\'s hand should open no menu');
  party.state.champions[0].charFlags &= ~CHARFLAG_ATTACK_DISABLE;
  clickHand();
  check(ui.attackingCharacterOrdinal === 1, 'the same click opens the menu once the champion is idle');
  closeAttackMenu(ui);

  // ---- 8. An attack that starts a script (the fusion's `_FusionSequence`) never returns
  //         to its caller (`doc/CSBwin-src/Character.cpp:4997`): `TAG01b1c0` leaves the
  //         menu up, and `d.clockTick = intResult` (`:4734`) is not set. While the script
  //         holds the loop every panel key is claimed and dead: CSBWin's UI only queues.
  // The attack holds the loop in a script of its own, as `_FusionSequence` does, until
  // `held` lets it go and a VBL ends it.
  function* hold(): LoopScript {
    while (held) yield 1;
  }
  ctx.loop.clockTick = false;
  game.systems.character.executeAttack = (chIdx: number, attackType: number) => {
    attacks.push({ chIdx, attackType });
    held = true;
    game.runScript(hold());
    return 1;
  };
  const option = ui.uiTables.graphic231.buttons.buttons17892.find((b) => b.word0 === 113);
  check(option !== undefined, 'buttons17892 should hold the first attack option, button 113');
  attacks = [];
  press('q');
  if (option) handleAttackAreaClick(ui, (option.x1 + option.x2) >> 1, (option.y1 + option.y2) >> 1);
  row(ui, 'option', true);
  check(attacks.length === 1 && game.isRunningScript(), 'the click attacks, and the attack holds the loop');
  check(ui.attackingCharacterOrdinal === 1, 'the attack menu stays up: TAG01b1c0 does not run');
  check(clockTick() === 'not due', 'd.clockTick is not set');
  const heldKeys = ['q', 'w', 'a', 'x', '7', 'F2', '1', 'Tab'].map((key) => press(key));
  check(heldKeys.every((taken) => taken), 'every panel key is still claimed');
  check(attacks.length === 1 && ui.attackingCharacterOrdinal === 1 && party.state.selectedCharacterIndex === -1
    && party.state.magicCasterIndex === 0 && runes(party.state) === '-',
  'and none acts: no attack, the same menu, no inventory, the same caster, no rune');
  check(!press('k'), 'a key that is not the panel\'s is still passed on');
  held = false;
  game.runFrame();
  check(!game.isRunningScript(), 'a VBL ends the script, and the loop is free');
  game.systems.character.executeAttack = (chIdx: number, attackType: number) => {
    attacks.push({ chIdx, attackType });
    return 1;
  };
  if (option) handleAttackAreaClick(ui, (option.x1 + option.x2) >> 1, (option.y1 + option.y2) >> 1);
  row(ui, 'option', true);
  check(ui.attackingCharacterOrdinal === 0 && clockTick() === 'due',
    'with no script, the same click closes the menu and makes a tick due');

  // ---- 9. The graphics.dat key tables `TAG0196da` searches (doc/CSBwin-src/CSBCode.cpp:
  //         8428-8475), a row per entry, in each mode's pair (`updateButtonLists`). Every
  //         entry has a browser key, and none is bound twice in a pair, so the first match
  //         `translateKey` returns is what CSBWin queues.
  const keyOf = (keyscan: number): string | undefined =>
    TABLE_KEYS.find((key) => keyScanOf(key) === keyscan)
    ?? CTRL_LETTERS.map((letter) => `Ctrl-${letter}`).find((name) => keyScanOf(name.slice(5), true) === keyscan);
  const pressed = (name: string): number => name.startsWith('Ctrl-')
    ? translateKey(ui, keyScanOf(name.slice(5), true))
    : translateKey(ui, keyScanOf(name));
  const expected: Record<string, Record<string, number>> = {
    // Awake, the author's roles for the arrows are CSBWin's: left and right strafe.
    Adventure: {
      F1: 7, F2: 8, F3: 9, F4: 10, 'Ctrl-S': 140, Escape: 147,
      Insert: 1, Home: 2, ArrowUp: 3, ArrowRight: 4, ArrowDown: 5, ArrowLeft: 6,
    },
    Sleeping: { Enter: 146, Escape: 147 },
    Frozen: { Escape: 148 },
  };
  console.log(['mode', 'table', 'button', 'keyscan', 'key'].join('\t'));
  for (const mode of ['Adventure', 'Sleeping', 'Frozen'] as const) {
    ui.uiMode = UIMode[mode];
    updateButtonLists(ui);
    const pair = [['pKeyXlate2', ui.keyXlate2 ?? []], ['pKeyXlate1', ui.keyXlate1 ?? []]] as const;
    const scans = pair.flatMap(([, table]) => table.map((entry) => entry.keyscan));
    check(new Set(scans).size === scans.length, `${mode}: no keyscan is bound twice`);
    const bound: Record<string, number> = {};
    for (const [name, table] of pair) {
      for (const entry of table) {
        const key = keyOf(entry.keyscan);
        console.log([mode, name, entry.mouse, `0x${entry.keyscan.toString(16)}`, key ?? '-'].join('\t'));
        check(key !== undefined, `${mode}: keyscan 0x${entry.keyscan.toString(16)} should have a browser key`);
        if (key === undefined) continue;
        bound[key] = entry.mouse;
        check(pressed(key) === entry.mouse, `${mode}: ${key} should queue button ${entry.mouse}`);
      }
    }
    check(JSON.stringify(Object.entries(bound).sort()) === JSON.stringify(Object.entries(expected[mode]).sort()),
      `${mode}: the tables should bind ${JSON.stringify(expected[mode])}`);
  }
  ui.uiMode = UIMode.Adventure;
  updateButtonLists(ui);
  check(pressed('Ctrl-R') === 0 && pressed('F5') === 0 && pressed('k') === 0,
    'a key no table binds is left to the browser and the port');
  for (const key of CASTER_KEYS) {
    check(pressed(key) !== 0 && tableKeyButton(ui, key) === 0,
      `${key} is bound in Byte18400, and left to the caster binding (DEBT.md H)`);
  }
  check(tableKeyButton(ui, 'ArrowLeft') === 6 && tableKeyButton(ui, 's', true) === 140,
    'every other table key goes through the tables');

  finish();
}

/** Every key `keyScanOf` gives a keyscan without Ctrl. */
const TABLE_KEYS = ['Enter', 'Escape', 'F1', 'F2', 'F3', 'F4', 'Home', 'ArrowUp', 'ArrowLeft', 'ArrowRight',
  'ArrowDown', 'Insert'];
/** The table keys the port keeps for the caster (`DEBT.md` H). */
const CASTER_KEYS = ['F1', 'F2', 'F3', 'F4'];
/** And the letters it gives one with Ctrl. */
const CTRL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

main();
