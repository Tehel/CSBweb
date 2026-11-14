/**
 * The Hall of Fame's answers over HTTP (`server/fame.ts`, `doc/ACHIEVEMENTS.md` → "The Hall
 * of Fame"): the server's `api/fame`, stood up on a free port over a scratch store whose
 * proofs are written and checked through `ProofStore` itself, as the verifier writes them,
 * with the common achievements (`achievementDefs`).
 *
 * Asserts:
 *   - a player counts once per identity: two browsers of one identity verifying the same
 *     achievement are one player;
 *   - the first is by `checked_at`, not by the time the proof was sent;
 *   - an identity a moderator reset is left out of every count and of the first, and its
 *     page is 404 at once, though the sets' answers are cached;
 *   - a pending set and a hidden one are in no answer, their route 404, and a player's
 *     badges of them are not listed;
 *   - a dropped claim, an unverified one (a proof queued) and a drifted proof's are not
 *     counted, nor an unlock whose id the set's file does not hold;
 *   - each achievement of the file is answered, in its order, with its players, their
 *     share and the first; a player's page lists their badges with their day; a named
 *     player who verified nothing has a page with no set;
 *   - an unknown set or id, a malformed id, a path too long, another kind 404; a POST 405;
 *   - no answer holds a `playerId`, a playthrough or a proof's id;
 *   - the cache: `max-age=30`, the same answer within it though a proof is checked
 *     meanwhile, and the new count once it expires;
 *   - the achievements across games (`ProofStore.hall`), worked out of the checked proofs'
 *     figures: each playthrough at the largest its proofs reached, never their sum, so a
 *     playthrough's second proof raises a total and does not add to it; Dungeon Janitor at
 *     the proof that took the kills past 500, Encore at the third game won, not a drifted
 *     proof's nor a queued one's; a Janitor a replay verified in one game, before it moved
 *     across games, still counted, at its own time; a Grand Slam of set A's games and set
 *     B's, at the proof of B that made it yes; and the profile's achievements
 *     (`verifiedBy`) the same.
 *
 * Usage: npm test -- --only=server-fame.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FamePlayerPage, FameSet, FameSummary } from '../../server/answers.ts';
import { createAppServer } from '../../server/app.ts';
import { DataSetStore, parseModerators } from '../../server/dataSets.ts';
import { RateLimit } from '../../server/events.ts';
import { IdentityStore } from '../../server/identity.ts';
import { ProofStore } from '../../server/proofs.ts';
import { RecordingStore } from '../../server/recordings.ts';
import { STATS_CACHE_MS, StatsStore } from '../../server/stats.ts';
import { openStore } from '../../server/store.ts';
import { FAME_PLAYERS, FAME_ROUTE, FAME_SETS, IDENTITIES_ROUTE, parseManifest, PLAYER_ID_HEADER, PROFILE_ROUTE, type PlayerProfile } from '../../src/data/DataSets.ts';
import { acrossInSets, setAchievementDefs } from '../../src/engine/achievements/PageAchievements.ts';
import { checkLocalDataSet } from '../../src/engine/LocalDataSetCheck.ts';
import { readRecordingPackage } from '../../src/engine/RecordingPackage.ts';
import { check, finish } from '../lib/check.ts';
import { anyFamily } from '../lib/commonAchievements.ts';

/** The common achievements, as the build holds them (`achievementFiles.ts`), which `tsx` cannot glob. */
const COMMON_TEXT = readFileSync(join(import.meta.dirname, '../../src/engine/achievements/defs/common.txt'), 'utf8');
const COMMON = setAchievementDefs(COMMON_TEXT, null);
/** Set A's: the common file's, and a Grand Slam of its games and set B's. */
const A_DEFS = setAchievementDefs(COMMON_TEXT, '# CSBweb achievements 1\n[grand-slam]\nname: Grand Slam\ntext: Win A and B.\ntier: hard\nwhen: games(won) >= 1 and games(won, in "b") >= 1\n');

