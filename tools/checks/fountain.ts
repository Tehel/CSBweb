/**
 * A click on a water fountain, through button 80 as the mouse queue hands it to the
 * interface (`Mouse.handleMouseButton`).
 *
 * With an object in hand, `HandleClickInViewport` (`doc/CSBwin-src/Mouse.cpp:1181-1231`)
 * tests button 5 of the wall ahead. Off an alcove and facing a fountain, a waterskin is
 * filled (`value(3)`) and an empty flask becomes a water flask; anything else is left as
 * it is. Then, whatever was in hand and whether or not it was filled, `TouchWallF1`
 * (`:1228-1229`): the wall is touched, as it is by a click on any other wall.
 *
 * With an empty hand, button 5 of a wall that is no alcove touches the wall
 * (`:1124-1129`), fountain or not. With the extras on (`DEBT.md` X), the cursor owner
 * drinks there first: 800 water, a full waterskin's gulp, capped as any drink is, and the
 * swallow queued. A dead cursor owner drinks nothing, and with the extras off nobody does.
 *
 * The view is staged by hand, as in `checks/viewport-click.ts`: what is under test is the
 * dispatch, not the renderer that sets `d.FacingWaterFountain`. The objects are real
 * records of `dungeon.dat`: its first empty flask and its first waterskin.
 *
 * Run: `npm test -- --only=fountain.ts`
 */
import { PotionType } from '../../src/core/constants';
import { OBJNI_WATERSKIN } from '../../src/core/objectNameIndex';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../../src/core/types';
import type { RectPos } from '../../src/data/tables/UITables';
import type { Game } from '../../src/engine/Game';
import { handleMouseButton } from '../../src/renderer/ui/Mouse';
import { resolveObjectNameIndex } from '../../src/renderer/ui/Objects';
import type { UIState } from '../../src/renderer/ui/UIState';
import { VIEWPORT_Y } from '../../src/renderer/ViewportGraphics';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';
import { stockGame, stockGraphics } from '../lib/game';
import { wrapMember } from '../lib/standIn';
import { newUIState } from '../lib/ui';
import { NO_EXTRAS } from '../../src/engine/GameContext';

const BUTTON_5: RectPos = { x1: 64, x2: 159, y1: 36, y2: 91 };
const UNSET: RectPos = { x1: 255, x2: 0, y1: 0, y2: 0 };
const CLICK_X = (BUTTON_5.x1 + BUTTON_5.x2) >> 1;
const CLICK_Y = ((BUTTON_5.y1 + BUTTON_5.y2) >> 1) + VIEWPORT_Y;

interface Scene {
  game: Game;
  ui: UIState;
  /** How many times `TouchWallF1` ran. */
  wallTouches: number;
  /** Every sound queued, by ordinal. */
  sounds: number[];
}

/** A party of one before a stone wall whose button 5 is drawn, a fountain or not. */
function scene(fountain: boolean): Scene {
  const game = stockGame();
  game.systems.hallOfChampions.addChampion(testChampion(0));
  const party = game.ctx.party.state;
  party.position = new Position(6, 14, 2);
  party.cursorOwner = 0;
  party.objectInHand = OBJECT_ID_NULL;
  const ui = newUIState(stockGraphics(), game.ctx);
  Object.assign(ui.picking, {
    facingAlcove: false,
    facingWaterFountain: fountain,
    doorSwitchRects: [],
    viewportObjectButtons: [UNSET, UNSET, UNSET, UNSET, UNSET, BUTTON_5].map((b) => ({ ...b })),
    viewportObjectRNs: [OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF],
    cellTypeJustAhead: RoomType.STONE,
  });
  const s: Scene = { game, ui, wallTouches: 0, sounds: [] };
  wrapMember(game.systems.mouse, 'handleWallClick', (original) => () => { s.wallTouches++; return original(); });
  wrapMember(game.ctx.sounds, 'queueSound', (original) => (ordinal, ...rest) => { s.sounds.push(ordinal); original(ordinal, ...rest); });
  return s;
}

function click(s: Scene): void {
  handleMouseButton(s.ui, 80, CLICK_X, CLICK_Y);
}

/** The first record of `db` that `pick` accepts, as an RN. */
function firstOf(game: Game, db: DBType, count: number, pick: (rn: ObjectID) => boolean): ObjectID {
  for (let i = 0; i < count; i++) {
    const rn = game.ctx.dungeon.rnMaps.rn(db, i);
    if (pick(rn)) return rn;
  }
  throw new Error(`no such record in database ${db}`);
}

