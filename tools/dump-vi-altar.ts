/**
 * The Altar of Vi: bones in, champion out.
 *
 * None of this is visible on a frame, and all of it is timing. `ProcessTT_ViAltar`
 * (`doc/CSBwin-src/Timer.cpp:2709`) is a three-state countdown that reschedules itself,
 * so the resurrection is spread over six ticks and each state must hand the right
 * thing to the next:
 *
 *   - **2** — `CreateCloud(RNffe4)` over the bones, `Time += 5`, drop to state 1.
 *   - **1** — find those exact bones again, resolve which champion they belong to,
 *     refuse if that champion is not dead, destroy the bones, `Time += 1`, drop to
 *     state 0 carrying the champion index in `packedPos`.
 *   - **0** — `BringCharacterToLife(packedPos)`.
 *
 * Resolving the champion has two arms, and this tool drives both, because the
 * difference between them is where the port was wrong. Bones made by a **death** carry
 * an expool record holding the champion's fingerprint, and their `value` is the *kind*
 * of bones — 2, "a dead champion's" (`doc/CSBwin-src/CSB.h:1267`). Bones placed by the
 * **dungeon** carry no record, and there `value` *is* the champion index
 * (`Timer.cpp:2788`, `Mouse.cpp:935`). The port used to have no second arm at all: it
 * guessed, resurrecting the single dead champion if there was exactly one and refusing
 * outright if there were two, and the drop handler rejected any bones whose `value`
 * was not 2 — which is every dungeon-authored bones object aimed at a champion other
 * than index 2.
 *
 * The last case is `BringCharacterToLife`'s corner search (`Character.cpp:805`). A
 * champion is revived into a corner someone living already stands in, and must be
 * moved; the champion themselves is still dead while that is decided, which is why
 * `CharacterAtPosition` skipping the dead (`Code11f52.cpp:4100`) is load-bearing
 * rather than a detail.
 *
 * And the pair has to outlast the game that made it. The record is one of `EXPOOL`'s,
 * database 11, keyed by the bones' RN (`doc/CSBwin-src/data.cpp:1639-1646`), and an RN
 * in a file is a slot of that file's object indirect index. So the last case saves a
 * game with bones on the floor and reads the file's own pool: the record is there, under
 * the bones' slot, and a game that loads the file resurrects from it.
 *
 * Bones whose champion has left the party name and resurrect the one in the wings
 * (`CopyCharacter`, `Timer.cpp:2771-2782`): healed to half their maximum there, and
 * nobody joins. One alive in the wings is refused at the drop, and a timer reads them out
 * of the wings for good.
 *
 * Run: `npm test -- --only=dump-vi-altar.ts`
 */
import { MISC_BONES_OF_HERO } from '../src/core/constants';
import { DBType, OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import type { Champion } from '../src/engine/gameTypes';
import { heldObjectName } from '../src/renderer/ui/Character';
import { getObjectDisplayName, resolveObjectNameIndex } from '../src/renderer/ui/Objects';
import { OBJNI_BONES_A } from '../src/core/objectNameIndex';
import { getActuatorWallGraphicOrdinal } from '../src/data/actuatorHelpers';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { EXPOOL_RECORD_SIZE, Expool } from '../src/data/CsbwinExpool';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { newGame, stockDungeon, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { check, fail, finish } from './lib/check';
import { readCsbwinCharacter, writeCsbwinCharacter } from '../src/data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../src/data/CsbwinSaveInfo';
import { getFromWings, saveToWings } from '../src/engine/Wings';
import { testChampion } from './lib/champion';

/** `EDT_ChampionBones` (`doc/CSBwin-src/CSB.h:1574`). */
const EDT_CHAMPION_BONES = 9;

/** `if (decorationIndex == 2) d.OrnateAlcoveGraphicIndex = D5W` (`Code390e.cpp:218`). */
const ORNATE_ALCOVE_DECORATION = 2;

/** Every champion starts at 200/200, so a `MaxHP/64` cut is visible without rounding. */
function champion(i: number, name: string): Champion {
  return testChampion(i, { name, attributes: { mana: 0, maxMana: 0 } });
}

function makeGame(): { game: Game; graphics: GraphicsLoader } {
  const data = stockDungeon();

  const graphics = stockGraphics();

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.systems.hallOfChampions.addChampion(champion(i, `HERO${i}`));
  return { game, graphics };
}

/** Any ordinary walkable cell — the altar itself is a wall decoration, not a room type. */
function findOpenCell(game: Game): Position {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 1; x < map.descriptor.width - 1; x++) {
      for (let y = 1; y < map.descriptor.height - 1; y++) {
        const flag = map.cellFlags[x]?.[y];
        if (flag === undefined) continue;
        if (((flag >> 5) & 0x7) !== RoomType.OPEN) continue;
        if ((flag & 0x08) !== 0) continue; // keep clear of cells that already hold objects
        return new Position(x, y, z);
      }
    }
  }
  throw new Error('no empty open cell in dungeon.dat');
}

