/**
 * The page's one animation clock: a frame at each of the display's while something asks
 * for one, and none while nothing does. The engine's VBL is not on it (`Game`'s
 * `setTimeout` clock, which runs where the page is hidden); what runs off that clock is:
 *
 * - the animations the interface plays while the clock may be held, the chewing mouth
 *   (`ui/Feeding.ts`) and a menu button's press (`playMenuPress`, `ui/Menu.ts`), each
 *   frame of which is the screen composed again (`animate`, `compose`);
 * - the pre-game screens' VBLs (`IntroHost.vbl`), which present their own frames
 *   (`frames`);
 * - what is drawn from the canvas once it holds a new frame or the page a new size, the
 *   CRT effect (`drawAfter`, `src/lib/crt.ts`), after the canvas.
 *
 * Without a display (a tool), a frame is every 16 ms.
 */

/** A frame's step: whether it wants the next frame too. */
export type FrameStep = () => boolean;

interface Running {
  step: FrameStep;
  /** The screen composed again after it (`animate`), or not (`frames`). */
  composes: boolean;
}

export class Presenter {
  private running: Running[] = [];
  private after: (() => void)[] = [];
  private scheduled = false;
  /** Moved on by `cancel`, so that a frame under way does not keep what it dropped. */
  private generation = 0;

  /** `compose` draws the screen again: the last frame, through `refreshScreen`'s guards. */
  constructor(private readonly compose: () => void) {}

  /**
   * `step` at every frame until it returns false, the screen composed after it while it
   * returns true. Its last frame, when it ends, is its own to draw.
   */
  animate(step: FrameStep): void {
    this.running.push({ step, composes: true });
    this.schedule();
  }

  /** `step` at every frame until it returns false, the screen left as it is. */
  frames(step: FrameStep): void {
    this.running.push({ step, composes: false });
    this.schedule();
  }

  /** `draw` at the next frame, after the screen: once, however often it is asked before. */
  drawAfter(draw: () => void): void {
    if (!this.after.includes(draw)) this.after.push(draw);
    this.schedule();
  }

  /**
   * Every animation under way dropped, with no frame more: a game set up again, or ended,
   * draws nothing of the last. The pre-game screens' VBLs go on.
   */
  cancel(): void {
    this.running = this.running.filter((r) => !r.composes);
    this.generation++;
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(this.frame);
    else setTimeout(this.frame, 16);
  }

  private readonly frame = (): void => {
    this.scheduled = false;
    const generation = this.generation;
    const ran = this.running;
    this.running = [];
    let compose = false;
    const going: Running[] = [];
    for (const r of ran) {
      if (!r.step()) continue;
      going.push(r);
      if (r.composes) compose = true;
    }
    // A step may have asked for more (`this.running`), or ended the game (`cancel`).
    this.running = [...(generation === this.generation ? going : going.filter((r) => !r.composes)), ...this.running];
    if (compose && generation === this.generation) this.compose();
    const after = this.after;
    this.after = [];
    for (const draw of after) draw();
    if (this.running.length > 0) this.schedule();
  };
}
