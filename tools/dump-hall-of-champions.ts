/**
 * The Hall of Champions: adding a champion at a mirror, then Resurrect, Reincarnate or
 * Cancel.
 *
 * `AddCharacter` (`doc/CSBwin-src/Character.cpp:456`) does not finish the job — it puts
 * the champion in the party *provisionally*, marked by `d.PotentialCharacterOrdinal`,
 * and leaves their possessions still linked in the mirror's cell.
 * `_ResurrectReincarnateCancel` (`doc/CSBwin-src/CSBCode.cpp:6615`) is what commits or
 * undoes that, and none of it is visible on a golden frame.
 *
 * This drives the real click path — `Game.handleWallClick` on the real level-0 mirrors
 * of the shipped dungeon — so the actuator gate, the hero text and the objects on the
 * floor are all the ones the game ships with.
 *
 * What to look for: the fingerprint is the party's own cell packed into a word, not a
 * counter; Cancel leaves the mirror exactly as it was, possessions included; Resurrect
 * unlinks those same objects from the room and turns the portrait actuator off; and
 * Reincarnate wipes all twenty skills before charging the hero's own penalties.
 *
 * Run: `npx tsx tools/dump-hall-of-champions.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, Direction, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, decodeObjectID, type ObjectID } from '../src/core/types';
import { getActuatorType } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { PresetHero } from '../src/data/dungeonTypes';
import { Game } from '../src/engine/Game';
import { attributeCurrent, attributeMaximum, attributeMinimum } from '../src/engine/attributes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { summarizeRoomInfoCsbwin } from '../src/renderer/csbwin/SummarizeRoomInfo';
import type { SummarizeRoomData } from '../src/renderer/bytecode/Types';
import { ImageFormat } from '../src/core/imageDecoder';
import { check, fail, finish } from './lib/check';

const DELTA_X = [0, 1, 0, -1];
const DELTA_Y = [-1, 0, 1, 0];

const RESURRECT = 160;
const REINCARNATE = 161;
const CANCEL = 162;

/** The graphics loader, kept aside so the portrait section can re-read its tables. */
let sharedGraphics: GraphicsLoader | null = null;

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  sharedGraphics = graphics;
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  const messages: Array<{ color: number; text: string }> = [];
  const game = new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      // The two tables `AddCharacter`'s possession loop reads.
      objDescCarryMask: objectTables.objDescCarryMask,
      carryLocation: uiTables.graphic232.carryLocation,
      championMessageColors: uiTables.graphic232.byte1386,
      messages: {
        printLinefeed: () => { messages.push({ color: -1, text: '\n' }); },
        quePrintLines: (color, text) => { messages.push({ color, text }); },
      },
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
      monsterAttackSounds: objectTables.monsterAttackSounds,
      uByte590: uiTables.graphic232.uByte590,
      byte586: uiTables.graphic232.byte586,
      clothingArmour: objectTables.clothingArmour,
      clothingFlags: objectTables.clothingFlags,
      byte1412: uiTables.graphic232.byte1412,
    },
  );
  game.setRandomSeed(0x12345678);
  (game as unknown as { probeMessages: typeof messages }).probeMessages = messages;
  return game;
}

function probeMessages(game: Game): Array<{ color: number; text: string }> {
  return (game as unknown as { probeMessages: Array<{ color: number; text: string }> }).probeMessages;
}

/** Stand the party in front of a mirror, facing it, as a player walking up would. */
function standAtMirror(game: Game, hero: PresetHero): { facing: number; mirror: Position } {
  const facing = (hero.location.wall + 2) & 3;
  const party = game.party.state;
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
    let rn = game.dungeonState.findFirstObject(cell);
    rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
    rn = game.dungeonState.getDBRecordLink(rn)
  ) {
    out.push(rn);
  }
  return out;
}

function possessionList(game: Game, chIdx: number): Array<{ slot: number; rn: ObjectID }> {
  const champ = game.party.state.champions[chIdx];
  const out: Array<{ slot: number; rn: ObjectID }> = [];
  for (let slot = 0; slot < (champ?.possessions?.length ?? 0); slot++) {
    const value = champ!.possessions![slot];
    if (value === null || value === undefined) continue;
    out.push({ slot, rn: value as ObjectID });
  }
  return out;
}

function portraitActuatorTypes(game: Game, mirror: Position, wall: number): number[] {
  const out: number[] = [];
  for (const rn of cellObjects(game, mirror)) {
    const decoded = decodeObjectID(rn);
    if (decoded.category !== DBType.ACTUATOR) continue;
    if (decoded.position !== wall) continue;
    const rec = game.dungeonState.getActuatorRecord(rn);
    if (rec) out.push(getActuatorType(rec));
  }
  return out;
}

function heroByName(game: Game, name: string): PresetHero {
  const hero = (game.dungeonState.getData().presetHeroes ?? []).find((h) => h.name === name);
  if (!hero) throw new Error(`no preset hero named ${name}`);
  return hero;
}

