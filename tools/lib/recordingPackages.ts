/**
 * A shared recording's package made by hand, without playing a game: what the server's
 * checks upload (`tools/checks/server.ts`) and the build's reads through the server's
 * module (`tools/checks/build.ts`). `tools/checks/replay.ts` makes packages of games played.
 */
import { NO_EXTRAS, type RulesOptions } from '../../src/engine/GameContext.ts';
import type { RecordedChange, Recording } from '../../src/engine/Recorder.ts';
import { packageOfEnd, writeRecordingPackage } from '../../src/engine/RecordingPackage.ts';

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

