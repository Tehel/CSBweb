// The party the CDP probes play with, built the way a player builds one.
//
// Stand at each of the first four preset heroes' mirrors, click the portrait
// (`AddCharacter`) and press Resurrect (button 160). Driving the real Hall of Champions
// needs no scaffolding in the app, only the calls that
// `tools/checks/hall-of-champions.ts` drives headlessly.
//
// HALK first: champion 0 is the one the golden frames open an inventory and an attack
// panel on, and DAROOU (first in mirror order) is empty-handed, which would leave
// `05-attack` showing PUNCH/KICK/WAR CRY instead of a weapon's attack list.
import type { Probe } from '../../src/main.ts';

/**
 * Runs in the page, against `window.__probe` (Debug on), so it closes over nothing: the
 * probes send its source (`BUILD_PARTY`). It returns the champions' names, comma-separated.
 */
export function buildParty({ game, renderView, presetHeroes }: Probe): string {
  const DELTA_X = [0, 1, 0, -1], DELTA_Y = [-1, 0, 1, 0];
  const all = presetHeroes();
  const halk = all.find(h => h.name === 'HALK');
  const heroes = [halk, ...all.filter(h => h !== halk)].filter(h => h !== undefined).slice(0, 4);
  for (const hero of heroes) {
    // Face the mirror from the cell in front of it, as a player walking up would.
    const facing = (hero.location.wall + 2) & 3;
    const party = game.ctx.party.state;
    party.position.x = hero.location.x - DELTA_X[facing];
    party.position.y = hero.location.y - DELTA_Y[facing];
    party.position.z = hero.location.map;
    party.facing = facing;
    game.systems.mouse.handleWallClick();
    game.systems.hallOfChampions.resurrectReincarnateCancel(160);
  }
  renderView();
  return game.ctx.party.state.champions.map(c => c.name).join(',');
}

/** An expression for `Runtime.evaluate`: `buildParty` called on the page's handle. */
export const BUILD_PARTY = `(${buildParty})(window.__probe)`;