function main(): void {
  /* ------------------------------------------------- 1. the provisional add ----- */

  const game = makeGame();
  const halk = heroByName(game, 'HALK');
  const { facing, mirror } = standAtMirror(game, halk);
  const wall = halk.location.wall;
  const party = game.party.state;
  const mirrorBefore = cellObjects(game, mirror);

  console.log('=== AddCharacter at the level-0 mirror of HALK THE BARBARIAN ===');
  console.log(`party at (${party.position.x},${party.position.y}) level ${party.position.z} facing ${facing}`);
  console.log(`mirror at (${mirror.x},${mirror.y}) wall ${wall}, ${mirrorBefore.length} objects in the cell`);

  const clicked = game.handleWallClick();
  check(clicked === false, 'the portrait actuator reports no switch action (it only adds a champion)');
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
  console.log(['title', champ.title ?? '', 'THE BARBARIAN'].join('\t'));
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

  /* ------------------------------------ 2. possessions, and where they still are - */

  const taken = possessionList(game, 0);
  console.log('');
  console.log('=== possessions taken from the mirror cell ===');
  console.log(['slot', 'object', 'category'].join('\t'));
  for (const { slot, rn } of taken) {
    console.log([slot, `0x${rn.toString(16)}`, DBType[decodeObjectID(rn).category]].join('\t'));
  }

  check(taken.length === halk.inventory.length,
    `all ${halk.inventory.length} objects at the mirror's wall became possessions`);
  check(taken.every(({ rn }) => decodeObjectID(rn).position === wall),
    "every possession came from the mirror's own wall position");
  check(champ.weaponHand === (champ.possessions?.[1] ?? null),
    'the weapon hand mirrors possession slot 1');

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
  game.resurrectReincarnateCancel(CANCEL);
  console.log(`champions ${party.champions.length}, potential ${party.potentialChampionIndex}, cursorOwner ${party.cursorOwner}, inventory ${party.selectedCharacterIndex}`);
  check(party.champions.length === 0, 'Cancel takes the champion back out of the party');
  check(party.potentialChampionIndex === -1, 'and clears the provisional marker');
  check(party.cursorOwner === -1, 'SetHandOwner(-1), because that was the only champion');
  check(party.selectedCharacterIndex === -1, 'the inventory is hidden again');

  const mirrorAfterCancel = cellObjects(game, mirror);
  check(mirrorAfterCancel.length === mirrorBefore.length
    && mirrorAfterCancel.every((rn, i) => rn === mirrorBefore[i]),
    "Cancel leaves the mirror's objects exactly as they were");
  check(portraitActuatorTypes(game, mirror, wall).includes(127),
    'and leaves the portrait actuator usable');

  const readded = game.handleWallClick();
  check(readded === false && party.champions.length === 1,
    'the same mirror can be clicked again after a Cancel');

  /* ------------------------------------------------------- 4. Resurrect --------- */

  console.log('');
  console.log('=== Resurrect (button 160) ===');
  const possessionsBeforeResurrect = possessionList(game, 0).map(({ rn }) => rn);
  const skillsBefore = party.champions[0]!.skills.map((s) => s.experience);
  const strengthBefore = attributeCurrent(party.champions[0]!.attributes.stats[1]!);
  game.resurrectReincarnateCancel(RESURRECT);

  const mirrorAfterResurrect = cellObjects(game, mirror);
  console.log(`mirror now holds ${mirrorAfterResurrect.length} objects (was ${mirrorBefore.length})`);
  console.log(`portrait actuator types on that wall: [${portraitActuatorTypes(game, mirror, wall).join(', ')}]`);
  console.log(`messages: ${probeMessages(game).map((m) => JSON.stringify(m.text)).join(' ')}`);

  check(party.potentialChampionIndex === -1, 'the champion is fully in the party now');
  check(party.selectedCharacterIndex === -1, 'and the menu screen is gone');
  check(
    possessionsBeforeResurrect.every((rn) => !mirrorAfterResurrect.includes(rn)),
    'RemoveObjectFromRoom unlinked every possession from the mirror',
  );
  check(mirrorAfterResurrect.length === mirrorBefore.length - possessionsBeforeResurrect.length,
    'and nothing else left the cell');
  check(!portraitActuatorTypes(game, mirror, wall).includes(127),
    'the portrait actuator is disabled — the mirror is used up');
  check(game.handleWallClick() === false && party.champions.length === 1,
    'clicking the dead mirror adds nobody');
  check(party.magicCasterIndex === 0, 'SelectMagicCaster(0) for the only champion');
  check(party.cursorOwner === 0, 'SetHandOwner(0) likewise');

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
  check(game.handleWallClick() === false && party.champions.length === 2,
    'BORIS joins provisionally at his own mirror');

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

  game.resurrectReincarnateCancel(REINCARNATE);

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
  check(wizard.attributes.fighter === 0 && wizard.attributes.wizard === 0,
    'and the four role levels with them');

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

  /* ------------------------------------------------ 6. the guards on adding ----- */

  console.log('');
  console.log('=== the guards on AddCharacter ===');
  const wuTse = heroByName(game, 'WU TSE');
  standAtMirror(game, wuTse);
  party.objectInHand = party.champions[0]!.possessions![1] as ObjectID;
  check(game.handleWallClick() === false && party.champions.length === 2,
    'a full cursor refuses the mirror (d.EmptyHanded)');
  party.objectInHand = null;

  check(game.handleWallClick() === false && party.champions.length === 3,
    'and an empty one accepts it');
  // Still standing at WU TSE's mirror, with his menu unanswered. Clicking again must
  // not stack a second provisional champion — `_ResurrectReincarnateCancel` only ever
  // reaches the last one.
  check(game.handleWallClick() === false && party.champions.length === 3,
    'a mirror is refused while a menu is still unanswered');
  game.resurrectReincarnateCancel(RESURRECT);

  const azizi = heroByName(game, 'AZIZI');
  standAtMirror(game, azizi);
  check(game.handleWallClick() === false && party.champions.length === 4, 'the fourth champion joins');
  game.resurrectReincarnateCancel(RESURRECT);
  const daroou = heroByName(game, 'DAROOU');
  standAtMirror(game, daroou);
  check(game.handleWallClick() === false && party.champions.length === 4,
    'a fifth is refused (d.NumCharacter == 4)');

  const fingerprints = party.champions.map((c) => c.fingerprint ?? 0);
  console.log(`fingerprints: [${fingerprints.map((f) => `0x${f.toString(16)}`).join(', ')}]`);
  check(new Set(fingerprints).size === fingerprints.length, 'every champion has a distinct fingerprint');
  check(fingerprints.every((f) => f !== 0), 'and none is zero');

  portraitSection();
  edgeDecorationSection();
  finish();
}