const ANN = '00000000-0000-4000-8000-000000000000';
const ANN_LINKED = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const DAN = '44444444-4444-4444-8444-444444444444';
const EVE = '55555555-5555-4555-8555-555555555555';
const FAY = '66666666-6666-4666-8666-666666666666';
const MODERATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAYER_IDS = [ANN, ANN_LINKED, BOB, CAROL, DAN, EVE, FAY, MODERATOR];
/** Each proof's playthrough: a number no answer should hold. */
const PLAYTHROUGH = 987654321;

/** Every answer's body, searched for a `playerId`, a playthrough and a proof's id at the end. */
const bodies: string[] = [];

interface Answer {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

function ask(port: number, path: string, method = 'GET', headers: Record<string, string> = {}, body?: string): Promise<Answer> {
    return new Promise((done, fail) => {
        const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => (text += chunk));
            res.on('end', () => {
                bodies.push(text);
                done({ status: res.statusCode ?? 0, headers: res.headers, body: text });
            });
        });
        req.on('error', fail);
        req.end(body);
    });
}

async function main(): Promise<void> {
    const scratch = mkdtempSync(join(tmpdir(), 'csbweb-fame-'));
    const distDir = join(scratch, 'dist');
    const gamefilesDir = join(scratch, 'gamefiles');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>page</title>');
    for (const dir of ['set-a', 'set-b', 'set-h', 'set-p']) mkdirSync(join(gamefilesDir, dir), { recursive: true });

    const db = openStore(join(scratch, 'store.db'));
    const dataSets = new DataSetStore(db);
    dataSets.fill(parseManifest(JSON.stringify({
        default: 'a', dataSets: [{ id: 'a', name: 'A', dir: 'set-a' }, { id: 'b', name: 'B', dir: 'set-b' }, { id: 'h', name: 'H', dir: 'set-h' }],
    }), ''));
    dataSets.setHidden('h', true);
    const walls = { shapes: [[32, 32]] as [number, number][], signature: ['0'] };
    dataSets.publish({ id: 'p', name: 'P', description: '', authors: [], csbGraphics: false, hintOracle: false, dmRules: false, thumbnailAsTitle: false, official: false, walls }, EVE);
    const identities = new IdentityStore(db);
    const proofs = new ProofStore(db, 1 << 30);
    let clock = 1_000_000;
    const server = createAppServer({ distDir, gamefilesDir }, {
        checkDataSet: checkLocalDataSet, dataSets, moderators: parseModerators(`${MODERATOR}=Alice`), store: new StatsStore(db), notify: () => {},
        rules: { hasSet: (id) => dataSets.hasSet(id) }, rateLimit: new RateLimit(100, 60_000), eventBudget: new RateLimit(1000, 60_000),
        publishRateLimit: new RateLimit(100, 60_000), now: () => clock,
        recordings: { store: new RecordingStore(db, 1 << 30), dir: join(scratch, 'recordings'), readPackage: readRecordingPackage, shareRateLimit: new RateLimit(100, 60_000) },
        identities: { store: identities, rateLimit: new RateLimit(100, 60_000) },
        proofs: { store: proofs, dir: join(scratch, 'proofs'), rateLimit: new RateLimit(100, 60_000) },
        achievementDefs: (id) => (id === 'b' ? COMMON.slice(0, 3) : id === 'a' ? A_DEFS : COMMON),
        achievementsAcross: (id, bySet) => (id === 'b' ? [] : acrossInSets((id === 'a' ? A_DEFS : COMMON).filter((def) => def.across), id, bySet, () => null)), achievementsCheck: anyFamily,
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;

    try {
        const ann = identities.create(ANN, 'Ann');
        identities.link(ANN_LINKED, ann.key);
        const bob = identities.create(BOB, 'Bob').identity;
        const carol = identities.create(CAROL, 'Carol').identity;
        const dan = identities.create(DAN, 'Dan').identity;
        const eve = identities.create(EVE, 'Eve').identity;
        const fay = identities.create(FAY, 'Fay').identity;

        const [first, second, third] = COMMON;
        if (!first || !second || !third) throw new Error('the common file holds fewer than three achievements');
        const proofIds: string[] = [];
        /**
         * A proof of `player` on `dataSet`, sent at `sentAt`, claiming `claims`, and checked at
         * `checkedAt` unlocking `unlocked`, in `playthrough` with `figures`, where it is given.
         */
        const proof = (
            player: string, dataSet: string, sentAt: number, claims: string[], checkedAt?: number, unlocked: string[] = claims,
            figures: Record<string, number> = {}, playthrough = PLAYTHROUGH,
        ) => {
            const id = (proofIds.length + 0xA0).toString(16).toUpperCase().padStart(16, 'F');
            proofIds.push(id);
            proofs.queue({ id, dataSet, player, build: 'test', level: 1, size: 1, sentAt, path: [] }, claims);
            if (checkedAt !== undefined) proofs.checked(id, checkedAt, playthrough, new Set(unlocked), figures);
            return id;
        };
        // Carol first of all, then reset; Bob sent before Ann but checked after her.
        proof(CAROL, 'a', 1, [first.id], 1_000);
        proof(BOB, 'a', 2, [first.id, second.id], 3_000, [first.id, 'not-in-the-file']);
        proof(ANN, 'a', 3, [first.id], 2_000);
        proof(ANN_LINKED, 'a', 4, [first.id, second.id], 4_000);
        proof(ANN, 'p', 5, [first.id], 5_000);
        proof(ANN, 'h', 6, [first.id], 5_000);
        proof(ANN, 'b', 7, [third.id], 6_000);
        proof(DAN, 'a', 8, [third.id]);
        const drifted = proof(EVE, 'a', 9, [third.id]);
        proofs.drifted(drifted, 7_000, 'it does not play');
        identities.reset(carol.id);

        const json = async <T>(path: string) => {
            const answer = await ask(port, `/${FAME_ROUTE}${path}`);
            return { ...answer, json: answer.status === 200 ? JSON.parse(answer.body) as T : null };
        };

        const summary = await json<FameSummary>('');
        console.log(`  api/fame: ${summary.body}`);
        check(summary.status === 200 && summary.headers['cache-control'] === `public, max-age=${STATS_CACHE_MS / 1000}`, 'api/fame answers, cached 30 seconds');
        const sets = summary.json?.sets ?? [];
        check(summary.json?.players === 2, `the Hall's players are Ann and Bob, once each: ${summary.json?.players}`);
        check(sets.map((set) => set.id).join() === 'a,b', `the public sets alone, the most players first: ${sets.map((set) => set.id).join()}`);
        check(sets[0]?.players === 2 && sets[0]?.achievements === A_DEFS.length && sets[0]?.verified === 2, 'set A: 2 players, its file\'s achievements, 2 verified');
        check(sets[1]?.players === 1 && sets[1]?.achievements === 3 && sets[1]?.verified === 1, 'set B: 1 player, its own file\'s 3 achievements, 1 verified');

        const a = await json<FameSet>(`/${FAME_SETS}/a`);
        const listed = a.json?.achievements ?? [];
        console.log(`  api/fame/sets/a: ${JSON.stringify(listed.filter((one) => one.players > 0))}`);
        check(listed.map((one) => one.id).join() === A_DEFS.map((def) => def.id).join(), 'every achievement of the file, in its order');
        check(listed.every((one, i) => one.name === A_DEFS[i]!.name && one.text === A_DEFS[i]!.text && one.tier === A_DEFS[i]!.tier), 'each with its name, text and tier');
        const firstBlood = listed[0];
        check(a.json?.players === 2 && firstBlood?.players === 2 && firstBlood.share === 1,
            `${first.id}: Ann's two browsers once, Bob, and not Carol, reset: ${firstBlood?.players} of ${a.json?.players}`);
        check(firstBlood?.first?.id === ann.identity.id && firstBlood.first.name === 'Ann', `${first.id} first: Ann, checked before Bob, who sent first; not Carol, reset`);
        const secondOne = listed[1];
        check(secondOne?.players === 1 && secondOne.share === 0.5 && secondOne.first?.name === 'Ann', `${second.id}: Ann alone, Bob's claim dropped`);
        check(listed.slice(2).every((one) => one.players === 0 && one.share === 0 && one.first === null),
            'the rest: nobody, Dan\'s claim unverified and Eve\'s proof drifted');
        check(!a.body.includes('not-in-the-file'), 'an unlock the file does not hold is not listed');

        const annPage = await json<FamePlayerPage>(`/${FAME_PLAYERS}/${ann.identity.id}`);
        console.log(`  Ann's page: ${annPage.body}`);
        check(annPage.json?.name === 'Ann' && annPage.json.id === ann.identity.id, 'a player\'s page by public id: their name');
        check(annPage.json?.sets.map((set) => `${set.id}:${set.achievements.map((one) => `${one.id}@${one.day}`).join('+')}`).join() === `a:${first.id}@1970-01-01+${second.id}@1970-01-01,b:${third.id}@1970-01-01`,
            'their badges by public set, in the file\'s order, each with its day; not the pending set\'s nor the hidden one\'s');
        const danPage = await json<FamePlayerPage>(`/${FAME_PLAYERS}/${dan.id}`);
        check(danPage.status === 200 && danPage.json?.sets.length === 0, 'a named player who verified nothing: a page with no set');
        const evePage = await json<FamePlayerPage>(`/${FAME_PLAYERS}/${eve.id}`);
        check(evePage.status === 200 && evePage.json?.sets.length === 0, 'a drifted proof earns no badge');

        for (const [path, what] of [
            [`/${FAME_PLAYERS}/${carol.id}`, 'a reset identity\'s page'], [`/${FAME_PLAYERS}/0000000000`, 'an unknown id'], [`/${FAME_PLAYERS}/NOT-AN-ID`, 'a malformed id'],
            [`/${FAME_SETS}/p`, 'a pending set'], [`/${FAME_SETS}/h`, 'a hidden set'], [`/${FAME_SETS}/zzz`, 'an unknown set'],
            [`/${FAME_SETS}/a/b`, 'a path too long'], [`/${FAME_SETS}`, 'a kind without its id'], ['/winners/a', 'another kind'],
        ] as const) check((await ask(port, `/${FAME_ROUTE}${path}`)).status === 404, `${what}: 404`);
        const posted = await ask(port, `/${FAME_ROUTE}`, 'POST', {}, '{}');
        check(posted.status === 405 && posted.headers.allow === 'GET, HEAD', 'a POST: 405');

        // The cache: Dan's proof checked meanwhile changes nothing until the answer expires.
        const before = (await ask(port, `/${FAME_ROUTE}/${FAME_SETS}/a`)).body;
        proofs.checked(proofIds[7]!, 8_000, PLAYTHROUGH, new Set([third.id]), {});
        check((await ask(port, `/${FAME_ROUTE}/${FAME_SETS}/a`)).body === before, 'within 30 seconds, the same answer, though a proof was checked');
        // A moderator's reset: the page 404 at once, the set's answer cached until it expires.
        const reset = await ask(port, `/${IDENTITIES_ROUTE}/${bob.id}`, 'POST', { [PLAYER_ID_HEADER]: MODERATOR, 'Content-Type': 'application/json' }, '{"action":"reset"}');
        check(reset.status === 200, 'a moderator resets Bob\'s name');
        check((await ask(port, `/${FAME_ROUTE}/${FAME_PLAYERS}/${bob.id}`)).status === 404, 'his page is 404 at once');
        clock += STATS_CACHE_MS + 1;
        const after = await json<FameSet>(`/${FAME_SETS}/a`);
        check(after.json?.players === 2 && after.json.achievements[0]?.players === 1 && after.json.achievements[2]?.players === 1 && after.json.achievements[2]?.first?.name === 'Dan',
            `once it expires: Bob left out, Dan's ${third.id} counted (${after.json?.players} players)`);

        // Across games: Fay's games, each playthrough at its largest figure, never the sum of its proofs'.
        const across = (id: string) => COMMON.find((def) => def.id === id)!;
        const WON = across('encore').games[0]!.key;
        const KILLS = `total(${across('dungeon-janitor').aggregates[0]!.key})`;
        proof(FAY, 'a', 10, [], 9_000, [], { [WON]: 1, [KILLS]: 300 }, 1);
        proof(FAY, 'a', 11, [], 9_500, [], { [WON]: 1, [KILLS]: 400 }, 1);
        proof(FAY, 'a', 12, [], 10_000, [], { [WON]: 1, [KILLS]: 150 }, 2);
        proof(FAY, 'a', 13, [], 10_500, [], { [KILLS]: 10 }, 3);
        const lost = proof(FAY, 'a', 14, []);
        proofs.drifted(lost, 10_600, 'it does not play');
        proof(FAY, 'a', 15, []);
        proof(FAY, 'b', 16, [], 10_700, [], { [WON]: 1 }, 4);
        // Dan's Dungeon Janitor, verified in one game before it moved across games.
        proof(DAN, 'a', 17, ['dungeon-janitor'], 10_800);
        const fayPage = async () => (await json<FamePlayerPage>(`/${FAME_PLAYERS}/${fay.id}`)).json;
        clock += STATS_CACHE_MS + 1;
        const fays = await fayPage();
        console.log(`  Fay's page, two games won: ${JSON.stringify(fays)}`);
        const fayA = fays?.sets.find((set) => set.id === 'a')?.achievements.map((one) => one.id).join() ?? '';
        check(fayA === 'dungeon-janitor,grand-slam', `Fay: Dungeon Janitor, 400 + 150 kills and not 850, no Encore at two games won, and Grand Slam, A and B won: ${fayA}`);
        check(fays?.sets.every((set) => set.id === 'a') === true, 'and nothing of set B, whose file has no achievement across games');
        proof(FAY, 'a', 18, [], 11_000, [], { [WON]: 1, [KILLS]: 5 }, 3);
        clock += STATS_CACHE_MS + 1;
        const fayAfter = (await fayPage())?.sets.find((set) => set.id === 'a')?.achievements.map((one) => one.id).join() ?? '';
        check(fayAfter === 'dungeon-janitor,encore,grand-slam', `a third game won, its playthrough's second proof: Encore (${fayAfter})`);
        const fame = (await json<FameSet>(`/${FAME_SETS}/a`)).json;
        const janitor = fame?.achievements.find((one) => one.id === 'dungeon-janitor');
        const hrProblem = fame?.achievements.find((one) => one.id === 'hr-problem');
        check(janitor?.players === 2 && janitor.first?.name === 'Fay' && hrProblem?.players === 0,
            `Dungeon Janitor: Fay first, at the proof that took the kills past 500, before Dan's verified in one game, both counted; HR Problem nobody (${janitor?.players}, ${janitor?.first?.name})`);
        const profile = await fetch(`http://127.0.0.1:${port}/${PROFILE_ROUTE}`, { headers: { [PLAYER_ID_HEADER]: FAY } });
        const theirs = ((await profile.json()) as PlayerProfile).achievements;
        console.log(`  Fay's profile: ${JSON.stringify(theirs)}`);
        check(JSON.stringify(theirs.map((set) => [set.dataSet, set.unlocked])) === '[["a",["dungeon-janitor","grand-slam","encore"]]]',
            'her profile lists the same, the first first: Grand Slam at the proof of B\'s win, between the 500th kill and the third win');
        const named = A_DEFS.filter((def) => theirs[0]?.unlocked.includes(def.id)).map((def) => def.name);
        check(JSON.stringify(theirs[0]?.names) === JSON.stringify(named) && named.length === 3,
            `and names them by A's file, in its order (${theirs[0]?.names.join(', ')})`);
        const slam = fame?.achievements.find((one) => one.id === 'grand-slam');
        check(slam?.players === 1 && slam.first?.name === 'Fay', `Grand Slam, A's, made yes by a proof of B: Fay (${slam?.players}, ${slam?.first?.name})`);

        const leaks = [...PLAYER_IDS, String(PLAYTHROUGH), ...proofIds].filter((secret) => bodies.some((body) => body.toLowerCase().includes(secret.toLowerCase())));
        check(leaks.length === 0, `no answer holds a playerId, a playthrough or a proof's id${leaks.length ? `: ${leaks.join(', ')}` : ''}`);
    } finally {
        server.close();
        db.close();
        rmSync(scratch, { recursive: true, force: true });
    }
    finish();
}

void main();
