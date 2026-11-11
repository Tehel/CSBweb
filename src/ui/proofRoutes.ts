/**
 * The server's proofs as the page reaches them (`doc/ACHIEVEMENTS.md` → "Proofs",
 * `server/proofs.ts`): whether this browser's player has a public name (`PROFILE_ROUTE`), a
 * proof sent, and the verdicts asked (`PROOFS_ROUTE`), each naming the player by the
 * browser's `playerId`. The game's page hands them to its `PageProofs` (`src/main.ts`), and
 * the welcome page's book asks the verdicts before it lists the achievements
 * (`welcomePage.ts`).
 */
import { PLAYER_ID_HEADER, PROFILE_ROUTE, PROOF_FIELDS, PROOF_ID, PROOFS_ROUTE, type PlayerProfile, type ProofVerdict } from '../data/DataSets';
import { keptPlayerId } from './gameEvents';

/** Whether this browser's player has a public name, as the server says: never, for a browser that keeps no `playerId`. */
export async function hasPublicName(): Promise<boolean> {
    const player = keptPlayerId();
    if (player === null) return false;
    const response = await fetch(PROFILE_ROUTE, { headers: { [PLAYER_ID_HEADER]: player } }).catch(() => null);
    if (!response?.ok) return false;
    const profile = await response.json().catch(() => null) as PlayerProfile | null;
    return Boolean(profile?.identity?.name);
}

/** `bytes`, a package, sent claiming `claims`: the proof's id, or a throw saying why not. */
export async function sendProof(bytes: Uint8Array, claims: readonly string[]): Promise<string> {
    const player = keptPlayerId();
    if (player === null) throw new Error('this browser keeps no playerId');
    const form = new FormData();
    form.append(PROOF_FIELDS.package, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/gzip' }), 'proof.gz');
    form.append(PROOF_FIELDS.claims, JSON.stringify(claims));
    const response = await fetch(PROOFS_ROUTE, { method: 'POST', headers: { [PLAYER_ID_HEADER]: player }, body: form });
    const json = await response.json().catch(() => null) as { id?: unknown; error?: unknown } | null;
    if (response.status === 201 && typeof json?.id === 'string' && PROOF_ID.test(json.id)) return json.id;
    throw new Error(typeof json?.error === 'string' ? json.error : `the server answered HTTP ${response.status}`);
}

/** The verdicts of the proofs `ids` this browser's identity sent, as the server answers them; a throw where it does not. */
export async function askVerdicts(ids: readonly string[]): Promise<readonly ProofVerdict[]> {
    const player = keptPlayerId();
    if (player === null || ids.length === 0) return [];
    const response = await fetch(`${PROOFS_ROUTE}?ids=${ids.join(',')}`, { headers: { [PLAYER_ID_HEADER]: player } });
    if (!response.ok) throw new Error(`the server answered HTTP ${response.status}`);
    return ((await response.json()) as { proofs: ProofVerdict[] }).proofs;
}
