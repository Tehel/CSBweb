/**
 * The proofs of the achievements over HTTP (`server/proofs.ts`, `doc/ACHIEVEMENTS.md` →
 * "Proofs"): the server's `api/proofs`, stood up on a free port over a scratch store, as the
 * page sends a proof and asks for its verdicts.
 *
 * Asserts:
 *   - only a player with a public name sends one: none, 403; a name a moderator reset,
 *     403; nothing written;
 *   - the form: not multipart 400; a package without claims, claims not a JSON list, one
 *     of more than `MAX_CLAIMS`, an id twice, an id not of `CLAIM_ID`'s
 *     form, an extra field, each 400; a package that does not read 422, saying why; one of
 *     a set the site does not publish 422; one with a move of `?dev` 422; nothing written;
 *   - a proof sent: 201 and its id, its file kept in `PROOFS_DIR` and never served, its row
 *     queued at the package's level, its claims `unverified`, and its verdicts answered to
 *     its sender and to a browser their key linked, and to nobody else; a malformed list of
 *     ids 400, no player 400; not cached;
 *   - the limits: `MAX_QUEUED_PER_IDENTITY` queued per identity, then 429; a body over
 *     `MAX_PROOF_BYTES` 413; the disk the packages may take, 507; the rate per address,
 *     429; a POST from another site 403;
 *   - no answer of any route holds a `playerId` or a playthrough;
 *   - the verifier (`verifyNext`, with the page's `replayProof` and the common
 *     achievements), over the repository's sets: nothing queued, nothing done; a genuine
 *     corpus recording (`replay-saves-written-over`, First Blood) claiming only an
 *     achievement it does not unlock, the forged claim dropped and First Blood granted
 *     unclaimed, verified, its file kept; the same proof again claiming First Blood,
 *     verified but not its own, its file deleted; a new game left alone and saved
 *     (`quietPackage`) claiming First Blood, dropped, its file deleted; the same package
 *     whose save shared differs, drifted, its claims unverified and the reason answered,
 *     its file kept; a package made by hand that the game does not play as it says,
 *     drifted; the genuine recording again claiming nothing, for its figures alone,
 *     checked, its kills kept as its figures (`proof_figures`), a drifted proof's none; the
 *     verdicts answered as the page asks them, and the profile listing First Blood once;
 *   - a moderator watching them (`identityText`, `answerProofPackage`): the identity's
 *     proofs, the latest first, each its set, state, reason, package kept or not and
 *     claims, uncached; a kept package's bytes, to a moderator alone, not to its sender nor
 *     to nobody, 403; a package deleted, an unknown id and a malformed one 404.
 *
 * Usage: npm test -- --only=server-proofs.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAppServer } from '../../server/app.ts';
import { DataSetStore, parseModerators } from '../../server/dataSets.ts';
import { RateLimit } from '../../server/events.ts';
import { IdentityStore } from '../../server/identity.ts';
import { MAX_PROOF_BYTES, MAX_QUEUED_PER_IDENTITY, ProofStore, verifyNext, type VerifyOptions } from '../../server/proofs.ts';
import { FileDigestCache } from '../../server/setFiles.ts';
import { RecordingStore } from '../../server/recordings.ts';
import { StatsStore } from '../../server/stats.ts';
import { openStore } from '../../server/store.ts';
import {
    IDENTITIES_ROUTE, MAX_CLAIMS, parseManifest, PLAYER_ID_HEADER, PROFILE_ROUTE, PROOF_FIELDS, PROOF_ID, PROOFS_ROUTE, type ModeratedIdentity, type ProofVerdict,
} from '../../src/data/DataSets.ts';
import { checkLocalDataSet } from '../../src/engine/LocalDataSetCheck.ts';
import { replayProof } from '../../src/engine/achievements/ProofReplay.ts';
import { acrossUnlocked } from '../../src/engine/achievements/AchievementState.ts';
import { setAchievementDefs } from '../../src/engine/achievements/PageAchievements.ts';
import { readRecordingPackage, writeRecordingPackage } from '../../src/engine/RecordingPackage.ts';
import { check, finish } from '../lib/check.ts';
import { dataSetNamed, diskFiles, GAMEFILES_DIR, MANIFEST_FILE } from '../lib/dataSets.ts';
import { CORPUS_DIR } from '../lib/recordingCorpus.ts';
import { packageOf, quietPackage } from '../lib/recordingPackages.ts';

/** The common achievements, as the build holds them (`achievementFiles.ts`), which `tsx` cannot glob. */
const COMMON = setAchievementDefs(readFileSync(join(import.meta.dirname, '../../src/engine/achievements/defs/common.txt'), 'utf8'), null);

