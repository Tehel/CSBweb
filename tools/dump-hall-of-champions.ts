/**
 * The Hall of Champions: adding a champion at a mirror, then Resurrect, Reincarnate or
 * Cancel.
 *
 * `AddCharacter` (`doc/CSBwin-src/Character.cpp:457`) does not finish the job — it puts
 * the champion in the party *provisionally*, marked by `d.PotentialCharacterOrdinal`,
 * and leaves their possessions still linked in the mirror's cell.
 * `_ResurrectReincarnateCancel` (`doc/CSBwin-src/CSBCode.cpp:6674`) is what commits or
 * undoes that, and none of it is visible on a golden frame.
 *
 * This drives the real click path — `MouseSystem.handleWallClick` on the real level-0 mirrors
 * of the shipped dungeon — so the actuator gate, the hero text and the objects on the
 * floor are all the ones the game ships with.
 *
 * What to look for: the fingerprint is the party's own cell packed into a word, not a
 * counter; Cancel leaves the mirror exactly as it was, possessions included; Resurrect
 * unlinks those same objects from the room and turns the portrait actuator off; and
 * Reincarnate wipes all twenty skills before charging the hero's own penalties, which
 * `DM_rules` waives.
 *
 * Run: `npm test -- --only=dump-hall-of-champions.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, Direction, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../src/core/types';
import { getActuatorDisableMessage, getActuatorType } from '../src/data/actuatorHelpers';
import type { ActuatorRecord } from '../src/data/dungeonTypes';
import { TimerFunction, type TimerEntry } from '../src/engine/TimerQueue';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { DungeonData } from '../src/data/dungeonTypes';
import type { PresetHero } from '../src/data/HeroExtractor';
import { Game } from '../src/engine/Game';
import { attributeCurrent, attributeMaximum, attributeMinimum } from '../src/engine/attributes';
import { summarizeRoomInfoCsbwin } from '../src/renderer/csbwin/SummarizeRoomInfo';
import type { SummarizeRoomData } from '../src/renderer/bytecode/Types';
import { attackButtonRect, drawAttackButton } from '../src/renderer/ui/Attack';
import { ImageFormat } from '../src/core/imageDecoder';
import { graphicsTablesOf, newGame, presetHeroesOfGame, stockDungeon, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { drawCursorItem, handleClothingClick, tag02076e, tag0207cc } from '../src/renderer/ui/Mouse';
import type { UIState } from '../src/renderer/ui/UIState';
import { check, fail, finish } from './lib/check';

const DELTA_X = [0, 1, 0, -1];
const DELTA_Y = [-1, 0, 1, 0];

const RESURRECT = 160;
const REINCARNATE = 161;
const CANCEL = 162;

/** Each game's `GameHost.messages`, as `gameOn` records them. */
const messagesOf = new WeakMap<Game, Array<{ color: number; text: string }>>();
/** The graphics loader, kept aside so the portrait section can re-read its tables. */
let sharedGraphics: GraphicsLoader | null = null;
/** Where the games' `GameHost.openReincarnateScreen` goes; a scenario points it at its screen. */
let reincarnateScreen: (chIdx: number) => void = () => {};
/**
 * The games' `GameHost.tag02076e` / `tag0207cc`, the UI's pair: each call, with the
 * inventory open at the time (`selectedCharacterIndex`) and the party's size.
 */
const pairCalls: string[] = [];
/** A screen the games' pair runs on as well, `tag02076e` / `tag0207cc`, when a scenario sets it. */
let pairUi: UIState | null = null;

function makeGame(): Game {
  const data = stockDungeon();

  const graphics = stockGraphics();
  sharedGraphics = graphics;
  return gameOn(data, graphics);
}

/** CSB's prison, the compressed `dungeon.dat` whose level 0 is its 24 mirrors. */
function makePrisonGame(): Game {
  const data = new DungeonLoader().loadDungeonDat(
    new Uint8Array(readFileSync(resolve('static/gamefiles/csb/dungeon.dat'))));
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/csb/graphics.dat'))));
  return gameOn(data, graphics);
}

function gameOn(data: DungeonData, graphics: GraphicsLoader): Game {

  const messages: Array<{ color: number; text: string }> = [];
  const game = newGame(data, graphics, {
    messages: {
      printLinefeed: () => { messages.push({ color: -1, text: '\n' }); },
      quePrintLines: (color, text) => { messages.push({ color, text }); },
      printLines: () => {},
      setNewSpeed: () => {},
      resetTime: () => {},
      clockTick: () => {},
      printNextQueued: () => {},
      vblInterrupt: () => {},
      discardText: () => {},
    },
    openReincarnateScreen: (chIdx) => reincarnateScreen(chIdx),
    tag02076e: () => { pairCalls.push(pairCall(game, 'TAG02076e')); if (pairUi) tag02076e(pairUi); },
    tag0207cc: () => { pairCalls.push(pairCall(game, 'TAG0207cc')); if (pairUi) tag0207cc(pairUi); },
  });
  game.setRandomSeed(0x12345678);
  messagesOf.set(game, messages);
  return game;
}

function pairCall(game: Game, name: string): string {
  const party = game.ctx.party.state;
  return `${name} inventory ${party.selectedCharacterIndex} champions ${party.champions.length}`;
}

function probeMessages(game: Game): Array<{ color: number; text: string }> {
  const messages = messagesOf.get(game);
  if (!messages) throw new Error('a game not built by gameOn');
  return messages;
}

/** Stand the party in front of a mirror, facing it, as a player walking up would. */
function standAtMirror(game: Game, hero: PresetHero): { facing: number; mirror: Position } {
  const facing = (hero.location.wall + 2) & 3;
  const party = game.ctx.party.state;
  party.position = new Position(
    hero.location.x - DELTA_X[facing],
    hero.location.y - DELTA_Y[facing],
    hero.location.map,
  );
  party.facing = facing as Direction;
  return {
    facing,
    mirror: new Position(hero.location.x, hero.location.y, hero.location.map),
  };
}

