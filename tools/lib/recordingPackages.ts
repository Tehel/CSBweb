/**
 * A shared recording's package made by hand, without a player: what the server's checks
 * upload (`tools/checks/server.ts`), the build's reads through the server's module
 * (`tools/checks/build.ts`) and the replay tool plays (`tools/checks/replay-recordings.ts`).
 * `tools/checks/replay.ts` makes packages of games played.
 */
import type { DataSetFiles } from '../../src/data/DataSetFiles.ts';
import type { DataSet } from '../../src/data/DataSets.ts';
import { NO_EXTRAS, type RulesOptions } from '../../src/engine/GameContext.ts';
import { saveFileOf } from '../../src/engine/GameSaves.ts';
import type { RecordedChange, Recording } from '../../src/engine/Recorder.ts';
import { packageOfEnd, packageOfSave, writeRecordingPackage } from '../../src/engine/RecordingPackage.ts';
import { playPath } from './playback.ts';

/** Every rule off: a recording's rules. */
const RULES_OFF: RulesOptions = {
    dmRules: false, dmRulesDesignOption: false, invisibleMonsters: false, drawAsSize4Monsters: false,
    simpleEncipher: false, supressDSAWarningOption: false, bGravityGame: false, bThreeDMovements: false,
};

/**
 * A package of a game of `dataSet`'s won at its hundredth VBL, titled `title`: played with an
 * extra on where `extras`, and moved by `?dev` where `dev`.
 */
export async function packageOf(dataSet: string, title: string, { extras = false, dev = false } = {}): Promise<Uint8Array<ArrayBuffer>> {
    const changes: RecordedChange[] = [{ change: { kind: 'key', num: 1 }, vbl: 10, time: 0, random: 0 }];
    if (dev) changes.push({ change: { kind: 'devLevel', delta: 1 }, vbl: 20, time: 0, random: 0 });
    const recording: Recording = {
        id: 'root', build: 'test', dataSet, start: { kind: 'new', random: 1, randomGameID: 2 }, parent: null, rules: RULES_OFF,
        extras: { ...NO_EXTRAS, drinkAtFountain: extras }, changes, vbls: 100, ended: true, end: { word11694: true },
    };
    const pkg = packageOfEnd([recording], { title, author: 'A Player', description: 'Won.' }, { recordedAt: 1000, endedAt: 2000, playTime: 500 });
    return new Uint8Array(await writeRecordingPackage(pkg));
}

/**
 * A package of a new game of `set`'s, whose files `files` reads, left alone for `vbls`
 * VBLs and shared at a save made there, titled `title`: one that plays to its point. The
 * save's file is the one the game makes there, played by the replay tool's page.
 */
export async function quietPackage(set: DataSet, files: DataSetFiles, title: string, vbls: number): Promise<Uint8Array<ArrayBuffer>> {
    const root: Recording = {
        id: 'root', build: 'test', dataSet: set.id, start: { kind: 'new', random: 0x1234, randomGameID: 5 }, parent: null, rules: RULES_OFF,
        extras: NO_EXTRAS, changes: [], vbls, ended: true, end: null,
    };
    const { game } = await playPath(set, files, [root]);
    const file = saveFileOf(game, 'running', (champion) => game.ctx.host.portraitOf(champion));
    const pkg = packageOfSave([root], { recording: root.id, changes: 0, vbls }, file, { title, author: '', description: '' },
        { recordedAt: 1000, endedAt: 2000, playTime: 500 });
    return new Uint8Array(await writeRecordingPackage(pkg));
}
