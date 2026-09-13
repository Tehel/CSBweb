import { MovementAction } from '../engine';
import type { UIContext } from './context';
import { getUIContext, isDebugFeaturesEnabled, setDebugFeaturesEnabled } from './context';
import { updateDebug } from './messages';
import { handleMapCanvasClick } from './mapPreview';
import { applyUISettings, loadUISettings, readUISettings, saveUISettings } from './settings';
import { getEventPosition, isViewportPoint } from './utils';

let uiBound = false;

const mapCanvasEl = document.getElementById('map-canvas') as HTMLCanvasElement | null;
const debugButton = document.getElementById('btn-debug') as HTMLButtonElement | null;
const mapButton = document.getElementById('btn-map') as HTMLButtonElement | null;
const logButton = document.getElementById('btn-log') as HTMLButtonElement | null;
const hoverButton = document.getElementById('btn-hover') as HTMLButtonElement | null;
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
        ctx.renderView();
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
        if (buttonMask !== 0) {
            ctx.renderer.enqueueMouseClick(x, y, buttonMask);
            if (buttonMask === 2 && isViewportPoint(x, y) && !ctx.renderer.isInventoryOpen()) {
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
                    if (ctx.renderer.isDoorSwitchHit(x, y)) {
                        if (ctx.game.handleDoorSwitchClick()) ctx.renderView();
                    } else if (ctx.renderer.isWallDecorationHit(x, y) && ctx.game.handleWallClick()) {
                        ctx.renderView();
                    } else {
                        ctx.renderer.tryPickViewportObject(x, y);
                    }
                }
            }
            ctx.renderView();
        }
    });

    canvas.addEventListener('mouseup', () => {
        if (ctx.renderer?.isSaveMenuOpen()) return;
        ctx.renderer.enqueueMouseUnclick();
        ctx.renderView();
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

export function bindUIEvents(): void {
    const ctx = getUIContext();
    if (!ctx) return;

    const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement | null;
    const glCanvasEl = document.getElementById('game-canvas_gl') as HTMLCanvasElement | null;
    bindCanvasEvents(gameCanvasEl, ctx);
    bindCanvasEvents(glCanvasEl, ctx);

    if (!uiBound) {
        uiBound = true;

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
            let handled = false;
            switch (e.key) {
                case 'ArrowUp':
                case 'w':
                case 'W':
                    ctx.game.enqueueMovement(MovementAction.MOVE_FORWARD);
                    handled = true;
                    break;
                case 'ArrowDown':
                case 's':
                case 'S':
                    ctx.game.enqueueMovement(MovementAction.MOVE_BACKWARD);
                    handled = true;
                    break;
                case 'ArrowLeft':
                case 'q':
                case 'Q':
                    ctx.game.enqueueMovement(MovementAction.TURN_LEFT);
                    handled = true;
                    break;
                case 'ArrowRight':
                case 'e':
                case 'E':
                    ctx.game.enqueueMovement(MovementAction.TURN_RIGHT);
                    handled = true;
                    break;
                case 'a':
                case 'A':
                    ctx.game.enqueueMovement(MovementAction.STRAFE_LEFT);
                    handled = true;
                    break;
                case 'd':
                case 'D':
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