/** Every object id lying in a cell, in chain order. */
function cellObjects(game: Game, cell: Position): ObjectID[] {
  const out: ObjectID[] = [];
  for (
    let rn = game.ctx.dungeon.findFirstObject(cell);
    rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
    rn = game.ctx.dungeon.getDBRecordLink(rn)
  ) {
    out.push(rn);
  }
  return out;
}

function possessionList(game: Game, chIdx: number): Array<{ slot: number; rn: ObjectID }> {
  const champ = game.ctx.party.state.champions[chIdx];
  const out: Array<{ slot: number; rn: ObjectID }> = [];
  for (let slot = 0; slot < (champ?.possessions?.length ?? 0); slot++) {
    const value = champ!.possessions[slot]!;
    if (value === OBJECT_ID_NULL) continue;
    out.push({ slot, rn: value });
  }
  return out;
}

function portraitActuatorTypes(game: Game, mirror: Position, wall: number): number[] {
  const out: number[] = [];
  for (const rn of cellObjects(game, mirror)) {
    const decoded = game.ctx.dungeon.rnMaps.decode(rn);
    if (decoded.category !== DBType.ACTUATOR) continue;
    if (decoded.position !== wall) continue;
    const rec = game.ctx.dungeon.getActuatorRecord(rn);
    if (rec) out.push(getActuatorType(rec));
  }
  return out;
}

/**
 * Draw champion `chIdx`'s attack hand, `DrawAttackButton` (`doc/CSBwin-src/Character.cpp:4832`),
 * and say whether it came out shaded. `ShadeRectangleInScreen(&LOCAL_8, 0)` blacks every
 * pixel of the box whose x + y is odd, and an unshaded box has its blue border there.
 */
function attackHandShaded(game: Game, chIdx: number): boolean {
  const graphics = sharedGraphics!;
  const ui = newUIState(graphics, game.ctx);
  drawAttackButton(ui, chIdx);
  const { pixels, width } = ui.screenIndexBuffer;
  const rect = attackButtonRect(chIdx);
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) {
      if ((x + y) & 1 && pixels[y * width + x] !== 0) return false;
    }
  }
  return true;
}

function heroByName(game: Game, name: string): PresetHero {
  const hero = presetHeroesOfGame(game).find((h) => h.name === name);
  if (!hero) throw new Error(`no preset hero named ${name}`);
  return hero;
}

