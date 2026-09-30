import { MovementAction } from '../engine';
import type { UIContext } from './context';
import { getUIContext, isDebugFeaturesEnabled, setDebugFeaturesEnabled } from './context';
import { updateDebug } from './messages';
import { handleMapCanvasClick } from './mapPreview';
import { updateChampionPanel } from './championPanel';
import { applyUISettings, loadUISettings, readUISettings, saveUISettings } from './settings';
import { getEventPosition } from './utils';

let uiBound = false;

const mapCanvasEl = document.getElementById('map-canvas') as HTMLCanvasElement | null;
const debugButton = document.getElementById('btn-debug') as HTMLButtonElement | null;
const mapButton = document.getElementById('btn-map') as HTMLButtonElement | null;
const logButton = document.getElementById('btn-log') as HTMLButtonElement | null;
const hoverButton = document.getElementById('btn-hover') as HTMLButtonElement | null;
const championsButton = document.getElementById('btn-champions') as HTMLButtonElement | null;
const smoothButton = document.getElementById('btn-smooth') as HTMLButtonElement | null;
const crtButton = document.getElementById('btn-crt') as HTMLButtonElement | null;
const soundButton = document.getElementById('btn-sound') as HTMLButtonElement | null;
const soundVolume = document.getElementById('sound-volume') as HTMLInputElement | null;
const dmRulesButton = document.getElementById('btn-dm-rules') as HTMLButtonElement | null;

