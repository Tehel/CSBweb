// Drive the running app and read its live state.
//
// Some bugs only exist on screen: the panel prints the wrong word, the click lands on the
// wrong champion, the object is in the chain but not drawn. `tools/dump-*.ts` cannot see
// those — they stand the engine up headlessly, without the UI. This drives the real page
// over the Chrome DevTools Protocol instead, through the `window.__probe` handle that
// `src/main.ts` exposes under the dev server's `__CSBWEB_PROBE__`.
//
// It starts a dev server and a headless Chrome if they are not already up, and leaves them
// running, so the second probe of a session costs one call instead of five.
//
//   node tools/probe-ui.mjs 'game.ctx.party.champions[0].name'
//   node tools/probe-ui.mjs --boot --shot /tmp/panel.png
//   node tools/probe-ui.mjs --click 15,15,right --shot /tmp/inv.png 'screen.ui.uiMode'
//   node tools/probe-ui.mjs --stop
//
// Actions run in the order given; the bare argument is the expression, evaluated last with
// `game`, `screen` and `renderView` in scope and printed as JSON.
//
// Deliberately NOT a test: nothing here asserts. Reproduce the bug in a `tools/dump-*.ts`
// once you know what it is — see the `playtest-bug` and `verification-tools` skills.
import { writeFileSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILD_PARTY } from './lib/buildParty.mjs';

const CDP = Number(process.env.CDP_PORT ?? 9222);
const APP = Number(process.env.DEV_PORT ?? 9000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** The `KeyboardEvent.code` of `key` on a US keyboard: the game's bindings match codes. */
const usCode = (key) => /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}`
  : /^[0-9]$/.test(key) ? `Digit${key}`
  : ({ ' ': 'Space', '`': 'Backquote', '~': 'Backquote', ',': 'Comma', '.': 'Period' })[key] ?? key;
const up = async (port, path = '/') => {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 800);
    await fetch(`http://127.0.0.1:${port}${path}`, { signal: c.signal });
    clearTimeout(t);
    return true;
  } catch { return false; }
};

const argv = process.argv.slice(2);
if (argv.includes('--stop')) {
  for (const pat of [`vite.*${APP}`, `remote-debugging-port=${CDP}`]) {
    try { execSync(`pkill -f "${pat}"`); } catch { /* nothing running */ }
  }
  console.log('stopped dev server and chrome');
  process.exit(0);
}
if (argv.includes('--help') || argv.length === 0) {
  console.log(`probe-ui — drive the running app and read its live state.

  node tools/probe-ui.mjs [actions...] ['expression']

Actions, applied in the order given:
  --boot              load ?intro=0 with a cleared localStorage and a seeded
                      Math.random, MAP VIEW on, and build the golden frames' party
                      at the Hall of Champions mirrors
  --key <K>           dispatch a keydown, e.g. --key ArrowUp, --key q: K is the key, and
                      its code the one a US keyboard gives
  --click X,Y[,right] click canvas pixel X,Y (0..319, 0..199); 'right' opens inventory
  --wait <ms>         pause
  --shot <file.png>   screenshot to file
  --stop              kill the dev server and chrome, then exit

The bare argument is evaluated last with game, screen and renderView in scope, and
printed as JSON:  node tools/probe-ui.mjs 'game.ctx.party.champions.map(c => c.name)'

Ports: DEV_PORT (9000), CDP_PORT (9222). Both daemons are started if absent and left up.`);
  process.exit(0);
}

// --- daemons -----------------------------------------------------------------
if (!(await up(APP))) {
  console.error(`starting dev server on :${APP}`);
  spawn('npm', ['run', 'dev', '--', '--port', String(APP), '--strictPort'],
    { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40 && !(await up(APP)); i++) await wait(500);
  if (!(await up(APP))) throw new Error(`dev server never came up on :${APP}`);
}
if (!(await up(CDP, '/json/version'))) {
  console.error(`starting headless chrome on :${CDP}`);
  spawn('google-chrome', [
    '--headless=new', `--remote-debugging-port=${CDP}`,
    `--user-data-dir=${join(tmpdir(), 'csbweb-probe-profile')}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1600,1000',
    `http://localhost:${APP}/?dungeon=dm-atari`,
  ], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40 && !(await up(CDP, '/json/version')); i++) await wait(500);
  if (!(await up(CDP, '/json/version'))) throw new Error(`chrome never came up on :${CDP}`);
  await wait(2500); // first paint
}

// --- CDP ---------------------------------------------------------------------
const page = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page');
if (!page) throw new Error('no page target; try --stop and run again');
if (typeof WebSocket === 'undefined') {
  console.error('probe-ui needs the global WebSocket: Node 22+, or NODE_OPTIONS=--experimental-websocket on Node 20-21');
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
    logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown')
    logs.push(`EXCEPTION: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const bad = r.result?.exceptionDetails;
  if (bad) throw new Error(bad.exception?.description ?? bad.text ?? JSON.stringify(bad));
  return r.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');

const probed = (expr) => `(() => { const p = window.__probe;
  if (!p) throw new Error('window.__probe missing — is this the dev server? try --boot');
  const { game, screen, renderView } = p;
  return JSON.parse(JSON.stringify((${expr}) ?? null, (k, v) =>
    typeof v === 'bigint' ? String(v) : v instanceof Map ? Object.fromEntries(v) : v));
})()`;

const boot = async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  // Seed the settings rather than clearing them, before the reload: no sound, and MAP
  // VIEW on, so the map dialog opens. Then seed Math.random so a boot is reproducible.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try {
      localStorage.clear();
      localStorage.setItem('csbweb_settings_v2', JSON.stringify({
        mapView: true, crt: false, sound: false }));
    } catch (e) {}
    let seed = 0x2545f491;
    Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
                          return ((seed >>> 0) % 1000000) / 1000000; };` });
  // `?intro=0`: straight into the dungeon, with no logo, title or entrance.
  await send('Page.navigate', { url: `http://localhost:${APP}/?intro=0&dungeon=dm-atari` });
  await wait(3500);
  // The golden frames' party, from the Hall of Champions mirrors.
  console.error('party:', await evaluate(BUILD_PARTY));
  await wait(600);
};
const click = async (spec) => {
  const [x, y, btn] = spec.split(',');
  const b = btn === 'right' ? 2 : 0;
  await evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
    const sx=r.left+${Number(x)}*r.width/320, sy=r.top+${Number(y)}*r.height/200;
    for (const t of ['pointerdown','pointerup'])
      c.dispatchEvent(new PointerEvent(t,{isPrimary:true,pointerType:'mouse',clientX:sx,clientY:sy,button:${b},buttons:${b === 2 ? 2 : 1},bubbles:true}));
    return 1;})()`);
  await wait(400);
};

let expr = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--boot') await boot();
  else if (a === '--key') { const k = argv[++i]; await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},code:${JSON.stringify(usCode(k))},bubbles:true})),1`); await wait(400); }
  else if (a === '--click') await click(argv[++i]);
  else if (a === '--wait') await wait(Number(argv[++i]));
  else if (a === '--shot') {
    const out = argv[++i];
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(out, Buffer.from(r.result.data, 'base64'));
    console.error('wrote', out);
  } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
  else expr = a;
}
if (expr !== null) console.log(JSON.stringify(await evaluate(probed(expr)), null, 2));
if (logs.length) console.error(`--- console errors ---\n${logs.join('\n')}`);
ws.close();
process.exit(0);
