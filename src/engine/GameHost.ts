/**
 * `GameHost` — what the engine asks of whoever runs it (`DEBT.md` E1d): the calls that
 * leave the engine. `main.ts` hands one to `Game` with the sound manager, the message
 * area and the renderer behind it; a tool hands the parts it listens to, or nothing.
 *
 * Every member is present: `createGameHost` fills what the host left out with a
 * null object that does nothing (a cursor filter that lets everything through; a `die`
 * that throws again), so no caller asks whether anybody is listening. Headless, nobody is, and the game plays the
 * same.
 */
import type { ObjectID } from '../core/types';

export enum CursorFilterType {
  TakeKey = 'TakeKey',
  TakeFromTorchHolder = 'TakeFromTorchHolder',
  PlaceInTorchHolder = 'PlaceInTorchHolder',
  SwapRemove = 'SwapRemove',
  SwapReplace = 'SwapReplace',
  GiftFromGod = 'GiftFromGod',
}

export interface CursorFilterPacket {
  type: CursorFilterType;
  object: ObjectID;
  level: number;
  x: number;
  y: number;
  pos: number;
}

export type CursorFilterHook = (packet: CursorFilterPacket) => boolean;

/**
 * Fragment-based message emitter, mirroring CSBWin's global `PrintLinefeed()` /
 * `QuePrintLines(color, text)` pair (`doc/CSBwin-src/CSBCode.cpp:1654`, `:1744`).
 *
 * Messages are composed from FRAGMENTS that flow onto one logical line and get word-wrapped
 * by the message area — never from pre-split strings containing newlines.
 * See `doc/CSBWIN_MESSAGES_REFERENCE.md`.
 *
 * Injected rather than imported as a global so the engine stays independent of the renderer.
 */
export interface MessageSink {
  printLinefeed(): void;
  quePrintLines(color: number, text: string): void;
  /** `PrintLines`, straight onto the strip rather than through `printQueue`, with `d.Time`. */
  printLines(color: number, text: string, time: number): void;
  /** `scrollingText.SetNewSpeed(oldSpeed, newSpeed)`, with `d.Time`. */
  setNewSpeed(oldSpeed: number, newSpeed: number, time: number): void;
  /** `scrollingText.ResetTime(newTime)`, with `d.Time`. */
  resetTime(newTime: number, time: number): void;
  /** `scrollingText.ClockTick()`, the tick's own, with `d.Time`. */
  clockTick(time: number): void;
  /** `tag0007c8`: the main loop's one `printQueue` entry a pass, with `d.Time`. */
  printNextQueued(time: number): void;
  /** The message strip's share of `vblInterrupt`: a scroll under way moves on a scanline. */
  vblInterrupt(): void;
}

export interface GameHost {
  /**
   * Play a sample, CSBWin's `StartSound`; `QueueSound` and the few direct `StartSound`s
   * end here. `highVolume` is `QueueSound`'s `LOCAL_12`: 1 loud, 0 quiet
   * (`doc/CSBwin-src/Sound.cpp:663`); left out, the sample plays loud.
   */
  playSound(soundId: number, rateIdx?: number, highVolume?: number): void;
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
   * `ShowHideInventory(chIdx)` (`doc/CSBwin-src/CSBCode.cpp:7419`), 4 to hide: the
   * inventory is the UI's. `_FusionSequence` hides an open one (`Attack.cpp:2269-2272`).
   */
  showHideInventory(chIdx: number): void;
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
   * none of the main loop's tick listeners. The main loop's tick calls it too, to paint
   * what `tag01b29a` drew (`Game.gameTick`).
   */
  drawViewport(): void;
  /**
   * `TAG01b29a` (`doc/CSBwin-src/CSBCode.cpp:8799`), from the main loop's tick after
   * `d.Time++` (`:685`): the champions' flinch and the attack panel, both the UI's.
   */
  tag01b29a(): void;
  /**
   * `DisplayCharacterDamage`'s blit (`doc/CSBwin-src/CSBCode.cpp:7121-7171`): the
   * champion lost `damage` HP this tick, shown in red over their name — or over their
   * portrait, their inventory being open — until `tag011366`. The screen is the UI's.
   */
  displayCharacterDamage(chIdx: number, damage: number): void;
  /**
   * `TAG011366`'s redraw (`doc/CSBwin-src/Timer.cpp:2692-2703`): the `TT_12` has come due,
   * and the champion's name or portrait goes back over the damage shown.
   */
  tag011366(chIdx: number): void;
  /**
   * `die(errorNum, msg)` (`doc/CSBwin-src/CSBCode.cpp:86-112`) in play: a frame threw —
   * the engine throws where CSBWin calls `die` — and the loop has stopped
   * (`Game.gameLoop`). CSBWin shows the message and quits; the page reports it. Left out,
   * the error is thrown again, so nothing swallows it.
   */
  die(error: unknown): void;
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
      printLines: () => {},
      setNewSpeed: () => {},
      resetTime: () => {},
      clockTick: () => {},
      printNextQueued: () => {},
      vblInterrupt: () => {},
    },
    sleepChanged: host.sleepChanged ?? (() => {}),
    openReincarnateScreen: host.openReincarnateScreen ?? (() => {}),
    closeAttackMenuOf: host.closeAttackMenuOf ?? (() => {}),
    showHideInventory: host.showHideInventory ?? (() => {}),
    repackChest: host.repackChest ?? (() => {}),
    tag02076e: host.tag02076e ?? (() => {}),
    tag0207cc: host.tag0207cc ?? (() => {}),
    showCredits: host.showCredits ?? (() => {}),
    drawViewport: host.drawViewport ?? (() => {}),
    tag01b29a: host.tag01b29a ?? (() => {}),
    displayCharacterDamage: host.displayCharacterDamage ?? (() => {}),
    tag011366: host.tag011366 ?? (() => {}),
    die: host.die ?? ((error) => { throw error; }),
  };
}
