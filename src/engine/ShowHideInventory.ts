/**
 * `ShowHideInventory` (`doc/CSBwin-src/CSBCode.cpp:7478`), and the pair that puts the
 * interface aside around a modal screen and brings it back, `TAG02076e`
 * (`doc/CSBwin-src/Character.cpp:5133`) and `TAG0207cc` (`CSBCode.cpp:10058`): their `d.`
 * work, the inventory opened or closed, the chest repacked or opened, the magic caster
 * selected again; and `KillCharacter`'s release of the eye or the mouth before its
 * `ShowHideInventory(4)`. What they draw is the screen's, which the host is asked for under
 * the same names (`GameHost.showHideInventory`, `tag02076e`, `tag0207cc`,
 * `releaseEyeOrMouth`).
 */
import { isAlive } from './rules';
import { drawLegalAttackTypes } from './AttackMenu';
import type { GameContext } from './GameContext';
import { setClockTick, waitForButtonFlash } from './LoopState';
import { repackChest, tag0189d4 } from './OpenChest';
import { getPartyChampion, selectMagicCaster } from './Party';

/**
 * `ShowHideInventory(chIdx)` (`doc/CSBwin-src/CSBCode.cpp:7478-7582`), 4 to hide: a dead
 * champion's inventory is not shown, and neither is any with the eye or the mouth held
 * (`:7491-7500`); then `d.clockTick = 1`. An open inventory is closed, `videoMode =
 * VM_ADVENTURE` (`:7512`) and its chest repacked (`:7513-7518`); a champion's own, asked
 * again, stays closed (`:7505-7508`). Otherwise the champion's opens, `VM_INVENTORY`
 * (`:7546`), and `DrawCharacterState`'s `CHARFLAG_chestOrScroll` runs `TAG0189d4`
 * (`:7563-7573`). The screen draws it (`GameHost.showHideInventory`), and
 * `DiscardAllInput()` follows, once the inventory's or the adventure's list is set
 * (`:7539`, `:7579`): a key or a click queued behind the portrait is lost. A sleeping
 * party returns before it (`:7527-7531`).
 */
export function showHideInventory(ctx: GameContext, chIdx: number): void {
  const party = ctx.party.state;
  if (chIdx !== 4) {
    if (chIdx < 0 || chIdx > 3) return;
    const champ = getPartyChampion(party, chIdx);
    if (!champ || !isAlive(champ)) return;
  }
  if (ctx.interface.pressingMouth) return;
  if (ctx.interface.pressingEye) return;
  setClockTick(ctx, 1);
  if (party.selectedCharacterIndex >= 0) ctx.loop.videoMode = 'VM_ADVENTURE';
  if (chIdx === 4) {
    repackChest(ctx);
    party.selectedCharacterIndex = -1;
    ctx.host.showHideInventory(chIdx);
    if (!party.sleeping) ctx.mouseQueue.discardAllInput();
    return;
  }
  const previous = party.selectedCharacterIndex;
  party.selectedCharacterIndex = previous === chIdx ? -1 : chIdx;
  if (previous >= 0) repackChest(ctx);
  if (party.selectedCharacterIndex >= 0) {
    ctx.loop.videoMode = 'VM_INVENTORY';
    tag0189d4(ctx);
  }
  ctx.host.showHideInventory(chIdx);
  ctx.mouseQueue.discardAllInput();
}

/**
 * `TAG02076e` (`doc/CSBwin-src/Character.cpp:5133-5160`), before the disk menu goes up
 * (`SaveGame.cpp:877`), at the freeze (`Mouse.cpp:1875`), on the way to sleep (`:1830`),
 * as the Hint Oracle opens, and once a Hall of Champions candidate's inventory is shown
 * (`Character.cpp:798`). The main loop's call, with `TAG0207cc`, is dead in CSBWin
 * (`doc/PROVEN_FACTS.md` → "`d.Word11722` is always zero"). Asleep, it does nothing
 * (`:5136`); otherwise `WaitForButtonFlash` (`:5138`), and an open inventory showing a
 * chest (`d.DisplayResurrectChestOrScroll == 4`) has it repacked (`:5141-5150`), so the
 * save finds the chest's objects in the chest. The shading and `SetCursorShape(0)`
 * (`:5151-5158`) are the screen's (`GameHost.tag02076e`).
 */
export function tag02076e(ctx: GameContext): void {
  const party = ctx.party.state;
  if (party.sleeping) return;
  waitForButtonFlash(ctx);
  if (party.selectedCharacterIndex >= 0 && ctx.interface.displayResurrectChestOrScroll === 4) repackChest(ctx);
  ctx.host.tag02076e();
}

/**
 * `TAG0207cc` (`doc/CSBwin-src/CSBCode.cpp:10058-10092`), once the disk menu has gone
 * (`SaveGame.cpp:1375`), at the thaw (`Mouse.cpp:1904`), as the Hint Oracle closes, from
 * `WakeUp` (`CSBCode.cpp:7120`) and from `_ResurrectReincarnateCancel` (`:6716`,
 * `:6867`). Asleep, it only redraws the sleep screen (`:10062-10066`), which the screen
 * draws whenever it composes. Otherwise the magic caster is selected again, which a dead
 * one does not survive (`:10069-10071`); the attack buttons come back unless an attack
 * menu is open (`d.Word20252 = 1`, `:10072-10075`), and `DrawLegalAttackTypes` (`:10076`);
 * `TAG002572`'s cursor (`:10089`) is the screen's (`GameHost.tag0207cc`), which nothing
 * after it reads; and an open inventory is shut without a repack and shown again
 * through `ShowHideInventory` (`:10077-10082`), whose `TAG0189d4` opens the chest again.
 * `d.Word11750 = 0` is the dead countdown in `DEBT.md` H.
 */
export function tag0207cc(ctx: GameContext): void {
  const party = ctx.party.state;
  if (party.sleeping) return;
  const caster = party.magicCasterIndex;
  party.magicCasterIndex = -1;
  selectMagicCaster(party, caster);
  if (ctx.interface.attackingCharacterOrdinal === 0) ctx.interface.word20252 = 1;
  drawLegalAttackTypes(ctx);
  ctx.host.tag0207cc();
  const selected = party.selectedCharacterIndex;
  if (selected >= 0) {
    party.selectedCharacterIndex = -1;
    ctx.loop.videoMode = 'VM_ADVENTURE';
    showHideInventory(ctx, selected);
  }
}

/**
 * `KillCharacter`'s release of a held eye, or else a held mouth, before it hides the
 * dead champion's inventory (`doc/CSBwin-src/Character.cpp:2603-2625`), so that
 * `ShowHideInventory(4)` does not return on it; `RemoveCharacter` has the same
 * (`:5292-5314`). The pointer shown again is the screen's (`GameHost.releaseEyeOrMouth`).
 * No `TAG0189d4`: the inventory is closing.
 */
export function releaseEyeOrMouth(ctx: GameContext): void {
  if (ctx.interface.pressingEye) {
    ctx.interface.pressingEye = false;
    ctx.host.releaseEyeOrMouth(true);
  } else if (ctx.interface.pressingMouth) {
    ctx.interface.pressingMouth = false;
    ctx.host.releaseEyeOrMouth(false);
  }
}