const PLAYER = '00000000-0000-4000-8000-000000000000';
const LINKED = '11111111-1111-4111-8111-111111111111';
const NAMELESS = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const MODERATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAYER_IDS = [PLAYER, LINKED, NAMELESS, STRANGER, MODERATOR];

/** Proofs per address and window: more than the checks send from one address but the rate's own. */
const PROOFS_PER_WINDOW = 3;

/** Every answer's body, searched for a `playerId` and a playthrough at the end. */
const bodies: string[] = [];

interface Answer {
    status: number;
    headers: Headers;
    body: string;
    json: Record<string, unknown>;
}

async function main(): Promise<void> {
    const scratch = mkdtempSync(join(tmpdir(), 'csbweb-proofs-'));
    const distDir = join(scratch, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>page</title>');
    const gamefilesDir = join(scratch, 'gamefiles');
    for (const dir of ['set-a', 'set-p']) mkdirSync(join(gamefilesDir, dir), { recursive: true });
    const proofsDir = join(scratch, 'proofs');
    mkdirSync(proofsDir);

    const db = openStore(join(scratch, 'store.db'));
    const dataSets = new DataSetStore(db);
    dataSets.fill(parseManifest(JSON.stringify({ default: 'a', dataSets: [{ id: 'a', name: 'A', dir: 'set-a' }] }), ''));
    const walls = { shapes: [[32, 32]] as [number, number][], signature: ['0'] };
    dataSets.publish({ id: 'p', name: 'P', description: '', authors: [], csbGraphics: false, hintOracle: false, dmRules: false, thumbnailAsTitle: false, official: false, walls }, STRANGER);
    const identities = new IdentityStore(db);
    const proofs = new ProofStore(db, 1 << 30);
    const api = {
        checkDataSet: checkLocalDataSet, dataSets, moderators: parseModerators(`${MODERATOR}=Alice`), store: new StatsStore(db), notify: () => {},
        rules: { hasSet: (id: string) => dataSets.hasSet(id) }, rateLimit: new RateLimit(100, 60_000), eventBudget: new RateLimit(1000, 60_000),
        publishRateLimit: new RateLimit(100, 60_000), now: Date.now,
        recordings: { store: new RecordingStore(db, 1 << 30), dir: join(scratch, 'recordings'), readPackage: readRecordingPackage, shareRateLimit: new RateLimit(100, 60_000) },
        identities: { store: identities, rateLimit: new RateLimit(100, 60_000) },
        proofs: { store: proofs, dir: proofsDir, rateLimit: new RateLimit(PROOFS_PER_WINDOW, 60_000) },
        achievementDefs: () => COMMON,
        achievementsAcross: (id: string, bySet: ReadonlyMap<string, readonly Readonly<Record<string, number>>[]>) => acrossUnlocked(COMMON.filter((def) => def.across), bySet.get(id) ?? []),
    };
    const server = createAppServer({ distDir, gamefilesDir }, api);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
        const answerOf = async (response: Response): Promise<Answer> => {
            const body = await response.text();
            bodies.push(body);
            const json = (response.headers.get('content-type') ?? '').includes('json') ? JSON.parse(body) as Record<string, unknown> : { error: body };
            return { status: response.status, headers: response.headers, body, json };
        };
        let address = 0;
        /** A proof's form posted as `player`, from an address of its own unless `ip` names one. */
        const send = async (player: string | null, form: FormData | string, ip = `10.8.0.${++address}`, headers: Record<string, string> = {}) =>
            answerOf(await fetch(`${base}/${PROOFS_ROUTE}`, {
                method: 'POST', body: form,
                headers: { 'X-Real-IP': ip, ...(player === null ? {} : { [PLAYER_ID_HEADER]: player }), ...headers },
            }));
        const formOf = (pkg: Uint8Array<ArrayBuffer> | null, claims: string | null, extra: Record<string, string> = {}) => {
            const form = new FormData();
            if (pkg) form.append(PROOF_FIELDS.package, new File([pkg], 'proof.gz', { type: 'application/gzip' }));
            if (claims !== null) form.append(PROOF_FIELDS.claims, claims);
            for (const [name, value] of Object.entries(extra)) form.append(name, value);
            return form;
        };
        const verdicts = async (player: string | null, ids: string) => answerOf(await fetch(`${base}/${PROOFS_ROUTE}?ids=${ids}`, {
            headers: player === null ? {} : { [PLAYER_ID_HEADER]: player },
        }));
        const rows = () => (db.prepare('SELECT COUNT(*) AS n FROM proofs').get() as { n: number }).n;
        const files = () => readdirSync(proofsDir).length;
        const won = await packageOf('a', 'Won');
        const claims = JSON.stringify(['first-blood', 'roll-the-credits']);

        // Who sends one.
        console.log('Who sends a proof:');
        const nameless = await send(NAMELESS, formOf(won, claims));
        check(nameless.status === 403 && nameless.json.error === 'Only a player with a public name sends a proof.', `a player with no name: 403, "${nameless.json.error}"`);
        const named = (player: string, name: string) => fetch(`${base}/${PROFILE_ROUTE}`, {
            method: 'POST', headers: { [PLAYER_ID_HEADER]: player, 'X-Real-IP': `10.8.9.${++address}` }, body: JSON.stringify({ action: 'name', name }),
        }).then((response) => response.json() as Promise<{ id: string; key: string }>);
        const tehel = await named(PLAYER, 'Tehel');
        const linked = await fetch(`${base}/${PROFILE_ROUTE}`, {
            method: 'POST', headers: { [PLAYER_ID_HEADER]: LINKED, 'X-Real-IP': `10.8.9.${++address}` }, body: JSON.stringify({ action: 'link', key: tehel.key }),
        });
        const reset = await named(NAMELESS, 'Reset Me');
        identities.reset(reset.id);
        const resetSent = await send(NAMELESS, formOf(won, claims));
        check(linked.status === 200 && resetSent.status === 403, `a name a moderator reset: 403 (${resetSent.status})`);
        check(rows() === 0 && files() === 0, 'and nothing written');

        // The form.
        console.log('\nThe form:');
        const plain = await send(PLAYER, 'not a form');
        check(plain.status === 400 && plain.json.error === 'The body is not multipart/form-data.', `a body that is not a form: 400, "${plain.json.error}"`);
        const tooMany = JSON.stringify(Array.from({ length: MAX_CLAIMS + 1 }, (_, i) => `a${i}`));
        const badForms: [FormData, string][] = [
            [formOf(won, null), 'a package without claims'], [formOf(null, claims), 'claims without a package'],
            [formOf(won, 'first-blood'), 'claims that are not JSON'], [formOf(won, '{"id": "first-blood"}'), 'claims that are no list'],
            [formOf(won, tooMany), `${MAX_CLAIMS + 1} claims`],
            [formOf(won, '["first-blood", "first-blood"]'), 'an id twice'], [formOf(won, '["First-Blood"]'), 'an id in capitals'],
            [formOf(won, '["-blood"]'), 'an id with a - first'], [formOf(won, `["${'a'.repeat(65)}"]`), 'an id of 65 characters'],
            [formOf(won, '[7]'), 'an id that is a number'], [formOf(won, claims, { note: 'hi' }), 'a field more'],
        ];
        for (const [form, why] of badForms) {
            const refused = await send(PLAYER, form);
            check(refused.status === 400 && String(refused.json.error).startsWith('The form is not'), `${why}: 400`);
        }
        const garbage = await send(PLAYER, formOf(new Uint8Array([1, 2, 3]), claims));
        check(garbage.status === 422 && String(garbage.json.error).startsWith('The package is refused:'), `a package that does not read: 422, "${garbage.json.error}"`);
        for (const [pkg, why, error] of [
            [await packageOf('nowhere', 'Elsewhere'), 'a set the site does not have', 'The site does not publish the set it plays.'],
            [await packageOf('p', 'Pending'), 'a set pending', 'The site does not publish the set it plays.'],
            [await packageOf('a', 'Moved', { dev: true }), 'a move of ?dev', 'It holds a move of ?dev, which earns nothing.'],
        ] as const) {
            const refused = await send(PLAYER, formOf(pkg, claims));
            check(refused.status === 422 && refused.json.error === error, `${why}: 422, "${refused.json.error}"`);
        }
        check(rows() === 0 && files() === 0, 'and nothing written');

        // A proof sent.
        console.log('\nA proof sent:');
        const sent = await send(PLAYER, formOf(won, claims));
        const id = String(sent.json.id);
        console.log(`  ${sent.status} ${sent.body}`);
        check(sent.status === 201 && PROOF_ID.test(id) && Object.keys(sent.json).length === 1 && sent.headers.get('cache-control') === 'no-store',
            'a player with a name: 201, its id alone, not cached');
        const row = proofs.get(id);
        check(row !== null && row.state === 'queued' && row.dataSet === 'a' && row.player === PLAYER && row.level === 0 && row.kept && row.playthrough === null
            && existsSync(join(proofsDir, `${id}.gz`)) && files() === 1, 'its row queued at the package\'s level, its file kept');
        check(JSON.stringify(proofs.claims(id)) === '[{"achievement":"first-blood","state":"unverified","claimed":true},{"achievement":"roll-the-credits","state":"unverified","claimed":true}]',
            'its claims, unverified');
        check(proofs.next()?.id === id, 'the verifier\'s next');
        const served = await fetch(`${base}/proofs/${id}.gz`);
        check(served.status === 404, `its file is never served: ${served.status}`);
        const own = await verdicts(PLAYER, id);
        const expected: ProofVerdict = { id, state: 'queued', claims: { 'first-blood': 'unverified', 'roll-the-credits': 'unverified' } };
        console.log(`  its verdicts: ${own.body}`);
        check(own.status === 200 && JSON.stringify(own.json) === JSON.stringify({ proofs: [expected] }) && own.headers.get('cache-control') === 'no-store',
            'its verdicts to its sender: queued, each claim unverified, not cached');
        const asLinked = await verdicts(LINKED, `${id},${id},0123456789ABCDEF`);
        check(asLinked.status === 200 && JSON.stringify(asLinked.json) === JSON.stringify({ proofs: [expected] }),
            'and to a browser their key linked, once, an unknown id left out');
        const asStranger = await verdicts(STRANGER, id);
        check(asStranger.status === 200 && JSON.stringify(asStranger.json) === '{"proofs":[]}', 'to anybody else, nothing');
        for (const [ids, why] of [['', 'no id'], [id.toLowerCase(), 'an id in lowercase'], [`${id};${id}`, 'ids a ; apart'],
            [Array.from({ length: MAX_CLAIMS + 1 }, () => id).join(','), `${MAX_CLAIMS + 1} ids`]] as const) {
            const refused = await verdicts(PLAYER, ids);
            check(refused.status === 400, `${why}: 400`);
        }
        check((await verdicts(null, id)).status === 400, 'no player: 400');
        const profile = await answerOf(await fetch(`${base}/${PROFILE_ROUTE}`, { headers: { [PLAYER_ID_HEADER]: PLAYER } }));
        check(JSON.stringify(profile.json.achievements) === '[]', 'the profile lists no achievement while its proof is queued');

        // The limits.
        console.log('\nThe limits:');
        for (let n = 1; n < MAX_QUEUED_PER_IDENTITY; n++) {
            const more = await send(n % 2 === 0 ? PLAYER : LINKED, formOf(won, claims));
            if (more.status !== 201) check(false, `proof ${n + 1} queued: ${more.status} ${more.body}`);
        }
        const full = await send(LINKED, formOf(won, claims));
        check(full.status === 429 && rows() === MAX_QUEUED_PER_IDENTITY,
            `${MAX_QUEUED_PER_IDENTITY} queued of one identity's browsers, the next refused: 429, "${full.json.error}"`);
        const large = await send(PLAYER, formOf(new Uint8Array(MAX_PROOF_BYTES + 1), claims));
        check(large.status === 413, `a body over ${MAX_PROOF_BYTES} bytes: 413`);
        const crossSite = await send(PLAYER, formOf(won, claims), undefined, { 'Sec-Fetch-Site': 'cross-site' });
        check(crossSite.status === 403, 'a POST another site sent: 403');
        const rate = [];
        for (let n = 0; n <= PROOFS_PER_WINDOW; n++) rate.push((await send(NAMELESS, formOf(won, claims), '10.8.200.1')).status);
        check(rate.slice(0, -1).every((status) => status === 403) && rate[PROOFS_PER_WINDOW] === 429,
            `the rate per address, refused ones included: ${rate.join(', ')}`);

        const smallDir = join(scratch, 'small');
        mkdirSync(smallDir);
        const small = createAppServer({ distDir, gamefilesDir }, {
            ...api, proofs: { store: new ProofStore(openStore(':memory:'), won.length - 1), dir: smallDir, rateLimit: new RateLimit(100, 60_000) },
        });
        await new Promise<void>((done) => small.listen(0, '127.0.0.1', done));
        try {
            const form = formOf(won, claims);
            const response = await fetch(`http://127.0.0.1:${(small.address() as AddressInfo).port}/${PROOFS_ROUTE}`, { method: 'POST', body: form, headers: { [PLAYER_ID_HEADER]: PLAYER } });
            check(response.status === 507 && readdirSync(smallDir).length === 0, `a package past the disk the proofs may take: ${response.status}, nothing written`);
            bodies.push(await response.text());
        } finally {
            small.close();
        }

    } finally {
        server.close();
        db.close();
        rmSync(scratch, { recursive: true, force: true });
    }
}

