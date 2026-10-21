/**
 * `GameHost` — what the engine asks of whoever runs it (`DEBT.md` E1d): the calls that
 * leave the engine. `main.ts` hands one to `Game` with the sound manager, the message
 * area and the renderer behind it; a tool hands the parts it listens to, or nothing.
 *
 * Every member is present: `createGameHost` fills what the host left out with a
 * null object that does nothing (a `die` that throws again), so no caller asks whether
 * anybody is listening. Headless, nobody is, and the game plays the same.
 */
import type { Champion } from './gameTypes';

/** A champion who has joined (`GameHost.championJoined`), by RESURRECT or REINCARNATE. */
export interface JoinedChampion {
  champion: Champion;
  reincarnated: boolean;
  /**
   * The name the mirror's text gives them: their own, resurrected, and the one REINCARNATE
   * replaced with the name typed on its screen.
   */
  hero: string;
}

/**
 * Fragment-based message emitter, mirroring CSBWin's global `PrintLinefeed()` /
 * `QuePrintLines(color, text)` pair (`doc/CSBwin-src/CSBCode.cpp:1664`, `:1761`).
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
  /** `scrollingText.DiscardText()`, the DSA's `&DISCARDTEXT`: the strip empties. */
  discardText(): void;
}

export interface GameHost {
  /**
   * Play a sample, CSBWin's `StartSound`; `QueueSound` and the few direct `StartSound`s
   * end here. `highVolume` is `QueueSound`'s `LOCAL_12`: 1 loud, 0 quiet
   * (`doc/CSBwin-src/Sound.cpp:668`); left out, the sample plays loud.
   */
  playSound(soundId: number, rateIdx?: number, highVolume?: number): void;
  /**
   * Play a sound of `CSBgraphics.dat`, its samples as `ReadSound` left them: the rest of
   * `PlayCustomSound`, `SOUNDDATA::Decode(volume)` and `sounder.Sound`
   * (`doc/CSBwin-src/Sound.cpp:1064-1067`). `volume` is `Decode`'s divisor, never 0.
   */
  playCustomSound(sound: Uint8Array, volume: number): void;
  /** Dev-only trace, CSBWin's `AITraceActive` / `AttackTraceActive` output. */
  trace(line: string): void;
  /**
   * The message area, CSBWin's `PrintLinefeed()` / `QuePrintLines(color, text)`
   * (`doc/CSBWIN_MESSAGES_REFERENCE.md`).
   */
  messages: MessageSink;
  /** `d.PartySleeping` changed: the UI swaps its button lists, the message area its timeout. */
  sleepChanged(sleeping: boolean): void;
  /**
   * Reincarnate raises the name-entry screen, which the engine does not own
   * (`doc/CSBwin-src/CSBCode.cpp:6797`). The screen answers through
   * `HallOfChampions.reincarnateNamed`; with no screen, Reincarnate stops where CSBWin would be
   * waiting for a name.
   */
  openReincarnateScreen(chIdx: number): void;
  /**
   * A champion has joined for good: RESURRECT or REINCARNATE has run to the end of
   * `_ResurrectReincarnateCancel` (`doc/CSBwin-src/CSBCode.cpp:6867`), the champion's name
   * printed and the inventory closed. Not CSBWin's: the page asks there whether the
   * prison's party, once it is four, begins the adventure (`GameSaves.championJoined`),
   * and reports the party (`src/ui/gameEvents.ts`).
   */
  championJoined(joined: JoinedChampion): void;
  /**
   * A champion's weapon hand changed (`AddCharacterPossession` /
   * `RemoveCharacterPossession`): `if (d.AttackingCharacterOrdinal == chIdx+1)
   * TAG01b1c0();` (`doc/CSBwin-src/Character.cpp:1893-1896`, `:1982-1985`). The attack
   * menu is the UI's.
   */
  closeAttackMenuOf(chIdx: number): void;
  /**
   * `ShowHideInventory(chIdx)` (`doc/CSBwin-src/CSBCode.cpp:7478`), 4 to hide: the
   * inventory is the UI's. `_FusionSequence` hides an open one (`Attack.cpp:2271-2274`).
   */
  showHideInventory(chIdx: number): void;
  /**
   * `KillCharacter`'s release of a held eye or mouth, on the champion whose inventory is
   * open, before its `ShowHideInventory(4)` (`doc/CSBwin-src/Character.cpp:2603-2625`):
   * the eye and the mouth are the UI's.
   */
  releaseEyeOrMouth(): void;
  /**
   * `TAG02076e` (`doc/CSBwin-src/Character.cpp:5133`): the open chest repacked, the
   * interface shaded and the arrow cursor, all the UI's. `AddCharacter` calls it once the
   * candidate's inventory is shown (`:797-798`).
   */
  tag02076e(): void;
  /**
   * `TAG0207cc` (`doc/CSBwin-src/CSBCode.cpp:10058`), `TAG02076e`'s undoing: `WakeUp` calls it
   * last (`:7120`), and `_ResurrectReincarnateCancel` once the inventory is hidden (`:6716`,
   * `:6867`).
   */
  tag0207cc(): void;
  /**
   * A saved game was read in play, which only the port has (`Game.savedGameRead`): F9,
   * the disk menu's LOAD, or the prison's new adventure. CSBWin reads a game only after
   * `d.Initialize()` has zeroed the whole of `d` (`doc/CSBwin-src/CSBCode.cpp:333-340`),
   * so the screen's share of it, the open chest, the attack menu, the Reincarnate
   * screen, the eye and the mouth, is the old world's and goes, and the screen takes
   * the party read. Called before anything runs on the world read, with whether the old
   * world's party had an inventory open, which the read has replaced.
   */
  savedGameRead(inventoryWasOpen: boolean): void;
  /**
   * `ShowCredits(1)`, the end of the game, which the engine does not draw: from
   * `_StartCSB` once `MainLoop` has returned on a lost game
   * (`doc/CSBwin-src/CSBCode.cpp:11557-11561`), or from `MainLoop` 300 VBLs after
   * `ProcessTimers` has won it (`:637-643`), with `d.Word11694` set. The loop has stopped
   * by then (`Game.mainLoopHasReturned`).
   */
  showCredits(word11694: boolean): void;
  /**
   * `DrawViewport(d.partyFacing, d.partyX, d.partyY); display();` from a script's tick,
   * `_ProcessTimersViewportAndSound` (`doc/CSBwin-src/Attack.cpp:2207-2208`), which runs
   * none of the main loop's tick listeners. The main loop's tick draws its viewport
   * through those listeners (`Game.onTick`).
   */
  drawViewport(): void;
  /**
   * The main loop's tick, once `tag01b29a` has drawn: the screen shown again with what it
   * drew, over the viewport the tick's `DrawViewport` left (`Game.gameTick`). Not a
   * `DrawViewport`.
   */
  paint(): void;
  /**
   * `TAG01b29a` (`doc/CSBwin-src/CSBCode.cpp:8904`), from the main loop's tick after
   * `d.Time++` (`:695`): the champions' flinch and the attack panel, both the UI's.
   */
  tag01b29a(): void;
  /**
   * `DisplayCharacterDamage`'s blit (`doc/CSBwin-src/CSBCode.cpp:7180-7230`): the
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
   * `DrawCharacterState(chIdx)` (`doc/CSBwin-src/Character.cpp:1234`) with `charFlags`
   * just set, for the three redraws the screen's own drawing of every box on every frame
   * cannot stand in for. Two go over the damage shown: `CHARFLAG_PORTRAIT_CHANGED` fills
   * the whole box (`:1260-1312`), and `CHARFLAG_CURSOR` the name of a champion whose
   * inventory is closed (`:1315-1361`). CSBWin draws at once wherever it sets either, so
   * the engine calls this there and keeps no flag. The third, `CHARFLAG_CHEST_OR_SCROLL`,
   * fills the open inventory's eye panel again (`:1483-1502`), which runs the viewing
   * filter; the engine keeps it in the champion's `charFlags` until a `DrawCharacterState`
   * (`drawCharacterState`, `Party.ts`).
   */
  drawCharacterState(chIdx: number, charFlags: number): void;
  /**
   * The portrait pixels of a champion carrying only `portraitGraphic`, a cell of graphic
   * 26 or a portrait of `CSBgraphics.dat`, which only the screen holds: `SaveToWings` writes them with the rest of the
   * `CHARDESC` (`SwapCharacter.ts`). Left out, such a champion goes to the wings with a
   * blank portrait.
   */
  portraitOf(champion: Champion): number[] | undefined;
  /**
   * `die(errorNum, msg)` (`doc/CSBwin-src/CSBCode.cpp:96-122`): a frame threw — the engine
   * throws where CSBWin calls `die` — and the loop has stopped (`Game.gameLoop`), or a
   * check of a game file failed (`die`, `src/engine/Die.ts`), which tells the host before
   * it throws. CSBWin shows the message and quits; the page ends its game and prints the
   * message, once however often it is told. Left out, the error is thrown again, so
   * nothing swallows it.
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
    playCustomSound: host.playCustomSound ?? (() => {}),
    trace: host.trace ?? (() => {}),
    messages: host.messages ?? {
      printLinefeed: () => {},
      quePrintLines: () => {},
      printLines: () => {},
      setNewSpeed: () => {},
      resetTime: () => {},
      clockTick: () => {},
      printNextQueued: () => {},
      vblInterrupt: () => {},
      discardText: () => {},
    },
    sleepChanged: host.sleepChanged ?? (() => {}),
    openReincarnateScreen: host.openReincarnateScreen ?? (() => {}),
    championJoined: host.championJoined ?? (() => {}),
    closeAttackMenuOf: host.closeAttackMenuOf ?? (() => {}),
    showHideInventory: host.showHideInventory ?? (() => {}),
    releaseEyeOrMouth: host.releaseEyeOrMouth ?? (() => {}),
    tag02076e: host.tag02076e ?? (() => {}),
    tag0207cc: host.tag0207cc ?? (() => {}),
    savedGameRead: host.savedGameRead ?? (() => {}),
    showCredits: host.showCredits ?? (() => {}),
    drawViewport: host.drawViewport ?? (() => {}),
    paint: host.paint ?? (() => {}),
    tag01b29a: host.tag01b29a ?? (() => {}),
    displayCharacterDamage: host.displayCharacterDamage ?? (() => {}),
    tag011366: host.tag011366 ?? (() => {}),
    drawCharacterState: host.drawCharacterState ?? (() => {}),
    portraitOf: host.portraitOf ?? (() => undefined),
    die: host.die ?? ((error) => { throw error; }),
  };
}