function main(): void {
  /* ------------------------------------------------- 1. the provisional add ----- */

  const game = makeGame();
  const halk = heroByName(game, 'HALK');
  const { facing, mirror } = standAtMirror(game, halk);
  const wall = halk.location.wall;
  const party = game.ctx.party.state;
  const mirrorBefore = cellObjects(game, mirror);

  console.log('=== AddCharacter at the level-0 mirror of HALK THE BARBARIAN ===');
  console.log(`party at (${party.position.x},${party.position.y}) level ${party.position.z} facing ${facing}`);
  console.log(`mirror at (${mirror.x},${mirror.y}) wall ${wall}, ${mirrorBefore.length} objects in the cell`);

  pairCalls.length = 0;
  const clicked = game.systems.mouse.handleWallClick();
  check(clicked === false, 'the portrait actuator reports no switch action (it only adds a champion)');
  console.log(`pair: ${JSON.stringify(pairCalls)}`);
  check(pairCalls.join() === 'TAG02076e inventory 0 champions 1',
    "TAG02076e once the candidate's inventory is shown (Character.cpp:797-798)");
  check(party.champions.length === 1, 'HALK is in the party after the wall click');

  const champ = party.champions[0];
  if (!champ) {
    fail('no champion was added — the rest of the run cannot mean anything');
    finish();
    return;
  }

  console.log('');
  console.log(['field', 'value', 'expected'].join('\t'));
  const expectedFingerprint = (party.position.z << 10) | (party.position.x << 5) | party.position.y;
  console.log(['name', champ.name, 'HALK'].join('\t'));
  console.log(['title', champ.title, 'THE BARBARIAN'].join('\t'));
  console.log(['fingerprint', String(champ.fingerprint), String(expectedFingerprint)].join('\t'));
  console.log(['charPosition', String(champ.partyPosition), String(facing)].join('\t'));
  console.log(['facing', String(champ.facing), String(facing)].join('\t'));
  console.log(['maxHealth', String(champ.attributes.maxHealth), String(halk.health)].join('\t'));
  console.log(['food', String(champ.food), '1500..1755'].join('\t'));
  console.log(['water', String(champ.water), '1500..1755'].join('\t'));
  console.log(['potentialChampionIndex', String(party.potentialChampionIndex), '0'].join('\t'));
  console.log(['selectedCharacterIndex', String(party.selectedCharacterIndex), '0'].join('\t'));
  console.log(['cursorOwner', String(party.cursorOwner), '0'].join('\t'));

  check(champ.name === 'HALK', 'the name comes from the hero text in the party cell');
  check(champ.title === 'THE BARBARIAN', 'so does the title');
  check(
    champ.fingerprint === expectedFingerprint,
    `fingerprint is (level<<10)|(x<<5)|y = ${expectedFingerprint}, not a counter`,
  );
  // `for (D6W=0; CharacterAtPosition((D6W+d.partyFacing)&3) != -1; D6W++)` — with an
  // empty party the very first candidate is free, so it is the facing itself.
  check(champ.partyPosition === facing, 'the first champion takes the corner the party faces');
  check(champ.facing === facing, 'and faces the way the party does');
  check(champ.attributes.maxHealth === halk.health, 'HP is the hero text figure');
  check(champ.attributes.health === champ.attributes.maxHealth, 'and Current starts at Maximum');
  check(champ.food >= 1500 && champ.food <= 1755, 'food is (random & 0xff) + 1500');
  check(champ.water >= 1500 && champ.water <= 1755, 'water is (random & 0xff) + 1500');
  check(champ.food !== champ.water, 'food and water draw two separate randoms');
  check(party.potentialChampionIndex === 0, 'the champion is only provisional');
  check(party.selectedCharacterIndex === 0, 'the inventory opened on them (ShowHideInventory)');
  check(party.cursorOwner === 0, 'the first champion in the party gets the cursor');
  console.log(`attack hand shaded: ${attackHandShaded(game, 0)}`);
  check(attackHandShaded(game, 0),
    "the candidate's attack hand is shaded while d.PotentialCharacterOrdinal is set (Character.cpp:4893)");

  /* ------------------------------------ 2. possessions, and where they still are - */

  const taken = possessionList(game, 0);
  console.log('');
  console.log('=== possessions taken from the mirror cell ===');
  console.log(['slot', 'object', 'category'].join('\t'));
  for (const { slot, rn } of taken) {
    console.log([slot, `0x${rn.toString(16)}`, DBType[game.ctx.dungeon.rnMaps.dbType(rn)]].join('\t'));
  }

  check(taken.length === halk.inventory.length,
    `all ${halk.inventory.length} objects at the mirror's wall became possessions`);
  check(taken.every(({ rn }) => game.ctx.dungeon.rnMaps.pos(rn) === wall),
    "every possession came from the mirror's own wall position");

  const mirrorDuring = cellObjects(game, mirror);
  check(mirrorDuring.length === mirrorBefore.length,
    'AddCharacter leaves the objects linked in the room — it is Resurrect that unlinks them');
  check(taken.every(({ rn }) => mirrorDuring.includes(rn)),
    'so each possession is in two places at once while the menu is up');

  check(portraitActuatorTypes(game, mirror, wall).includes(127),
    'the portrait actuator is still live before the menu is answered');

  /* --------------------------------------------------------- 3. Cancel ---------- */

  console.log('');
  console.log('=== Cancel (button 162) ===');
  game.ctx.loop.clockTick = false;
  pairCalls.length = 0;
  game.systems.hallOfChampions.resurrectReincarnateCancel(CANCEL);
  console.log(`pair: ${JSON.stringify(pairCalls)}`);
  check(pairCalls.join() === 'TAG0207cc inventory -1 champions 0',
    'TAG0207cc once the inventory is hidden and the champion gone (CSBCode.cpp:6716)');
  console.log(`champions ${party.champions.length}, potential ${party.potentialChampionIndex}, cursorOwner ${party.cursorOwner}, inventory ${party.selectedCharacterIndex}`);
  check(party.champions.length === 0, 'Cancel takes the champion back out of the party');
  check(party.potentialChampionIndex === -1, 'and clears the provisional marker');
  check(party.cursorOwner === -1, 'SetHandOwner(-1), because that was the only champion');
  check(party.selectedCharacterIndex === -1, 'the inventory is hidden again');
  check(game.ctx.loop.clockTick, "and ShowHideInventory(4)'s d.clockTick = 1 makes a tick due (CSBCode.cpp:6693, :7500)");
  check(party.vacantCharacters[0] === champ,
    "the candidate's record stays in slot 0, which d.NumCharacter-- only stops counting (CSBCode.cpp:6699)");

  const mirrorAfterCancel = cellObjects(game, mirror);
  check(mirrorAfterCancel.length === mirrorBefore.length
    && mirrorAfterCancel.every((rn, i) => rn === mirrorBefore[i]),
    "Cancel leaves the mirror's objects exactly as they were");
  check(portraitActuatorTypes(game, mirror, wall).includes(127),
    'and leaves the portrait actuator usable');

  const readded = game.systems.mouse.handleWallClick();
  check(readded === false && party.champions.length === 1,
    'the same mirror can be clicked again after a Cancel');

  /* ------------------------------------------------------- 4. Resurrect --------- */

  console.log('');
  console.log('=== Resurrect (button 160) ===');
  const possessionsBeforeResurrect = possessionList(game, 0).map(({ rn }) => rn);
  const skillsBefore = party.champions[0]!.skills.map((s) => s.experience);
  const strengthBefore = attributeCurrent(party.champions[0]!.attributes.stats[1]!);
  game.ctx.loop.clockTick = false;
  pairCalls.length = 0;
  game.systems.hallOfChampions.resurrectReincarnateCancel(RESURRECT);
  const tickDueAfterResurrect = game.ctx.loop.clockTick;
  console.log(`pair: ${JSON.stringify(pairCalls)}`);
  check(pairCalls.join() === 'TAG0207cc inventory -1 champions 1',
    'TAG0207cc once the inventory is hidden (CSBCode.cpp:6866-6867)');

  const mirrorAfterResurrect = cellObjects(game, mirror);
  console.log(`mirror now holds ${mirrorAfterResurrect.length} objects (was ${mirrorBefore.length})`);
  console.log(`portrait actuator types on that wall: [${portraitActuatorTypes(game, mirror, wall).join(', ')}]`);
  console.log(`messages: ${probeMessages(game).map((m) => JSON.stringify(m.text)).join(' ')}`);

  check(party.potentialChampionIndex === -1, 'the champion is fully in the party now');
  check(party.selectedCharacterIndex === -1, 'and the menu screen is gone');
  check(tickDueAfterResurrect, "ShowHideInventory(4)'s d.clockTick = 1 makes a tick due (CSBCode.cpp:6866, :7500)");
  check(
    possessionsBeforeResurrect.every((rn) => !mirrorAfterResurrect.includes(rn)),
    'RemoveObjectFromRoom unlinked every possession from the mirror',
  );
  check(mirrorAfterResurrect.length === mirrorBefore.length - possessionsBeforeResurrect.length,
    'and nothing else left the cell');
  check(!portraitActuatorTypes(game, mirror, wall).includes(127),
    'the portrait actuator is disabled — the mirror is used up');
  check(game.systems.mouse.handleWallClick() === false && party.champions.length === 1,
    'clicking the dead mirror adds nobody');
  check(party.magicCasterIndex === 0, 'SelectMagicCaster(0) for the only champion');
  check(party.cursorOwner === 0, 'SetHandOwner(0) likewise');
  check(!attackHandShaded(game, 0), 'and the attack hand is no longer shaded');

  const messages = probeMessages(game);
  const printed = messages.map((m) => m.text);
  check(printed.includes('HALK'), 'the champion is named in the message area');
  check(printed.includes(' RESURRECTED'), 'followed by RESURRECTED');
  check(!printed.includes(' REINCARNATED'), 'and not by REINCARNATED');
  check(
    party.champions[0]!.skills.every((s, i) => s.experience === skillsBefore[i]),
    'Resurrect leaves the skills from the hero text alone',
  );
  check(attributeCurrent(party.champions[0]!.attributes.stats[1]!) === strengthBefore,
    'and charges no attribute penalty');

  /* ----------------------------------------------------- 5. Reincarnate -------- */

  console.log('');
  console.log('=== Reincarnate (button 161), at a second mirror ===');
  const boris = heroByName(game, 'BORIS');
  standAtMirror(game, boris);
  check(game.systems.mouse.handleWallClick() === false && party.champions.length === 2,
    'BORIS joins provisionally at his own mirror');
  check(attackHandShaded(game, 0),
    "HALK's attack hand is shaded too: the test is d.PotentialCharacterOrdinal, not the champion");

  const wizard = party.champions[1]!;
  const before = {
    skills: wizard.skills.map((s) => s.experience),
    maxHealth: wizard.attributes.maxHealth,
    maxMana: wizard.attributes.maxMana,
    maxStamina: wizard.attributes.maxStamina,
    stats: wizard.attributes.stats.map((a) => ({
      current: attributeCurrent(a),
      maximum: attributeMaximum(a),
      minimum: attributeMinimum(a),
    })),
  };
  check(before.skills.some((exp) => exp > 0), 'BORIS starts with skill experience to lose');

  // Reincarnate now runs in two halves, because CSBWin's does: `ReIncarnate`
  // (`doc/CSBwin-src/Code13ea4.cpp:20`) blocks for a typed name before any of the
  // penalties are charged. With no UI attached the engine stops at exactly that point,
  // so this stands in for the screen — which is what `main.ts` wires the real one as.
  let screenOpenedFor = -1;
  reincarnateScreen = (chIdx) => { screenOpenedFor = chIdx; };
  pairCalls.length = 0;
  game.systems.hallOfChampions.resurrectReincarnateCancel(REINCARNATE);
  check(screenOpenedFor === 1, 'Reincarnate raises the name-entry screen for the new champion');
  check(pairCalls.length === 0, 'and no TAG0207cc while the name is being typed');
  check(
    wizard.skills.every((skill, i) => skill.experience === before.skills[i]),
    'and charges nothing at all until it is answered — CSBWin calls ReIncarnate first',
  );
  game.systems.hallOfChampions.reincarnateNamed(screenOpenedFor, 'ZED', 'THE RENAMED');
  console.log(`pair: ${JSON.stringify(pairCalls)}`);
  check(pairCalls.join() === 'TAG0207cc inventory -1 champions 2',
    'TAG0207cc once the answered menu is hidden (CSBCode.cpp:6866-6867)');
  check(wizard.name === 'ZED', 'the typed name replaces the hero text\'s');
  check(wizard.title === 'THE RENAMED', 'and the typed title');

  const attributePenalty = boris.reincarnateAttributePenalty;
  const statPenalty = boris.reincarnateStatPenalty;
  console.log(`penalties from the hero text: attribute ${attributePenalty}/16, stat ${statPenalty}/16`);
  console.log('');
  console.log(['attribute', 'before', 'penalised', 'after', 'max after'].join('\t'));
  const ATTR_NAMES = ['LUCK', 'STRENGTH', 'DEXTERITY', 'WISDOM', 'VITALITY', 'ANTI-MAGIC', 'ANTI-FIRE'];
  let pointsGained = 0;
  for (let i = 0; i < 7; i++) {
    const start = before.stats[i]!;
    const penalised = i === 0
      ? start.current
      : Math.max(start.current - Math.trunc((start.current * attributePenalty) / 16), start.minimum);
    const after = attributeCurrent(wizard.attributes.stats[i]!);
    console.log([ATTR_NAMES[i], start.current, penalised, after, attributeMaximum(wizard.attributes.stats[i]!)].join('\t'));
    pointsGained += after - penalised;
    check(after >= penalised, `${ATTR_NAMES[i]} never ends below its penalised value`);
    check(attributeMaximum(wizard.attributes.stats[i]!) === after,
      `${ATTR_NAMES[i]} Maximum tracks Current through reincarnation`);
  }
  console.log('');
  console.log(`random attribute points distributed: ${pointsGained}`);
  check(pointsGained === 12, 'twelve random attribute points, hardcoded in CSBWin');
  check(
    attributeCurrent(wizard.attributes.stats[0]!) >= before.stats[0]!.current,
    'Luck is exempt from the penalty (the loop runs 1..6) and can only gain',
  );

  check(wizard.skills.every((s) => s.experience === 0 && s.tempAdjust === 0),
    'all twenty skills are wiped');

  const scale = (v: number): number => Math.trunc((v * (16 - statPenalty)) / 16);
  console.log(['stat', 'before', 'after', 'expected'].join('\t'));
  console.log(['maxHealth', before.maxHealth, wizard.attributes.maxHealth, scale(before.maxHealth)].join('\t'));
  console.log(['maxStamina', before.maxStamina, wizard.attributes.maxStamina, scale(before.maxStamina)].join('\t'));
  console.log(['maxMana', before.maxMana, wizard.attributes.maxMana, scale(before.maxMana)].join('\t'));
  check(wizard.attributes.maxHealth === scale(before.maxHealth), 'MaxHP is scaled by (16 - statPenalty)/16');
  check(wizard.attributes.maxStamina === scale(before.maxStamina), 'MaxStamina likewise');
  check(wizard.attributes.maxMana === scale(before.maxMana), 'MaxMana likewise');
  check(probeMessages(game).some((m) => m.text === ' REINCARNATED'), 'REINCARNATED is printed');
  check(party.magicCasterIndex === 0, 'a second champion does not steal the magic tab');

  /* ------------------------------------------- 5b. Reincarnate under DM_rules ---- */

  // `if (!DM_rules)` guards both penalties (`doc/CSBwin-src/CSBCode.cpp:6799`, `:6820`):
  // the same champion, reincarnated in a game with DM rules on, keeps every attribute
  // and stat, and only the twelve random points and the wiped skills remain.
  console.log('');
  console.log('=== Reincarnate under DM_rules: no penalty ===');
  {
    const g = makeGame();
    g.ctx.rules.dmRules = true;
    standAtMirror(g, heroByName(g, 'BORIS'));
    g.systems.mouse.handleWallClick();
    const zed = g.ctx.party.state.champions[0]!;
    const start = zed.attributes.stats.map((a) => attributeCurrent(a));
    const stats = { ...zed.attributes };
    let opened = -1;
    reincarnateScreen = (chIdx) => { opened = chIdx; };
    g.systems.hallOfChampions.resurrectReincarnateCancel(REINCARNATE);
    g.systems.hallOfChampions.reincarnateNamed(opened, 'ZED', 'THE RENAMED');
    const after = zed.attributes.stats.map((a) => attributeCurrent(a));
    console.log(`attributes ${start.join(' ')} -> ${after.join(' ')}`);
    console.log(`maxHealth ${stats.maxHealth} -> ${zed.attributes.maxHealth}, ` +
      `maxStamina ${stats.maxStamina} -> ${zed.attributes.maxStamina}, ` +
      `maxMana ${stats.maxMana} -> ${zed.attributes.maxMana}`);
    check(after.every((v, i) => v >= start[i]!), 'no attribute is lowered');
    check(after.reduce((sum, v, i) => sum + v - start[i]!, 0) === 12,
      'the only change is the twelve random points');
    check(zed.attributes.health === stats.health && zed.attributes.maxHealth === stats.maxHealth &&
      zed.attributes.stamina === stats.stamina && zed.attributes.maxStamina === stats.maxStamina &&
      zed.attributes.mana === stats.mana && zed.attributes.maxMana === stats.maxMana,
      'HP, stamina and mana are not scaled');
    check(zed.skills.every((s) => s.experience === 0), 'the skills are still wiped');
  }

  /* ------------------------------------------------ 6. the guards on adding ----- */

  console.log('');
  console.log('=== the guards on AddCharacter ===');
  const wuTse = heroByName(game, 'WU TSE');
  standAtMirror(game, wuTse);
  party.objectInHand = party.champions[0]!.possessions![1] as ObjectID;
  check(game.systems.mouse.handleWallClick() === false && party.champions.length === 2,
    'a full cursor refuses the mirror (d.EmptyHanded)');
  party.objectInHand = OBJECT_ID_NULL;

  check(game.systems.mouse.handleWallClick() === false && party.champions.length === 3,
    'and an empty one accepts it');
  // Still standing at WU TSE's mirror, with his menu unanswered. Clicking again must
  // not stack a second provisional champion — `_ResurrectReincarnateCancel` only ever
  // reaches the last one.
  check(game.systems.mouse.handleWallClick() === false && party.champions.length === 3,
    'a mirror is refused while a menu is still unanswered');
  game.systems.hallOfChampions.resurrectReincarnateCancel(RESURRECT);

  const azizi = heroByName(game, 'AZIZI');
  standAtMirror(game, azizi);
  check(game.systems.mouse.handleWallClick() === false && party.champions.length === 4, 'the fourth champion joins');
  game.systems.hallOfChampions.resurrectReincarnateCancel(RESURRECT);
  const daroou = heroByName(game, 'DAROOU');
  standAtMirror(game, daroou);
  check(game.systems.mouse.handleWallClick() === false && party.champions.length === 4,
    'a fifth is refused (d.NumCharacter == 4)');

  const fingerprints = party.champions.map((c) => c.fingerprint);
  console.log(`fingerprints: [${fingerprints.map((f) => `0x${f.toString(16)}`).join(', ')}]`);
  check(new Set(fingerprints).size === fingerprints.length, 'every champion has a distinct fingerprint');
  check(fingerprints.every((f) => f !== 0), 'and none is zero');

  disableMessageSection();
  portraitSection();
  edgeDecorationSection();
  finish();
}