/** The verifier over the repository's sets, as the deployed one runs it, the replay the page's source. */
async function verifier(): Promise<void> {
    console.log('\nThe verifier:');
    const scratch = mkdtempSync(join(tmpdir(), 'csbweb-verifier-'));
    const distDir = join(scratch, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>page</title>');
    const proofsDir = join(scratch, 'proofs');
    mkdirSync(proofsDir);
    const gamefilesDir = join(process.cwd(), GAMEFILES_DIR);
    const db = openStore(join(scratch, 'store.db'));
    const dataSets = new DataSetStore(db);
    dataSets.fill(parseManifest(readFileSync(MANIFEST_FILE, 'utf8'), ''));
    const identities = new IdentityStore(db);
    const proofs = new ProofStore(db, 1 << 30);
    const api = {
        checkDataSet: checkLocalDataSet, dataSets, moderators: parseModerators(`${MODERATOR}=Alice`), store: new StatsStore(db), notify: () => {},
        rules: { hasSet: (id: string) => dataSets.hasSet(id) }, rateLimit: new RateLimit(100, 60_000), eventBudget: new RateLimit(1000, 60_000),
        publishRateLimit: new RateLimit(100, 60_000), now: Date.now,
        recordings: { store: new RecordingStore(db, 1 << 30), dir: join(scratch, 'recordings'), readPackage: readRecordingPackage, shareRateLimit: new RateLimit(100, 60_000) },
        identities: { store: identities, rateLimit: new RateLimit(100, 60_000) },
        proofs: { store: proofs, dir: proofsDir, rateLimit: new RateLimit(100, 60_000) },
        achievementDefs: () => COMMON,
        achievementsAcross: (id: string, bySet: ReadonlyMap<string, readonly Readonly<Record<string, number>>[]>) => acrossUnlocked(COMMON.filter((def) => def.across), bySet.get(id) ?? []),
    };
    const server = createAppServer({ distDir, gamefilesDir }, api);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const options: VerifyOptions = {
        proofs, identities, dataSets, dir: proofsDir, gamefilesDir, digests: new FileDigestCache(), now: Date.now,
        replay: (bytes, limit, sets) => replayProof(bytes, limit, sets, () => COMMON),
    };
    try {
        await fetch(`${base}/${PROFILE_ROUTE}`, { method: 'POST', headers: { [PLAYER_ID_HEADER]: PLAYER }, body: JSON.stringify({ action: 'name', name: 'Tehel' }) });
        const send = async (pkg: Uint8Array<ArrayBuffer>, claims: string[]): Promise<string> => {
            const form = new FormData();
            form.append(PROOF_FIELDS.package, new File([pkg], 'proof.gz'));
            form.append(PROOF_FIELDS.claims, JSON.stringify(claims));
            const answer = await fetch(`${base}/${PROOFS_ROUTE}`, { method: 'POST', body: form, headers: { [PLAYER_ID_HEADER]: PLAYER } });
            const body = await answer.text();
            bodies.push(body);
            if (answer.status !== 201) throw new Error(`a proof refused: ${answer.status} ${body}`);
            return (JSON.parse(body) as { id: string }).id;
        };
        const verdictsOf = async (ids: string[]): Promise<ProofVerdict[]> => {
            const answer = await fetch(`${base}/${PROOFS_ROUTE}?ids=${ids.join(',')}`, { headers: { [PLAYER_ID_HEADER]: PLAYER } });
            const body = await answer.text();
            bodies.push(body);
            return (JSON.parse(body) as { proofs: ProofVerdict[] }).proofs;
        };
        const corpus = (name: string) => new Uint8Array(readFileSync(join(CORPUS_DIR, name)));

        check(await verifyNext(options) === null, 'nothing queued: nothing done');
        const genuine = corpus('replay-saves-written-over.L5.gz');
        const forged = await send(genuine, ['roll-the-credits']);
        const again = await send(genuine, ['first-blood']);
        const set = dataSetNamed('dm-atari');
        const quietBytes = await quietPackage(set, diskFiles(set), 'Quiet', 600);
        const lost = await send(quietBytes, ['first-blood']);
        const quiet = await readRecordingPackage(quietBytes);
        if (quiet.shared.kind !== 'save') throw new Error('quietPackage is no longer shared at a save');
        const drifting = await send(new Uint8Array(await writeRecordingPackage({ ...quiet, shared: { ...quiet.shared, md5: '0'.repeat(32) } })), ['first-blood']);
        const elsewhere = await send(await packageOf('dm-atari', 'Elsewhere'), ['first-blood']);
        const figured = await send(genuine, []);

        const done = [];
        for (let step = await verifyNext(options); step !== null; step = await verifyNext(options)) {
            console.log(`  ${JSON.stringify(step)}`);
            done.push(step);
        }
        check(JSON.stringify(done.map((step) => step.id)) === JSON.stringify([forged, again, lost, drifting, elsewhere, figured]), 'each queued proof replayed once, the oldest first');
        const [first, second, third, fourth, fifth, sixth] = done;
        check(first?.state === 'checked' && JSON.stringify(first.verified) === '["first-blood"]' && JSON.stringify(first.dropped) === '["roll-the-credits"]'
            && JSON.stringify(first.own) === '["first-blood"]' && first.kept && existsSync(join(proofsDir, `${forged}.gz`)),
            'a genuine recording claiming what it does not unlock: the claim dropped, First Blood granted unclaimed, its file kept');
        check(proofs.get(forged)?.playthrough !== null && JSON.stringify(proofs.claims(forged))
            === '[{"achievement":"first-blood","state":"verified","claimed":false},{"achievement":"roll-the-credits","state":"dropped","claimed":true}]',
            'its playthrough read by the replay, its claims verdicts');
        check(second?.state === 'checked' && JSON.stringify(second.verified) === '["first-blood"]' && second.own.length === 0 && !second.kept
            && !existsSync(join(proofsDir, `${again}.gz`)) && proofs.get(again)?.kept === false,
            'the same game claiming First Blood: verified, but not its own, its file deleted');
        check(third?.state === 'checked' && third.verified.length === 0 && JSON.stringify(third.dropped) === '["first-blood"]' && !third.kept,
            'a new game left alone claiming First Blood: dropped, its file deleted');
        check(fourth?.state === 'drifted' && fourth.reason !== '' && fourth.kept && existsSync(join(proofsDir, `${drifting}.gz`))
            && proofs.claims(drifting).every((claim) => claim.state === 'unverified'),
            `a package whose save differs: drifted, "${fourth?.reason}", its claims unverified, its file kept`);
        check(fifth?.state === 'drifted' && fifth.reason.length > 0, `a package made by hand: drifted, "${fifth?.reason}"`);
        const figuresOf = (id: string) => JSON.stringify(db.prepare('SELECT key, value FROM proof_figures WHERE proof = ? ORDER BY key').all(id).map((row) => [row.key, row.value]));
        console.log(`  the figures kept: ${figuresOf(figured)}`);
        check(sixth?.state === 'checked' && sixth.own.length === 0 && !sixth.kept && proofs.claims(figured).every((claim) => !claim.claimed)
            && figuresOf(figured) === JSON.stringify([[`total(${COMMON.find((def) => def.id === 'dungeon-janitor')!.aggregates[0]!.key})`, 2]]) && figuresOf(forged) === figuresOf(figured),
            'the same game claiming nothing, for its figures: checked, its two kills kept as its figures, its file deleted');
        check(figuresOf(drifting) === '[]' && figuresOf(lost) === '[]', 'a drifted proof keeps no figure, nor a game with nothing above 0');

        const verdicts = await verdictsOf([forged, again, lost, drifting]);
        console.log(`  the verdicts: ${JSON.stringify(verdicts)}`);
        check(JSON.stringify(verdicts) === JSON.stringify([
            { id: forged, state: 'checked', claims: { 'first-blood': 'verified', 'roll-the-credits': 'dropped' } },
            { id: again, state: 'checked', claims: { 'first-blood': 'verified' } },
            { id: lost, state: 'checked', claims: { 'first-blood': 'dropped' } },
            { id: drifting, state: 'drifted', reason: fourth?.reason, claims: { 'first-blood': 'unverified' } },
        ]), 'the verdicts as the page asks them: verified, dropped, and the drift\'s reason');
        const profile = await fetch(`${base}/${PROFILE_ROUTE}`, { headers: { [PLAYER_ID_HEADER]: PLAYER } }).then((answer) => answer.text());
        bodies.push(profile);
        const achievements = (JSON.parse(profile) as { achievements: unknown }).achievements;
        console.log(`  the profile's achievements: ${JSON.stringify(achievements)}`);
        check(JSON.stringify(achievements) === JSON.stringify([{ dataSet: 'dm-atari-1.2', name: dataSets.read().dataSets.find((set) => set.id === 'dm-atari-1.2')?.name, unlocked: ['first-blood'] }]),
            'the profile lists First Blood once, by its set');

        // A moderator watching the proofs: the identity's, the latest first, then a package
        // kept, to them alone.
        const identityId = identities.of(PLAYER)?.id ?? '';
        const moderated = await fetch(`${base}/${IDENTITIES_ROUTE}/${identityId}`, { headers: { [PLAYER_ID_HEADER]: MODERATOR } });
        const moderatedBody = await moderated.text();
        bodies.push(moderatedBody);
        const listed = (JSON.parse(moderatedBody) as ModeratedIdentity).proofs;
        console.log(`  to a moderator: ${JSON.stringify(listed.map(({ id, state, kept, claims }) => ({ id, state, kept, claims })))}`);
        const byId = new Map(listed.map((proof) => [proof.id, proof]));
        check(moderated.status === 200 && moderated.headers.get('cache-control') === 'no-store' && listed.length === 6
            && listed.every((proof, i) => i === 0 || proof.sentAt <= listed[i - 1]!.sentAt)
            && [forged, again, lost, drifting, elsewhere, figured].every((id) => byId.has(id))
            && JSON.stringify(byId.get(forged)?.claims) === JSON.stringify({ 'first-blood': 'verified', 'roll-the-credits': 'dropped' })
            && byId.get(forged)?.kept === true && byId.get(again)?.kept === false && byId.get(drifting)?.reason === fourth?.reason
            && byId.get(forged)?.name === dataSets.read().dataSets.find((one) => one.id === 'dm-atari-1.2')?.name,
            'a moderator reads the identity\'s proofs, uncached, the latest first: each its set, its state, its drift\'s reason, whether its package is kept, and its claims');
        const packageAs = (player: string | null, id: string, method = 'GET') => fetch(`${base}/${PROOFS_ROUTE}/${id}`, { method, headers: player === null ? {} : { [PLAYER_ID_HEADER]: player } });
        const served = await packageAs(MODERATOR, forged);
        const servedBytes = new Uint8Array(await served.arrayBuffer());
        check(served.status === 200 && served.headers.get('content-type') === 'application/gzip' && served.headers.get('cache-control') === 'no-store'
            && Buffer.from(servedBytes).equals(Buffer.from(genuine)), 'a kept package, to a moderator: its bytes, as sent, not cached');
        const refusedPackages = [await packageAs(PLAYER, forged), await packageAs(null, forged), await packageAs(MODERATOR, again), await packageAs(MODERATOR, '0'.repeat(16)),
            await packageAs(MODERATOR, 'not-a-proof'), await packageAs(MODERATOR, forged, 'DELETE')];
        for (const answer of refusedPackages) bodies.push(await answer.text());
        check(refusedPackages.map((answer) => answer.status).join() === '403,403,404,404,404,405',
            `to its own sender and to nobody 403, a package deleted, an unknown id and a malformed one 404, another method 405: ${refusedPackages.map((answer) => answer.status).join()}`);
    } finally {
        server.close();
        db.close();
        rmSync(scratch, { recursive: true, force: true });
    }
}

await main();
await verifier();
const leaks = bodies.filter((body) => PLAYER_IDS.some((player) => body.includes(player)) || body.includes('playthrough'));
check(leaks.length === 0, `no answer of ${bodies.length} holds a playerId or a playthrough`);
finish();