function emptyFlask(s: Scene): ObjectID {
  const potions = s.game.ctx.dungeon.getData().databases.potions.records;
  return firstOf(s.game, DBType.POTION, potions.length, (rn) => s.game.ctx.dungeon.getPotionRecord(rn)?.potionType === PotionType.EMPTY_FLASK);
}

function waterskin(s: Scene): ObjectID {
  const misc = s.game.ctx.dungeon.getData().databases.misc.records;
  return firstOf(s.game, DBType.MISC, misc.length, (rn) => resolveObjectNameIndex(s.ui, rn) === OBJNI_WATERSKIN);
}

function main(): void {
  console.log(['in hand', 'fountain', 'after', 'wall touched'].join('\t'));

  {
    const s = scene(true);
    const rn = emptyFlask(s);
    s.game.ctx.party.state.objectInHand = rn;
    click(s);
    const type = s.game.ctx.dungeon.getPotionRecord(rn)!.potionType;
    console.log(['empty flask', true, `potion type ${type}`, s.wallTouches].join('\t'));
    check(type === PotionType.WATER_FLASK, 'an empty flask held to a fountain becomes a water flask');
    check(s.wallTouches === 1, 'and the wall is touched after the fill (TouchWallF1, Mouse.cpp:1228-1229)');
  }
  {
    const s = scene(true);
    const rn = waterskin(s);
    const misc = s.game.ctx.dungeon.getMiscRecord(rn)!;
    misc.specialState = 0;
    s.game.ctx.party.state.objectInHand = rn;
    click(s);
    console.log(['empty waterskin', true, `value ${misc.specialState}`, s.wallTouches].join('\t'));
    check(misc.specialState === 3, 'an empty waterskin is filled to 3');
    check(s.wallTouches === 1, 'and the wall is touched after the fill');
  }
  {
    const s = scene(false);
    const rn = emptyFlask(s);
    s.game.ctx.party.state.objectInHand = rn;
    click(s);
    const type = s.game.ctx.dungeon.getPotionRecord(rn)!.potionType;
    console.log(['empty flask', false, `potion type ${type}`, s.wallTouches].join('\t'));
    check(type === PotionType.EMPTY_FLASK, 'another wall fills nothing');
    check(s.wallTouches === 1, 'and is touched');
  }

  /* ------------------------------------------- an empty hand: the extra ---- */

  console.log('');
  console.log(['extras', 'fountain', 'owner health', 'water before', 'after', 'sounds', 'wall touched'].join('\t'));
  const drink = (extras: boolean, fountain: boolean, water: number, health = 200): Scene & { after: number } => {
    const s = scene(fountain);
    s.ui.ctx.extras = { ...NO_EXTRAS, drinkAtFountain: extras };
    const champ = s.game.ctx.party.state.champions[0]!;
    champ.water = water;
    champ.attributes.health = health;
    click(s);
    console.log([extras, fountain, health, water, champ.water, s.sounds.join(' ') || '-', s.wallTouches].join('\t'));
    return { ...s, after: champ.water };
  };
  const SOUND_GULP = 8;
  {
    const s = drink(false, true, 1000);
    check(s.after === 1000 && s.sounds.length === 0, 'extras off: an empty hand drinks nothing (CSBWin)');
    check(s.wallTouches === 1, 'extras off: the wall is touched');
  }
  {
    const s = drink(true, true, 1000);
    check(s.after === 1800, "extras on: the cursor owner drinks a full waterskin's gulp, 800");
    check(s.sounds.length === 1 && s.sounds[0] === SOUND_GULP, 'extras on: the swallow is queued');
    check(s.wallTouches === 1, 'extras on: and the wall is touched after');
  }
  {
    const s = drink(true, true, 1900);
    check(s.after === 2048, "extras on: the drink is capped at 2048, as every drink's water is");
  }
  {
    const s = drink(true, true, 1000, 0);
    check(s.after === 1000 && s.sounds.length === 0, 'extras on: a dead cursor owner drinks nothing');
    check(s.wallTouches === 1, 'extras on: the wall is still touched');
  }
  {
    const s = drink(true, false, 1000);
    check(s.after === 1000 && s.sounds.length === 0, 'extras on: another wall gives nothing to drink');
  }

  finish();
}

main();
