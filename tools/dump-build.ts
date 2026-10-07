/**
 * What a build ships (PLAN.md Phase 17, step 2): the page, and none of `static/`.
 *
 * Builds with the project's own `vite.config.mts` (the CLI, as `npm run build` does) into a
 * scratch folder, lists every file,
 * and asserts:
 *   - every file is `index.html` or under `assets/`, of a type the page itself is made of:
 *     no `.dat`, no `.pdf`, nothing of `static/`;
 *   - every local `href` and `src` in `index.html` names a file the build holds;
 *   - the CRT's scanlines are in the bundle, not fetched by a name the build no longer
 *     serves;
 *   - the bundle hands the probes no `window.__probe`, which only a build made with
 *     `CSBWEB_PROBE=1` does (`vite.config.mts`): the image the golden frames check.
 *
 * Usage: npx tsx tools/dump-build.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE_TYPES = new Set(['.html', '.js', '.css', '.ico', '.png']);

let failures = 0;
function check(ok: boolean, what: string): void {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
    if (!ok) failures++;
}

function listFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const path = join(dir, e.name);
        return e.isDirectory() ? listFiles(path) : [path];
    });
}

async function main(): Promise<void> {
    const outDir = mkdtempSync(join(tmpdir(), 'csbweb-build-'));
    try {
        const vite = spawnSync(resolve(ROOT, 'node_modules/.bin/vite'),
            ['build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'],
            { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CSBWEB_PROBE: undefined } });
        if (vite.status !== 0) throw new Error(`vite build failed:\n${vite.stdout}${vite.stderr}`);

        const files = listFiles(outDir).map((f) => relative(outDir, f)).sort();
        let total = 0;
        console.log('The build:');
        for (const f of files) {
            const size = statSync(join(outDir, f)).size;
            total += size;
            console.log(`  ${String(size).padStart(8)}  ${f}`);
        }
        console.log(`  ${String(total).padStart(8)}  in all`);

        console.log('\nChecks:');
        const strays = files.filter((f) => f !== 'index.html' && !f.startsWith('assets/'));
        check(strays.length === 0, `every file is index.html or under assets/${strays.length ? `: not ${strays.join(', ')}` : ''}`);
        const foreign = files.filter((f) => !PAGE_TYPES.has(f.slice(f.lastIndexOf('.'))));
        check(foreign.length === 0, `every file is of the page's own types${foreign.length ? `: not ${foreign.join(', ')}` : ''}`);
        check(!files.some((f) => f.includes('gamefiles')), 'no game files');

        const html = readFileSync(join(outDir, 'index.html'), 'utf8');
        const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1])
            .filter((u) => !/^(?:[a-z]+:|#)/i.test(u));
        check(refs.length >= 2, `index.html names its script and its icon (${refs.join(', ')})`);
        const missing = refs.filter((u) => !files.includes(u.replace(/^\.\//, '')));
        check(missing.length === 0, `every file index.html names is in the build${missing.length ? `: not ${missing.join(', ')}` : ''}`);

        const bundle = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, f), 'utf8')).join('');
        check(!bundle.includes('QPN59'), 'the bundle fetches no scanlines by their old name');
        check(/data:image\/png;base64,|crt-scanlines-[\w-]+\.png/.test(bundle), 'the CRT scanlines are in the bundle, inlined or hashed');
        check(!bundle.includes('__probe'), 'the bundle hands the probes no handle');
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