/** The live type-127 actuators on a mirror's wall, in chain order. */
function portraitActuators(game: Game, mirror: Position, wall: number): ActuatorRecord[] {
  const out: ActuatorRecord[] = [];
  for (const rn of cellObjects(game, mirror)) {
    const decoded = game.ctx.dungeon.rnMaps.decode(rn);
    if (decoded.category !== DBType.ACTUATOR || decoded.position !== wall) continue;
    const rec = game.ctx.dungeon.getActuatorRecord(rn);
    if (rec && getActuatorType(rec) === 127) out.push(rec);
  }
  return out;
}

/**
 * A portrait's `DisableMessage` (`word4` bits 6-7): when Resurrect or Reincarnate
 * disables it, `PortraitTranslateDisable` (`doc/CSBwin-src/CSBCode.cpp:6648-6671`) sends
 * set (1), clear (2) or toggle (3) to the mirror's own cell, at the wall its `Position`
 * (`word6` bits 12-13) names, as `QueueDSASwitchAction(0, action, d.LoadedLevel, x, y,
 * pos, 'M')` (`DSA.cpp:486-533`): a stone cell's timer, `TT_STONEROOM`, due now, with
 * action 0, 1 or 2. The shipped mirrors carry none (`ExtendPortraits` clears the field),
 * so each case sets it on HALK's.
 */