/** A bones object the dungeon might have authored: no expool record, `value` = chIdx. */
function makeDungeonBones(game: Game, chIdx: number, posInCell: number): ObjectID {
  const db = game.ctx.dungeon.getData().databases.misc;
  db.records.push({
    nextObject: OBJECT_ID_EOF,
    specialState: chIdx & 0x3,
    important: true,
    miscType: MISC_BONES_OF_HERO,
  });
  db.count++;
  return game.ctx.dungeon.rnMaps.setPos(game.ctx.dungeon.rnMaps.rn(DBType.MISC, db.records.length - 1), posInCell & 0x3);
}

/**
 * The dungeon's own ornate alcoves — the Altars of Vi.
 *
 * `d.OrnateAlcoveGraphicIndex` is the level's decoration slot whose global decoration
 * index is **2** (`doc/CSBwin-src/Code390e.cpp:218`), and `d.FacingViAltar` is set only
 * while the party is looking straight at one (`doc/CSBwin-src/CSBCode.cpp:3362`). The
 * decoration lives on an actuator inside the *wall* cell, with `pos` naming which face
 * it is on, so the party stands in the neighbouring cell and faces it: a wall object is
 * in front when `(pos - facing) & 3 == 2`, hence `facing = (pos + 2) & 3`.
 *
 * Found by scanning rather than written down, because the shipped dungeon is the
 * authority and a hardcoded (level, x, y) would be a guess.
 */
function findViAltars(game: Game): Array<{ alcove: Position; party: Position; facing: number }> {
  const DELTA = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  const out: Array<{ alcove: Position; party: Position; facing: number }> = [];
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map?.wallDecorationTOC) continue;
    // The decoration ordinal an actuator carries is 1-based into this level's TOC.
    const ornateSlots = new Set(
      map.wallDecorationTOC.flatMap((d, i) => (d === ORNATE_ALCOVE_DECORATION ? [i + 1] : [])),
    );
    if (ornateSlots.size === 0) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const alcove = new Position(x, y, z);
        for (
          let rn = dungeon.findFirstObject(alcove);
          rn !== OBJECT_ID_EOF;
          rn = dungeon.getDBRecordLink(rn)
        ) {
          if (game.ctx.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
          const rec = dungeon.getActuatorRecord(rn);
          if (!rec) continue;
          if (!ornateSlots.has(getActuatorWallGraphicOrdinal(rec) | 0)) continue;
          const facing = (game.ctx.dungeon.rnMaps.pos(rn) + 2) & 0x3;
          const [dx, dy] = DELTA[facing]!;
          out.push({ alcove, party: new Position(x - dx, y - dy, z), facing });
        }
      }
    }
  }
  return out;
}

function bonesAt(game: Game, cell: Position): ObjectID[] {
  const out: ObjectID[] = [];
  for (
    let rn = game.ctx.dungeon.findFirstObject(cell);
    rn !== OBJECT_ID_EOF;
    rn = game.ctx.dungeon.getDBRecordLink(rn)
  ) {
    if (game.ctx.dungeon.rnMaps.dbType(rn) !== DBType.MISC) continue;
    if (game.ctx.dungeon.getMiscRecord(rn)?.miscType === MISC_BONES_OF_HERO) out.push(rn);
    if (out.length > 32) break;
  }
  return out;
}

function cloudsAt(game: Game, cell: Position): number {
  let n = 0;
  for (
    let rn = game.ctx.dungeon.findFirstObject(cell);
    rn !== OBJECT_ID_EOF;
    rn = game.ctx.dungeon.getDBRecordLink(rn)
  ) {
    if (game.ctx.dungeon.rnMaps.dbType(rn) === DBType.CLOUD) n++;
    if (n > 32) break;
  }
  return n;
}

/** Run the clock forward, letting the altar's self-rescheduling timer advance. */
function runTicks(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    game.systems.timer.processTimers();
    game.ctx.state.tickCount++;
  }
}

