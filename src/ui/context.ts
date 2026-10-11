import type { Game } from '../engine/Game';
import type { GameScreen } from '../renderer/GameScreen';

export interface UIContext {
    screen: GameScreen;
    game: Game;
    refreshScreen: () => void;
    onQuickSave: () => void;
    onQuickLoad: () => void;
}

let context: UIContext | null = null;
let debugFeaturesEnabled = false;

export function setUIContext(next: UIContext): void {
    context = next;
}

export function getUIContext(): UIContext | null {
    return context;
}

export function setDebugFeaturesEnabled(enabled: boolean): void {
    debugFeaturesEnabled = enabled;
}

export function isDebugFeaturesEnabled(): boolean {
    return debugFeaturesEnabled;
}