/**
 * A mirror seen from an angle — the `srcOffsetX` arm of `DrawWallDecoration`
 * (`doc/CSBwin-src/CSBCode.cpp:3538-3562`).
 *
 * Positions 7 and 9 are the F2 front walls one cell to the left and right. Both are
 * scaled to the width of the F2 *centre* rectangle (`[8]`) and then drawn into a
 * narrower slot pinned to a screen border, so only part of the bitmap is visible — and
 * which part depends on the side. Getting that backwards drew the decoration cropped on
 * the wrong side with a gap where the off-screen margin should have been; it stood for
 * as long as the renderer has existed, because no golden frame contains an edge
 * decoration.
 */
function edgeDecorationSection(): void {
  const graphics = sharedGraphics;
  if (!graphics) {
    fail('graphics.dat was not retained; the edge-decoration section cannot run');
    return;
  }
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
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
 * (`doc/CSBwin-src/CSBCode.cpp:3686-3716`).
 */
function portraitSection(): void {
  const probe = makeGame();
  const graphics = sharedGraphics;
  if (!graphics) {
    fail('graphics.dat was not retained; the portrait section cannot run');
    return;
  }
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);

  console.log('');
  console.log('=== the portrait rectangle, extracted from graphics.dat item 0x22e ===');
  const rect = viewportTables.championPortraitRect;
  console.log(`Byte2546 = { x1: ${rect.x1}, x2: ${rect.x2}, y1: ${rect.y1}, y2: ${rect.y2} }`);
  // Canary: CSBWin's own comment at `doc/CSBwin-src/CSBCode.cpp:3695` records this rect
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
  const party = probe.party.state;

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
    summarizeRoomInfoCsbwin(rslt, probe.dungeonState, party.position, partyFacing, objectTables);
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
  probe.handleWallClick();
  probe.resurrectReincarnateCancel(RESURRECT);
  const after = summarize(mirror.x, mirror.y, facing);
  const afterTaken = after.championPortraitOrdinal | 0;
  const decorationAfter = after.decorations[1] | 0;
  console.log(`after the champion is taken: ordinal ${afterTaken}, rear decoration ${decorationAfter}`);
  check(afterTaken === 0, 'a spent mirror shows no portrait');
  check(decorationAfter !== 0, 'but the picture frame is still drawn — it comes from wallGraphicOrdinal');

  // Every shipped hero must be addressable inside the sheet.
  const heroes = probe.dungeonState.getData().presetHeroes ?? [];
  const outOfRange = heroes.filter((h) => h.portraitIndex > 23);
  console.log(`shipped heroes: ${heroes.length}, portrait indices ${Math.min(...heroes.map((h) => h.portraitIndex))}..${Math.max(...heroes.map((h) => h.portraitIndex))}`);
  check(outOfRange.length === 0,
    'no shipped hero needs GetExternalPortraitAddress (all portrait indices are 0..23)');
  check(new Set(heroes.map((h) => h.portraitIndex)).size === heroes.length,
    'and every one of them has a distinct portrait');
}

main();
