import type { DungeonData } from '../data';
import type { Game } from '../engine';
import type { ViewportRenderer } from '../renderer/ViewportRenderer';

export interface UIContext {
    renderer: ViewportRenderer;
    game: Game;
    dungeonData: DungeonData;
    renderView: () => void;
    onQuickSave: () => void;
    onQuickLoad: () => void;
    onInjectRandomParty: () => void;
    onToggleAttackPanel: () => void;
    setCrtEnabled: (enabled: boolean) => boolean;
    isCrtEnabled: () => boolean;
    setSoundEnabled: (enabled: boolean) => void;
    isSoundEnabled: () => boolean;
    setSoundVolume: (volume: number) => void;
    getSoundVolume: () => number;
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