function disableMessageSection(): void {
  console.log('');
  console.log('=== a portrait\'s DisableMessage, sent when Resurrect disables it ===');

  const shipped = makeGame();
  const shippedMessages = shipped.ctx.dungeon.getData().databases.actuators.records
    .filter((r) => r.nextObject !== OBJECT_ID_NULL && getActuatorType(r) === 127)
    .map(getActuatorDisableMessage);
  console.log(`dm-atari portraits: ${shippedMessages.length}, with a DisableMessage: ` +
    `${shippedMessages.filter((m) => m !== 0).length}`);
  check(shippedMessages.length === 24 && shippedMessages.every((m) => m === 0),
    'no portrait of the shipped dungeon carries a DisableMessage');

  const POSITION = 1;
  const show = (t: TimerEntry): string =>
    `fn ${t.function} L${t.level} (${t.uByte6},${t.uByte7}) pos ${t.uByte8} act ${t.uByte9} t ${t.time}`;
  for (const [disableMessage, button] of [[0, RESURRECT], [1, RESURRECT], [2, REINCARNATE], [3, RESURRECT], [1, CANCEL]] as const) {
    const game = makeGame();
    const halk = heroByName(game, 'HALK');
    const { mirror } = standAtMirror(game, halk);
    const portraits = portraitActuators(game, mirror, halk.location.wall);
    const portrait = portraits[0];
    if (portraits.length !== 1 || !portrait) {
      fail(`HALK's wall has ${portraits.length} portraits, not one`);
      continue;
    }
    portrait.word4 = (portrait.word4 & ~0x00c0) | (disableMessage << 6);
    portrait.word6 = (portrait.word6 & ~0x3000) | (POSITION << 12);
    game.systems.mouse.handleWallClick();
    const before = new Set(game.ctx.timers.getTimers());
    reincarnateScreen = () => {};
    game.systems.hallOfChampions.resurrectReincarnateCancel(button);
    const sent = game.ctx.timers.getTimers().filter((t) => !before.has(t));
    console.log(`DisableMessage ${disableMessage}, button ${button}: [${sent.map(show).join('; ')}]`);

    if (disableMessage === 0 || button === CANCEL) {
      check(sent.length === 0, button === CANCEL
        ? `Cancel disables nothing, so DisableMessage ${disableMessage} sends nothing`
        : 'DisableMessage 0 (PORTRAIT_ResponseNone) sends nothing');
      continue;
    }
    const t = sent[0];
    check(sent.length === 1 && t !== undefined
      && t.function === TimerFunction.TT_STONEROOM
      && t.level === mirror.z && t.uByte6 === mirror.x && t.uByte7 === mirror.y
      && t.uByte8 === POSITION && t.uByte9 === disableMessage - 1
      && t.time === game.ctx.state.tickCount,
      `DisableMessage ${disableMessage} sends action ${disableMessage - 1} to the mirror's cell at ` +
      `the portrait's Position, a TT_STONEROOM due now`);
  }
}

