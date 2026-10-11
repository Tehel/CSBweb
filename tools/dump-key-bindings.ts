/**
 * The keyboard bindings (`src/renderer/ui/Keyboard.ts`).
 *
 * A key press is invisible to `tools/check-frames.sh` — the frames are captured from a
 * fixed state, and nothing here changes a pixel until the panel it opened is drawn — so
 * this is where the table is proved. It presses the real keys, as `KeyboardEvent.code`s,
 * against the real `UIState` and checks the state each one leaves behind: which attack menu is open,
 * which champion's inventory, which rune the incantation just took.
 *
 * The three things worth watching in the output: `ordinal` is the 1-based champion whose
 * attack menu is up (0 for none), `inv` is `selectedCharacterIndex`, and `runes` is the
 * incantation being assembled. The replace-not-stack rule is the point of the middle
 * block — a second attack or inventory key must move the panel, never leave two open.
 * The last block is a row per entry of the graphics.dat key tables: the mode, the table,
 * the button, the keyscan and the code that reaches it.
 *
 * Run: `npx tsx tools/dump-key-bindings.ts`
 */
import { setHandOwner } from '../src/engine/Party';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import type { Champion, PartyState } from '../src/engine/gameTypes';
import { UIMode, type UIState } from '../src/renderer/ui/UIState';
import { CHARFLAG_ATTACK_DISABLE } from '../src/engine/gameTypes';
import type { LoopScript } from '../src/engine/LoopState';
import { gameTablesOf, newGame, presetHeroesOf, stockDungeon, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { standIn } from './lib/standIn';
import { check, finish } from './lib/check';
import {
  actionsByCode, DEFAULT_KEY_BINDINGS, handleUIKey, keyScanOf, portKeyAction, tableKeyButton, translateKey,
} from '../src/renderer/ui/Keyboard';
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
  const data = stockDungeon();

  const graphics = stockGraphics();
  const addTables = gameTablesOf(graphics);

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
  standIn(game.systems.character, 'executeAttack', (chIdx: number, attackType: number) => {
    attacks.push({ chIdx, attackType });
    return 1;
  });
  // `d.clockTick` as the handlers leave it (`LoopState.setClockTick`).
  const clockTick = (): string => (ctx.loop.clockTick ? 'due' : 'not due');
  let casts: Array<{ chIdx: number; incantation: number[] }> = [];
  // Stands in for `CastMagic`, which clears the runes of a cast it does not refuse;
  // `tools/dump-magic-panel.ts` drives the real one.
  standIn(game.systems.magic, 'castSpellFromUi', (chIdx: number) => {
    const champion = party.state.champions[chIdx]!;
    casts.push({ chIdx, incantation: [...champion.incantation] });
    champion.incantation = [];
    return 0;
  });

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
  console.log(['code', 'claimed', 'ordinal', 'inv', 'caster', 'runes'].join('\t'));

  // ---- 1. The attack keys are a column per champion. A key of a champion whose menu is
  //         not open opens it, replacing any other — never stacking.
  attacks = [];
  press('KeyQ');
  check(ui.attackingCharacterOrdinal === 1, "'q' should open champion 1's attack menu");
  check(ui.word20252 === 0, "'q' should put the panel into its option-list state");
  check(ui.word20248 >= 1, 'an empty hand should still offer at least one attack');
  const offered = ui.word20248;

  press('KeyX');
  check(ui.attackingCharacterOrdinal === 2, "'x' should replace the open menu with champion 2's, not stack on it");
  check(attacks.length === 0, "'x' should open champion 2's menu, not attack for champion 1");

  press('KeyW');
  check(attacks.length === 1 && attacks[0].chIdx === 1,
    "'w' with champion 2's menu open should perform their first attack");
  check(ui.attackingCharacterOrdinal === 0, 'performing an attack should close the menu');
  check(clockTick() === 'due',
    "and set d.clockTick to what it returned, as the click does (Character.cpp:4733-4734)");
  check(ui.word20250 === 1, 'closing the menu should leave the panel owing a redraw');

  // ---- 2. Any of the column's three keys opens the menu; with it open, each is its row,
  //         and only a row that `word20248` says is real (`handleAttackAreaClick`).
  attacks = [];
  press('KeyZ');
  check(ui.attackingCharacterOrdinal === 1 && attacks.length === 0,
    "'z' with no menu open should open champion 1's, and attack nothing");
  press('KeyZ');
  if (offered < 3) {
    check(attacks.length === 0, `only ${offered} attack(s) offered, so 'z' must do nothing`);
    check(ui.attackingCharacterOrdinal === 1, 'a dead option must leave the menu open');
    press('KeyQ');
  } else {
    check(attacks.length === 1, "'z' should perform the third attack when one is offered");
  }
  check(ui.attackingCharacterOrdinal === 0, 'the panel should be closed again');

  press('KeyA');
  press('KeyA');
  if (offered < 2) {
    check(ui.attackingCharacterOrdinal === 1, `only ${offered} attack offered, so 'a' must do nothing`);
    closeAttackMenu(ui);
  } else {
    check(attacks.length >= 1 && attacks[attacks.length - 1].chIdx === 0 && ui.attackingCharacterOrdinal === 0,
      "'a' should perform champion 1's second attack");
  }

  // ---- 2b. Tab is PASS (button 112): it closes the open menu and attacks nothing. With
  //          no menu open its point is above the hands, and it does nothing.
  attacks = [];
  press('KeyW');
  check(ui.attackingCharacterOrdinal === 2, "'w' should open champion 2's menu");
  check(press('Tab'), 'Tab should be claimed');
  check(ui.attackingCharacterOrdinal === 0 && attacks.length === 0,
    'Tab should close the menu without attacking');
  check(press('Tab') && ui.attackingCharacterOrdinal === 0 && attacks.length === 0,
    'Tab with no menu open should be claimed and do nothing');

  // ---- 3. The inventory keys, the same toggle `handleInventoryToggle` gives a click.
  press('Digit7');
  check(party.state.selectedCharacterIndex === 0, "'7' should open champion 1's inventory");
  press('Digit8');
  check(party.state.selectedCharacterIndex === 1, "'8' should replace it with champion 2's");
  press('Digit8');
  check(party.state.selectedCharacterIndex === -1, "'8' again should close it");
  press('Digit9');
  check(party.state.selectedCharacterIndex === -1,
    "'9' should do nothing — there is no third champion");
  press('KeyE');
  check(ui.attackingCharacterOrdinal === 0, "'e' should do nothing — there is no third champion");

  // ---- 4. The magic keys. No caster, no keypad (button id 100's guard in `Mouse.ts`).
  check(party.state.magicCasterIndex === -1, 'no caster should be selected yet');
  press('Digit1');
  check(runes(party.state) === '-', 'a rune key with no caster selected should do nothing');

  // F1-F4 select the caster, as config.txt's clicks do, not the inventories `Byte18400`
  // binds them to.
  press('F1');
  check(party.state.magicCasterIndex === 0, 'F1 should select the first champion as caster');
  press('F2');
  check(party.state.magicCasterIndex === 1, 'F2 should move the caster to the second champion');
  check(party.state.selectedCharacterIndex === -1, 'and open no inventory');
  press('F1');
  check(party.state.magicCasterIndex === 0, 'F1 should bring it back');

  const caster = party.state.champions[0];
  const manaBefore = caster.attributes.mana;
  press('Digit1');
  check(caster.incantation.length === 1 && caster.incantation[0] === 96,
    "'1' should push the first rune of the first step");
  check(caster.attributes.mana < manaBefore, 'a rune should cost mana');

  press('Digit3');
  check(caster.incantation.length === 2 && caster.incantation[1] === 96 + 6 + 2,
    "'3' should push the third rune of the second step");

  press('Backquote');
  check(caster.incantation.length === 1,
    "Backquote, '~' on a US keyboard and '²' on AZERTY, should take the last rune back");

  casts = [];
  press('Tab');
  check(casts.length === 0 && caster.incantation.length === 1, 'Tab should not cast');
  press('Space');
  check(casts.length === 1, 'Space should cast the incantation');
  check(casts[0]?.chIdx === 0 && casts[0]?.incantation.length === 1,
    'the cast should carry the caster and the runes assembled');

  casts = [];
  press('Space');
  check(casts.length === 0, 'Space with an empty incantation should cast nothing');

  // ---- 5. Codes, not characters, and the keys the table does **not** claim. A binding is
  //         a `KeyboardEvent.code`, the physical key: on AZERTY the number row types
  //         & é " ' ( - è _ ç à unshifted and `²` sits where `~` does on a US keyboard, and
  //         their codes are Digit1-Digit0 and Backquote all the same, so the runes above
  //         answered unshifted. A character is no binding, Shift's or not, and the keypad's
  //         digits are not the number row's. `GameInput.keyDown` routes the unclaimed keys
  //         to the key tables and the page: the moves and the freeze go to the tables
  //         (section 9), F5 and F9 to the page.
  for (const key of ['q', 'Q', '1', '&', '~', '`', '²', ' ', 'Numpad1', 'Numpad7']) {
    check(!handleUIKey(ui, key), `'${key}' is no panel binding`);
  }
  check(ui.attackingCharacterOrdinal === 0 && party.state.selectedCharacterIndex === -1,
    'and opened no menu or inventory');

  for (const key of [...MOVE_KEYS, 'Escape', 'F5', 'F9']) {
    check(!handleUIKey(ui, key), `'${key}' must be left for the key tables and the page`);
  }
  check(portKeyAction('F5') === 'quickSave' && portKeyAction('F9') === 'quickLoad', 'F5 and F9 are the page\'s');
  for (const key of ['KeyK', 'Numpad8', 'Escape', 'k', 'ArrowUp']) {
    check(portKeyAction(key) === null, `'${key}' asks nothing of the page`);
  }
  // The default preset binds no code twice, so the reverse map loses none.
  const codes = Object.values(DEFAULT_KEY_BINDINGS).flat().filter((code) => code !== '');
  check(actionsByCode(DEFAULT_KEY_BINDINGS).size === codes.length, 'the default preset binds no code twice');

  // ---- 6. `d.PotentialCharacterOrdinal` makes every panel inert
  //         (`doc/CSBwin-src/Mouse.cpp:1717-1789`), keys included.
  party.state.potentialChampionIndex = 0;
  press('KeyQ');
  check(ui.attackingCharacterOrdinal === 0, 'no attack menu while a champion is only provisional');
  press('Digit7');
  check(party.state.selectedCharacterIndex === -1, 'no inventory either');
  press('Digit1');
  check(runes(party.state) === '-', 'and no runes');
  party.state.potentialChampionIndex = -1;

  // ---- 7. A busy champion opens no menu, by key or by a click on their hand:
  //         `PrepareAttack` returns on `CHARFLAG_attackDisable`
  //         (`doc/CSBwin-src/Character.cpp:4941`). The stub attack busies the attacker, as
  //         the real one's `DisableCharacterAction` does.
  const restoreAttack = standIn(game.systems.character, 'executeAttack', (chIdx: number, attackType: number) => {
    attacks.push({ chIdx, attackType });
    party.state.champions[chIdx].charFlags |= CHARFLAG_ATTACK_DISABLE;
    return 1;
  });
  const hand = ui.uiTables.graphic231.buttons.buttons17952.find((b) => b.word0 === 116);
  check(hand !== undefined, 'buttons17952 should hold champion 1\'s hand, button 116');
  const clickHand = (): void => {
    if (!hand) return;
    handleAttackAreaClick(ui, (hand.x1 + hand.x2) >> 1, (hand.y1 + hand.y2) >> 1);
    row(ui, 'hand', true);
  };
  attacks = [];
  press('KeyQ');
  press('KeyQ');
  attackPanelTick(ui); // the tick brings the hands back: word20252 = 1
  check(attacks.length === 1 && (party.state.champions[0].charFlags & CHARFLAG_ATTACK_DISABLE) !== 0,
    'the attack should leave champion 1 busy');
  press('KeyQ');
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
  restoreAttack();
  const restoreRecording = standIn(game.systems.character, 'executeAttack', (chIdx: number, attackType: number) => {
    attacks.push({ chIdx, attackType });
    held = true;
    game.runScript(hold());
    return 1;
  });
  const option = ui.uiTables.graphic231.buttons.buttons17892.find((b) => b.word0 === 113);
  check(option !== undefined, 'buttons17892 should hold the first attack option, button 113');
  attacks = [];
  press('KeyQ');
  if (option) handleAttackAreaClick(ui, (option.x1 + option.x2) >> 1, (option.y1 + option.y2) >> 1);
  row(ui, 'option', true);
  check(attacks.length === 1 && game.isRunningScript(), 'the click attacks, and the attack holds the loop');
  check(ui.attackingCharacterOrdinal === 1, 'the attack menu stays up: TAG01b1c0 does not run');
  check(clockTick() === 'not due', 'd.clockTick is not set');
  const heldKeys = ['KeyQ', 'KeyW', 'KeyA', 'KeyX', 'Digit7', 'F2', 'Digit1', 'Backquote', 'Space', 'Tab']
    .map((key) => press(key));
  check(heldKeys.every((taken) => taken), 'every panel key is still claimed');
  check(attacks.length === 1 && ui.attackingCharacterOrdinal === 1 && party.state.selectedCharacterIndex === -1
    && party.state.magicCasterIndex === 0 && runes(party.state) === '-',
  'and none acts: no attack, the same menu, no inventory, the same caster, no rune');
  check(!press('KeyK'), 'a key that is not the panel\'s is still passed on');
  held = false;
  game.runFrame();
  check(!game.isRunningScript(), 'a VBL ends the script, and the loop is free');
  restoreRecording();
  if (option) handleAttackAreaClick(ui, (option.x1 + option.x2) >> 1, (option.y1 + option.y2) >> 1);
  row(ui, 'option', true);
  check(ui.attackingCharacterOrdinal === 0 && clockTick() === 'due',
    'with no script, the same click closes the menu and makes a tick due');

  // ---- 9. The graphics.dat key tables `TAG0196da` searches (doc/CSBwin-src/CSBCode.cpp:
  //         8428-8475), a row per entry, in each mode's pair (`updateButtonLists`), with
  //         the default preset's codes that send its keyscan. No keyscan is bound twice in
  //         a pair, so the first match `translateKey` returns is what CSBWin queues. No
  //         default code sends Ctrl-S, which CSBWin's shipped config.txt never sends
  //         (`keyScanOf`), nor Return, F1-F4's inventories, the arrows, Insert or Clr/Home,
  //         which it sends only as the keypad's scancodes.
  const codesOf = (keyscan: number): string[] => codes.filter((code) => keyScanOf(code) === keyscan);
  const expected: Record<string, Record<number, number>> = {
    // Awake, the author's roles for the arrows are CSBWin's: left and right strafe.
    Adventure: {
      0x3b00: 7, 0x3c00: 8, 0x3d00: 9, 0x3e00: 10, 0x13: 140, 0x1b: 147,
      0x5200: 1, 0x4700: 2, 0x4800: 3, 0x4d00: 4, 0x5000: 5, 0x4b00: 6,
    },
    Sleeping: { 0x0d: 146, 0x1b: 147 },
    Frozen: { 0x1b: 148 },
  };
  console.log(['mode', 'table', 'button', 'keyscan', 'codes'].join('\t'));
  for (const mode of ['Adventure', 'Sleeping', 'Frozen'] as const) {
    ui.uiMode = UIMode[mode];
    updateButtonLists(ui);
    const pair = [['pKeyXlate2', ui.keyXlate2 ?? []], ['pKeyXlate1', ui.keyXlate1 ?? []]] as const;
    const scans = pair.flatMap(([, table]) => table.map((entry) => entry.keyscan));
    check(new Set(scans).size === scans.length, `${mode}: no keyscan is bound twice`);
    const bound: Record<number, number> = {};
    for (const [name, table] of pair) {
      for (const entry of table) {
        const sent = codesOf(entry.keyscan);
        console.log([mode, name, entry.mouse, `0x${entry.keyscan.toString(16)}`, sent.join(' ') || '-'].join('\t'));
        bound[entry.keyscan] = entry.mouse;
        check(translateKey(ui, entry.keyscan) === entry.mouse,
          `${mode}: keyscan 0x${entry.keyscan.toString(16)} should queue button ${entry.mouse}`);
        for (const code of sent) {
          check(tableKeyButton(ui, code) === entry.mouse, `${mode}: ${code} should queue button ${entry.mouse}`);
        }
      }
    }
    check(JSON.stringify(Object.entries(bound).sort()) === JSON.stringify(Object.entries(expected[mode]).sort()),
      `${mode}: the tables should bind ${JSON.stringify(expected[mode])}`);
  }

  // The default preset's moves, at the buttons `Game`'s movement takes (1 turns left, 2
  // right, 3 steps forward, 4 strafes right, 5 steps back, 6 strafes left), and Esc.
  // Every other key is nothing to the tables: the arrows, Insert, Clr/Home, Return and
  // F1-F4 among them.
  const buttonOf = (mode: 'Adventure' | 'Sleeping' | 'Frozen', code: string): number => {
    ui.uiMode = UIMode[mode];
    updateButtonLists(ui);
    return tableKeyButton(ui, code);
  };
  const awake: Record<string, number> = {
    KeyJ: 1, Numpad7: 1, KeyL: 2, Numpad9: 2, KeyK: 3, Numpad8: 3,
    Period: 4, Numpad6: 4, Comma: 5, Numpad5: 5, KeyM: 6, Numpad4: 6, Pause: 147,
  };
  for (const [code, button] of Object.entries(awake)) {
    check(buttonOf('Adventure', code) === button, `awake, ${code} should queue button ${button}`);
  }
  for (const code of ['Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Insert', 'Home', 'PageUp', 'Enter',
    'NumpadEnter', 'F1', 'F5', 'KeyS', 'Numpad2', 'Numpad0']) {
    check(buttonOf('Adventure', code) === 0, `awake, ${code} sends the tables nothing`);
  }
  check(buttonOf('Sleeping', 'Pause') === 147 && buttonOf('Sleeping', 'Enter') === 0
    && buttonOf('Sleeping', 'KeyK') === 0, 'asleep, Pause, the tables\' Esc, is 147, and Return and K nothing');
  check(buttonOf('Frozen', 'Pause') === 148 && buttonOf('Frozen', 'KeyK') === 0, 'frozen, Pause is 148, and K nothing');
  ui.uiMode = UIMode.Adventure;
  updateButtonLists(ui);

  finish();
}

/** The default preset's moves: K , J L M . and the keypad's 4-9. */
const MOVE_KEYS = ['KeyK', 'Comma', 'KeyJ', 'KeyL', 'KeyM', 'Period',
  'Numpad8', 'Numpad5', 'Numpad7', 'Numpad9', 'Numpad4', 'Numpad6'];

main();