function main(): void {
  /* ---------------------------------------- 1. bones from a death ---------------- */

  console.log('=== bones left by a death: resolved by fingerprint ===');
  {
    const { game: g } = makeGame();
    const cell = findOpenCell(g);
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);

    const victim = 1;
    const maxHpBefore = g.ctx.party.state.champions[victim]!.attributes.maxHealth;
    g.systems.monsterAttack.killCharacter(victim);

    const bones = bonesAt(g, cell);
    console.log(`HERO${victim} died, leaving ${bones.length} bones object(s) at (${cell.x},${cell.y}) level ${cell.z}`);
    if (bones.length !== 1) {
      fail('the death should leave exactly one bones object');
      finish();
      return;
    }
    const rn = bones[0]!;
    const record = g.ctx.dungeon.getMiscRecord(rn);
    check((record?.specialState ?? 0) === 2, "a death's bones carry value 2, the kind marker");
    check(
      g.ctx.dungeon.copyChampionBonesRecord(rn) === g.ctx.party.state.champions[victim]!.fingerprint,
      "and an expool record holding the champion's fingerprint",
    );

    // Schedule the altar the way a drop into the alcove does.
    g.systems.timer.scheduleViAltar(rn, cell, g.ctx.dungeon.rnMaps.pos(rn) & 0x3, g.ctx.state.tickCount);

    console.log('');
    console.log(['tick', 'clouds in cell', 'bones in cell', `HERO${victim} alive`, 'health', 'maxHealth'].join('\t'));
    const snapshot = (t: number): void => {
      const c = g.ctx.party.state.champions[victim]!;
      console.log([t, cloudsAt(g, cell), bonesAt(g, cell).length, c.attributes.health !== 0, c.attributes.health, c.attributes.maxHealth].join('\t'));
    };
    snapshot(0);

    // State 2 fires on the tick it was scheduled for, the next one, and makes the cloud.
    runTicks(g, 1);
    snapshot(1);
    check(cloudsAt(g, cell) === 1, 'state 2 should put a cloud over the bones — CreateCloud(RNffe4)');
    check(bonesAt(g, cell).length === 1, 'and leave the bones alone for now');
    check(g.ctx.party.state.champions[victim]!.attributes.health === 0, 'and not yet revive anyone');

    // `Time += 5`: state 1 lands five ticks after that one, and consumes the bones
    // without yet reviving anyone — the two halves are a tick apart and must stay so, or
    // a champion could come back while their bones are still on the floor.
    runTicks(g, 5);
    snapshot(6);
    check(bonesAt(g, cell).length === 0, 'state 1 should consume the bones');
    check(g.ctx.party.state.champions[victim]!.attributes.health === 0, 'and still not revive anyone');

    // `Time += 1`: state 0 on the tick after.
    runTicks(g, 1);
    snapshot(7);
    const revived = g.ctx.party.state.champions[victim]!;
    check(revived.attributes.health !== 0, 'state 0 should bring the champion back');

    // `MaxHP = Larger(25, MaxHP - MaxHP/64 - 1)`, then `HP = MaxHP/2`.
    const expectedMax = Math.max(25, maxHpBefore - Math.floor(maxHpBefore / 64) - 1);
    console.log('');
    console.log(['', 'expected', 'actual'].join('\t'));
    console.log(['maxHealth', expectedMax, revived.attributes.maxHealth].join('\t'));
    console.log(['health', Math.floor(expectedMax / 2), revived.attributes.health].join('\t'));
    check(revived.attributes.maxHealth === expectedMax, 'the maximum takes a permanent MaxHP/64 + 1 cut');
    check(revived.attributes.health === Math.floor(expectedMax / 2), 'and the champion comes back at half of it');
    check(revived.facing === g.ctx.party.state.facing, 'facing the way the party faces');
    check(
      g.ctx.dungeon.copyChampionBonesRecord(rn) === null,
      'the expool bones record should be consumed with the bones',
    );
  }

  /* ---------------------------------------- 1b. a fingerprint of 0 --------------- */

  // `expool.AddChampionBonesRecord(objD4, pcA3->fingerPrint)` is unconditional
  // (doc/CSBwin-src/Character.cpp:2651): 0 is a fingerprint like any other — the one
  // `AddCharacter` gives a champion recruited at level 0, (0, 0).
  console.log('');
  console.log('=== a fingerprint of 0 still pairs the bones with the champion ===');
  {
    const { game: g } = makeGame();
    const cell = findOpenCell(g);
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);

    // Not champion 2: a death's bones carry value 2, which unpaired bones would read
    // as a champion index.
    const victim = 1;
    g.ctx.party.state.champions[victim]!.fingerprint = 0;
    g.systems.monsterAttack.killCharacter(victim);
    const bones = bonesAt(g, cell);
    const rn = bones[0];
    const record = rn === undefined ? null : g.ctx.dungeon.copyChampionBonesRecord(rn);
    console.log(`bones: ${bones.length}, expool record: ${record}`);
    check(bones.length === 1 && record === 0, 'the death records fingerprint 0 in the expool');
    if (rn !== undefined) {
      g.systems.timer.scheduleViAltar(rn, cell, g.ctx.dungeon.rnMaps.pos(rn) & 0x3, g.ctx.state.tickCount);
      runTicks(g, 7);
      check(g.ctx.party.state.champions[victim]!.attributes.health !== 0, 'and the altar raises the champion');
    }
  }

  /* ---------------------------------------- 2. bones authored by the dungeon ----- */

  console.log('');
  console.log('=== bones placed by the dungeon: value IS the champion index ===');
  console.log(['bones value', 'champion', 'was dead', 'revived'].join('\t'));
  {
    // Champion 3, deliberately not index 2 — the value the old code demanded.
    const target = 3;
    const { game: g } = makeGame();
    const cell = findOpenCell(g);
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    g.systems.monsterAttack.killCharacter(target);
    // Clear away the bones the death itself left, so only the authored ones are here.
    for (const rn of bonesAt(g, cell)) {
      g.ctx.dungeon.removeObjectFromCell(cell, rn);
    }

    const rn = makeDungeonBones(g, target, 0);
    g.ctx.dungeon.addObjectToCell(cell, rn);
    check(g.ctx.dungeon.copyChampionBonesRecord(rn) === null, 'authored bones have no expool record');

    g.systems.timer.scheduleViAltar(rn, cell, g.ctx.dungeon.rnMaps.pos(rn) & 0x3, g.ctx.state.tickCount);
    runTicks(g, 8);

    const c = g.ctx.party.state.champions[target]!;
    console.log([target, `HERO${target}`, true, c.attributes.health !== 0].join('\t'));
    check(c.attributes.health !== 0, `bones with value ${target} should revive champion ${target}`);
    check(bonesAt(g, cell).length === 0, 'and consume themselves doing it');
  }

  /* ---------------------------------------- 3. the altar refuses the living ------ */

  console.log('');
  console.log('=== the altar refuses a champion who is not dead ===');
  {
    const target = 3;
    const { game: g } = makeGame();
    const cell = findOpenCell(g);
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);

    const rn = makeDungeonBones(g, target, 0);
    g.ctx.dungeon.addObjectToCell(cell, rn);
    g.systems.timer.scheduleViAltar(rn, cell, g.ctx.dungeon.rnMaps.pos(rn) & 0x3, g.ctx.state.tickCount);
    runTicks(g, 8);

    const c = g.ctx.party.state.champions[target]!;
    console.log(`HERO${target} health ${c.attributes.health}, bones still on the floor: ${bonesAt(g, cell).length === 1}`);
    check(c.attributes.health === 200, 'a living champion is untouched');
    check(bonesAt(g, cell).length === 1, 'and the bones stay on the floor');
  }

  /* ---------------------------------------- 3b. refused bones lose their record -- */

  // `ProcessTT_ViAltar` takes the record out of the pool before it looks at the
  // champion (`expool.GetChampionBonesRecord`, a `Read`, `Timer.cpp:2750`), so bones it
  // refuses are left with none, and from then on their `value`, 2, is read as a champion
  // index. No play reaches it today: the drop refuses a living champion's bones, and
  // nothing revives one in the altar's five ticks. So the champion is revived by hand.
  console.log('');
  console.log("=== a death's bones, refused: the record is taken all the same ===");
  {
    const victim = 1;
    const { game: g } = makeGame();
    const cell = findOpenCell(g);
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    g.systems.monsterAttack.killCharacter(victim);
    g.systems.monsterAttack.killCharacter(2);
    const rn = bonesAt(g, cell).find(
      (b) => g.ctx.dungeon.copyChampionBonesRecord(b) === g.ctx.party.state.champions[victim]!.fingerprint,
    );
    if (rn === undefined) {
      fail('the death left no bones paired with the champion');
    } else {
      g.ctx.party.state.champions[victim]!.attributes.health = 50;
      g.systems.timer.scheduleViAltar(rn, cell, g.ctx.dungeon.rnMaps.pos(rn) & 0x3, g.ctx.state.tickCount);
      runTicks(g, 8);
      const record = g.ctx.dungeon.copyChampionBonesRecord(rn);
      console.log(`HERO${victim} health ${g.ctx.party.state.champions[victim]!.attributes.health}, ` +
        `their bones on the floor: ${bonesAt(g, cell).includes(rn)}, record: ${record}`);
      check(g.ctx.party.state.champions[victim]!.attributes.health === 50, 'the living champion is untouched');
      check(bonesAt(g, cell).includes(rn), 'and the bones stay on the floor');
      check(record === null, 'but their record is gone');

      // Offered again, they are bones with no record: `chIndex = DB10A2->value()`.
      g.systems.timer.scheduleViAltar(rn, cell, g.ctx.dungeon.rnMaps.pos(rn) & 0x3, g.ctx.state.tickCount);
      runTicks(g, 8);
      const other = g.ctx.party.state.champions[2]!;
      console.log(`offered again: HERO2 alive ${other.attributes.health !== 0}, the bones on the floor: ${bonesAt(g, cell).includes(rn)}`);
      check(other.attributes.health !== 0, 'offered again, they raise champion 2, the index their value names');
      check(!bonesAt(g, cell).includes(rn), 'and are consumed');
    }
  }

  /* ---------------------------------------- 4. the corner search ----------------- */

  console.log('');
  console.log('=== BringCharacterToLife moves a champion whose corner is taken ===');
  console.log(['champion', 'corner before', 'corner after', 'alive'].join('\t'));
  {
    const target = 1;
    const { game: g } = makeGame();
    const cell = findOpenCell(g);
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    g.systems.monsterAttack.killCharacter(target);

    // While the champion lies dead, a living one takes their corner. CSBWin allows
    // this precisely because `CharacterAtPosition` ignores the dead.
    const squatter = 2;
    g.ctx.party.state.champions[squatter]!.partyPosition = g.ctx.party.state.champions[target]!.partyPosition;
    const cornerBefore = g.ctx.party.state.champions[target]!.partyPosition;

    const rn = bonesAt(g, cell)[0]!;
    g.systems.timer.scheduleViAltar(rn, cell, g.ctx.dungeon.rnMaps.pos(rn) & 0x3, g.ctx.state.tickCount);
    runTicks(g, 8);

    const c = g.ctx.party.state.champions[target]!;
    console.log([`HERO${target}`, cornerBefore, c.partyPosition, c.attributes.health !== 0].join('\t'));
    check(c.attributes.health !== 0, 'the champion still comes back');
    check(c.partyPosition !== cornerBefore, 'but not into the corner the squatter took');
    const occupants = g.ctx.party.state.champions.filter(
      (o) => o.attributes.health !== 0 && o.partyPosition === c.partyPosition,
    ).length;
    check(occupants === 1, 'and the corner they land in holds nobody else living');
  }

  /* ---------------------------------------- 5. the drop into the alcove ---------- */

  console.log('');
  console.log('=== a real Altar of Vi: pick the bones up, drop them in, wait ===');
  {
    const { game: g, graphics } = makeGame();
    const altars = findViAltars(g);
    console.log(['level', 'alcove', 'party stands', 'facing'].join('\t'));
    for (const a of altars) {
      console.log([a.alcove.z, `(${a.alcove.x},${a.alcove.y})`, `(${a.party.x},${a.party.y})`, a.facing].join('\t'));
    }
    check(altars.length > 0, 'the shipped dungeon has at least one ornate alcove');

    // The one the player meets first: a few cells from the stairs down off level 0.
    const altar = altars.find((a) => a.alcove.z === 0) ?? altars[0];
    if (!altar) {
      fail('no Altar of Vi to test against');
    } else {
      const victim = 2;
      g.ctx.party.state.position = altar.party;
      g.ctx.party.state.facing = altar.facing as Champion['facing'] & number;
      g.systems.monsters.loadPartyLevel(altar.party.z);
      g.systems.monsterAttack.killCharacter(victim);

      const bones = bonesAt(g, altar.party)[0];
      if (bones === undefined) {
        fail('the death left no bones to carry');
      } else {
        const ui = newUIState(graphics, g.ctx);
        const nameIndex = resolveObjectNameIndex(ui, bones);

        // The gate that decides whether a click in the alcove is an altar offering at
        // all (`src/renderer/ui/ViewportPicking.ts`, `doc/CSBwin-src/Mouse.cpp:899`).
        // `OBJNI_BONES_A` had been transcribed as decimal 93 out of a hex comment, so
        // this read 147 !== 93 and the altar was never offered anything.
        console.log('');
        console.log(['', 'value'].join('\t'));
        console.log(['name index of the bones', nameIndex].join('\t'));
        console.log(['OBJNI_BONES_A', OBJNI_BONES_A].join('\t'));
        check(nameIndex === OBJNI_BONES_A, "a death's bones are objNI_Bones_a, which is what offers them to the altar");

        // What the player reads. Both places CSBWin prints a bones name put the dead
        // champion's name in front of it, through `DescribeChampionBones`'s "% BONES"
        // (doc/CSBwin-src/Code11f52.cpp:29-60).
        const shown = getObjectDisplayName(ui, bones, nameIndex);
        const inHand = heldObjectName(ui, bones);
        console.log(['name shown for the bones', shown].join('\t'));
        console.log(['name in the hand', inHand].join('\t'));
        check(shown === `HERO${victim} BONES`, "and they are named for their owner, not just 'BONES'");
        check(inHand === `HERO${victim} BONES`, 'the hand names them so too, with the space');

        // Pick them up and drop them in, the way the viewport click does.
        g.ctx.dungeon.removeObjectFromCell(altar.party, bones);
        g.ctx.party.state.objectInHand = bones;
        g.ctx.party.state.cursorOwner = 0;
        const dropped = g.systems.mouse.dropObjectFromCursor(4, { viAltar: true });
        check(dropped, 'the bones go into the alcove');
        check(bonesAt(g, altar.alcove).length === 1, 'and land in the alcove cell, not the party cell');

        console.log('');
        console.log(['tick', 'bones in alcove', `HERO${victim} alive`, 'health'].join('\t'));
        const row = (t: number): void => {
          const c = g.ctx.party.state.champions[victim]!;
          console.log([t, bonesAt(g, altar.alcove).length, c.attributes.health !== 0, c.attributes.health].join('\t'));
        };
        row(0);
        runTicks(g, 8);
        row(8);

        const revived = g.ctx.party.state.champions[victim]!;
        check(revived.attributes.health !== 0, 'and six ticks later the champion is back');
        check(bonesAt(g, altar.alcove).length === 0, 'with the bones consumed');
      }
    }
  }

  /* ---------------------------------------- 6. inert bones are not remains ------- */

  console.log('');
  console.log('=== bones with value 0 dropped into the same alcove ===');
  {
    const { game: g } = makeGame();
    const altar = findViAltars(g).find((a) => a.alcove.z === 0);
    if (!altar) {
      fail('no Altar of Vi on level 0');
    } else {
      g.ctx.party.state.position = altar.party;
      g.ctx.party.state.facing = altar.facing as Champion['facing'] & number;
      g.systems.monsters.loadPartyLevel(altar.party.z);
      g.systems.monsterAttack.killCharacter(1);

      // `if (value != 0)` — bones whose value is 0 are scenery, not anybody's remains
      // (`doc/CSBwin-src/Code11f52.cpp:79`, `doc/CSBwin-src/CSB.h:1261-1267`). The
      // altar's `value`-as-index arm must not read that 0 as "champion 0".
      const inert = makeDungeonBones(g, 0, 0);
      g.ctx.dungeon.getMiscRecord(inert)!.specialState = 0;
      g.ctx.party.state.objectInHand = inert;
      g.ctx.party.state.cursorOwner = 0;
      const dropped = g.systems.mouse.dropObjectFromCursor(4, { viAltar: true });
      check(dropped, 'inert bones still drop into the alcove like any other object');
      runTicks(g, 8);
      const c = g.ctx.party.state.champions[1]!;
      console.log(`HERO1 alive after 8 ticks: ${c.attributes.health !== 0}, bones in alcove: ${bonesAt(g, altar.alcove).length}`);
      check(c.attributes.health === 0, 'but they raise nobody');
      check(bonesAt(g, altar.alcove).length === 1, 'and they stay in the alcove');
    }
  }

  /* ---------------------------------------- 7. through a save and a load --------- */

  console.log('');
  console.log('=== the bones of a death, through a save and a load ===');
  {
    const { game: g } = makeGame();
    const altar = findViAltars(g).find((a) => a.alcove.z === 0);
    if (!altar) {
      fail('no Altar of Vi on level 0');
    } else {
      const victim = 2;
      g.ctx.party.state.position = altar.party;
      g.ctx.party.state.facing = altar.facing as Champion['facing'] & number;
      g.systems.monsters.loadPartyLevel(altar.party.z);

      // A save of the game before the death holds no bones record, and its load takes
      // away the one a game it is loaded into has.
      const noDeath = buildSaveFile(g);
      g.systems.monsterAttack.killCharacter(victim);
      const bones = bonesAt(g, altar.party)[0];
      const fingerprint = g.ctx.party.state.champions[victim]!.fingerprint;
      const file = buildSaveFile(g);

      // What the file holds, read from its own bytes.
      const parsed = loadCsbwinWorld(file);
      const layout = parsed.save.imageLayout;
      const index = parsed.save.objectIndex;
      if (bones === undefined || !layout || !index) {
        fail('the death left no bones, or the file no image');
      } else {
        const start = layout.databases[DBType.EXPOOL]!;
        const blocks = layout.objectCounts[DBType.EXPOOL] ?? 0;
        const filePool = new Expool({
          expool: file.slice(start, start + blocks * EXPOOL_RECORD_SIZE),
          header: { objectCounts: [] },
        });
        const slots = filePool.keys().filter((key) => key >>> 24 === EDT_CHAMPION_BONES).map((key) => key & 0xffff);
        const slot = slots[0] ?? 0;
        const named = slots.length === 1 && slot < index.length
          ? `${index.typeMap[slot] & 15}:${index.indexMap[slot]}` : 'none';
        const rnMaps = g.ctx.dungeon.rnMaps;
        console.log(['', 'value'].join('\t'));
        console.log(['EXPOOL blocks in the file', blocks].join('\t'));
        console.log(["the bones' RN in the game", bones].join('\t'));
        console.log(["the record's key in the file", slot].join('\t'));
        console.log(["which the file's index names (db:idx)", named].join('\t'));
        console.log(["the record, and the champion's fingerprint", `${filePool.copyChampionBonesRecord(slot)}, ${fingerprint}`].join('\t'));
        // The bones' block is the pool's first after the directory, written at the death;
        // the save's overlay palette records fill eight more (`SaveGame.cpp:1216-1231`).
        check(blocks === 10, "the file's EXPOOL: the directory, a block of bones records, and the palette's eight");
        check(slots.length === 1, 'holding one bones record');
        check(slot === bones, "keyed by the bones' RN, a slot of the object index");
        check(named === `${rnMaps.dbType(bones)}:${rnMaps.idx(bones)}`, "which the file's index names as the bones' record");
        check(filePool.copyChampionBonesRecord(slot) === fingerprint, "and the record is the champion's fingerprint");

        const routes: Array<[string, (next: Game) => void]> = [
          ['the save file', (next) => { applyCsbwinSave(next, file); }],
        ];
        console.log('');
        console.log(['loaded from', 'bones records', 'pair', `HERO${victim} alive after the altar`, 'bones records left'].join('\t'));
        for (const [name, load] of routes) {
          // A game with a death of its own, whose record the loaded world does not have.
          const { game: next } = makeGame();
          next.systems.monsterAttack.killCharacter(0);
          load(next);
          const bonesRecords = (): number =>
            new Expool(next.ctx.state.dungeon).keys().filter((key) => key >>> 24 === EDT_CHAMPION_BONES).length;
          const loaded = bonesAt(next, altar.party)[0];
          if (loaded === undefined) {
            fail(`${name}: the bones are not on the floor of the loaded game`);
            continue;
          }
          const recordsLoaded = bonesRecords();
          const pair = next.ctx.dungeon.copyChampionBonesRecord(loaded);
          check(recordsLoaded === 1, `${name}: the loaded game has the file's one bones record`);
          check(pair === fingerprint, `${name}: and it pairs the bones with the champion`);

          next.ctx.dungeon.removeObjectFromCell(altar.party, loaded);
          next.ctx.party.state.objectInHand = loaded;
          next.ctx.party.state.cursorOwner = 0;
          check(next.systems.mouse.dropObjectFromCursor(4, { viAltar: true }), `${name}: the bones go into the alcove`);
          runTicks(next, 8);
          const alive = next.ctx.party.state.champions[victim]!.attributes.health !== 0;
          console.log([name, recordsLoaded, pair, alive, bonesRecords()].join('\t'));
          check(alive, `${name}: and the altar brings the champion back`);
          check(bonesAt(next, altar.alcove).length === 0, `${name}: with the bones consumed`);
          check(bonesRecords() === 0, `${name}: and their record with them`);

          // The same game, taken back to before anyone died.
          applyCsbwinSave(next, noDeath);
          check(bonesRecords() === 0, `${name}: a save with no bones record leaves the game none`);
          check(buildSaveFile(next).length > 0, `${name}: and the game saves again`);
        }
      }
    }
  }

  /* ---------------------------------------- 8. a champion in the wings ----------- */

  console.log('');
  console.log('=== the bones of a champion who has left the party ===');
  {
    // HERO1 dies by the altar, and leaves the party for the wings as `CharacterDelete`
    // would: their record saved, the champions after them a slot down.
    const inWings = (dead: boolean) => {
      const { game: g, graphics } = makeGame();
      const altar = findViAltars(g).find((a) => a.alcove.z === 0)!;
      g.ctx.party.state.position = altar.party;
      g.ctx.party.state.facing = altar.facing as Champion['facing'] & number;
      g.systems.monsters.loadPartyLevel(altar.party.z);
      g.systems.monsterAttack.killCharacter(1);
      const left = g.ctx.party.state.champions[1]!;
      if (!dead) left.attributes.health = 50;
      const record = new Uint8Array(CHARDESC_SIZE);
      writeCsbwinCharacter(record, 0, left);
      saveToWings(g.ctx.dungeon, record);
      g.ctx.party.state.champions.splice(1, 1);
      g.ctx.party.state.cursorOwner = 0;
      return { g, graphics, bones: bonesAt(g, altar.party)[0], altar, fingerprint: left.fingerprint };
    };
    const hp = (g: Game, fingerprint: number): string => {
      const record = getFromWings(g.ctx.dungeon, fingerprint, true);
      return record ? String(readCsbwinCharacter(record, 0).champion.attributes.health) : 'not in the wings';
    };

    const dead = inWings(true);
    if (dead.bones === undefined) {
      fail('the death left no bones');
    } else {
      const { g, graphics, bones, altar, fingerprint } = dead;
      const name = getObjectDisplayName(newUIState(graphics, g.ctx), bones, OBJNI_BONES_A);
      console.log(['name shown for the bones', name].join('\t'));
      check(name === 'HERO1 BONES', 'CopyCharacter names the bones from the wings');

      g.ctx.dungeon.removeObjectFromCell(altar.party, bones);
      g.ctx.party.state.objectInHand = bones;
      check(g.systems.mouse.dropObjectFromCursor(4, { viAltar: true }), 'the bones go into the alcove');
      console.log(['tick', 'bones in alcove', 'HP in the wings', 'champions'].join('\t'));
      const row = (t: number): void => {
        console.log([t, bonesAt(g, altar.alcove).length, hp(g, fingerprint), g.ctx.party.state.champions.length].join('\t'));
      };
      row(0);
      runTicks(g, 8);
      row(8);
      check(hp(g, fingerprint) === '100', 'the champion in the wings is healed to half their maximum, 200');
      check(bonesAt(g, altar.alcove).length === 0, 'and the bones consumed');
      check(g.ctx.party.state.champions.length === 3, 'and nobody joins the party');
    }

    // One alive in the wings: the drop sets no timer, and a timer set all the same
    // reads them out of the wings for good, leaving the bones (`Timer.cpp:2775-2776`).
    const alive = inWings(false);
    if (alive.bones === undefined) {
      fail('the death left no bones');
    } else {
      const { g, bones, altar, fingerprint } = alive;
      g.ctx.dungeon.removeObjectFromCell(altar.party, bones);
      g.ctx.party.state.objectInHand = bones;
      g.systems.mouse.dropObjectFromCursor(4, { viAltar: true });
      runTicks(g, 8);
      console.log(`alive in the wings: dropped, 8 ticks: ${bonesAt(g, altar.alcove).length} bones, HP ${hp(g, fingerprint)}`);
      check(bonesAt(g, altar.alcove).length === 1 && hp(g, fingerprint) === '50', 'the drop sets no timer for the living');
      const placed = bonesAt(g, altar.alcove)[0]!;
      g.ctx.dungeon.addChampionBonesRecord(placed, fingerprint);
      g.systems.timer.scheduleViAltar(placed, altar.alcove, g.ctx.dungeon.rnMaps.pos(placed) & 0x3, g.ctx.state.tickCount);
      runTicks(g, 8);
      console.log(`  a timer set all the same, 8 ticks: ${bonesAt(g, altar.alcove).length} bones, ${hp(g, fingerprint)}`);
      check(bonesAt(g, altar.alcove).length === 1 && hp(g, fingerprint) === 'not in the wings',
        'a timer reads the living out of the wings for good, and leaves the bones');
    }
  }

  finish();
}

main();
