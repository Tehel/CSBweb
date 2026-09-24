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

function bindCanvasEvents(canvas: HTMLCanvasElement | null, ctx: UIContext): void {
    if (!canvas) return;
    if (canvas.dataset.uiBound === 'true') return;
    canvas.dataset.uiBound = 'true';

    canvas.addEventListener('mousemove', (e) => {
        if (!ctx.renderer) return;
        const { x, y } = getEventPosition(canvas, e);
        ctx.renderer.setHoverPoint({ x, y });
        // Cursor tracking only — never a full `renderView()`. That would re-run
        // `DrawViewport` (and its animated-texture randomness) on every pixel of
        // mouse travel; CSBWin's own cursor moves independently of the dungeon
        // redraw, which happens once per game tick, never on a mouse event.
        ctx.renderer.refreshOverlay();
    });

    canvas.addEventListener('mousedown', (e) => {
        const { x, y } = getEventPosition(canvas, e);
        const buttonMask = e.button === 2 ? 1 : e.button === 0 ? 2 : 0;
        // The save/load screen is modal, the way `_WaitForMenuSelect` is modal: it
        // replaces every button list while it runs, so nothing else may see the click
        // (`doc/CSBWIN_MENU_REFERENCE.md`). Handling it here rather than through the
        // game's mouse queue is also what keeps the browser's transient user
        // activation alive — `showDirectoryPicker` refuses without it, and the queue is
        // drained a frame later.
        if (buttonMask !== 0 && ctx.renderer?.isSaveMenuOpen()) {
            ctx.renderer.handleSaveMenuClick(x, y, buttonMask);
            ctx.renderView();
            return;
        }
        if (buttonMask === 0) return;
        if (ctx.renderer.isReincarnateScreenOpen()) {
            ctx.renderer.handleReincarnateClick(x, y);
            ctx.renderView();
            return;
        }
        // Queued, not handled: `Game.handleMouseEvents` takes it off the queue in its turn,
        // behind any key or click already waiting, and hands it to `handleMouseButton`.
        ctx.game.onMouseClick(ctx.renderer.searchMouseButtons(x, y, buttonMask), x, y);
    });

    canvas.addEventListener('mouseup', () => {
        if (ctx.renderer?.isSaveMenuOpen()) return;
        ctx.game.onMouseUnClick();
    });

    canvas.addEventListener('wheel', (e) => {
        if (!ctx.renderer?.isSaveMenuOpen()) return;
        e.preventDefault();
        ctx.renderer.handleSaveMenuWheel(e.deltaY);
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    canvas.addEventListener('mouseleave', () => {
        ctx.renderer.setHoverPoint(null);
        ctx.renderView();
    });
}

/**
 * Button 80, `HandleClickInViewport` (doc/CSBwin-src/Mouse.cpp:1031), reached through
 * `HandleMouseEvents` (`:1665-1670`): a drop, a throw, a wall, a door switch or an object
 * picked up. The eye, when the inventory hides the viewport, is `handleMouseButton`'s.
 */
function handleClickInViewport(ctx: UIContext, x: number, y: number): void {
    if (ctx.renderer.isInventoryOpen()) return;
    const cursorAction = ctx.renderer.resolveViewportCursorAction(x, y);
    if (cursorAction) {
        if (cursorAction.kind === 'drop') ctx.game.dropObjectFromCursor(cursorAction.pos, { viAltar: cursorAction.viAltar });
        else if (cursorAction.kind === 'throw') ctx.game.throwObjectFromCursor(cursorAction.side);
        else if (cursorAction.kind === 'wall') {
            if (!ctx.renderer.tryUseFrontWallItem(x, y)) {
                ctx.game.handleWallClick();
            }
        }
    } else if (!ctx.renderer.hasCursorObject()) {
        const target = ctx.renderer.resolveEmptyHandedViewportClick(x, y);
        if (target === 'doorSwitch') ctx.game.handleDoorSwitchClick();
        else if (target === 'wall') ctx.game.handleWallClick();
        else if (target === 'object') ctx.renderer.tryPickViewportObject(x, y);
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
                ctx.renderer.handleMouseButton(num, x, y);
                ctx.renderView();
            },
            unclick: () => {
                ctx.renderer.handleMouseUnclick();
                ctx.renderView();
            },
        });

        document.getElementById('btn-qsave')?.addEventListener('click', () => ctx.onQuickSave());
        document.getElementById('btn-qload')?.addEventListener('click', () => ctx.onQuickLoad());

        smoothButton?.addEventListener('click', () => {
            const style = ctx.renderer.getCanvasStyle();
            style.imageRendering = style.imageRendering === 'smooth' ? 'pixelated' : 'smooth';
            smoothButton.classList.toggle('is-pressed', style.imageRendering === 'smooth');
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

        // Once per game tick, which is when skills and attributes can change. The panel
        // does nothing while it is hidden.
        ctx.game.onTick(() => updateChampionPanel());

        document.addEventListener('keydown', (e) => {
            // The Reincarnate name-entry screen is modal on the keyboard as well as
            // the mouse (`keyboardMode = 2`, `doc/CSBwin-src/Code13ea4.cpp:38`): while
            // it is up every key is a letter being typed, so none of the movement or
            // debug keys below may see one. 'W' would otherwise walk the party into a
            // wall while the player named their champion.
            // The save/load screen takes the keyboard whole, for the reason the
            // Reincarnate screen does: 'S' would otherwise walk the party backwards
            // while the player scrolled a list of saves.
            if (ctx.renderer?.isSaveMenuOpen()) {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                ctx.renderer.handleSaveMenuKey(e.key);
                ctx.renderView();
                e.preventDefault();
                return;
            }
            if (ctx.renderer?.isReincarnateScreenOpen()) {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                ctx.renderer.handleReincarnateKey(e.key);
                ctx.renderView();
                e.preventDefault();
                return;
            }
            // A browser or OS shortcut keeps its key: nothing below is bound with a
            // modifier, so Ctrl-R still reloads rather than opening a rune keypad.
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            // Asleep, `d.pKeyXlate1` is NULL and `d.pKeyXlate2` is `Byte18440`
            // (doc/CSBwin-src/Mouse.cpp:1700-1701), which graphics.dat fills with two
            // keys: Return (0x0d) is button 146, the wake-up, and Esc (0x1b) is 147, the
            // freeze — unported with the rest of the freeze (DEBT G5). Every other key is
            // dead, the movement keys and the panel bindings included.
            if (ctx.game.isPartySleeping()) {
                if (e.key === 'Enter') ctx.game.enqueueKeyButton(146);
                e.preventDefault();
                return;
            }
            // The panel bindings come first. They are the larger half of the table and
            // they claim their keys whatever the game state, so the movement switch
            // below never sees one.
            if (ctx.renderer?.handleUIKey(e.key)) {
                ctx.renderView();
                e.preventDefault();
                return;
            }
            let handled = false;
            switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
                case 'ArrowUp':
                case 'k':
                    ctx.game.enqueueMovement(MovementAction.MOVE_FORWARD);
                    handled = true;
                    break;
                case 'ArrowDown':
                case ',':
                    ctx.game.enqueueMovement(MovementAction.MOVE_BACKWARD);
                    handled = true;
                    break;
                case 'ArrowLeft':
                case 'j':
                    ctx.game.enqueueMovement(MovementAction.TURN_LEFT);
                    handled = true;
                    break;
                case 'ArrowRight':
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
                case 'Escape':
                    ctx.game.setPaused(!ctx.game.state.paused);
                    updateDebug(ctx.game.state.paused ? 'Game paused' : 'Game resumed');
                    handled = true;
                    break;
                case 'F5':
                    ctx.onQuickSave();
                    handled = true;
                    break;
                case 'F9':
                    ctx.onQuickLoad();
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
