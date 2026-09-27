/**
 * `GameHost` — what the engine asks of whoever runs it (`DEBT.md` E1d): the calls that
 * leave the engine. `main.ts` hands one to `Game` with the sound manager, the message
 * area and the renderer behind it; a tool hands the parts it listens to, or nothing.
 *
 * Every member is present: `createGameHost` fills what the host left out with a
 * null object that does nothing (a cursor filter that lets everything through), so no
 * caller asks whether anybody is listening. Headless, nobody is, and the game plays the
 * same.
 */
import type { CursorFilterHook, MessageSink } from './ActuatorSystem';

export interface GameHost {
  /** Play a sample; `QueueSound` and the few direct `StartSound`s end here. */
  playSound(soundId: number, rateIdx?: number, distance?: number): void;
  /** Dev-only trace, CSBWin's `AITraceActive` / `AttackTraceActive` output. */
  trace(line: string): void;
  /** `CursorFilter`, the host's view of the object on the cursor. */
  cursorFilter: CursorFilterHook;
  /**
   * The message area, CSBWin's `PrintLinefeed()` / `QuePrintLines(color, text)`
   * (`doc/CSBWIN_MESSAGES_REFERENCE.md`).
   */
  messages: MessageSink;
  /** `d.PartySleeping` changed: the UI swaps its button lists, the message area its timeout. */
  sleepChanged(sleeping: boolean): void;
  /**
   * Reincarnate raises the name-entry screen, which the engine does not own
   * (`doc/CSBwin-src/CSBCode.cpp:6738`). The screen answers through
   * `Game.reincarnateNamed`; with no screen, Reincarnate stops where CSBWin would be
   * waiting for a name.
   */
  openReincarnateScreen(chIdx: number): void;
  /**
   * A champion's weapon hand changed (`AddCharacterPossession` /
   * `RemoveCharacterPossession`): `if (d.AttackingCharacterOrdinal == chIdx+1)
   * TAG01b1c0();` (`doc/CSBwin-src/Character.cpp:1888-1891`, `:1977-1980`). The attack
   * menu is the UI's.
   */
  closeAttackMenuOf(chIdx: number): void;
  /**
   * `RepackChest` (`doc/CSBwin-src/Character.cpp:3108`): a chest left the weapon hand of
   * the champion whose inventory is open (`:1906-1914`). The open chest is the UI's.
   */
  repackChest(): void;
  /**
   * `TAG02076e` (`doc/CSBwin-src/Character.cpp:5108`): the open chest repacked, the
   * interface shaded and the arrow cursor, all the UI's. `AddCharacter` calls it once the
   * candidate's inventory is shown (`:796-797`).
   */
  tag02076e(): void;
  /**
   * `TAG0207cc` (`doc/CSBwin-src/CSBCode.cpp:9934`), `TAG02076e`'s undoing: `WakeUp` calls it
   * last (`:7061`), and `_ResurrectReincarnateCancel` once the inventory is hidden (`:6657`,
   * `:6808`).
   */
  tag0207cc(): void;
  /**
   * `ShowCredits(1)`, the end of the game, which the engine does not draw: from
   * `_StartCSB` once `MainLoop` has returned on a lost game
   * (`doc/CSBwin-src/CSBCode.cpp:11322-11326`), or from `MainLoop` 300 VBLs after
   * `ProcessTimers` has won it (`:627-633`), with `d.Word11694` set. The loop has stopped
   * by then (`Game.mainLoopHasReturned`).
   */
  showCredits(word11694: boolean): void;
  /**
   * `DrawViewport(d.partyFacing, d.partyX, d.partyY); display();` from a script's tick,
   * `_ProcessTimersViewportAndSound` (`doc/CSBwin-src/Attack.cpp:2205-2206`), which runs
   * none of the main loop's tick listeners.
   */
  drawViewport(): void;
}

/**
 * `host`, with a null object for every member it leaves out or leaves `undefined` (a
 * browser with no audio passes `playSound: undefined`).
 */
export function createGameHost(host: Partial<GameHost> = {}): GameHost {
  return {
    playSound: host.playSound ?? (() => {}),
    trace: host.trace ?? (() => {}),
    cursorFilter: host.cursorFilter ?? (() => true),
    messages: host.messages ?? {
      printLinefeed: () => {},
      quePrintLines: () => {},
      setNewSpeed: () => {},
      resetTime: () => {},
      clockTick: () => {},
      printNextQueued: () => {},
      vblInterrupt: () => {},
    },
    sleepChanged: host.sleepChanged ?? (() => {}),
    openReincarnateScreen: host.openReincarnateScreen ?? (() => {}),
    closeAttackMenuOf: host.closeAttackMenuOf ?? (() => {}),
    repackChest: host.repackChest ?? (() => {}),
    tag02076e: host.tag02076e ?? (() => {}),
    tag0207cc: host.tag0207cc ?? (() => {}),
    showCredits: host.showCredits ?? (() => {}),
    drawViewport: host.drawViewport ?? (() => {}),
  };
}
