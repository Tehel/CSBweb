/**
 * The banner an achievement unlocked shows (`doc/ACHIEVEMENTS.md` → "The page"): three
 * seconds over the top of the viewport, drawn after the game and before a dialog, never
 * in the message area, which is the engine's. It is the port's own, and nothing of the
 * game reads it.
 *
 * Each unlock waits its turn, so two at once show one after the other. Its three seconds
 * start when it is first drawn, and a dialog up holds it back: it is drawn under no
 * dialog. With ACHIEVEMENT NOTICES off (`SettingsValues.achievementNotices`), an unlock
 * shows nothing.
 *
 * It is drawn in the interface's palette, the viewport's lines under it too, as a cursor
 * is (`ScreenComposer.presentViewport`): in a dark level the light level's would hide it.
 */
import type { Rect } from '../../data/tables/UITables';
import type { Tier } from '../../engine/achievements/AchievementFile';
import { MENU_OPTION_COLOR } from './Menu';
import { nowMs, type UIState } from './UIState';
import { CHAR_WIDTH, drawPanel, drawText } from './Widgets';

/** How long a banner stays, in milliseconds. */
export const BANNER_MS = 3000;

/**
 * The banner's panel, in screen coordinates: across the viewport (0-223) but for four
 * columns a side, four rows under its top (33), two lines of text high.
 */
export const BANNER_RECT: Rect = { x1: 4, y1: 37, x2: 219, y2: 60 };

/** Its first line, over the name. */
export const BANNER_TITLE = 'ACHIEVEMENT UNLOCKED';

/** The colour white, the title's. */
const TITLE_COLOR = 15;

/**
 * A tier's colour in the interface's palette, on the panel's brown: easy the option
 * colour, silly cyan, weird green, hard the lit yellow. The dialog colours them the same
 * (`AchievementsDialog.ts`).
 */
export const TIER_COLORS: Readonly<Record<Tier, number>> = { easy: MENU_OPTION_COLOR, silly: 4, weird: 7, hard: 11 };

/** An unlock waiting for the banner, or shown on it. */
export interface Notice {
  readonly name: string;
  readonly tier: Tier;
}

/** The banner's state: the notices waiting, and the one shown with when it goes. */
export interface BannerState {
  readonly waiting: Notice[];
  shown: { readonly notice: Notice; until: number | null } | null;
  /** The banner has changed since a frame last drew it (`takeBannerChanged`). */
  changed: boolean;
}

/** An unlock to show, after those waiting; nothing with ACHIEVEMENT NOTICES off. */
export function showAchievementNotice(ui: UIState, notice: Notice): void {
  if (!ui.settings.values.achievementNotices) return;
  ui.banner.waiting.push(notice);
  if (!ui.banner.shown) next(ui);
}

/** The next notice waiting on the banner, or none. */
function next(ui: UIState): void {
  const notice = ui.banner.waiting.shift();
  ui.banner.shown = notice ? { notice, until: null } : null;
  ui.banner.changed = true;
}

/**
 * Whether the banner has changed since a frame last drew it: one shown, or one gone at
 * its time, the next taking its place. A redraw is due (`wire`, `src/main.ts`).
 */
export function takeBannerChanged(ui: UIState): boolean {
  const { shown } = ui.banner;
  if (shown?.until != null && nowMs() >= shown.until) next(ui);
  const changed = ui.banner.changed;
  ui.banner.changed = false;
  return changed;
}

/**
 * The banner drawn into the screen, if one is shown and no dialog is up: its rectangle,
 * which the screen shows through the interface's palette, or `null`. Its three seconds
 * start at its first drawing.
 */
export function drawAchievementBanner(ui: UIState): Rect | null {
  const { shown } = ui.banner;
  if (!shown || ui.dialog) return null;
  shown.until ??= nowMs() + BANNER_MS;
  const box = BANNER_RECT;
  drawPanel(ui, box);
  const x = box.x1 + 4;
  const right = box.x2 - 1;
  const tier = shown.notice.tier.toUpperCase();
  drawText(ui, BANNER_TITLE, x, box.y1 + 9, TITLE_COLOR);
  drawText(ui, tier, right + 2 - tier.length * CHAR_WIDTH, box.y1 + 9, TIER_COLORS[shown.notice.tier]);
  const chars = Math.floor((right - x + 1) / CHAR_WIDTH);
  drawText(ui, shown.notice.name.toUpperCase().slice(0, chars), x, box.y1 + 18);
  return box;
}