/**
 * A mirror seen from an angle — the `srcOffsetX` arm of `DrawWallDecoration`
 * (`doc/CSBwin-src/CSBCode.cpp:3599-3623`).
 *
 * Positions 7 and 9 are the F2 front walls one cell to the left and right. Both are
 * scaled to the width of the F2 *centre* rectangle (`[8]`) and then drawn into a
 * narrower slot pinned to a screen border, so only part of the bitmap is visible — and
 * which part depends on the side. Getting that backwards draws the decoration cropped on
 * the wrong side, with a gap where the off-screen margin should be. This section pins the
 * rectangles; the golden frames `13-edge-decoration-left` and `14-edge-decoration-right`
 * pin the pixels.
 */
function edgeDecorationSection(): void {
  const graphics = sharedGraphics;
  if (!graphics) {
    fail('graphics.dat was not retained; the edge-decoration section cannot run');
    return;
  }
  const objectTables = graphicsTablesOf(graphics).objects;
  const sets = objectTables.wallDecorationRectSets;

  console.log('');
  console.log('=== F2 front-wall rectangles, per decoration rect set ===');
  console.log(['set', '[7] left', '[8] centre', '[9] right', 'srcX@7', 'window@7', 'window@9'].join('\t'));

  const VIEWPORT_RIGHT = 223;
  for (let i = 0; i < sets.length; i++) {
    const r7 = sets[i]?.[7];
    const r8 = sets[i]?.[8];
    const r9 = sets[i]?.[9];
    if (!r7 || !r8 || !r9) {
      fail(`rect set ${i} is missing one of the F2 front rectangles`);
      continue;
    }
    const finalBitmapWidth = (r8.x2 | 0) - (r8.x1 | 0);
    const scaledWidth = finalBitmapWidth + 1;
    const destWidth7 = (r7.x2 | 0) - (r7.x1 | 0) + 1;
    const destWidth9 = (r9.x2 | 0) - (r9.x1 | 0) + 1;
    // What the port computes.
    const srcX7 = finalBitmapWidth - ((r7.x2 | 0) - (r7.x1 | 0));
    const srcX9 = 0;

    console.log([
      i,
      `${r7.x1}..${r7.x2}`,
      `${r8.x1}..${r8.x2}`,
      `${r9.x1}..${r9.x2}`,
      srcX7,
      `${srcX7}..${srcX7 + destWidth7 - 1} of ${scaledWidth}`,
      `${srcX9}..${srcX9 + destWidth9 - 1} of ${scaledWidth}`,
    ].join('\t'));

    check(r7.x1 === 0, `set ${i}: the F2 front-left slot is flush against the left border`);
    check(r9.x2 === VIEWPORT_RIGHT, `set ${i}: the F2 front-right slot is flush against the right border`);
    check(destWidth7 < scaledWidth && destWidth9 < scaledWidth,
      `set ${i}: both edge slots are narrower than the bitmap they scale from`);
    // The invariant the bug broke: position 7 shows the bitmap's **right** end, so its
    // window must finish on the last column; position 9 shows the left end, so its
    // window must start on column 0.
    check(srcX7 + destWidth7 - 1 === scaledWidth - 1,
      `set ${i}: the front-left window ends flush with the bitmap's right edge`);
    check(srcX9 === 0,
      `set ${i}: the front-right window starts flush with the bitmap's left edge`);
    check(srcX7 > 0, `set ${i}: the front-left offset is non-zero — 0 is what the bug drew`);
  }
}

/**
 * The portrait a mirror shows: `SummarizeRoomInfo`'s `championPortraitOrdinal`
 * (`doc/CSBwin-src/Codea59a.cpp:154-167`) and the `Byte2546` rectangle the
 * `relativePosition == 12` arm of `DrawWallDecoration` blits into
 * (`doc/CSBwin-src/CSBCode.cpp:3751-3781`).
 */