function bindCanvasEvents(canvas: HTMLCanvasElement | null, ctx: UIContext): void {
    if (!canvas) return;
    if (canvas.dataset.uiBound === 'true') return;
    canvas.dataset.uiBound = 'true';

    // Once `MainLoop` has returned, `_ShowCredits` has emptied every button list and key
    // table (`doc/CSBwin-src/Code1f9e6.cpp:116-121`) and owns the screen: the adventure's
    // handlers neither act nor draw.
    const ended = (): boolean => ctx.game.mainLoopHasReturned();

    canvas.addEventListener('mousemove', (e) => {
        if (!ctx.screen || ended()) return;
        const { x, y } = getEventPosition(canvas, e);
        ctx.screen.setHoverPoint({ x, y });
        // Cursor tracking only — never a full `renderView()`. That would re-run
        // `DrawViewport` (and its animated-texture randomness) on every pixel of
        // mouse travel; CSBWin's own cursor moves independently of the dungeon
        // redraw, which happens once per game tick, never on a mouse event.
        ctx.screen.refreshOverlay();
    });

    canvas.addEventListener('mousedown', (e) => {
        if (ended()) return;
        const { x, y } = getEventPosition(canvas, e);
        const buttonMask = e.button === 2 ? 1 : e.button === 0 ? 2 : 0;
        // The save/load screen is modal, the way `_WaitForMenuSelect` is modal: it
        // replaces every button list while it runs, so nothing else may see the click
        // (`doc/CSBWIN_MENU_REFERENCE.md`). Handling it here rather than through the
        // game's mouse queue is also what keeps the browser's transient user
        // activation alive — `showDirectoryPicker` refuses without it, and the queue is
        // drained a frame later.
        if (buttonMask !== 0 && ctx.screen?.isSaveMenuOpen()) {
            ctx.screen.handleSaveMenuClick(x, y, buttonMask);
            ctx.renderView();
            return;
        }
        if (buttonMask === 0) return;
        if (ctx.screen.isReincarnateScreenOpen()) {
            ctx.screen.handleReincarnateClick(x, y);
            ctx.renderView();
            return;
        }
        // Queued, not handled: `Game.handleMouseEvents` takes it off the queue in its turn,
        // behind any key or click already waiting, and hands it to `handleMouseButton`.
        ctx.game.onMouseClick(ctx.screen.searchMouseButtons(x, y, buttonMask), x, y);
    });

    canvas.addEventListener('mouseup', () => {
        if (ended() || ctx.screen?.isSaveMenuOpen()) return;
        ctx.game.onMouseUnClick();
    });

    canvas.addEventListener('wheel', (e) => {
        if (ended() || !ctx.screen?.isSaveMenuOpen()) return;
        e.preventDefault();
        ctx.screen.handleSaveMenuWheel(e.deltaY);
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    canvas.addEventListener('mouseleave', () => {
        if (ended()) return;
        ctx.screen.setHoverPoint(null);
        ctx.renderView();
    });
}

/**
 * Button 80, `HandleClickInViewport` (doc/CSBwin-src/Mouse.cpp:1031), reached through
 * `HandleMouseEvents` (`:1665-1670`): a drop, a throw, a wall, a door switch, an object
 * picked up, or the sound of a hand on bare stone. The eye, when the inventory hides the
 * viewport, is `handleMouseButton`'s.
 */
function handleClickInViewport(ctx: UIContext, x: number, y: number): void {
    if (ctx.screen.isInventoryOpen()) return;
    const cursorAction = ctx.screen.resolveViewportCursorAction(x, y);
    if (cursorAction) {
        if (cursorAction.kind === 'drop') ctx.game.dropObjectFromCursor(cursorAction.pos, { viAltar: cursorAction.viAltar });
        else if (cursorAction.kind === 'throw') ctx.game.throwObjectFromCursor(cursorAction.side);
        else if (cursorAction.kind === 'wall') {
            if (!ctx.screen.tryUseFrontWallItem(x, y)) {
                ctx.game.handleWallClick();
            }
        }
    } else if (!ctx.screen.hasCursorObject()) {
        const target = ctx.screen.resolveEmptyHandedViewportClick(x, y);
        if (target === 'doorSwitch') ctx.game.handleDoorSwitchClick();
        else if (target === 'wall') ctx.game.handleWallClick();
        else if (target === 'object') ctx.screen.tryPickViewportObject(x, y);
        else if (target === 'stone') ctx.game.handleStoneClick();
    }
}

export function bindUIEvents(): void {
    const ctx = getUIContext();
    if (!ctx) return;

    const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement | null;
    const glCanvasEl = document.getElementById('game-canvas_gl') as HTMLCanvasElement | null;
    bindCanvasEvents(gameCanvasEl, ctx);
    bindCanvasEvents(glCanvasEl, ctx);

    if (!uiBound) {
        uiBound = true;

        ctx.game.setMouseEventHandlers({
            button: (num, x, y) => {
                if (num === 80) handleClickInViewport(ctx, x, y);
                ctx.screen.handleMouseButton(num, x, y);
                ctx.renderView();
            },
            unclick: () => {
                ctx.screen.handleMouseUnclick();
                ctx.renderView();
            },
        });

        document.getElementById('btn-qsave')?.addEventListener('click', () => ctx.onQuickSave());
        document.getElementById('btn-qload')?.addEventListener('click', () => ctx.onQuickLoad());

        smoothButton?.addEventListener('click', () => {
            const style = ctx.screen.getCanvasStyle();
            style.imageRendering = style.imageRendering === 'auto' ? 'pixelated' : 'auto';
            smoothButton.classList.toggle('is-pressed', style.imageRendering === 'auto');
            saveUISettings(readUISettings());
        });

        crtButton?.addEventListener('click', () => {
            const next = !ctx.isCrtEnabled();
            const enabled = ctx.setCrtEnabled(next);
            crtButton.classList.toggle('is-pressed', enabled);
            if (next && !enabled) updateDebug('CRT effect unavailable');
            else updateDebug(enabled ? 'CRT effect enabled' : 'CRT effect disabled');
            saveUISettings(readUISettings());
        });

        soundButton?.addEventListener('click', () => {
            const next = !ctx.isSoundEnabled();
            ctx.setSoundEnabled(next);
            soundButton.classList.toggle('is-pressed', next);
            updateDebug(next ? 'Sound enabled' : 'Sound disabled');
            saveUISettings(readUISettings());
        });

        soundVolume?.addEventListener('input', () => {
            const value = Math.max(0, Math.min(100, Number(soundVolume.value)));
            ctx.setSoundVolume(value / 100);
            saveUISettings(readUISettings());
        });

        debugButton?.addEventListener('click', () => {
            const next = !isDebugFeaturesEnabled();
            setDebugFeaturesEnabled(next);
            debugButton.classList.toggle('is-pressed', next);
            updateDebug(next ? 'Debug features enabled' : 'Debug features disabled');
            saveUISettings(readUISettings());
        });

        mapButton?.addEventListener('click', () => {
            const mapEl = document.getElementById('map');
            if (!mapEl) return;
            const visible = mapEl.style.display !== 'none';
            mapEl.style.display = visible ? 'none' : 'block';
            mapButton.classList.toggle('is-pressed', !visible);
            saveUISettings(readUISettings());
        });

        logButton?.addEventListener('click', () => {
            const logEl = document.getElementById('log');
            if (!logEl) return;
            const visible = logEl.style.display !== 'none';
            logEl.style.display = visible ? 'none' : 'block';
            logButton.classList.toggle('is-pressed', !visible);
            saveUISettings(readUISettings());
        });

        hoverButton?.addEventListener('click', () => {
            const hoverEl = document.getElementById('hover');
            if (!hoverEl) return;
            const visible = hoverEl.style.display !== 'none';
            hoverEl.style.display = visible ? 'none' : 'block';
            hoverButton.classList.toggle('is-pressed', !visible);
            saveUISettings(readUISettings());
        });

        championsButton?.addEventListener('click', () => {
            const championsEl = document.getElementById('champions');
            if (!championsEl) return;
            const visible = championsEl.style.display !== 'none';
            championsEl.style.display = visible ? 'none' : 'block';
            championsButton.classList.toggle('is-pressed', !visible);
            updateChampionPanel();
            saveUISettings(readUISettings());
        });

        // CSBWin's "DM Rules" menu item: `DM_rules = !DM_rules`, at any time
        // (doc/CSBwin-src/CSBUI.cpp:912-914). It is the game's, not the page's: a save
        // carries it and a read game or the boot may set it, so it is not a UI setting. The
        // menu reads its check mark afresh each time it opens (`WM_INITMENUPOPUP`,
        // doc/CSBwin-src/CSBwin.cpp:1116, :1162-1166); the button is always in view, so it
        // reads it every tick.
        const showDMRules = (): void => {
            dmRulesButton?.classList.toggle('is-pressed', ctx.game.ctx.rules.dmRules);
        };
        dmRulesButton?.addEventListener('click', () => {
            ctx.game.ctx.rules.dmRules = !ctx.game.ctx.rules.dmRules;
            showDMRules();
            updateDebug(ctx.game.ctx.rules.dmRules ? 'DM Rules on' : 'DM Rules off');
        });
        ctx.game.onTick(showDMRules);

        // Once per game tick, which is when skills and attributes can change. The panel
        // does nothing while it is hidden.
        ctx.game.onTick(() => updateChampionPanel());

        document.addEventListener('keydown', (e) => {
            // `_ShowCredits` has emptied `d.pKeyXlate1` and `d.pKeyXlate2`
            // (`doc/CSBwin-src/Code1f9e6.cpp:120-121`): no key is the adventure's any more.
            if (ctx.game.mainLoopHasReturned()) return;
            // The Reincarnate name-entry screen is modal on the keyboard as well as
            // the mouse (`keyboardMode = 2`, `doc/CSBwin-src/Code13ea4.cpp:38`): while
            // it is up every key is a letter being typed, so none of the panel, movement
            // or debug keys below may see one. 'Q' would otherwise open an attack menu
            // while the player named their champion.
            // The save/load screen takes the keyboard whole, for the reason the
            // Reincarnate screen does: 'S' would otherwise open an attack menu while the
            // player scrolled a list of saves.
            if (ctx.screen?.isSaveMenuOpen()) {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                ctx.screen.handleSaveMenuKey(e.key);
                ctx.renderView();
                e.preventDefault();
                return;
            }
            if (ctx.screen?.isReincarnateScreenOpen()) {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                ctx.screen.handleReincarnateKey(e.key);
                ctx.renderView();
                e.preventDefault();
                return;
            }
            // The key tables first, `TAG0196da` (doc/CSBwin-src/CSBCode.cpp:8428): awake,
            // `Byte18400` and `Byte18428` bind Ctrl-S, Esc, Insert, Clr/Home and the arrows,
            // and F1-F4, which the port keeps for the caster (`DEBT.md` H); asleep `Byte18440` binds Return and Esc, and frozen `Byte18448` Esc
            // alone (doc/CSBwin-src/Mouse.cpp:1700-1701, :1754-1755). A bound key is queued
            // as its button, like a click.
            if (!e.metaKey && !e.altKey) {
                const button = ctx.screen?.translateKey(e.key, e.ctrlKey) ?? 0;
                if (button !== 0) {
                    ctx.game.enqueueKeyButton(button);
                    e.preventDefault();
                    return;
                }
            }
            // A browser or OS shortcut keeps its key: nothing below is bound with a
            // modifier, so Ctrl-R still reloads rather than opening a rune keypad.
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            // Asleep or frozen, every key the table does not bind is dead, the movement
            // keys and the panel bindings included.
            if (ctx.game.isPartySleeping() || ctx.game.isFrozen()) {
                e.preventDefault();
                return;
            }
            // Then the port's own bindings, which claim no other key a table binds: the
            // panel keys, which claim theirs whatever the game state, so the movement switch
            // below never sees one.
            if (ctx.screen?.handleUIKey(e.key)) {
                ctx.renderView();
                e.preventDefault();
                return;
            }
            let handled = false;
            switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
                case 'k':
                    ctx.game.enqueueMovement(MovementAction.MOVE_FORWARD);
                    handled = true;
                    break;
                case ',':
                    ctx.game.enqueueMovement(MovementAction.MOVE_BACKWARD);
                    handled = true;
                    break;
                case 'j':
                    ctx.game.enqueueMovement(MovementAction.TURN_LEFT);
                    handled = true;
                    break;
                case 'l':
                    ctx.game.enqueueMovement(MovementAction.TURN_RIGHT);
                    handled = true;
                    break;
                case 'm':
                    ctx.game.enqueueMovement(MovementAction.STRAFE_LEFT);
                    handled = true;
                    break;
                case '.':
                    ctx.game.enqueueMovement(MovementAction.STRAFE_RIGHT);
                    handled = true;
                    break;
                // Not while a script holds the loop: the save could not resume it, and a
                // load would run it on in the loaded world.
                case 'F5':
                    if (!ctx.game.isRunningScript()) ctx.onQuickSave();
                    handled = true;
                    break;
                case 'F9':
                    if (!ctx.game.isRunningScript()) ctx.onQuickLoad();
                    handled = true;
                    break;
            }
            if (handled) e.preventDefault();
        });

        mapCanvasEl?.addEventListener('click', (e) => {
            handleMapCanvasClick(e);
        });
    }

    applyUISettings(loadUISettings());
}