function portraitSection(): void {
  const probe = makeGame();
  // Read before the probe recruits: a recruit disables its mirror.
  const shippedHeroes = presetHeroesOfGame(probe);
  const graphics = sharedGraphics;
  if (!graphics) {
    fail('graphics.dat was not retained; the portrait section cannot run');
    return;
  }
  const viewportTables = graphicsTablesOf(graphics).viewport;
  const objectTables = graphicsTablesOf(graphics).objects;

  console.log('');
  console.log('=== the portrait rectangle, extracted from graphics.dat item 0x22e ===');
  const rect = viewportTables.championPortraitRect;
  console.log(`Byte2546 = { x1: ${rect.x1}, x2: ${rect.x2}, y1: ${rect.y1}, y2: ${rect.y2} }`);
  // Canary: CSBWin's own comment at `doc/CSBwin-src/CSBCode.cpp:3760` records this rect
  // as 0x60,0x7f,0x23,0x3f. Reading those four bytes back is what proves the offset,
  // since any neighbouring skip would give a different quadruple.
  check(rect.x1 === 0x60 && rect.x2 === 0x7f && rect.y1 === 0x23 && rect.y2 === 0x3f,
    'Byte2546 reads back as 0x60,0x7f,0x23,0x3f — the offset is right');
  const rectW = rect.x2 - rect.x1 + 1;
  const rectH = rect.y2 - rect.y1 + 1;
  check(rectW === 32 && rectH === 29, `the rectangle is one portrait cell, 32x29 (got ${rectW}x${rectH})`);

  // Graphic 26 is the portrait sheet. CSBWin addresses it with `(charID & 7) << 5` and
  // `29 * (charID >> 3)`, which is only equivalent to a 2-D cell index if the sheet is
  // exactly 8 cells wide.
  const sheet = graphics.getImage(26, ImageFormat.IMG1);
  if (!sheet) {
    fail('graphic 26 (the portrait sheet) did not decode');
    return;
  }
  console.log(`graphic 26 = ${sheet.width}x${sheet.height} = ${sheet.width / rectW}x${sheet.height / rectH} cells`);
  check(sheet.width === rectW * 8, 'the sheet is 8 portrait cells wide, so `charID & 7` is the column');
  check(sheet.height === rectH * 3, 'and 3 tall, so charIDs 0..23 are the built-in portraits');
  check(sheet.width / 2 === 128, "the source byte width CSBWin passes is the sheet's own (128)");

  console.log('');
  console.log('=== championPortraitOrdinal, per relative cell, at HALK\'s mirror ===');
  const halk = heroByName(probe, 'HALK');
  const { facing, mirror } = standAtMirror(probe, halk);
  const party = probe.ctx.party.state;

  // `summarizeRoomInfoCsbwin` reads the cell to summarize out of `rslt.x`/`rslt.y` and
  // takes the **party's** position and facing separately — the same convention
  // `DrawViewport` uses for all 21 relative cells.
  const summarize = (cellX: number, cellY: number, partyFacing: number): SummarizeRoomData => {
    const rslt: SummarizeRoomData = {
      x: cellX,
      y: cellY,
      relativeCellNumber: 17,
      skinNumber: 0,
      roomType: 0,
      championPortraitOrdinal: 0,
      graphicRoomType: 0,
      rn2: 0xfffe,
      decorations: [0, 0, 0],
      text: [0xfffe, 0xfffe, 0xfffe],
    };
    summarizeRoomInfoCsbwin(rslt, probe.ctx.dungeon, party.position, partyFacing, objectTables);
    return rslt;
  };

  const atMirror = summarize(mirror.x, mirror.y, facing).championPortraitOrdinal | 0;
  const atParty = summarize(party.position.x, party.position.y, facing).championPortraitOrdinal | 0;
  console.log(['cell', 'ordinal'].join('\t'));
  console.log([`mirror (${mirror.x},${mirror.y})`, atMirror].join('\t'));
  console.log([`party  (${party.position.x},${party.position.y})`, atParty].join('\t'));

  check(atMirror === halk.portraitIndex + 1,
    `the mirror cell reports ordinal ${halk.portraitIndex + 1} — the actuator value plus one`);
  check(atParty === 0, "the party's own cell has no portrait to report");

  // Relative position 2 is the *rear* wall of the summarized cell, which is only the
  // mirror while the party is looking at it. Turn the party round and the same cell
  // reports nothing, which is what keeps a portrait off a wall seen edge-on.
  const away = summarize(mirror.x, mirror.y, (facing + 2) & 3).championPortraitOrdinal | 0;
  console.log(`same cell, party turned round: ${away}`);
  check(away === 0, 'the mirror reports no portrait to a party facing the other way');

  // Taking the champion sets the actuator to type 0, which stops the ordinal but leaves
  // the decoration's `wallGraphicOrdinal` alone — the frame stays, the face goes.
  probe.systems.mouse.handleWallClick();
  probe.systems.hallOfChampions.resurrectReincarnateCancel(RESURRECT);
  const after = summarize(mirror.x, mirror.y, facing);
  const afterTaken = after.championPortraitOrdinal | 0;
  const decorationAfter = after.decorations[1] | 0;
  console.log(`after the champion is taken: ordinal ${afterTaken}, rear decoration ${decorationAfter}`);
  check(afterTaken === 0, 'a spent mirror shows no portrait');
  check(decorationAfter !== 0, 'but the picture frame is still drawn — it comes from wallGraphicOrdinal');

  // Every shipped hero must be addressable inside the sheet.
  const heroes = shippedHeroes;
  const outOfRange = heroes.filter((h) => h.portraitIndex > 23);
  console.log(`shipped heroes: ${heroes.length}, portrait indices ${Math.min(...heroes.map((h) => h.portraitIndex))}..${Math.max(...heroes.map((h) => h.portraitIndex))}`);
  check(outOfRange.length === 0,
    'no shipped hero needs GetExternalPortraitAddress (all portrait indices are 0..23)');
  check(new Set(heroes.map((h) => h.portraitIndex)).size === heroes.length,
    'and every one of them has a distinct portrait');

  /* ------------------------------------------- facing3 at a mirror not facing 0 ---- */

  // `pcA3->facing3 = (ui8)d.partyFacing` (`doc/CSBwin-src/Character.cpp:532`): the way a
  // hit turns the portrait, and byte 40 of the saved CHARDESC. `ClearMemory` would leave
  // it 0, so only a party facing some other way can tell the two apart.
  const turned = heroes.find((h) => ((h.location.wall + 2) & 3) !== 0);
  check(turned !== undefined, 'some shipped mirror is faced other than north');
  if (turned) {
    const g = makeGame();
    const at = standAtMirror(g, turned);
    g.systems.mouse.handleWallClick();
    const added = g.ctx.party.state.champions[0];
    console.log(`${turned.name}: party facing ${at.facing}, facing3 ${added?.damageFromDirection}`);
    check(added !== undefined && added.damageFromDirection === at.facing,
      `${turned.name}'s facing3 starts as the party's facing, ${at.facing} (Character.cpp:532)`);
  }

  /* --------------------------------------- the candidate's objects on the cursor ---- */

  // `TAG02076e` puts up the arrow, `SetCursorShape(0)` (`doc/CSBwin-src/Character.cpp:5158`),
  // but an object taken from the candidate's inventory goes on the cursor all the same:
  // `HandleClothingClick`'s `ObjectToCursor(objD4, 0)` makes its cursor at once
  // (`CSBCode.cpp:7051`, `:6923-6930`), and putting it back, `RemoveObjectFromHand`, sets
  // the cursor from the hand (`Mouse.cpp:637`, `TAG002572`). The shading stays.
  {
    const g = makeGame();
    const hero = heroByName(g, 'HALK');
    standAtMirror(g, hero);
    const ui = newUIState(sharedGraphics!, g.ctx);
    pairUi = ui;
    g.systems.mouse.handleWallClick();
    const candidate = g.ctx.party.state.champions[0]!;
    const slot = candidate.possessions.findIndex((rn) => rn !== OBJECT_ID_NULL);
    // A point of the viewport, in the zone where the cursor takes its shape from the hand.
    ui.hoverPoint = { x: 100, y: 80 };
    const cursorPixels = (): string => {
      ui.screenIndexBuffer.pixels.fill(0);
      drawCursorItem(ui, false);
      return Array.from(ui.screenIndexBuffer.pixels).join();
    };
    const arrow = cursorPixels();
    const arrowUp = ui.arrowCursorShape;
    handleClothingClick(ui, 8 + slot);
    const held = g.ctx.party.state.objectInHand;
    const withObject = cursorPixels();
    const arrowAfterPick = ui.arrowCursorShape;
    const shadedAfterPick = ui.shadedByTag02076e;
    handleClothingClick(ui, 8 + slot);
    const putBack = g.ctx.party.state.objectInHand === OBJECT_ID_NULL && candidate.possessions[slot] === held;
    const empty = cursorPixels();
    console.log(`HALK's slot ${slot}: arrow after TAG02076e ${arrowUp}; taken ${held !== OBJECT_ID_NULL}, ` +
      `cursor ${withObject === arrow ? 'the arrow' : 'changed'}; put back ${putBack}, cursor ${empty === arrow ? 'the arrow' : 'from the hand'}`);
    check(arrowUp, "TAG02076e's SetCursorShape(0) puts up the arrow (Character.cpp:5158)");
    check(held !== OBJECT_ID_NULL && !arrowAfterPick && withObject !== arrow,
      "an object taken from the candidate's inventory is on the cursor (ObjectToCursor, CSBCode.cpp:7051)");
    check(shadedAfterPick, 'and the movement, magic and weapon-ready areas stay shaded');
    check(putBack && empty !== withObject, 'put back, the cursor is set from the empty hand (RemoveObjectFromHand, TAG002572)');
    g.systems.hallOfChampions.resurrectReincarnateCancel(CANCEL);
    pairUi = null;
  }

  /* ------------------------------------------------ CSB's prison, every mirror ---- */

  // `AddCharacter` reads the title to the *second* line break, its two lines joined
  // (`doc/CSBwin-src/Character.cpp:569-591`). Three of the prison's texts split the title
  // over both lines, so the mirrors are found from their actuators, not from the
  // extractor's list, and each one clicked.
  console.log('');
  console.log("=== CSB's prison: a champion at every mirror ===");
  const prison = makePrisonGame();
  const level0 = prison.ctx.dungeon.getData().maps[0]!;
  const joined: string[] = [];
  let mirrors = 0;
  for (let x = 0; x < level0.descriptor.width; x++) {
    for (let y = 0; y < level0.descriptor.height; y++) {
      const cell = new Position(x, y, 0);
      for (const rn of cellObjects(prison, cell)) {
        const decoded = prison.ctx.dungeon.rnMaps.decode(rn);
        if (decoded.category !== DBType.ACTUATOR) continue;
        const rec = prison.ctx.dungeon.getActuatorRecord(rn);
        if (!rec || getActuatorType(rec) !== 127) continue;
        mirrors++;
        const facing = (decoded.position + 2) & 3;
        const party = prison.ctx.party.state;
        party.position = new Position(x - DELTA_X[facing]!, y - DELTA_Y[facing]!, 0);
        party.facing = facing as Direction;
        prison.systems.mouse.handleWallClick();
        const champ = party.champions[0];
        const line = `(${x},${y}) wall ${decoded.position}: ${champ ? `${champ.name} / ${champ.title}` : 'nobody'}`;
        console.log(`  ${line}`);
        check(party.champions.length === 1, `the mirror at ${line} gives a champion`);
        if (champ) joined.push(`${champ.name} / ${champ.title}`);
        prison.systems.hallOfChampions.resurrectReincarnateCancel(CANCEL);
      }
    }
  }
  check(mirrors === 24, `the prison has 24 mirrors (${mirrors})`);
  check(new Set(joined).size === mirrors, 'and each gives a champion of its own');
  for (const title of ['MANTIA / SPELLWEAVER OF KELT', 'SLOGAR / WEBBER OF ARACHNIA', 'VEN / HIGH PRIEST OF SSHA']) {
    check(joined.includes(title), `${title}: a title on two lines is both, joined`);
  }
}

main();
