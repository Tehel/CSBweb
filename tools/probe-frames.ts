// Golden-frame probe.
//
// Drives the running dev server over the Chrome DevTools Protocol — boot, enable Debug,
// build a party at the Hall of Champions mirrors, open a champion's inventory, select in
// it, open the attack menu —
// and writes a PNG per state.
//
// What it captures is the **320x200 screen as CSBWin draws it**, not a screenshot of the
// page, nor even the canvas's colours: the palette-index buffer the canvas was last given,
// and the palette each pixel went through (`ScreenComposer.presentedFrame`,
// `src/renderer/csbwin/PresentedFrame.ts`), written as `tools/lib/frames.ts` says. A
// renderer that draws a slot holding the same colour as the right one fails, and a change
// to how an Atari colour is shown on the canvas alone fails nothing. The page around the
// canvas is DOM debug chrome, drawn with the host's fonts and widget theme, and enters into
// nothing. `compare-frames.ts` then compares what the frames hold, so the PNG encoder does
// not enter into it either. Each frame is checked against the canvas as it is taken: every
// pixel of one code showed the same colour there, which is the colour the file keeps to be
// looked at.
//
// `Math.random` is seeded and localStorage cleared on every load, so the frames are
// identical run to run.
//
// A few things are asserted on the spot rather than compared as frames, since no frame
// shows them: the CRT effect, which screens take the mouse wheel, a move of the pointer
// left to the VBL's frame to paint, the keys of the entrance's chooser, the download its
// EXPORT starts, a file dropped on it, a finger held on the eye, a mouse released off
// the canvas, the settings dialog opened, held, changed and read back, its EXIT asking
// first and leading to the welcome page, the map dialog
// opened by a long press, but not with MAP VIEW off, its next level, a square and its items shown, the champion dialog opened by a
// long press on the bars, where a tap opens the inventory, and fullscreen, entered by a
// tap and a click, the screen and the effect sized and placed in it, at 16:10 and at 4:3,
// in it and out of it, and in the installed app's window, the save store held by another tab, and the welcome
// page: its tiles and their order, its fonts, its selection, where PLAY and CONTINUE go, and CONTINUE's save read
// straight into play, its form adding, editing, publishing and deleting a player's own set, the
// tiles' controls moderating a published one, the book listing its documents, a moderator adding
// and removing them, and each tile's name in its set's state's colour,
// to a moderator, its ABOUT, the statistics page its footer links to, and, against a page whose server sends a content security policy
// (`check-image.sh`), nothing it refuses. See `check` below.
// A failure there exits 1.
//
// Usage:
//   bash tools/check-frames.sh                     # normally: it starts both daemons
//
// or, driving it directly against daemons you started yourself:
//
//   npm run dev &
//   google-chrome --headless=new --remote-debugging-port=9222 \
//     --window-size=1600,1000 http://localhost:9000/ &
//   node tools/probe-frames.ts tools/frames        # refresh the committed baseline
//   node tools/probe-frames.ts /tmp/now            # then diff /tmp/now against it
//
// CDP_PORT overrides the DevTools port (default 9222), and APP_URL the page (the dev
// server on DEV_PORT, 9000), which must have `window.__probe`: the dev server's, or a
// build's made with `CSBWEB_PROBE=1` (`vite.config.mts`).
//
// This is the closest thing the project has to a rendering test (PLAN.md Phase 15) — it
// caught nothing during the Phase 14 split, which is exactly what it was there to do.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILD_PARTY } from './lib/buildParty.ts';
import { encodeFrame } from './lib/frames.ts';

const PORT = Number(process.env.CDP_PORT ?? 9222);
const DEV_PORT = Number(process.env.DEV_PORT ?? 9000);
// APP_URL: a page served elsewhere than the dev server, built with its probe handle
// (`check-frames.sh --url`).
const APP = process.env.APP_URL ?? `http://localhost:${DEV_PORT}/`;
const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
const page = (await res.json()).find((t: { type: string }) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map<number, (message: any) => void>();
const logs: string[] = [];
const downloads: string[] = [];
// What answers a request `Fetch.enable` paused, while a block stands in for the server.
let onPaused: ((params: { requestId: string; request: { url: string; method: string } }) => unknown) | null = null;
// What the next `Page.loadEventFired` resolves (`navigate`).
let onLoaded: (() => void) | null = null;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.loadEventFired') onLoaded?.();
  if (m.method === 'Browser.downloadWillBegin') downloads.push(m.params.suggestedFilename);
  if (m.method === 'Fetch.requestPaused') onPaused?.(m.params);
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error','warning'].includes(m.params.type))
    logs.push(m.params.type + ': ' + m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown')
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
};
await new Promise(r => { ws.onopen = r; });
// A protocol command's answer, the protocol's JSON.
const send = (method: string, params: object = {}) => new Promise<any>(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

// What the page's `expr` comes to, as JSON gives it back: typed where it is used.
const evaluate = async (expr: string): Promise<any> => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
// Read the canvas back as raw pixels. Base64 is built in 32k slices because
// `String.fromCharCode(...bytes)` on a whole 256000-byte frame overflows the argument
// limit, and character-by-character concatenation is far slower than it looks.
const CAPTURE_CANVAS = `(() => {
  const c = document.getElementById('game-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = '';
  for (let i = 0; i < d.length; i += 0x8000)
    s += String.fromCharCode.apply(null, d.subarray(i, Math.min(i + 0x8000, d.length)));
  return { width: c.width, height: c.height, data: btoa(s) };
})()`;
// The screen as last presented, and the canvas's colour for each of its codes, with the
// first pixel whose colour is not its code's.
const CAPTURE_FRAME = `(() => {
  const frame = window.__probe.screen.composer.presentedFrame();
  const c = document.getElementById('game-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const colours = {};
  let stray = null;
  frame.codes.forEach((code, i) => {
    const rgb = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    const was = colours[code];
    if (!was) colours[code] = rgb;
    else if (!stray && was.some((v, k) => v !== rgb[k])) stray = { x: i % frame.width, y: Math.floor(i / frame.width), code, was, rgb };
  });
  return { frame, colours, stray };
})()`;

const canvasPixels = async () => (await evaluate(CAPTURE_CANVAS)).data;
/** Writes the frame, and returns the canvas's pixels for the checks made on the spot. */
const shot = async (name: string) => {
  const { frame, colours, stray } = await evaluate(CAPTURE_FRAME);
  if (stray) check(false, `${name}: code ${stray.code} shows ${stray.was} on the canvas, and ${stray.rgb} at (${stray.x},${stray.y})`);
  writeFileSync(`${process.argv[2]}/${name}.png`, encodeFrame(frame, colours));
  console.log('  wrote', name + '.png', `(${frame.width}x${frame.height})`);
  return canvasPixels();
};
const failures: string[] = [];
const check = (ok: boolean, what: string) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };
// The CRT effect is a WebGL canvas, `#crt-canvas` (`createCrtEffect`, `src/lib/crt.ts`):
// absent where Chrome gives no WebGL context. Nothing about the effect can
// be checked then, and that fails the run rather than pass it unseen.
const crtEffect = () => evaluate(`(()=>{const gl=document.getElementById('crt-canvas');
  return !gl ? 'unavailable' : getComputedStyle(gl).display === 'none' ? 'off' : 'on';})()`);
// A named key's `code` is its `key`; the bindings match the code, the save menu the key.
const key = (k: string) => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},code:${JSON.stringify(k)},bubbles:true})),1`);
// Whether the game takes a notch of the wheel over the canvas, rather than leave it to the
// page: a save menu's list does, the disk menu's and the entrance's chooser's, and nothing
// else. That it scrolls the list is `tools/checks/save-menu.ts`'s to show.
const wheelTaken = () => evaluate(`(()=>{const e=new WheelEvent('wheel',{deltaY:100,cancelable:true,bubbles:true});
  document.getElementById('game-canvas').dispatchEvent(e); return e.defaultPrevented;})()`);
// button: 0 = left (DM mask 2), 2 = right (DM mask 1)
const canvasClick = (x: number, y: number, button = 0) => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  const sx=r.left+${x}*r.width/320, sy=r.top+${y}*r.height/200;
  for (const t of ['pointerdown','pointerup']) c.dispatchEvent(new PointerEvent(t,{isPrimary:true,pointerType:'mouse',clientX:sx,clientY:sy,button:${button},buttons:${button===2?2:1},bubbles:true}));
  return 1;})()`);
// A click as a player makes it: CDP's own mouse events at a point of the page, which the
// browser hit-tests, where `canvasClick` hands its events to the game canvas whatever lies
// over it.
const realClick = async (x: number, y: number) => {
  const p = await evaluate(`(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();
    return {x:r.left+(${x}+0.5)*r.width/320, y:r.top+(${y}+0.5)*r.height/200};})()`);
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
// `expr` true on the page, polled; a run that never sees it fails rather than hangs.
const until = async (expr: string, what: string, ms = 30000) => {
  for (const end = Date.now() + ms; ; await wait(50)) {
    if (await evaluate(expr).catch(() => false)) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
  }
};
// `url` loaded, then `ready` true on it. A change of the fragment alone loads nothing,
// and Chrome then names no loader.
// `act` leaves the page: the next one loaded, then `ready` true on it.
const leave = async (act: () => Promise<unknown>, ready: string) => {
  const loaded = new Promise<void>(r => { onLoaded = r; });
  await act();
  await loaded;
  onLoaded = null;
  await until(ready, 'the page it leads to');
};
const navigate = async (url: string, ready: string) => {
  const loaded = new Promise<void>(r => { onLoaded = r; });
  const { result } = await send('Page.navigate', { url });
  if (result?.loaderId) await loaded;
  onLoaded = null;
  await until(ready, url);
};
// What each page is ready at. The welcome page: drawn, from the store's answers, its fonts
// and thumbnails in. The statistics page: its band filled from `api/stats` (its set's half
// is waited for by `statsPage`). A game: started, and a tick past it, its first view drawn.
const WELCOME = `document.body.classList.contains('welcome') && !!document.getElementById('welcome-play')
  && document.fonts.status === 'loaded' && [...document.images].every(i => i.complete)`;
const STATS = `document.querySelector('.stats-band')?.childElementCount > 0 && document.fonts.status === 'loaded'`;
const GAME = `(async()=>{const g=window.__probe?.game; if(!g?.running) return false;
  const t=g.ctx.state.tickCount; for(let i=0;i<40&&g.ctx.state.tickCount===t;i++) await new Promise(r=>setTimeout(r,25));
  return g.ctx.state.tickCount!==t;})()`;
// An HTML page done with what a step set off: nothing under way, every image in, and its
// DOM unchanged for a tenth of a second (`__settle`, set on every page). What a step
// starts it does in its own task, so it is under way, or the DOM changed, by then.
const settled = () => evaluate(`(async()=>{const q=window.__settle, give=performance.now()+30000;
  while (q.pending > 0 || performance.now() - q.changed < 100 || ![...document.images].every((i) => i.complete)) {
    if (performance.now() > give) throw new Error('the page never settled, ' + q.pending + ' under way');
    await new Promise((r) => setTimeout(r, 10));
  }
  return 1;})()`);
// A page ready once loaded, the app's or not.
const LOADED = 'true';
// The pre-game screens (`introProbe`, `src/renderer/intro/BootSequence.ts`), which run no
// VBL of the game's. The entrance at rest is a screen of it waiting for a click or a key,
// its fades done: the door, the credits, the chooser and its menus. A click it takes stops
// the wait until its screen waits again. The chooser, a dialog of the screen's, plays its
// buttons' presses and reads a file on the page's own time (`SaveMenuState`): at rest,
// neither is under way.
const ENTRANCE = `(p => p?.intro.waiting === true && !p.screen.ui.saveMenu?.press && !p.screen.ui.saveMenu?.busy)(window.__probe)`;
// `n` of the game's VBLs (`Game.runFrame`) run from now, counted on the page. CSBWin takes
// a click or a key in a VBL, and draws the view only in a tick (`VBL_PER_TICK` VBLs): a step
// in play waits for a tick after the VBL taking it, one under a dialog, where the clock is
// held, for the VBL taking it and the one drawing it. Counted in VBLs, not milliseconds, a
// step waits as long as the game takes, however busy the machine. The entrance and the
// Hint Oracle run no VBL of the game's, and a long press, fullscreen and the CRT effect's
// context are the page's and the browser's timers: those still wait a time.
const VBL_PER_TICK = 15;
const TICK = VBL_PER_TICK + 1;
const SHOWN = 2;
const vbls = (n: number) => evaluate(`(async()=>{const g=window.__probe.game;
  if (g.__vbls === undefined) { g.__vbls = 0; const own = g.runFrame; g.runFrame = function () { this.__vbls++; return own.call(this); }; }
  const end = g.__vbls + ${n}, give = Date.now() + 10000;
  while (g.__vbls < end) {
    if (Date.now() > give) throw new Error('no VBL of the game\\'s for 10s');
    await new Promise((r) => setTimeout(r, 4));
  }
  return 1;})()`);

await send('Runtime.enable');
await send('Page.enable');
// What the server's policy refuses (`SECURITY_HEADERS`, `server/app.ts`), said on the
// console of every page loaded, and checked at the end. The dev server sends no policy.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  document.addEventListener('securitypolicyviolation', (e) => console.error('CSP: ' + e.effectiveDirective + ' refused ' + e.blockedURI));
` });
// What the page has under way, for `settled`: fetches and the reads of their answers, the
// store's requests and transactions, files read, images decoded and encoded; and when it
// last changed, its DOM or what it had under way.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const q = window.__settle = { pending: 0, changed: 0 };
  const begin = () => { q.pending++; q.changed = performance.now(); };
  const once = () => { let done = false; return () => { if (!done) { done = true; q.pending--; q.changed = performance.now(); } }; };
  const track = (owner, name) => { const own = owner[name]; if (!own) return;
    owner[name] = function (...args) { begin(); const end = once();
      try { return Promise.resolve(own.apply(this, args)).finally(end); } catch (e) { end(); throw e; } }; };
  track(window, 'fetch'); track(window, 'createImageBitmap');
  for (const name of ['arrayBuffer', 'blob', 'json', 'text']) track(Response.prototype, name);
  for (const name of ['arrayBuffer', 'text']) track(Blob.prototype, name);
  track(OffscreenCanvas.prototype, 'convertToBlob');
  for (const name of ['open', 'deleteDatabase']) { const own = IDBFactory.prototype[name];
    IDBFactory.prototype[name] = function (...args) { const request = own.apply(this, args); begin(); const end = once();
      for (const e of ['success', 'error']) request.addEventListener(e, end); return request; }; }
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) { const tx = transaction.apply(this, args); begin(); const end = once();
    for (const e of ['complete', 'abort', 'error']) tx.addEventListener(e, end); return tx; };
  new MutationObserver(() => { q.changed = performance.now(); })
    .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
})();` });
// The save menu's EXPORT downloads a file. Chrome is told to announce a download and keep
// none, so the run leaves nothing on the disk.
await send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true });
// Pin the viewport. The frames no longer depend on it — they are the canvas, not the page —
// but the click helper maps game coordinates through the canvas's bounding rect, so a
// window too small to lay the page out as intended would send clicks somewhere else.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
});
// Deterministic run: no persisted UI settings / quick-save, and a seeded Math.random —
// `AddCharacter` rolls food and water from it (`HallOfChampions.addCharacter`), so without the seed
// the status bars would differ run to run.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  // A page opened with \`keepsettings\` keeps the settings a page before it changed.
  if (!location.search.includes('keepsettings')) {
    try { localStorage.clear(); } catch (e) {}
  }
  // The save/load screen lists IndexedDB, so a frame of it would otherwise carry
  // whatever the last probe session saved. Both drivers of this script run Chrome on a
  // throwaway profile (probe-ui.ts and check-frames.sh both pass --user-data-dir), so
  // there is no real save to lose here.
  // A page opened with \`keepsaves\` keeps the store, so a game saved on one page can be
  // resumed from the entrance of the next.
  if (!location.search.includes('keepsaves')) {
    try { indexedDB.deleteDatabase('csbweb-saves'); } catch (e) {}
  }
  // The KEYS tab labels a key with what the machine's keyboard prints, where the browser
  // says (\`navigator.keyboard.getLayoutMap()\`): without it, a frame shows QWERTY's labels
  // on every machine.
  try { Object.defineProperty(Navigator.prototype, 'keyboard', { get: () => undefined, configurable: true }); } catch (e) {}
  let seed = 0x2545f491;
  Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
                        return ((seed >>> 0) % 1000000) / 1000000; };
` });
// The welcome page (`src/ui/welcomePage.ts`) of a store with no save: the manifest's
// default set, dm-atari-1.2, is selected, so PLAY opens it, and every tile is dimmed, in
// the manifest's order: the six Atari disks of Dungeon Master, its Amiga set, its Kid's dungeon and CSB,
// then the fan-made dungeons. The page with a save is checked further down.
const OFFICIAL = ['dm-atari-1.0a', 'dm-atari-1.0b', 'dm-atari-1.1', 'dm-atari-1.2', 'dm-atari-1.2-de', 'dm-atari-1.3-fr', 'dm-amiga', 'kids-dungeon', 'csb'];
await navigate(`${APP}?dungeon=nowhere`, WELCOME);
const firstVisit = await evaluate(`({tiles: [...document.querySelectorAll('.pick[data-set]')].map(t=>t.dataset.set+(t.classList.contains('dim')?'':'*')+(t.getAttribute('aria-pressed')==='true'?'!':'')).join(','),
  play: document.getElementById('welcome-play').getAttribute('href'),
  resume: document.getElementById('welcome-continue').getAttribute('href'),
  above: !!(document.querySelector('.welcome-actions').compareDocumentPosition(document.querySelector('.welcome-grid')) & Node.DOCUMENT_POSITION_FOLLOWING),
  sections: [...document.querySelectorAll('.welcome-sets')].map(s=>s.querySelector('h2').textContent+':'+[...s.querySelectorAll('.pick')].map(t=>t.dataset.set??'add').join('/')).join('|')})`);
console.log('state: welcome page, no save');
console.log('  ', JSON.stringify(firstVisit));
check(firstVisit.tiles === [...OFFICIAL, 'conflux-3.5', 'towers-of-chaos'].map((id) => id === 'dm-atari-1.2' ? `${id}!` : id).join()
  && /dungeon=dm-atari-1\.2(&|$)/.test(firstVisit.play ?? '') && firstVisit.resume === null && firstVisit.above,
  'no save: the official games in the manifest\'s order, then the others too, dm-atari-1.2 selected, PLAY opens it, CONTINUE disabled, the buttons above the grids');
check(firstVisit.sections === `Official games:${OFFICIAL.join('/')}|Fan-made dungeons:conflux-3.5/towers-of-chaos/add`,
  'two sections, each under its title: the official games, then the fan-made dungeons, "+ Add my own" last');

// A new server's answer, no set and no default: the grid holds only "+ Add my own", PLAY
// and CONTINUE are disabled, and the form it opens has no base set to offer.
onPaused = ({ requestId }) => send('Fetch.fulfillRequest', { requestId, responseCode: 200,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
  body: Buffer.from(JSON.stringify({ default: null, dataSets: [] })).toString('base64') });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/data-sets*' }] });
await navigate(`${APP}?dungeon=nowhere`, WELCOME);
await send('Fetch.disable');
onPaused = null;
const noSet = await evaluate(`(() => {
  const tiles = [...document.querySelectorAll('.welcome-grid .pick')].map(t=>t.classList.contains('add')?'add':t.dataset.set).join(',');
  const official = document.querySelector('.welcome-official').checkVisibility();
  const play = document.getElementById('welcome-play'), resume = document.getElementById('welcome-continue');
  document.querySelector('.pick.add').click();
  const form = document.querySelector('dialog.add-set[open]');
  return {tiles, play: play.getAttribute('href') ?? (play.getAttribute('aria-disabled') && 'disabled'),
    resume: resume.getAttribute('href') ?? (resume.getAttribute('aria-disabled') && 'disabled'),
    form: !!form, bases: form ? form.querySelectorAll('.add-set-base').length : -1, official};
})()`);
console.log('state: welcome page, no set');
console.log('  ', JSON.stringify(noSet));
check(noSet.tiles === 'add' && noSet.play === 'disabled' && noSet.resume === 'disabled' && noSet.form && noSet.bases === 0 && !noSet.official,
  'no set: only "+ Add my own", PLAY and CONTINUE disabled, no section of official games, and its form offers no base set');

// The fan-made dungeons with no save keep the manifest's order, the server's `position`,
// not their names': a manifest listing The Towers of Chaos before Conflux shows them so.
onPaused = ({ requestId }) => send('Fetch.fulfillRequest', { requestId, responseCode: 200,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
  body: Buffer.from(JSON.stringify({ default: null, dataSets: [
    { id: 'towers-of-chaos', name: 'The Towers of Chaos 3.3', dir: 'towers-of-chaos-3.3', csbGraphics: true },
    { id: 'conflux-3.5', name: 'Conflux 3.5', dir: 'conflux-3.5-b8', csbGraphics: true },
  ] })).toString('base64') });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/data-sets*' }] });
await navigate(`${APP}?dungeon=nowhere`, WELCOME);
await send('Fetch.disable');
onPaused = null;
const byPosition = await evaluate(`[...document.querySelectorAll('.welcome-custom .pick')].map(t=>t.classList.contains('add')?'add':t.dataset.set).join(',')`);
console.log('state: welcome page, fan-made dungeons out of name order');
console.log('  ', JSON.stringify(byPosition));
check(byPosition === 'towers-of-chaos,conflux-3.5,add', 'the fan-made dungeons with no save in the manifest\'s order, not by name');
// `?intro=0` skips the title animation and the dungeon entrance
// (`src/renderer/intro/BootSequence.ts`), so the six frames below still open on the
// adventure screen. The entrance gets frames of its own at the end.
await navigate(`${APP}?intro=0&dungeon=dm-atari`, GAME);
console.log('state: booted');            await shot('01-boot');
// The four champions, from the Hall of Champions mirrors (`tools/lib/buildParty.ts`).
await evaluate(BUILD_PARTY).then(names => console.log('  party:', names));
await vbls(TICK);
console.log('state: party built');       await shot('02-party');
// Right-click a party block (DM mask 1, button id 7) opens that champion's inventory.
await canvasClick(15, 15, 2);  await vbls(TICK);
console.log('state: inventory');
const inventory = await shot('03-inventory');
// The effect is shown the game canvas and paints nothing on it: its curve and scanlines are
// drawn on its own canvas, at the size it is shown. The pointer is read through the same
// curve, so a point of the tube is the screen pixel it shows: the middle stays where it is,
// and a point towards a corner shows a pixel nearer the corner, the picture being shrunk
// into the glass. Without the effect, the pointer is the plain scaling.
const hoverAt = (u: number, v: number) => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent('pointermove',{isPrimary:true,pointerType:'mouse',clientX:r.left+${u}*r.width,clientY:r.top+${v}*r.height,bubbles:true}));
  const p=window.__probe.screen.ui.hoverPoint; return p ? p.x+','+p.y : 'none';})()`);
// DISPLAY's SCANLINES (236,86) and SCREEN CURVE (236,107), in the settings dialog: Esc
// opens it, the tab is DISPLAY (120,45), and Esc closes it again over the inventory.
const SCANLINES: [number, number] = [236, 86];
const CURVE: [number, number] = [236, 107];
const toggleCrt = async ([x, y]: [number, number]) => {
  await key('Escape'); await vbls(SHOWN);
  await canvasClick(120, 45, 0); await vbls(SHOWN);
  await canvasClick(x, y, 0); await vbls(SHOWN);
  await key('Escape'); await vbls(SHOWN);
  await evaluate(`document.getElementById('game-canvas').dispatchEvent(new PointerEvent('pointerleave',{isPrimary:true,pointerType:'mouse'})),1`);
  await vbls(SHOWN);
};
await toggleCrt(SCANLINES);
const crtInPlay = await crtEffect();
check(crtInPlay !== 'unavailable', 'the CRT effect exists (without it this Chrome gives no WebGL context, and nothing below is checked)');
check(crtInPlay === 'on', 'DISPLAY\'s SCANLINES turns the effect on');
check(await canvasPixels() === inventory, 'CRT effect on: the game canvas keeps its pixels');
const tubeSize = await evaluate(`(()=>{const t=document.getElementById('crt-canvas');return t.width+'x'+t.height;})()`);
check(tubeSize === '960x600', `the effect is drawn at the size it is shown, 960x600 (${tubeSize})`);
// The effect draws a frame only once the game canvas has a new one, or the tube a new
// size (`createCrtEffect`): the tube's draws counted against the canvas's presents, for
// a second over the inventory, where little changes, and then a move of the pointer,
// which the VBL's frame presents. One draw may be pending from before the count.
await evaluate(`(()=>{const gl=document.getElementById('crt-canvas').getContext('webgl');
  const ctx=document.getElementById('game-canvas').getContext('2d');const n={draws:0,presents:0};window.__crtCount=n;
  const draw=gl.drawArrays,put=ctx.putImageData;window.__crtUncount=()=>{gl.drawArrays=draw;ctx.putImageData=put;};
  gl.drawArrays=function(...a){n.draws++;return draw.apply(this,a);};
  ctx.putImageData=function(...a){n.presents++;return put.apply(this,a);};return 1;})()`);
await wait(1000);
const crtIdle = await evaluate(`({...window.__crtCount})`);
check(crtIdle.draws <= crtIdle.presents + 1, `at rest, the effect draws only what is presented (${crtIdle.draws} draws, ${crtIdle.presents} presents)`);
await hoverAt(0.3, 0.3); await vbls(SHOWN);
const crtMoved = await evaluate(`(()=>{const n={...window.__crtCount};window.__crtUncount();return n;})()`);
check(crtMoved.presents > crtIdle.presents && crtMoved.draws > crtIdle.draws, `a present is drawn (${crtMoved.draws} draws, ${crtMoved.presents} presents)`);
check(await hoverAt(0.1, 0.1) === '32,20', 'the scanlines alone: the pointer is the plain scaling');
await toggleCrt(CURVE);
check(await hoverAt(0.5, 0.5) === '160,100', 'the curve on: the tube\'s middle is the screen\'s');
const curved = (await hoverAt(0.1, 0.1)).split(',').map(Number);
check(curved[0] < 32 && curved[1] < 20, `the curve on: the pointer at (32,20)'s place shows a pixel nearer the corner (${curved})`);
check(await hoverAt(0.002, 0.002) === '0,0', 'the curve on: a point of the tube\'s black corner is the screen\'s corner');
// A lost WebGL context hides the tube and the game canvas shows through, flat, so the
// pointer is read flat until the context is restored. The extension is kept from before
// the loss, after which the context gives none.
const loseContext = (how: 'loseContext' | 'restoreContext') => evaluate(`(()=>{window.__loseContext??=document.getElementById('crt-canvas').getContext('webgl').getExtension('WEBGL_lose_context');
  window.__loseContext.${how}();return 1;})()`);
await loseContext('loseContext'); await wait(300);
check(await hoverAt(0.1, 0.1) === '32,20', 'the WebGL context lost: the pointer is the plain scaling');
await loseContext('restoreContext'); await wait(300);
check((await hoverAt(0.1, 0.1)).split(',').map(Number).join() === curved.join(), 'and restored: the pointer is curved again');
await toggleCrt(SCANLINES);
check(await crtEffect() === 'on' && (await hoverAt(0.1, 0.1)).split(',').map(Number).join() === curved.join(),
  'the curve alone: the effect stays on, the pointer curved');
await toggleCrt(CURVE);
check(await crtEffect() === 'off', 'neither: the effect is off');
check(await hoverAt(0.1, 0.1) === '32,20', 'CRT effect off: the pointer is the plain scaling');
await evaluate(`document.getElementById('game-canvas').dispatchEvent(new PointerEvent('pointerleave',{isPrimary:true,pointerType:'mouse'})),1`);
// Take an item out of the inventory. (41,66) is button id 30, body slot 2, which the Hall
// of Champions fills for HALK with object 39027; selecting moves it out of the grid and
// into the cursor, so this frame differs from 03 by the vacated slot.
//
// It used to click (15,15) — the same point as the right-click above, which is button id
// 12, champion 0's *party block* in the top bar, not the inventory grid at all. Nothing
// moved on screen and 04 came out identical to 03, so the frame proved nothing beyond
// what 03 already proved. `compare-frames.ts` now refuses a baseline with two identical
// frames, which is what makes that mistake visible instead of silent.
await canvasClick(41, 66, 0);  await vbls(TICK);
console.log('state: inventory+select');  await shot('04-inventory-sel');
// Put it back, so the frames below are unaffected by the detour.
await canvasClick(41, 66, 0);  await vbls(TICK);
await canvasClick(15, 15, 2);  await vbls(TICK);   // back out
// Champion 0's attack button (233-252 x 86-120) opens the real attack menu, listing
// that champion's legal attacks. This used to be a dev-only F7 preview of a
// placeholder panel; the panel is now `ui/Attack.ts` driven by `word20252`.
await canvasClick(240, 100, 0); await vbls(TICK);
console.log('state: attack panel');      await shot('05-attack');
// The disk icon (`buttons17760[1]`, id 140) raises the save/load dialog over the whole
// screen, cleared. Reopen an inventory first — the attack-panel step backed out of it.
// The browser store was emptied on boot, so the list is reliably its "NEW SAVE" row alone
// and this frame pins the dialog itself: the frame, the two panels and the four buttons,
// all pieces of graphic 0, with LOAD and EXPORT unlabelled because that row holds no save
// to load or to export.
await canvasClick(15, 15, 2);  await vbls(TICK);
await canvasClick(177, 40, 0); await vbls(TICK);
console.log('state: save menu');         await shot('06-savemenu');
check(await wheelTaken(), 'the disk menu takes the wheel, for its list');
// A move of the pointer paints nothing: the VBL's frame draws the cursor where the mouse
// is by then, as CSBWin's VBL handler does. A mouse reports faster than the screen is
// composed, and a paint for each move kept the browser from showing any. The pointer
// leaves again, so that no later frame holds a cursor.
const moves = await evaluate(`(async()=>{const {screen}=window.__probe;const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  const g=c.getContext('2d'); let paints=0; const own=g.putImageData; g.putImageData=function(...a){paints++; return own.apply(this,a);};
  for (let i=0;i<50;i++) c.dispatchEvent(new PointerEvent('pointermove',{isPrimary:true,pointerType:'mouse',clientX:r.left+(100.5+i)*r.width/320,clientY:r.top+100.5*r.height/200,bubbles:true}));
  const during=paints; await new Promise(r=>setTimeout(r,200));
  const at=screen.ui.hoverPoint; delete g.putImageData;
  c.dispatchEvent(new PointerEvent('pointerleave',{isPrimary:true,pointerType:'mouse'})); await new Promise(r=>setTimeout(r,200));
  return {during, after:paints, at, left:screen.ui.hoverPoint===null};})()`);
console.log('  fifty moves of the pointer:', JSON.stringify(moves));
check(moves.during === 0, 'a move of the pointer paints nothing itself');
check(moves.after >= 1 && moves.after < 50 && moves.at.x === 149 && moves.at.y === 100, 'the VBL\'s frame draws the cursor where the pointer last was');
check(moves.left, 'the pointer gone, no cursor is left for the frames that follow');
// SAVE (x 95..143, y 161..174), a new save from that row, for the resume from the
// entrance below.
await canvasClick(120, 168, 0);
await until(`window.__probe.saves.list().then((rows) => rows.length > 0)`, 'the save');
// A delete is done only once its transaction commits (`BrowserSaveStore.remove`):
// one aborted after its request succeeded, as a quota or an I/O error aborts one, is a
// delete that failed, and the save is still listed, for the resume below.
const abortedDelete = await evaluate(`(async()=>{const {saves}=window.__probe;const own=IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete=function(key){const request=own.call(this,key);const tx=this.transaction;
    request.addEventListener('success',()=>tx.abort());return request;};
  try { const [entry]=await saves.list(); if (!entry) return 'no save';
    const told=await saves.remove(entry).then(()=>'done',()=>'failed');
    return told+', '+((await saves.list()).some(e=>e.id===entry.id)?'listed':'gone'); }
  finally { IDBObjectStore.prototype.delete=own; }})()`);
check(abortedDelete === 'failed, listed', `a delete whose transaction aborts fails, and the save is still listed (${abortedDelete})`);

// The dungeon entrance, with the intro left on: the FTL logo, the title animation and the
// entrance's own fade play first, and the frame is taken once the door waits for a click
// (`ENTRANCE`), when the screen is static until the player clicks.
//
// This is the only evidence that the corridor behind the doors actually renders. It is
// drawn by the real viewport renderer over a synthetic 5x5 level
// (`src/renderer/intro/PrisonLevel.ts`), and `tools/checks/intro.ts` can check the level and
// the compositing but not the pixels the bytecode programs produce.
// The welcome page (`src/ui/welcomePage.ts`): the page with no known `?dungeon=`, HTML and
// no game. The store holds the one save made above, of dm-atari, a hidden set, so no tile
// is bright, the tiles are in the manifest's order, none is selected, and CONTINUE reads that save while no set is selected. Each tile
// shows its set's thumbnail, and the page fetches no game file to draw them. A click
// selects a tile, and PLAY opens its set; a click on another set, with no save, leaves
// CONTINUE disabled; a click on the selected tile selects none. Then PLAY's own click,
// as a player makes it, is the way into the entrance below.
await navigate(`${APP}?dungeon=nowhere&keepsaves`, WELCOME);
const welcome = () => evaluate(`(()=>{const q=(s)=>[...document.querySelectorAll(s)];
  return { canvas: !!document.getElementById('game-canvas'),
    tiles: q('.pick[data-set]').map(t=>t.dataset.set+(t.classList.contains('dim')?'':'*')+(t.getAttribute('aria-pressed')==='true'?'!':'')).join(','),
    play: document.getElementById('welcome-play').getAttribute('href'),
    resume: document.getElementById('welcome-continue').getAttribute('href'),
    preview: q('.welcome-preview > *').map(e=>e.textContent),
    pictures: q('.pick[data-set]').map(t=>{const i=t.querySelector('.pick-picture img');
      return i && i.complete && i.naturalWidth===320 && i.naturalHeight===200
        && (i.src.endsWith('/'+t.dataset.set+'-thumbnail.png') || t.dataset.set.startsWith('local:') && i.src.startsWith('blob:'));}),
    saves: q('.pick[data-set]').map(t=>t.querySelector('.pick-saves')?.textContent ?? ''),
    last: (()=>{const t=document.querySelector('.welcome-custom .welcome-grid').lastElementChild;
      return t.className+(t.disabled?' disabled':'')+(t.hasAttribute('aria-pressed')?' pressed':'')+' '+t.textContent;})(),
    gameFiles: performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\.dat$/i.test(n)).length };})()`);
// The element scrolled into view first, should the page have grown under it.
// Then the page settled, unless the click leaves it.
const clickOn = async (selector: string, leaves = false) => {
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();
    return {x:r.left+r.width/2, y:r.top+r.height/2};})()`);
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  if (!leaves) await settled();
};
console.log('state: welcome page');
const atWelcome = await welcome();
console.log('  ', JSON.stringify(atWelcome));
const saveId = /[?&]save=([^&]+)/.exec(atWelcome.resume ?? '')?.[1];
check(!atWelcome.canvas && atWelcome.tiles === [...OFFICIAL, 'conflux-3.5', 'towers-of-chaos'].join(),
  'an unknown ?dungeon= is the welcome page, no game canvas, its tiles the sets not hidden, the hidden one with a save among none, in the manifest\'s order, none selected');
check(atWelcome.pictures.length === OFFICIAL.length + 2 && atWelcome.pictures.every(Boolean) && atWelcome.gameFiles === 0,
  'each tile shows its set\'s 320x200 thumbnail, <id>-thumbnail.png, and the page fetches no .dat');
check(atWelcome.play === null && /dungeon=dm-atari/.test(atWelcome.resume ?? '') && saveId !== undefined,
  'none selected: PLAY is disabled, CONTINUE reads the last save used, of any set, a hidden one\'s too');
check(atWelcome.preview.length === 3 && atWelcome.preview[0] === 'Dungeon Master' && atWelcome.preview[1].split(' · ').length === 4
  && /^Level \d+ · \d{4}-\d\d-\d\d \d\d:\d\d$/.test(atWelcome.preview[2]),
  'the box beside CONTINUE shows its set, its party of four, its level and when it was saved');
// The page's fonts. Its labels are in 'DM Screen', `src/assets/dm-screen.ttf`, and the
// browser draws it as the game draws its font: every character, at ten screen pixels to a
// font pixel, is its six rows of five pixels from dm-atari's graphics.dat (`gen-font.ts --rows`),
// with nothing in the sixth column or the row above and below, and an advance of six.
// Its prose is in Spectral, served with the page: no request leaves for Google Fonts.
const fontRows = JSON.parse(execFileSync('npx', ['tsx', 'tools/gen-font.ts', '--rows'],
  { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) }));
const fonts = await evaluate(`(async()=>{await document.fonts.ready; await document.fonts.load('80px "DM Screen"');
  const rows=${JSON.stringify(fontRows)}, P=10, wrong=[];
  const c=document.createElement('canvas'); c.width=16*P*7; c.height=Math.ceil(rows.length/16)*P*9;
  const g=c.getContext('2d',{willReadFrequently:true}); g.font='80px "DM Screen"'; g.textBaseline='alphabetic';
  rows.forEach(([code],i)=>g.fillText(String.fromCharCode(code),(i%16)*P*7,Math.floor(i/16)*P*9+P*6));
  const a=g.getImageData(0,0,c.width,c.height).data;
  rows.forEach(([code,glyph],i)=>{const x=(i%16)*P*7, top=Math.floor(i/16)*P*9+P;
    if(g.measureText(String.fromCharCode(code)).width!==6*P) wrong.push(code+' advance');
    for(let r=-1;r<=6;r++) for(let col=0;col<6;col++){
      const lit=a[((top+r*P+P/2)*c.width+x+col*P+P/2)*4+3]>127;
      const want=r>=0&&r<6&&col<5&&((glyph[r]>>(4-col))&1)===1;
      if(lit!==want){wrong.push(code+' '+r+','+col);return;}}});
  const face=[...document.fonts].find(f=>f.family.replace(/"/g,'')==='DM Screen');
  return {dm: face&&face.status, spectral: document.fonts.check('30px Spectral') && document.fonts.check('italic 30px Spectral'),
    google: performance.getEntriesByType('resource').filter(e=>/googleapis|gstatic/.test(e.name)).length,
    characters: rows.length, wrong};})()`);
console.log('  ', JSON.stringify(fonts));
check(fonts.dm === 'loaded' && fonts.characters > 90 && fonts.wrong.length === 0,
  "the labels' font is DM's, drawn as the game draws graphics.dat's font, every character");
check(fonts.spectral && fonts.google === 0, 'the prose is in Spectral, regular and italic, served with the page');
await clickOn('.pick[data-set="csb"]');
const atCsb = await welcome();
check(atCsb.tiles.includes('csb!') && /dungeon=csb/.test(atCsb.play ?? '') && !/save=/.test(atCsb.play ?? '')
  && atCsb.resume === null && atCsb.preview.join() === 'No saved game here yet',
  'a set with no save selected: PLAY opens it, CONTINUE is disabled');
await clickOn('.pick[data-set="csb"]');
check((await welcome()).play === null, 'a click on the selected tile selects none');
check(atWelcome.last === 'pick add +Add my own', 'the fan-made dungeons end with "+ Add my own", never selected');
// HOW TO PLAY (`src/ui/howToPlay.ts`): the page opened at `#how-to-play` shows its
// dialog, the moves, attacks and runes keyed as the player's settings have them, the 24
// runes the font's (U+E060 to U+E077, `gen-font.ts`). Its chooser's ARROWS makes the
// settings the ARROWS preset, stored, the sheet shown anew; CSBWIN KEYS puts them back.
// Its links to print are the sheets `tools/gen-help-sheet.ts` made for the preset shown,
// which are there, and the sheet is the text that tool recorded (`sheets.json`): a sheet
// changed without its files made again fails here. CLOSE takes the fragment off, and the
// page's button opens it again. Then the default set, dm-atari-1.2, is selected.
const howToPlay = () => evaluate(`(async()=>{const d=document.querySelector('dialog.how-to-play');
  const keys=(s)=>[...d.querySelectorAll(s)].map(c=>[...c.querySelectorAll('.how-key')].map(k=>k.textContent).join(' ')).join();
  return d && { open: d.open, hash: location.hash,
    preset: [...d.querySelectorAll('.how-choice input')].filter(i=>i.checked).map(i=>i.value).join(),
    stored: JSON.parse(localStorage.getItem('csbweb_settings_v2') ?? '{}').keyPreset ?? null,
    moves: keys('.how-pad-cell'), attacks: keys('.how-attacks .how-keys'), runeKeys: keys('.how-rune-table > .how-keys'),
    glyphs: [...d.querySelectorAll('.how-glyph')].map(g=>g.textContent.codePointAt(0).toString(16)).join(),
    font: getComputedStyle(d.querySelector('.how-glyph')).fontFamily,
    sheet: d.querySelector('.how-sheet').textContent,
    printed: await Promise.all(['.how-pdf', '.how-png'].map(async (s)=>{const a=d.querySelector(s);
      const r=a.href ? await fetch(a.href).catch(()=>null) : null; return a.download+(r?.ok ? ' '+r.headers.get('content-type') : ' missing');})) };})()`);
const printedSheets = JSON.parse(readFileSync(new URL('../src/assets/how-to-play/sheets.json', import.meta.url), 'utf8'));
await navigate(`${APP}?dungeon=nowhere&keepsaves#how-to-play`, WELCOME);
const help = await howToPlay();
console.log('  ', JSON.stringify(help));
check(help?.open === true && help.hash === '#how-to-play', 'the page at #how-to-play opens HOW TO PLAY');
check(help?.preset === 'csbwin' && help.moves === 'J KP 7,K KP 8,L KP 9,M KP 4,, KP 5,. KP 6'
  && help.attacks === 'Q,W,E,R,A,S,D,F,Z,X,C,V' && help.runeKeys === '1,2,3,4,5,6',
  'its sheet keys the moves, the attacks and the runes as the CSBWin preset does, the champions in columns');
check(help?.glyphs === Array.from({ length: 24 }, (_, i) => (0xe060 + i).toString(16)).join() && /DM Screen/.test(help.font),
  'its runes are the 24 glyphs, in the order the magic panel shows them, in the game\'s font');
check(help?.sheet === printedSheets['csbwin-qwerty']
  && help.printed.join() === 'csbweb-how-to-play-csbwin-qwerty.pdf application/pdf,csbweb-how-to-play-csbwin-qwerty.png image/png',
  'its PDF and PNG to print are the CSBWin preset\'s, in QWERTY, made from the sheet it shows');
await clickOn('.how-choice input[value="arrows"]');
const arrows = await howToPlay();
check(arrows?.preset === 'arrows' && arrows.stored === 'arrows' && arrows.moves === 'DELETE KP 7,UP KP 8,PAGE DOWN KP 9,LEFT KP 4,DOWN KP 5,RIGHT KP 6',
  'ARROWS in its chooser makes the settings the ARROWS preset, stored, and the sheet shows its moves');
check(arrows?.sheet === printedSheets['arrows-qwerty'] && arrows.printed.join() === 'csbweb-how-to-play-arrows-qwerty.pdf application/pdf,csbweb-how-to-play-arrows-qwerty.png image/png',
  'its PDF and PNG to print are then the ARROWS preset\'s, made from the sheet it shows');
await clickOn('.how-choice input[value="csbwin"]');
check((await howToPlay())?.stored === 'csbwin', 'CSBWIN KEYS puts the preset back');
await clickOn('#how-close');
check(await evaluate(`!document.querySelector('dialog.how-to-play') && location.hash === '' && /dungeon=nowhere/.test(location.search)`),
  'CLOSE closes it, and takes #how-to-play off the address');
await clickOn('#welcome-help');
const reopened = await howToPlay();
check(reopened?.open === true && reopened.hash === '#how-to-play', 'the page\'s HOW TO PLAY opens it');
await clickOn('#how-close');
// ABOUT (`src/ui/about.ts`): the page opened at `#about` shows its dialog, its questions
// each a title over its answer, the statistics' linking to the statistics page and naming
// the setting that sends none. CLOSE takes the fragment off, and the footer's ABOUT, a
// link to `#about`, opens it again.
const about = () => evaluate(`(()=>{const d=document.querySelector('dialog.about');
  return d && { open: d.open, hash: location.hash,
    questions: [...d.querySelectorAll('.about-question h3')].map(h=>h.textContent),
    statistics: [...d.querySelectorAll('.about-question')].filter(q=>q.querySelector('a[href="stats"]')).map(q=>q.querySelector('h3').textContent+(/SEND STATISTICS/.test(q.textContent)?'+':'')).join() };})()`);
await navigate(`${APP}?dungeon=nowhere&keepsaves#about`, WELCOME);
const aboutShown = await about();
console.log('  about:', JSON.stringify(aboutShown));
check(aboutShown?.open === true && aboutShown.hash === '#about' && aboutShown.questions.length === 7
  && aboutShown.statistics === 'What are the statistics?+',
  'the page at #about opens ABOUT, its seven questions, the statistics\' linking to the statistics page and naming SEND STATISTICS');
await clickOn('#about-close');
check(await evaluate(`!document.querySelector('dialog.about') && location.hash === '' && /dungeon=nowhere/.test(location.search)`),
  'CLOSE closes it, and takes #about off the address');
await clickOn('.welcome-footer nav a[href="#about"]');
const aboutAgain = await about();
check(aboutAgain?.open === true && aboutAgain.hash === '#about', 'the footer\'s ABOUT opens it');
await clickOn('#about-close');
await clickOn('.pick[data-set="dm-atari-1.2"]');
// The form that adds a set (`src/ui/addDataSetForm.ts`), which "+ Add my own" opens: its
// checklist, a row each for the name, the id and the six files, crossed where needed and
// missing or wrong, checked where right. CANCEL closes it. Then the player's own set
// (`src/data/LocalDataSets.ts`) is made through it: DM's dungeon.dat dropped with CSB's
// thumbnail, hcsb.hct, and a file none of a dungeon's, the game files under names that
// are not theirs; the id made from the name, then
// written; hcsb.hct alone crossing hcsb.dat and holding CONFIRM, until it is removed; a
// graphics.dat given turning off the choice of graphics; an image of 640x400 refused as
// the thumbnail, its row saying so, the one before kept; the thumbnail removed, and drawn
// again by "Generate from data" from DM's graphics; the checkbox beside a thumbnail, off
// at first, gone without one, checked to show it as the title. What the dropped dungeon holds
// shows under the checklist, the form still on one screen. The record is stored, its
// thumbnail the site's DM thumbnail pixel for pixel, and the page shows its tile selected. What the check refuses is `tools/checks/local-data-set.ts`'s.
// The set's id is the run's own: a dev server or an image another run used still holds the
// set that run published, and refuses its id.
const MINE = `mine-${Date.now().toString(36)}`;
const form = () => evaluate(`(()=>{const d=document.querySelector('dialog.add-set');
  return d && { open: d.open, id: d.querySelector('[name=id]').value,
    rows: [...d.querySelectorAll('.add-set-checklist li')].map(li=>li.dataset.about+({right:'+',wrong:'x'}[li.className]??'')).join(),
    dropped: d.querySelector('.add-set-dropped').textContent, confirm: !d.querySelector('#add-set-confirm').disabled,
    base: [...d.querySelectorAll('[name=baseSet]')].map(r=>r.value+(r.checked?'*':'')+(r.disabled?'-':'')).join(),
    problems: [...d.querySelectorAll('.add-set-problem')].map(p=>p.textContent).filter(Boolean),
    holds: d.querySelector('.add-set-holds').hidden ? '' : [...d.querySelectorAll('.add-set-holds dd')].map(dd=>dd.textContent).join(' | '),
    generate: (b=>b?(b.disabled?'off':'on'):'')(d.querySelector('.add-set-generate')),
    thumbnail: (g=>g.title||g.textContent)(d.querySelector('.add-set-checklist li[data-about=thumbnail] .add-set-given')),
    asTitle: (l=>!l?'':l.querySelector('input').checked?'on':'off')(d.querySelector('.add-set-checklist .add-set-as-title')),
    title: d.querySelector('#add-set-title').textContent, name: d.querySelector('[name=name]').value,
    fixedId: d.querySelector('[name=id]').readOnly, dmRules: d.querySelector('[name=dmRules]').checked, deletable: !d.querySelector('.add-set-delete').hidden,
    official: (c=>c.closest('label').checkVisibility()?(c.checked?'on':'off'):'hidden')(d.querySelector('[name=official]')),
    removable: [...d.querySelectorAll('.add-set-checklist li')].filter(li=>!li.querySelector('.add-set-remove').hidden).map(li=>li.dataset.about).join(),
    height: d.getBoundingClientRect().height };})()`);
const inForm = (body: string) => evaluate(`(async()=>{const d=document.querySelector('dialog.add-set');${body};return 1;})()`);
const typeIn = (name: string, value: string) => inForm(`const i=d.querySelector('[name=${name}]');i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input'))`);
const dropIn = (files: [path: string, name: string][]) => inForm(`const dt=new DataTransfer();
  for(const [path,name] of ${JSON.stringify(files)}){const b=await (await fetch(path)).blob(); dt.items.add(new File([b],name,{type:b.type}));}
  d.querySelector('.add-set-drop').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}))`);
const removeIn = (about: string) => inForm(`d.querySelector('.add-set-checklist li[data-about="${about}"] .add-set-remove').click()`);
await clickOn('.pick.add');
const opened = await form();
console.log('  form:', JSON.stringify(opened));
check(opened?.open === true && !opened.confirm && opened.title === 'Add my own dungeon' && !opened.fixedId && !opened.deletable && opened.dmRules && opened.base === 'dm-atari*,csb' && opened.problems.length === 0 && opened.holds === ''
  && opened.rows === 'namex,idx,dungeon.datx,graphics.dat+,CSBgraphics.dat,hcsb.hct,hcsb.dat,thumbnail'
  && opened.generate === 'on' && opened.thumbnail === 'Generate from data' && opened.asTitle === '' && opened.official === 'hidden',
  '"+ Add my own" opens the form, DM rules checked, no official game\'s checkbox to a player: the name, the id and dungeon.dat crossed, DM\'s graphics.dat checked, the thumbnail offered from it, CONFIRM held');
check(opened.height <= 600, 'the form is on one screen');
await inForm(`d.querySelector('#add-set-cancel').click()`);
check(await form() === null, 'CANCEL closes it');
await clickOn('.pick.add');
await dropIn([['/gamefiles/dm-atari/dungeon.dat', 'graphics.dat'], ['/gamefiles/csb/csb-thumbnail.png', 'title.png'],
  ['/gamefiles/csb/hcsb.hct', 'hints'], ['/', 'notes.txt']]);
await typeIn('name', 'My Own Dungeon');
await settled();
const filled = await form();
console.log('  form:', JSON.stringify(filled));
check(filled.id === 'my-own-dungeon' && filled.rows === 'name+,id+,dungeon.dat+,graphics.dat+,CSBgraphics.dat,hcsb.hct+,hcsb.datx,thumbnail+'
  && filled.dropped === "Not one of a dungeon's files: notes.txt." && !filled.confirm && filled.asTitle === 'off'
  && filled.problems.join() === 'The Hint Oracle needs hcsb.dat beside hcsb.hct.',
  'dropped files go where what they hold says, whatever their names, an image to the thumbnail; the id is the name\'s; hcsb.hct alone crosses hcsb.dat and holds CONFIRM');
await dropIn([['/gamefiles/dm-atari/graphics.dat', 'GFX']]);
await settled();
const ownGraphics = await form();
await removeIn('graphics.dat');
await removeIn('hcsb.hct');
await typeIn('id', MINE);
await settled();
const ready = await form();
check(ownGraphics.base === 'dm-atari*-,csb-' && ownGraphics.dropped === '' && ready.base === 'dm-atari*,csb',
  'a graphics.dat given turns the choice of graphics off, and its removal on');
check(ready.rows === 'name+,id+,dungeon.dat+,graphics.dat+,CSBgraphics.dat,hcsb.hct,hcsb.dat,thumbnail+' && ready.id === MINE
  && ready.confirm && ready.problems.length === 0,
  'a row\'s × takes its file back, and with nothing wrong CONFIRM is given');
await inForm(`const c=new OffscreenCanvas(640,400);c.getContext('2d').fillRect(0,0,640,400);
  const dt=new DataTransfer();dt.items.add(new File([await c.convertToBlob({type:'image/png'})],'large.png',{type:'image/png'}));
  d.querySelector('.add-set-drop').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}))`);
await settled();
const large = await form();
console.log('  large:', JSON.stringify(large));
check(large.rows === ready.rows && large.thumbnail === 'title.png' && large.confirm
  && large.problems.join() === 'It is 640x400, not 320x200.' && large.height <= 600,
  'an image of 640x400 is not taken as the thumbnail, its row saying why, and the one before stays');
await removeIn('thumbnail');
await settled();
const unthumbed = await form();
await inForm(`d.querySelector('.add-set-generate').click()`);
await settled();
const generated = await form();
console.log('  generated:', JSON.stringify(generated));
check(unthumbed.rows.endsWith(',thumbnail') && unthumbed.generate === 'on' && unthumbed.confirm && unthumbed.problems.length === 0
  && generated.rows === ready.rows && generated.thumbnail === 'title.png' && generated.generate === '' && generated.confirm,
  'without a thumbnail, its refusal gone with it, its row offers "Generate from data", which gives it title.png');
check(ready.asTitle === 'off' && unthumbed.asTitle === '' && generated.asTitle === 'off',
  'a thumbnail\'s row offers to show it as the title, off at first, also for one drawn from the title; without one, it does not');
await inForm(`d.querySelector('.add-set-as-title input').click()`);
await settled();
const titled = await form();
check(titled.asTitle === 'on' && titled.confirm && titled.height <= 600, 'the checkbox checked, CONFIRM is still given, on one screen');
check(filled.holds === '14 | Weapons 106Clothing 121Scrolls 34Potions 55Containers 12Misc 278 | 303 in 182 groups, of 25 kinds | None'
  && ready.holds === filled.holds && ready.height <= 600,
  'what the dungeon holds shows under the checklist, whatever else is wrong, and the form stays on one screen');
await inForm(`d.querySelector('#add-set-confirm').click()`);
await settled();
const stored = await evaluate(`(async()=>{const r = await new Promise((resolve, reject) => { const open = indexedDB.open('csbweb-saves');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => { const get = open.result.transaction('dataSets').objectStore('dataSets').get('local:${MINE}');
    get.onsuccess = () => { open.result.close(); resolve(get.result); }; }; });
  const pixels = async (blob) => { const bitmap = await createImageBitmap(blob), c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = c.getContext('2d'); g.drawImage(bitmap, 0, 0); return [bitmap.width, bitmap.height, ...g.getImageData(0, 0, bitmap.width, bitmap.height).data]; };
  const site = r && await pixels(await (await fetch('/gamefiles/dm-atari/dm-atari-thumbnail.png')).blob());
  const mine = r?.files.thumbnail && await pixels(r.files.thumbnail);
  return r && { name: r.name, dmRules: r.dmRules, asTitle: r.thumbnailAsTitle, baseSet: r.baseSet, files: Object.keys(r.files).sort().join(), levels: r.dungeonSignature.length,
    sizes: Object.values(r.files).map((f) => f.size), thumbnail: r.files.thumbnail?.type, createdAt: r.createdAt,
    sameThumbnail: !!mine && mine.length === site.length && mine.every((v, i) => v === site[i]) };})()`);
const afterAdd = await welcome();
console.log('  stored:', JSON.stringify(stored));
check(await form() === null && stored?.name === 'My Own Dungeon' && stored.baseSet === 'dm-atari'
  && stored.dmRules && stored.asTitle === true && stored.files === 'dungeon.dat,thumbnail' && stored.levels === 14 && stored.sizes.every((size: number) => size > 0),
  'CONFIRM stores the record: its name, DM\'s graphics, its thumbnail as the title, its two files and its dungeon\'s signature, and closes the form');
check(stored?.thumbnail === 'image/png' && stored.sameThumbnail,
  'the thumbnail drawn from DM\'s graphics is the site\'s DM thumbnail, pixel for pixel');
check(afterAdd.tiles.includes(`local:${MINE}!`) && new RegExp(`dungeon=local%3A${MINE}(&|$)`).test(afterAdd.play ?? ''), 'the page shows the new set, selected');
// A save filed under the new set's id, a copy of dm-atari's one save made a millisecond
// older. Its tile is bright and the fan-made dungeons' first, its picture the record's image, and it counts its
// save; selected, PLAY and CONTINUE lead to it. "+ Add my own" stays last, and a click on
// it opens the form and selects nothing.
// Then the pen on the local set's picture, the only tile with one, opens the form on its
// record: its name, its id fixed, dungeon.dat replaceable but not removable, and DELETE.
// A new name confirmed is stored over the record, which keeps when it was added, and its
// save stays. DELETE asks first, counting the save; CANCEL keeps the set, and DELETE
// removes the record and its save, its row and its file, so that the pages below see the
// one save. A recording played on the set, its row and its two parts, goes with it.
const saveDatabase = (body: { before?: string; write: string }) => evaluate(`(async()=>{${body.before ?? ''}
  return new Promise((resolve, reject) => { const open = indexedDB.open('csbweb-saves');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction(['saves', 'saveFiles', 'dataSets', 'recordings', 'recordingParts'], 'readwrite');
      const saves = tx.objectStore('saves'), files = tx.objectStore('saveFiles'), dataSets = tx.objectStore('dataSets');
      const recordings = tx.objectStore('recordings'), parts = tx.objectStore('recordingParts');
      ${body.write}
      tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = () => reject(tx.error); }; });})()`);
await saveDatabase({
  write: `const all = saves.getAll();
    all.onsuccess = () => { const row = all.result[0];
      saves.put({ ...row, id: 'probe-local-save', dataSet: 'local:${MINE}', savedAt: row.savedAt - 1, usedAt: (row.usedAt ?? row.savedAt) - 1 });
      const file = files.get(row.id);
      file.onsuccess = () => files.put({ ...file.result, id: 'probe-local-save' }); };
    recordings.put({ id: 'probe-local-recording', dataSet: 'local:${MINE}', build: 'probe', playthrough: 7, recordedAt: 1, writtenAt: 1,
      vbls: 10, ended: false, changes: 1, parts: 2 });
    parts.put({ id: 'probe-local-recording', seq: 0, start: { kind: 'new', random: 1, randomGameID: 7 }, rules: {}, extras: {} });
    parts.put({ id: 'probe-local-recording', seq: 1, changes: [{ change: { kind: 'forceDMRules' }, vbl: 0, time: 0, random: 1 }] });`,
});
await navigate(`${APP}?dungeon=nowhere&keepsaves`, WELCOME);
const withLocal = await welcome();
console.log('  local set:', JSON.stringify(withLocal));
check(withLocal.tiles === [...OFFICIAL, `local:${MINE}*`, 'conflux-3.5', 'towers-of-chaos'].join()
  && withLocal.saves[OFFICIAL.length] === '1 save' && withLocal.pictures.length === OFFICIAL.length + 3 && withLocal.pictures.every(Boolean)
  && withLocal.gameFiles === 0 && withLocal.last === atWelcome.last,
  "a local set's tile: its save counted, bright, its picture the record's image, the add tile still last");
await clickOn(`.pick[data-set="local:${MINE}"]`);
const atLocal = await welcome();
check(atLocal.tiles.includes(`local:${MINE}*!`) && new RegExp(`dungeon=local%3A${MINE}(&|$)`).test(atLocal.play ?? '')
  && new RegExp(`dungeon=local%3A${MINE}&.*save=probe-local-save`).test(atLocal.resume ?? '') && atLocal.preview[0] === 'My Own Dungeon',
  'a local set selected: PLAY opens it, CONTINUE reads its save, the box names it');
await clickOn('.pick.add');
check((await welcome()).play === atLocal.play && (await form())?.open === true, 'a click on "+ Add my own" opens the form, and leaves the selection');
await inForm(`d.querySelector('#add-set-cancel').click()`);
const readStore = () => evaluate(`new Promise((resolve, reject) => { const open = indexedDB.open('csbweb-saves');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => { const tx = open.result.transaction(['saves', 'saveFiles', 'dataSets', 'recordings', 'recordingParts']);
    const set = tx.objectStore('dataSets').get('local:${MINE}'), saves = tx.objectStore('saves').getAllKeys(), files = tx.objectStore('saveFiles').getAllKeys();
    const recordings = tx.objectStore('recordings').getAll(), parts = tx.objectStore('recordingParts').getAllKeys();
    tx.oncomplete = () => { open.result.close(); const mine = recordings.result.filter((r) => r.dataSet === 'local:${MINE}').map((r) => r.id);
      resolve({ name: set.result?.name ?? null, createdAt: set.result?.createdAt ?? null,
      saves: saves.result.sort().join(), files: files.result.sort().join(),
      recordings: mine.join(), parts: parts.result.filter((k) => mine.includes(k[0])).length }); }; }; })`);
const pen = await evaluate(`(()=>{const pens=[...document.querySelectorAll('.pick-edit')], p=pens[0], a=p.getBoundingClientRect();
  const b=p.closest('.pick-cell').querySelector('.pick[data-set] .pick-picture').getBoundingClientRect();
  return { count: pens.length, of: p.closest('.pick-cell').querySelector('.pick').dataset.set, label: p.getAttribute('aria-label'),
    corner: a.left < b.right && a.right >= b.right && a.top <= b.top && a.bottom > b.top && a.width < b.width / 2,
    rows: Object.values(Object.groupBy([...document.querySelectorAll('.pick')].map(t=>t.getBoundingClientRect()), r=>Math.round(r.top)))
      .map(row=>[...new Set(row.map(r=>Math.round(r.height)))].join('/')).join(),
    names: [...document.querySelectorAll('.pick[data-set]')].map(t=>t.dataset.set+' '+getComputedStyle(t.querySelector('.pick-name')).color).join('|') };})()`);
check(pen.count === 1 && pen.of === `local:${MINE}` && pen.label === 'Edit My Own Dungeon' && pen.corner,
  "only a local set's tile has the pen, over its picture's top right corner");
console.log('  tile heights by row:', pen.rows);
// The local set's book opens RECORDINGS alone: no tab, no document, no ADD, and no site's list.
await clickOn(`.pick-cell:has(.pick[data-set="local:${MINE}"]) .pick-documents`);
const localBook = await evaluate(`(d=>d&&{ title: d.querySelector('h2').textContent, tabs: d.querySelectorAll('.documents-tab').length,
  documents: !!d.querySelector('#documents-pane'), recordings: !d.querySelector('#recordings-pane').hidden, add: !!d.querySelector('#documents-add'),
  site: !!d.querySelector('.recordings-site, .recordings-site-heading') })(document.querySelector('dialog.documents'))`);
await clickOn('#documents-close');
check(localBook?.title === 'My Own Dungeon' && localBook.tabs === 0 && !localBook.documents && localBook.recordings && !localBook.add && !localBook.site,
  "a local set's book opens its recordings alone, titled with its name: no tab, no document, no ADD and no site's list");
check(pen.rows.split(',').every((row: string) => !row.includes('/')), "a local set's tile is as tall as the others on its row");
check(pen.names.split('|').every((name: string) => name.endsWith(name.startsWith('local:') ? ' rgb(0, 216, 216)' : ' rgb(252, 252, 252)')),
  "a local set's name is in cyan, palette entry 4, the others' in white");
await clickOn('.pick-edit');
const editing = await form();
console.log('  editing:', JSON.stringify(editing));
check(editing?.open === true && editing.title === 'Edit my own dungeon' && editing.name === 'My Own Dungeon' && editing.id === MINE
  && editing.fixedId && editing.deletable && editing.base === 'dm-atari*,csb' && editing.removable === 'thumbnail'
  && editing.rows === ready.rows && editing.thumbnail === 'title.png' && editing.asTitle === 'on' && editing.confirm && editing.height <= 600,
  'the pen opens the form on the record: its fields and files, its id fixed, dungeon.dat not removable, DELETE offered');
await typeIn('name', 'My Edited Dungeon');
await settled();
await inForm(`d.querySelector('#add-set-confirm').click()`);
await settled();
const edited = await readStore();
const afterEdit = await welcome();
check(await form() === null && edited.name === 'My Edited Dungeon' && edited.createdAt === stored.createdAt
  && edited.saves === ['probe-local-save', decodeURIComponent(saveId!)].sort().join() && edited.files === edited.saves
  && afterEdit.tiles.includes(`local:${MINE}*!`),
  'CONFIRM stores the edited record over the old, when it was added kept, its save kept, and the page shows it selected');
// PUBLISH, beside DELETE on the pen's form, offers the stored set to the site
// (`server/publish.ts`), which the dev server answers as the deployed one does
// (`vite.config.mts`). It is held while the form shows a change, and given again once the
// change is undone. Published, the form closes and the page, asked for the sets anew, shows
// the pending set's tile, its name red, its thumbnail served from its new folder, beside the
// local one, which stays. A second PUBLISH of the id is refused, the server's answer said
// under the checklist, and the form stays; a 422's problems, the server stood in for, go on
// their rows.
const publishState = () => evaluate(`(b=>b&&(b.hidden?'hidden':b.disabled?'off':'on'))(document.querySelector('dialog.add-set .add-set-publish'))`);
const failureText = () => evaluate(`document.querySelector('dialog.add-set .add-set-failure')?.textContent`);
await clickOn('.pick.add');
const notOffered = await publishState();
await inForm(`d.querySelector('#add-set-cancel').click()`);
await clickOn('.pick-edit');
const offered = await publishState();
await typeIn('name', 'My Changed Dungeon');
await settled();
const whileChanged = await publishState();
await typeIn('name', 'My Edited Dungeon');
await settled();
const undone = await publishState();
check(notOffered === 'hidden' && offered === 'on' && whileChanged === 'off' && undone === 'on',
  'PUBLISH is on the pen\'s form alone, offered on the stored set, held while the form shows a change');
await inForm(`d.querySelector('.add-set-publish').click()`);
await settled();
const afterPublish = await welcome();
const publishedTile = await evaluate(`(t=>t&&{ colour: getComputedStyle(t.querySelector('.pick-name')).color, name: t.querySelector('.pick-name').textContent })(document.querySelector('.pick[data-set="${MINE}"]'))`);
const publishedRecord = await readStore();
console.log('  published:', JSON.stringify({ tiles: afterPublish.tiles, tile: publishedTile }));
const tilesOf = (page: { tiles: string }) => page.tiles.split(',');
check(await form() === null && tilesOf(afterPublish).includes(`${MINE}!`) && tilesOf(afterPublish).includes(`local:${MINE}*`)
  && publishedTile?.colour === 'rgb(252, 0, 0)' && publishedTile.name === 'My Edited Dungeon'
  && afterPublish.pictures.every(Boolean) && publishedRecord.name === 'My Edited Dungeon' && publishedRecord.saves === edited.saves,
  'PUBLISH sends the set: the form closes, the page shows it pending and selected, its thumbnail from its folder, beside the local set, which stays with its saves');
// A tile's controls (`src/ui/welcomePage.ts`): what each set's tile offers this viewer,
// each control's class and label, by set, but the triangle, which every tile has first: a
// link to the set as PLAY's, its save none, labelled with its name. The triangles are
// checked once, here; the "+ Add my own" tile has none.
const controlsOf = () => evaluate(`Object.fromEntries([...document.querySelectorAll('.pick[data-set]')].map(t=>[t.dataset.set,
  [...(t.closest('.pick-cell')?.querySelectorAll('.pick-control:not(.pick-play)')??[])].map(b=>b.className.replace('pick-control ','')+':'+b.getAttribute('aria-label')).join()]))`);
const triangles = await evaluate(`(()=>{const query=(id)=>{const p=new URLSearchParams(location.search); p.set('dungeon', id); p.delete('save'); return '?'+p;};
  const picks=[...document.querySelectorAll('.pick[data-set]')];
  return { tiles: picks.length, wrong: picks.filter(t=>{const a=t.closest('.pick-cell')?.querySelector('.pick-control');
      return !(a && a.tagName === 'A' && a.classList.contains('pick-play') && a.getAttribute('href') === query(t.dataset.set)
        && a.getAttribute('aria-label') === 'Play '+t.querySelector('.pick-name').textContent);}).map(t=>t.dataset.set),
    add: !!document.querySelector('.pick.add').closest('.pick-cell') };})()`);
const owned = await controlsOf();
console.log('  triangles:', JSON.stringify(triangles));
check(triangles.tiles > 2 && triangles.wrong.length === 0 && !triangles.add,
  'every tile, a local set\'s too, has the triangle first, a link to its set without a save, labelled with its name; "+ Add my own" has none');
const owner = await evaluate(`localStorage.getItem('csbweb_player_v1')`);
console.log('  to its owner:', JSON.stringify(owned));
/** A set of `tools/data-sets.json`, the manifest the probe reads. */
interface ManifestRow { id: string; name: string; hidden?: boolean; status?: string }
const manifestRows: ManifestRow[] = JSON.parse(readFileSync(new URL('data-sets.json', import.meta.url), 'utf8')).dataSets;
check(owned[MINE] === 'pick-documents:Documents of My Edited Dungeon,pick-reject:Withdraw My Edited Dungeon'
  && owned[`local:${MINE}`] === 'pick-documents:Recordings of My Edited Dungeon,pick-edit:Edit My Edited Dungeon'
  && Object.entries(owned).every(([set, controls]) => set === MINE || set.startsWith('local:')
    || controls === `pick-documents:Documents of ${manifestRows.find((row) => row.id === set)?.name}`),
  'to its owner, the pending set has the book and the cross, which withdraws it, every other published set the book alone, and a local set the book and the pen');
await clickOn('.pick-edit');
await inForm(`d.querySelector('.add-set-publish').click()`);
await settled();
const again = { form: await form(), failure: await failureText(), publish: await publishState() };
console.log('  published again:', JSON.stringify({ failure: again.failure, publish: again.publish }));
check(again.form?.open === true && again.failure === 'It could not be published: The site already has a set of this id.' && again.publish === 'on',
  'a second PUBLISH of the id is refused, the server\'s answer said under the checklist, the form open');
onPaused = ({ requestId }) => send('Fetch.fulfillRequest', { requestId, responseCode: 422,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
  body: Buffer.from(JSON.stringify({ error: 'The set does not pass the check.', problems: [{ about: 'dungeon.dat', text: 'Its walls are wrong.' }] })).toString('base64') });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/data-sets*' }] });
await inForm(`d.querySelector('.add-set-publish').click()`);
await settled();
await send('Fetch.disable');
onPaused = null;
const unchecked = { form: await form(), failure: await failureText() };
console.log('  refused:', JSON.stringify({ rows: unchecked.form?.rows, problems: unchecked.form?.problems }));
check(unchecked.failure === 'It could not be published: The set does not pass the check.' && unchecked.form.rows.split(',').includes('dungeon.datx')
  && unchecked.form.problems.includes('Its walls are wrong.') && unchecked.form.confirm,
  "a 422's problems go on their rows, the server's check being the server's alone: CONFIRM stays");
await inForm(`d.querySelector('#add-set-cancel').click()`);
const confirmation = () => evaluate(`(()=>{const d=document.querySelector('dialog.delete-set');
  return d && { open: d.open, title: d.querySelector('h2').textContent, text: d.querySelector('p').textContent };})()`);
await clickOn('.pick-edit');
await inForm(`d.querySelector('.add-set-delete').click()`);
const asked = await confirmation();
console.log('  delete:', JSON.stringify(asked));
await evaluate(`document.querySelector('#delete-set-cancel').click()`);
await settled();
const keptSet = { dialog: await confirmation(), form: await form(), store: await readStore() };
check(asked?.open === true && asked.title === 'Delete My Edited Dungeon?' && /^Its saved game is deleted with it\. .*EXPORT/.test(asked.text)
  && keptSet.dialog === null && keptSet.form?.open === true && keptSet.store.name === 'My Edited Dungeon' && keptSet.store.saves === edited.saves
  && keptSet.store.recordings === 'probe-local-recording' && keptSet.store.parts === 2,
  "DELETE asks first, counting the set's save and naming EXPORT; CANCEL keeps the set, its save and its recording");
await inForm(`d.querySelector('.add-set-delete').click()`);
await evaluate(`document.querySelector('#delete-set-confirm').click()`);
await settled();
const deleted = { dialog: await confirmation(), form: await form(), store: await readStore(), page: await welcome() };
check(deleted.dialog === null && deleted.form === null && deleted.store.name === null && deleted.store.saves === decodeURIComponent(saveId!)
  && deleted.store.files === deleted.store.saves && deleted.store.recordings === '' && deleted.store.parts === 0
  && tilesOf(deleted.page).filter((tile: string) => tile !== MINE).join() === atWelcome.tiles && tilesOf(deleted.page).includes(MINE),
  'its DELETE removes the record, every save filed under its id and every recording played on it, and the page shows the sets without it, the published one kept');
// The moderation (`server/moderate.ts`), from the tiles, as the dev server's moderator
// (`DEV_MODERATOR_PLAYER_ID`, `vite.config.mts`; the image's in `tools/check-image.sh`), the
// page reloaded with their `playerId` kept. Every published set has the book first, then the
// pen; the set published above, pending, then the tick
// and the cross, every other the eye, open on a set shown, shut on a hidden one. The tick approves it, its name white and its
// tile still selected, then the eye hides it, purple, and shows it again, white. A refusal,
// the server stood in for, is said in the box beside CONTINUE. Then its owner, who sees no
// control on the approved set, withdraws a second set of theirs, published by hand: the
// cross asks first, and CANCEL keeps it.
const MODERATOR = '00000000-0000-4000-8000-000000000001';
const asPlayer = async (player: string) => {
  await evaluate(`localStorage.setItem('csbweb_player_v1', ${JSON.stringify(player)}),1`);
  await navigate(`${APP}?dungeon=nowhere&keepsaves&keepsettings`, WELCOME);
};
const mineOf = async () => ({ ...(await evaluate(`(t=>({ colour: getComputedStyle(t.querySelector('.pick-name')).color, selected: t.getAttribute('aria-pressed') }))(document.querySelector('.pick[data-set="${MINE}"]'))`)),
  controls: (await controlsOf())[MINE] });
const onMine = (control: string) => clickOn(`.pick-cell:has(.pick[data-set="${MINE}"]) .${control}`);
await asPlayer(MODERATOR);
const moderating = await controlsOf();
console.log('  to a moderator:', JSON.stringify(moderating));
check(moderating[MINE] === 'pick-documents:Documents of My Edited Dungeon,pick-edit:Edit My Edited Dungeon,pick-approve:Approve My Edited Dungeon,pick-reject:Reject My Edited Dungeon'
  && Object.entries(moderating).every(([set, controls]) => set === MINE
    || ((row) => controls === `pick-documents:Documents of ${row?.name},pick-edit:Edit ${row?.name},${row?.hidden ? `pick-show:Show ${row.name}` : `pick-hide:Hide ${row?.name}`}`)(manifestRows.find((row) => row.id === set))),
  'to a moderator, every set has the book and the pen, the pending set then the tick and the cross, every other set the eye, open on a set shown, shut on a hidden one');
// The moderator's switch, at the page's top right corner, to a moderator alone: off, the
// page is a player's, neither a hidden set nor a pending one listed, and every published
// set the book alone; it stays off across a reload, and turned on again, the page is the
// moderator's.
const moderationSwitch = () => evaluate(`(b=>b&&{ checked: b.getAttribute('aria-checked'), text: b.textContent,
  corner: (r=>Math.round(document.documentElement.clientWidth-r.right)+','+Math.round(r.top))(b.getBoundingClientRect()) })(document.querySelector('.welcome-moderation'))`);
const switchedOn = await moderationSwitch();
await clickOn('.welcome-moderation');
const switchedOff = { switch: await moderationSwitch(), controls: await controlsOf() };
await asPlayer(MODERATOR);
const offReloaded = { switch: await moderationSwitch(), controls: await controlsOf() };
await clickOn('.welcome-moderation');
const switchedBack = { switch: await moderationSwitch(), controls: await controlsOf() };
console.log("  the moderator's switch:", JSON.stringify({ switchedOn, off: switchedOff.switch, reloaded: offReloaded.switch, back: switchedBack.switch }));
const asAPlayer = Object.keys(moderating).filter((set) => set !== MINE && !manifestRows.find((row) => row.id === set)?.hidden);
const playerControls = (controls: Record<string, string>) => Object.keys(controls).join() === asAPlayer.join() && Object.entries(controls).every(([set, controls]) => set.startsWith('local:')
  || controls === `pick-documents:Documents of ${manifestRows.find((row) => row.id === set)?.name}`);
check(switchedOn?.checked === 'true' && switchedOn.text === 'Moderator on' && switchedOn.corner === '12,12'
  && switchedOff.switch?.checked === 'false' && switchedOff.switch.text === 'Moderator off' && playerControls(switchedOff.controls)
  && offReloaded.switch?.checked === 'false' && playerControls(offReloaded.controls)
  && switchedBack.switch?.checked === 'true' && JSON.stringify(switchedBack.controls) === JSON.stringify(moderating),
  "the moderator's switch, at the top right corner, on: off, the page is a player's, no hidden nor pending set, the book alone, kept across a reload; on again, the moderator's");
await clickOn(`.pick[data-set="${MINE}"]`);
await onMine('pick-approve');
const approved = await mineOf();
await onMine('pick-hide');
const hidden = await mineOf();
await onMine('pick-show');
const shown = await mineOf();
console.log('  moderated:', JSON.stringify({ approved, hidden, shown }));
const BOOK_OF_MINE = 'pick-documents:Documents of My Edited Dungeon';
check(approved.colour === 'rgb(252, 252, 252)' && approved.controls === `${BOOK_OF_MINE},pick-edit:Edit My Edited Dungeon,pick-hide:Hide My Edited Dungeon` && approved.selected === 'true'
  && hidden.colour === 'rgb(216, 0, 216)' && hidden.controls === `${BOOK_OF_MINE},pick-edit:Edit My Edited Dungeon,pick-show:Show My Edited Dungeon` && hidden.selected === 'true'
  && shown.colour === 'rgb(252, 252, 252)' && shown.controls === `${BOOK_OF_MINE},pick-edit:Edit My Edited Dungeon,pick-hide:Hide My Edited Dungeon` && shown.selected === 'true',
  'the tick approves the set, the shut eye hides it and the open eye shows it, the page asking for the sets anew, the set kept selected');
onPaused = ({ requestId }) => send('Fetch.fulfillRequest', { requestId, responseCode: 409,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
  body: Buffer.from(JSON.stringify({ error: 'The set is hidden.' })).toString('base64') });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/data-sets/*' }] });
await onMine('pick-hide');
await send('Fetch.disable');
onPaused = null;
const moderationRefused = (await welcome()).preview.join();
check(moderationRefused === 'My Edited Dungeon could not be hidden: The set is hidden.', 'a refusal is said beside CONTINUE');
// The pen, to a moderator (`server/edit.ts`): the form on the set as the site holds it, its
// files read from its folder, its id without local: and fixed, no PUBLISH nor DELETE,
// dungeon.dat not removable, and CONFIRM held until a change. A new description, then a new
// dungeon.dat, which the note under the checklist says reaches no saved game; CONFIRM sends
// the edit, and the page, asked for the sets anew, shows the set from its new folder,
// still selected.
const noteText = () => evaluate(`document.querySelector('dialog.add-set .add-set-note')?.textContent`);
await onMine('pick-edit');
const siteForm = { ...(await form()), publish: await publishState(), note: await noteText(),
  prefix: await evaluate(`document.querySelector('dialog.add-set .add-set-id > span').hidden`) };
console.log('  the pen, to a moderator:', JSON.stringify(siteForm));
check(siteForm.open === true && siteForm.title === 'Edit the published dungeon' && siteForm.name === 'My Edited Dungeon' && siteForm.id === MINE
  && siteForm.fixedId && siteForm.prefix === true && !siteForm.deletable && siteForm.publish === 'hidden' && siteForm.removable === 'graphics.dat,thumbnail'
  && !siteForm.rows.includes('x') && siteForm.rows.includes('dungeon.dat+') && siteForm.thumbnail === 'thumbnail.png' && !siteForm.confirm && siteForm.note === ''
  && siteForm.official === 'off',
  'the pen opens the form on the published set, its files the folder\'s, its id fixed, no PUBLISH nor DELETE, CONFIRM held until a change, the official game\'s checkbox offered, off');
await typeIn('description', 'Edited by a moderator.');
await typeIn('authors', 'Ann, Bob');
await settled();
const describedConfirm = (await form())?.confirm;
await dropIn([['gamefiles/dm-atari/dungeon.dat', 'dungeon.dat']]);
await settled();
const newDungeonNote = await noteText();
await inForm(`d.querySelector('#add-set-confirm').click()`);
await settled();
const siteEdited = await evaluate(`fetch('api/data-sets', { headers: { 'X-Player-Id': ${JSON.stringify(MODERATOR)} } }).then(r=>r.json())
  .then(m=>(s=>s&&{ dir: s.dir, description: s.description })(m.dataSets.find(s=>s.id===${JSON.stringify(MINE)})))`);
const afterSiteEdit = { form: await form(), page: await welcome(), mine: await mineOf(),
  picture: await evaluate(`document.querySelector('.pick[data-set="${MINE}"] img')?.getAttribute('src')`) };
console.log('  edited by a moderator:', JSON.stringify({ describedConfirm, newDungeonNote, siteEdited, picture: afterSiteEdit.picture }));
check(describedConfirm === true && newDungeonNote.startsWith('Saved games keep the dungeon they were made in'),
  'a change enables CONFIRM, and a new dungeon.dat is said to reach no saved game');
check(afterSiteEdit.form === null && siteEdited?.dir === `${MINE}@2` && siteEdited.description === 'Edited by a moderator.'
  && afterSiteEdit.picture === `gamefiles/${MINE}@2/${MINE}-thumbnail.png` && afterSiteEdit.page.pictures.every(Boolean) && afterSiteEdit.mine.selected === 'true',
  'CONFIRM edits the set on the site: the form closes, its text changed, its files in a new folder, whose thumbnail the page shows, the set still selected');
// The book, to a moderator (`server/documents.ts`): under its title the set's description,
// its authors after "By: ", then the set's archive, which is made
// in the page and downloaded as `<name>.zip` (`src/data/DataSetArchive.ts`); the set has no
// document yet, which its dialog says, with ADD. A text chosen is added, a link that opens in a new tab, served from
// the set's new folder; a name that is not a document's is refused in the dialog, nothing
// sent; a .doc is a link that downloads. The text's cross asks first, then removes it.
// CLOSE shows the page anew, the book on the set. Its owner, below, has the book, which
// offers neither ADD nor a cross.
const documentsDialog = () => evaluate(`(d=>d&&{ open: d.open, title: d.querySelector('h2').textContent, description: d.querySelector('.documents-description').textContent,
  authors: d.querySelector('.documents-authors').textContent,
  items: [...d.querySelectorAll('.documents-list li')].map(li=>{const a=li.querySelector('a'), pack=li.querySelector('.documents-pack');
    return pack ? pack.textContent+'|'+li.querySelector('.documents-size').textContent : a ? [a.textContent, a.getAttribute('href'), a.target || (a.hasAttribute('download') ? 'download' : ''), li.querySelector('.documents-size').textContent,
      li.querySelector('.documents-remove')?.getAttribute('aria-label') ?? ''].join('|') : li.textContent;}),
  add: !!d.querySelector('#documents-add'), status: d.querySelector('.documents-status').textContent })(document.querySelector('dialog.documents'))`);
const chooseDocument = (name: string, text: string) => evaluate(`(()=>{const input=document.querySelector('#documents-file'), t=new DataTransfer();
  t.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)})); input.files=t.files; input.dispatchEvent(new Event('change')); return 1;})()`);
await onMine('pick-documents');
const noDocument = await documentsDialog();
const downloadsBefore = downloads.length;
await clickOn('dialog.documents .documents-pack');
for (const end = Date.now() + 5000; downloads.length === downloadsBefore && Date.now() < end; ) await wait(20);
const packed = { downloaded: downloads.slice(downloadsBefore), status: (await documentsDialog())?.status };
await chooseDocument('Notes.txt', 'Read me first.');
await settled();
const oneDocument = await documentsDialog();
const servedDocument = await evaluate(`fetch(document.querySelector('dialog.documents .documents-list a').getAttribute('href')).then(r=>r.text())`);
await chooseDocument('page.html', '<p>no</p>');
await settled();
const refusedDocument = await documentsDialog();
await chooseDocument('Solution.doc', 'The answer.');
await settled();
const twoDocuments = await documentsDialog();
await clickOn('dialog.documents .documents-remove[aria-label="Remove Notes.txt"]');
const askedRemoval = await evaluate(`(d=>d&&{ title: d.querySelector('h2').textContent, button: d.querySelector('#remove-document-confirm').textContent })(document.querySelector('dialog.remove-document'))`);
await evaluate(`document.querySelector('#remove-document-confirm').click()`);
await settled();
const afterRemoval = await documentsDialog();
await clickOn('#documents-close');
const afterDocuments = { dialog: await documentsDialog(), mine: await mineOf() };
const ARCHIVE = 'My Edited Dungeon.zip|every file';
console.log('  the book:', JSON.stringify({ noDocument, packed, oneDocument, refusedDocument: refusedDocument?.status, twoDocuments, askedRemoval, afterRemoval }));
check(noDocument?.open === true && noDocument.title === 'My Edited Dungeon' && noDocument.description === 'Edited by a moderator.' && noDocument.authors === 'By: Ann, Bob' && noDocument.items.join() === `${ARCHIVE},No document yet.` && noDocument.add,
  'to a moderator, the book opens the set\'s description, its authors, its archive, then its documents, none yet, with ADD');
check(packed.downloaded.join() === 'My Edited Dungeon.zip' && packed.status === '', 'the archive, clicked, is made and downloaded as <name>.zip');
check(oneDocument?.items.join() === `${ARCHIVE},Notes.txt|gamefiles/${MINE}@3/Notes.txt|_blank|14 B|Remove Notes.txt` && oneDocument.status === '' && servedDocument === 'Read me first.',
  'a text chosen is added: a link that opens in a new tab, from the set\'s new folder, its size, and a cross');
check(refusedDocument?.status.startsWith('page.html cannot be a document') && refusedDocument.items.length === 2, 'a file whose name is not a document\'s is refused in the dialog, nothing sent');
check(twoDocuments?.items.join() === `${ARCHIVE},Notes.txt|gamefiles/${MINE}@4/Notes.txt|_blank|14 B|Remove Notes.txt,Solution.doc|gamefiles/${MINE}@4/Solution.doc|download|11 B|Remove Solution.doc`,
  'a .doc is a link that downloads, the documents listed by name');
check(askedRemoval?.title === 'Remove Notes.txt?' && askedRemoval.button === 'Remove'
  && afterRemoval?.items.join() === `${ARCHIVE},Solution.doc|gamefiles/${MINE}@5/Solution.doc|download|11 B|Remove Solution.doc`, 'its cross asks first, then removes it');
check(afterDocuments.dialog === null && afterDocuments.mine.selected === 'true' && afterDocuments.mine.controls.startsWith(BOOK_OF_MINE),
  'CLOSE shows the page anew, the set still selected, the book on its tile');
const SECOND = `${MINE}-b`;
const secondPublished = await evaluate(`(async()=>{const f=new FormData(), file=async(path)=>(await fetch(path)).blob();
  for (const [name, value] of [['id','${SECOND}'],['name','My Second Dungeon'],['description',''],['dmRules','true'],['thumbnailAsTitle','false'],['official','false'],['baseSet','dm-atari']]) f.append(name, value);
  f.append('dungeon.dat', await file('gamefiles/dm-atari/dungeon.dat'), 'dungeon.dat');
  f.append('thumbnail', await file('gamefiles/dm-atari/dm-atari-thumbnail.png'), 'thumbnail.png');
  return (await fetch('api/data-sets', { method: 'POST', headers: { 'X-Player-Id': ${JSON.stringify(owner)} }, body: f })).status;})()`);
await asPlayer(owner);
const ownerAgain = await controlsOf();
const ownersSwitch = await moderationSwitch();
const rejectDialog = () => evaluate(`(d=>d&&{ open: d.open, title: d.querySelector('h2').textContent, button: d.querySelector('#reject-set-confirm').textContent })(document.querySelector('dialog.reject-set'))`);
await clickOn(`.pick-cell:has(.pick[data-set="${SECOND}"]) .pick-reject`);
const askedWithdraw = await rejectDialog();
await evaluate(`document.querySelector('#reject-set-cancel').click()`);
await settled();
const setsOf = (page: { tiles: string }) => tilesOf(page).map((tile) => tile.replace(/[*!]+$/, ''));
const keptPending = { dialog: await rejectDialog(), tiles: setsOf(await welcome()) };
await clickOn(`.pick-cell:has(.pick[data-set="${SECOND}"]) .pick-reject`);
await evaluate(`document.querySelector('#reject-set-confirm').click()`);
await settled();
const withdrawn = { dialog: await rejectDialog(), tiles: setsOf(await welcome()) };
await clickOn(`.pick-cell:has(.pick[data-set="${MINE}"]) .pick-documents`);
const ownersDocuments = await documentsDialog();
await clickOn('#documents-close');
console.log('  withdrawn:', JSON.stringify({ published: secondPublished, controls: ownerAgain[SECOND], asked: askedWithdraw }));
check(ownersSwitch === null, "to a player, no moderator's switch");
check(secondPublished === 201 && ownerAgain[SECOND] === 'pick-documents:Documents of My Second Dungeon,pick-reject:Withdraw My Second Dungeon' && ownerAgain[MINE] === BOOK_OF_MINE
  && askedWithdraw?.open === true && askedWithdraw.title === 'Withdraw My Second Dungeon?' && askedWithdraw.button === 'Withdraw'
  && keptPending.dialog === null && keptPending.tiles.includes(SECOND)
  && withdrawn.dialog === null && !withdrawn.tiles.includes(SECOND) && withdrawn.tiles.includes(MINE),
  'its owner withdraws a pending set by its cross, which asks first, CANCEL keeping it; the approved set offers them the book alone');
check(ownersDocuments?.items.join() === `${ARCHIVE},Solution.doc|gamefiles/${MINE}@5/Solution.doc|download|11 B|` && !ownersDocuments.add,
  'to a player, the book offers the archive and lists the documents, with no cross and no ADD');
// The statistics page (`src/stats/statsPage.ts`), which the welcome page's footer links
// to, at `/stats`, none of the game's code loaded: its band, its column of sets and the
// selected set's figures, wins, levels and champions, each as `api/stats` answers them,
// whatever the store holds (the dev server's fortnight, `tools/lib/statsFortnight.ts`, or
// the image's empty one). With no `?set=`, the column's first is selected; a click selects
// another, in the URL, the page's other parameters kept, and back selects the first again.
const statsLink = await evaluate(`[...document.querySelectorAll('.welcome-footer nav a')].find(a=>a.textContent==='Stats')?.getAttribute('href')`);
await navigate(`${APP}stats?keepsaves&keepsettings`, STATS);
const statsPage = () => evaluate(`(async()=>{const q=(s,r=document)=>[...r.querySelectorAll(s)];const text=(e)=>e?.textContent;
  const panel=document.querySelector('.stats-set');
  for(let i=0;i<50&&!panel.querySelector('h2');i++) await new Promise(r=>setTimeout(r,100));
  const summary=await (await fetch('api/stats')).json();
  const id=q('.stats-pick[aria-current="true"]').map(p=>p.dataset.set).join();
  const set=id?await (await fetch('api/stats/'+encodeURIComponent(id))).json():null;
  const hours=(ms)=>{const h=ms/3600000;return h<10?h.toFixed(1):Math.round(h).toLocaleString('en-US');};
  const sections=Object.fromEntries(q('.stats-section',panel).map(s=>[text(s.querySelector('h3')),s]));
  const wins=q('tbody tr',sections['Fastest wins']);
  return { search: location.search,
    band: q('.stats-band dd').map(text).join('|'),
    expectedBand: [summary.players, hours(summary.playTime), summary.started, summary.won].map(String).join('|'),
    weeks: q('.stats-band .stats-week').length,
    picks: q('.stats-pick').map(p=>p.dataset.set).join(), expectedPicks: summary.sets.map(s=>s.id).join(),
    selected: id, name: text(panel.querySelector('h2')),
    figures: q('.stats-figures dd',panel).map(text).join('|'),
    expectedFigures: set&&[hours(set.playTime), set.started, set.won, set.died, set.players].map(String).join('|'),
    expectedName: set?.name, sets: summary.sets.length,
    wins: wins.length, solos: q('.stats-solo',panel).length, reincarnated: q('.stats-reincarnated',panel).length,
    expectedWins: set?.fastest.length, expectedSolos: set?.fastest.filter(w=>w.champions.length===1).length,
    expectedReincarnated: set?.fastest.flatMap(w=>w.champions).filter(c=>c.reincarnated).length,
    levels: q('.stats-levels .stats-row',panel).map(r=>text(r.querySelector('.stats-row-label'))+'='+text(r.querySelector('.stats-row-value'))).join(),
    expectedLevels: set&&(set.levels.length===0?'':Array.from({length:Math.max(...set.levels.map(l=>l.level))+1},(_,l)=>'Level '+(l+1)+'='+(set.levels.find(r=>r.level===l)?.count??0)).join()),
    champions: q('.stats-champions .stats-row:not(.stats-row-head) .stats-row-label',panel).map(text).join(),
    expectedChampions: set?.champions.map(c=>c.name).join(),
    gameCode: performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\\/main(-[\\w-]+)?\\.(ts|js)(\\?|$)|\\.dat$/i.test(n)) };})()`);
const statsFirst = await statsPage();
console.log('state: statistics page');
console.log('  ', JSON.stringify(statsFirst));
const statsMatch = (page: Record<string, unknown>) => page.band === page.expectedBand && page.picks === page.expectedPicks && page.name === page.expectedName
  && page.figures === page.expectedFigures && page.wins === page.expectedWins && page.solos === page.expectedSolos
  && page.reincarnated === page.expectedReincarnated && page.levels === page.expectedLevels && page.champions === page.expectedChampions;
check(statsLink === 'stats' && statsFirst.gameCode.length === 0 && statsFirst.weeks > 0,
  'the welcome page\'s footer links to the statistics page, which loads none of the game\'s code, and charts the weeks');
check(statsFirst.sets > 1 && statsFirst.selected === statsFirst.expectedPicks.split(',')[0] && statsMatch(statsFirst),
  'with no ?set=, the column\'s first is selected, and the band, the column and its figures, wins, levels and champions are api/stats\'s');
const secondSet = statsFirst.expectedPicks.split(',')[1];
await clickOn(`.stats-pick[data-set="${secondSet}"]`);
const statsSecond = await statsPage();
console.log('  ', JSON.stringify(statsSecond));
check(statsSecond.selected === secondSet && new URLSearchParams(statsSecond.search).get('set') === secondSet
  && statsSecond.search.includes('keepsaves') && statsMatch(statsSecond),
  'a click selects a set, in the URL, the other parameters kept, and the page is its own');
await evaluate(`history.back(),1`);
await settled();
const statsBack = await statsPage();
check(statsBack.selected === statsFirst.selected && statsMatch(statsBack), 'back selects the first again');
const lastSet = statsFirst.expectedPicks.split(',').at(-1);
await navigate(`${APP}stats?set=${encodeURIComponent(lastSet)}&keepsaves&keepsettings`, STATS);
const statsLast = await statsPage();
console.log('  ', JSON.stringify(statsLast));
check(statsLast.selected === lastSet && statsMatch(statsLast), `?set=${lastSet}, the column's last, selects it`);
// A tile's name says its set's state, to a moderator (`server/dataSets.ts`), whose answer
// the dev server's manifest stands in for here, with `"moderator": true`, kids-dungeon
// pending and 3d2d1d, a hidden set, pending too: every set is listed, the hidden ones
// included, a pending one's name red, palette entry 8, a hidden one's purple, red winning,
// and the others' white. A local set's cyan is checked above.
const moderated: { moderator?: boolean; dataSets: ManifestRow[] } = JSON.parse(readFileSync(new URL('data-sets.json', import.meta.url), 'utf8'));
moderated.moderator = true;
for (const set of moderated.dataSets) if (set.id === 'kids-dungeon' || set.id === '3d2d1d') set.status = 'pending';
onPaused = ({ requestId }) => send('Fetch.fulfillRequest', { requestId, responseCode: 200,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
  body: Buffer.from(JSON.stringify(moderated)).toString('base64') });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/data-sets*' }] });
await navigate(`${APP}?dungeon=nowhere&keepsaves`, WELCOME);
await send('Fetch.disable');
onPaused = null;
const states = await evaluate(`Object.fromEntries([...document.querySelectorAll('.pick[data-set]')]
  .map(t=>[t.dataset.set, getComputedStyle(t.querySelector('.pick-name')).color]))`);
console.log('  to a moderator:', JSON.stringify(states));
const colourOf = (set: ManifestRow) => set.status === 'pending' ? 'rgb(252, 0, 0)' : set.hidden ? 'rgb(216, 0, 216)' : 'rgb(252, 252, 252)';
check(Object.keys(states).sort().join() === moderated.dataSets.map((set) => set.id).sort().join()
  && moderated.dataSets.every((set) => states[set.id] === colourOf(set)),
  "to a moderator, every set is listed, the hidden ones too, a pending set's name red, a hidden one's purple, red winning, the others' white");
await clickOn('.pick[data-set="dm-atari"]');
await leave(() => clickOn('#welcome-play', true), ENTRANCE);
check(await evaluate(`location.search`) === '?dungeon=dm-atari&keepsaves=', 'PLAY opens the selected set, the page\'s other parameters kept');
console.log('state: entrance');
const entrance = await shot('07-entrance');
// The scroll at the bottom of the button column (button id 202).
await canvasClick(270, 192, 0); await until(ENTRANCE, 'the entrance at rest');
console.log('state: credits');
const credits = await shot('08-credits');
// Back to the entrance, "resume" (id 201), the one save the chooser lists, its first
// row, and LOAD (x 24..74, y 161..174):
// the loaded game is played at once, with no "GAME LOADED, READY TO PLAY." before it, so
// this is the adventure's first view of the save made above.
await canvasClick(160, 100, 0); await until(ENTRANCE, 'the entrance at rest');
check(!(await wheelTaken()), 'the entrance leaves the wheel to the page');
await canvasClick(270, 84, 0);  await until(ENTRANCE, 'the entrance at rest');
check(await wheelTaken(), 'the entrance\'s chooser takes the wheel, for its list');
// The cursor stays up as the chooser redraws, from `STShowCursor` to `STHideCursor`
// (`doc/CSBwin-src/SaveGame.cpp:1687-1689`): after a notch of the wheel and two keys, the
// arrow is still where the click that opened it left it, and the pointer leaving the
// canvas takes it off. The pointer stays off for the comparisons below.
const leaveCanvas = () => evaluate(`document.getElementById('game-canvas').dispatchEvent(new PointerEvent('pointerleave',{isPrimary:true,pointerType:'mouse'})),1`);
await key('ArrowUp');   await until(ENTRANCE, 'the entrance at rest');
await key('ArrowDown'); await until(ENTRANCE, 'the entrance at rest');
const withArrow = await canvasPixels();
await leaveCanvas();
check(withArrow !== (await canvasPixels()), 'the entrance\'s chooser keeps its cursor up as it redraws');
// And the keys the list takes in play. The one save is selected under its heading: the up
// arrow moves the selection to the heading, and the down arrow back to the save.
const chooserUp = await canvasPixels();
await key('ArrowUp');   await until(ENTRANCE, 'the entrance at rest');
const onHeading = await canvasPixels();
await key('ArrowDown'); await until(ENTRANCE, 'the entrance at rest');
check(onHeading !== chooserUp && onHeading !== entrance && (await canvasPixels()) === chooserUp,
  'the entrance\'s chooser takes the arrow keys, and stays up');
// EXPORT (x 170..220, y 161..174) on that save: the page's own download
// (`downloadSaveFile`, `src/data/saves/downloadSaveFile.ts`), which no Node tool can run.
// What the file holds is `tools/checks/save-menu.ts`'s to show.
// The welcome page's archive was downloaded before it.
const exportedFrom = downloads.length;
await canvasClick(195, 168, 0); await until(ENTRANCE, 'the entrance at rest');
for (const end = Date.now() + 5000; downloads.length === exportedFrom && Date.now() < end; ) await wait(20);
const exported = downloads.slice(exportedFrom);
console.log('  downloads:', exported.join(', ') || 'none');
check(exported.length === 1 && /^csbweb-\d{8}-\d{6}\.dat$/.test(exported[0]),
  'EXPORT in the chooser starts one download, a .dat under the save\'s name');
// A file dropped on the page while the chooser is up: the page's own listener
// (`bindSaveDrop`, `src/ui/saveDrop.ts`), which no Node tool can run either. The file is
// the csb set's save, another dungeon's here, so it is refused in a one-option menu and
// nothing is stored; OK (the centred menu's one button, around (159,147)) brings the
// chooser back, its message gone. What is stored and what is asked is
// `tools/checks/save-menu.ts`'s to show.
const dropTaken = await evaluate(`(async()=>{
  const bytes = await (await fetch('/gamefiles/csb/csbgame2.dat')).arrayBuffer();
  const data = new DataTransfer();
  data.items.add(new File([bytes], 'CSBGAME2.DAT'));
  const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
  document.getElementById('game-canvas').dispatchEvent(drop);
  return drop.defaultPrevented;
})()`);
await settled(); await until(ENTRANCE, 'the entrance at rest');
const refusal = await canvasPixels();
check(dropTaken && refusal !== chooserUp && refusal !== entrance,
  'a save of another dungeon dropped on the chooser is taken by the page, and a menu comes up');
await canvasClick(159, 147, 0); await until(ENTRANCE, 'the entrance at rest');
await leaveCanvas();
check((await canvasPixels()) === chooserUp, 'its OK brings the chooser back, with nothing more listed');
await canvasClick(100, 27, 0);  await until(ENTRANCE, 'the entrance at rest');
await canvasClick(48, 168, 0);  await until(GAME, 'the loaded game');
console.log('state: game loaded');       const loaded = await shot('12-game-loaded');

// The welcome page's CONTINUE, as its link reads (`?dungeon=dm-atari&save=<row id>`): the
// boot reads that save straight into play (`continueSave`, `src/main.ts`), with no
// title and no entrance, so the screen is the one the entrance's LOAD showed of it, its
// party the four the welcome page's box named. A row the store does not hold leaves the
// entrance instead, without the title.
const continued = async (search: string, ready: string) => {
  await navigate(`${APP}${search}`, ready);
  await leaveCanvas(); if (ready === GAME) await vbls(SHOWN);
  return evaluate(`(()=>{const p=window.__probe; return p ? p.game.ctx.party.state.champions.map(c=>c.name.trim()).join(' · ') : null;})()`);
};
const continuedParty = await continued(`?dungeon=dm-atari&save=${saveId}&keepsaves`, GAME);
console.log('  continued party:', continuedParty);
check(continuedParty === atWelcome.preview[1] && (await canvasPixels()) === loaded,
  'CONTINUE reads its save straight into play: the screen the entrance\'s LOAD showed, the party the box named');
await continued('?dungeon=dm-atari&save=nowhere&keepsaves', ENTRANCE);
check((await canvasPixels()) === entrance, 'a save the store does not hold leaves the entrance, without the title');

// A pressed crack switch (`doc/PROVEN_FACTS.md`, "Crack Switch (In) placement"): level 4,
// (14,29) facing west, after the click. The pushed-in crack must sit low on the wall where
// the Out crack was, not at eye level where `graphics.dat`'s coordinate set would put it.
// Built from a fresh `?intro=0` boot with the same party, since TouchWall needs a leader.
// The click also opens the grid at (13,28), off to the right; the wait covers its opening.
await navigate(`${APP}?intro=0&dungeon=dm-atari`, GAME);
await evaluate(BUILD_PARTY);
await evaluate(`(()=>{
  const { game, renderView } = window.__probe;
  const party = game.ctx.party.state;
  party.position.x = 14; party.position.y = 29; party.position.z = 4;
  party.facing = 3;
  party.brightness = 1000;   // level 4 is dark, and no one holds a torch: full magic light
  const touched = game.systems.mouse.handleWallClick();
  renderView();
  return touched;
})()`).then(t => console.log('  touched:', t));
await vbls(12 * VBL_PER_TICK);
console.log('state: crack switch');      await shot('09-crack-switch');

// Door ornaments (`TAG004b26`, `doc/CSBwin-src/CSBCode.cpp:4058`), drawn onto the door's
// bitmap before the blit. The entrance door, level 0 (1,2), seen from the start square:
// ornament 7 at full size, the black double door, over the grid that is its door type.
// Then level 4 door 60 at (4,25), two squares east of (2,25): a wooden door whose lock
// plate, ornament 5 in position set 2, is shrunk to its F2 size through `d.Byte4188`.
const FACE = (x: number, y: number, z: number, facing: number) => `(()=>{
  const { game, renderView } = window.__probe;
  const party = game.ctx.party.state;
  party.position.x = ${x}; party.position.y = ${y}; party.position.z = ${z};
  party.facing = ${facing};
  party.brightness = 1000;
  renderView();
})()`;
await evaluate(FACE(1, 3, 0, 0)); await vbls(TICK);
console.log('state: entrance door');     await shot('10-entrance-door');
await evaluate(FACE(2, 25, 4, 1)); await vbls(TICK);
console.log('state: door lock, F2');     await shot('11-door-lock-f2');
// A wall decoration on an F2 edge wall, positions 7 and 9 of `DrawWallDecoration`
// (`doc/CSBwin-src/CSBCode.cpp:3599-3623`). One mirror frame in the Hall of Champions,
// the south face of level 0 (16,7), seen from two squares south and one to either side,
// facing north: from (17,9) it is front-left, from (15,9) front-right. It is scaled to the
// F2 centre width and cut by the screen border, so on the left it must show the bitmap's
// right end, and on the right its left end. `tools/checks/hall-of-champions.ts` pins the
// rectangles; these two frames pin the pixels.
await evaluate(FACE(17, 9, 0, 0)); await vbls(TICK);
console.log('state: F2 front-left wall'); await shot('13-edge-decoration-left');
await evaluate(FACE(15, 9, 0, 0)); await vbls(TICK);
console.log('state: F2 front-right wall'); await shot('14-edge-decoration-right');
// A wall text seen from afar is its plaque, cut short for a text of one to three lines
// (`doc/CSBwin-src/CSBCode.cpp:3625-3660`). "HALL OF / CHAMPIONS", on the north
// face of level 0 (8,5), seen from (8,3) facing south: two lines at F2 centre, so the
// plaque stops at `d.Byte4212[10]`, row 53 of its 37-73. `tools/checks/wall-text.ts` pins
// the cut at every position; this frame pins it in a real view.
await evaluate(FACE(8, 3, 0, 2)); await vbls(TICK);
console.log('state: wall text at F2');   await shot('19-wall-text-f2');
// A left click on a portrait box's bars, where CSBWin has no left button, is the box's
// right click (`searchMouseButtons`, `src/renderer/ui/Mouse.ts`): champion 1's inventory
// opens, and a second click closes it. Nothing is drawn, so this is no frame.
const selected = () => evaluate(`window.__probe.screen.ui.partyState.selectedCharacterIndex`);
await canvasClick(124, 10, 0); await vbls(TICK);
check(await selected() === 1, 'a left click on a champion\'s bars opens the inventory');
await canvasClick(124, 10, 0); await vbls(TICK);
check(await selected() === -1, 'and a second one closes it');
// A finger, through CDP's touch events, which Chrome delivers to the page as a touch
// screen's: pointer events as it presses and lifts, and its mouse events only after the
// lift (`bindCanvasEvents`, `src/ui/events.ts`). So the eye (12-27 x 46-61) is held while
// the finger is down, and a tap is one click.
const touch = async (type: string, x: number, y: number) => {
  const p = await evaluate(`(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();
    return {x:r.left+(${x}+0.5)*r.width/320, y:r.top+(${y}+0.5)*r.height/200};})()`);
  await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }] });
};
const pressingEye = () => evaluate(`window.__probe.screen.ui.ctx.interface.pressingEye`);
// The tap is this page's first user activation, the clicks above being the page's own
// events, and a touch gives one only at its lift: the sound is unlocked by it
// (`createSoundManager`, `src/main.ts`), not by the press.
const soundRunning = () => evaluate(`window.__probe.sound.isRunning()`);
check(!(await soundRunning()), 'no user activation yet: the sound is locked');
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await touch('touchStart', 124, 10); await touch('touchEnd', 124, 10); await vbls(TICK);
check(await selected() === 1, 'a tap on a champion\'s bars opens the inventory, once');
check(await soundRunning(), 'and unlocks the sound');
await touch('touchStart', 19, 53); await vbls(TICK);
check(await pressingEye(), 'a finger held on the eye keeps it pressed');
await touch('touchEnd', 19, 53); await vbls(TICK);
check(!(await pressingEye()), 'and lifting it lets go');
await touch('touchStart', 124, 10); await touch('touchEnd', 124, 10); await vbls(TICK);
check(await selected() === -1, 'a second tap closes the inventory');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
// A mouse pressed on the eye, moved off the canvas and released there: the canvas has the
// pointer captured (`bindCanvasEvents`), so the release is its, and the eye is let go. A
// move names the button held, or Chrome takes it for a move with none, which ends the
// capture.
const realMouse = async (type: string, x: number, y: number) => {
  const p = await evaluate(`(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();
    return {x:r.left+(${x}+0.5)*r.width/320, y:r.top+(${y}+0.5)*r.height/200};})()`);
  await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
};
await canvasClick(124, 10, 0); await vbls(TICK);
await realMouse('mousePressed', 19, 53); await vbls(TICK);
check(await pressingEye(), 'a mouse held on the eye keeps it pressed');
await realMouse('mouseMoved', 19, 215); await realMouse('mouseReleased', 19, 215); await vbls(TICK);
check(!(await pressingEye()), 'and released off the canvas, lets go');
await canvasClick(124, 10, 0); await vbls(TICK);
check(await selected() === -1, 'the inventory closed again');

// The Hint Oracle's button (`src/renderer/ui/HintOracleButton.ts`), CSB's set only: the
// inventory's close box is the Oracle's `?`, and a real click on it opens the Oracle on the
// party's square. CSB's `csbgame2.dat` is read into a `?intro=0` game, and its party set on
// level 4 (1,7), thirteen squares from the nearest creature, so nothing moves while the
// frames are taken; there the Oracle lists CREATURES and CIRCLE OF POISON. Its title list
// cycles a palette slot every 21 VBLs, so it is no frame: `tools/checks/hint-oracle-screen.ts`
// checks its pixels. A hint's page, the first title's, does not cycle, and is one.
await navigate(`${APP}?intro=0&dungeon=csb`, GAME);
await evaluate(`(async()=>{
  const { game, renderView, applySaveBytes } = window.__probe;
  applySaveBytes(game, new Uint8Array(await (await fetch('/gamefiles/csb/csbgame2.dat')).arrayBuffer()));
  const party = game.ctx.party.state;
  party.position.x = 1; party.position.y = 7;
  renderView();
  return party.champions.map((c) => c.name).join(', ');
})()`).then(names => console.log('  csb party:', names));
await vbls(TICK);
await canvasClick(15, 15, 2);  await vbls(TICK);
await leaveCanvas(); await vbls(SHOWN);
console.log('state: CSB inventory');
const csbInventory = await shot('15-csb-inventory');
// A real click on the Hint Oracle, and the Oracle waiting for a button again: its click
// taken, two of its VBLs on, and whatever it set off drawn.
const oracleAt = async (x: number, y: number) => {
  const from = await evaluate(`window.__probe.intro.vbls`);
  await realClick(x, y);
  await until(`(i => i.vbls >= ${from} + 2 && i.oracle?.waiting === true)(window.__probe.intro)`, 'the Hint Oracle waiting for a button');
};
await oracleAt(214, 40);
check(await evaluate(`window.__probe.screen.ui.hintOracleUp`), 'a real click on the close box opens the Hint Oracle');
await oracleAt(160, 36);
await leaveCanvas();
console.log('state: hint page');         await shot('16-hint-oracle-page');
// DONE (x 221-289, y 179-192) on the page goes back to the title list, and on the list
// closes the Oracle: the inventory comes back as it was.
await oracleAt(255, 185);
await realClick(255, 185); await until(`window.__probe.intro.oracle === null`, 'the Hint Oracle closed'); await vbls(TICK);
await leaveCanvas(); await vbls(SHOWN);
check(!(await evaluate(`window.__probe.screen.ui.hintOracleUp`)) && (await canvasPixels()) === csbInventory,
  'DONE on the page and then on the list closes the Oracle, back to frame 15');

// Conflux 3.5 at its start: level 0, (13,24) facing north, no champion. Nearly every view
// of it runs a skin's program from its `CSBgraphics.dat`, and its DSAs run from the first
// tick (`tools/checks/watch-conflux-start.ts`). The square in front is a wall, which its skin
// paints with a picture, and nothing in view moves.
await navigate(`${APP}?intro=0&dungeon=conflux-3.5`, GAME);
await leaveCanvas(); await vbls(SHOWN);
console.log('state: Conflux start');     const confluxStart = await shot('18-conflux-start');
// A viewport overlay (`src/renderer/csbwin/OverlayScreen.ts`), put up on the engine as a
// DSA's `&OVERLAY` and `&JITTER` would: overlay 1 of Conflux's `CSBgraphics.dat` over this
// view, half of each pixel the overlay's, its colour 0 transparent, and the view shifted
// four pixels right under it. Hidden and shifted back after, the view is frame 18.
const OVERLAY = `window.__probe.game.ctx.overlay`;
await evaluate(`(()=>{const o = ${OVERLAY}; o.SelectOverlay(1, 1, 50, 0, 0, window.__probe.game.ctx.state.tickCount);
  o.Jitter(4, 0, 0, 0); window.__probe.refreshScreen(); return o.active;})()`);
await vbls(TICK);
console.log('state: overlay');           await shot('17-overlay');
await evaluate(`(()=>{const o = ${OVERLAY}; o.active = false; o.Jitter(0, 0, 0, 0); window.__probe.refreshScreen(); return 1;})()`);
await vbls(TICK);
check((await canvasPixels()) === confluxStart, 'the overlay hidden and the view shifted back, it is frame 18 again');
// Wall decorations of Conflux's `CSBgraphics.dat`, their bitmaps read as bitplanes
// (`tools/checks/extended-decorations.ts`), from level 0 (14,14) facing south: on the west
// faces of the squares to the left, decoration 5, a bookshelf, drawn as it stands at F1
// (15,15), and decoration 11, a ladder, its side view scaled by `ShrinkBLT` to F2 (15,16).
await evaluate(FACE(14, 14, 0, 2)); await vbls(TICK);
await leaveCanvas(); await vbls(SHOWN);
console.log('state: Conflux bookshelf'); await shot('20-conflux-bookshelf');

// The settings dialog (`src/renderer/ui/SettingsDialog.ts`), over the default dungeon's
// first view: Esc opens it, over the whole screen, on GAME, and the clock is held while it
// is up. A frame a tab: GAME's with the pointer on DRINK AT FOUNTAINS' button, so it is
// lit, the help line names it and the cursor is drawn, DISPLAY's and SOUND's with it off the canvas,
// and KEYS' with MOVE FORWARD's first slot waiting for its key.
await navigate(`${APP}?intro=0&keepsaves&dungeon=dm-atari`, GAME);
const settingsUp = () => evaluate(`window.__probe.screen.ui.settingsDialog !== null`);
const settingsValues = () => evaluate(`window.__probe.screen.ui.settings.values`);
const ticks = () => evaluate(`window.__probe.game.ctx.state.tickCount`);
const pointerAt = (x: number, y: number) => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent('pointermove',{isPrimary:true,pointerType:'mouse',clientX:r.left+(${x}+0.5)*r.width/320,clientY:r.top+(${y}+0.5)*r.height/200,bubbles:true}));return 1;})()`);
await key('Escape'); await vbls(SHOWN);
check(await settingsUp(), 'Esc opens the settings in play');
const heldAt = await ticks(); await vbls(2 * TICK);
check(await ticks() === heldAt, 'the clock is held while they are up');
await pointerAt(85, 65); await vbls(SHOWN);
console.log('state: settings, GAME');    await shot('21-settings-game');
await leaveCanvas(); await vbls(SHOWN);
await canvasClick(120, 45, 0); await vbls(SHOWN);
console.log('state: settings, DISPLAY'); await shot('22-settings-display');
// DISPLAY's ASPECT RATIO (236,65): 4:3 shows the 320x200 canvas 960x720, a click still
// landing on what it shows, and 16:10 again 960x600.
const canvasSize = () => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  return [c.width,c.height,r.width,r.height].join('x');})()`);
await canvasClick(236, 65, 0); await vbls(SHOWN);
check((await settingsValues()).aspectRatio === '4:3' && await canvasSize() === '320x200x960x720',
  'ASPECT RATIO at 4:3 shows the 320x200 canvas 960x720');
await canvasClick(236, 65, 0); await vbls(SHOWN);
check((await settingsValues()).aspectRatio === '16:10' && await canvasSize() === '320x200x960x600',
  'a click on it there, where it is shown, makes it 16:10, 960x600');
await canvasClick(197, 45, 0); await vbls(SHOWN);
console.log('state: settings, SOUND');   await shot('23-settings-sound');
// The VOLUME slider, dragged with CDP's own mouse from its left end, and released off the
// canvas, right of it: the canvas has the pointer captured, so the moves off it come at
// its edge, and the knob goes to the track's right end; the release is the canvas's too,
// and a move after it drags nothing.
const cdpMouse = async (type: string, x: number, y: number) => {
  const p = await evaluate(`(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();
    return {x:r.left+(${x}+0.5)*r.width/320, y:r.top+(${y}+0.5)*r.height/200};})()`);
  await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
};
await cdpMouse('mousePressed', 200, 86); await vbls(SHOWN);
check((await settingsValues()).volume === 0, 'a press at the VOLUME slider\'s left end sets it to 0');
await cdpMouse('mouseMoved', 254, 86); await vbls(SHOWN);
const halfway = (await settingsValues()).volume;
check(halfway > 0.4 && halfway < 0.6, `dragged to the track's middle, about a half (${halfway})`);
await cdpMouse('mouseMoved', 400, 86); await cdpMouse('mouseReleased', 400, 86); await vbls(SHOWN);
check((await settingsValues()).volume === 1, 'dragged off the canvas, to its right, the volume is 1');
await pointerAt(200, 86); await vbls(SHOWN);
check((await settingsValues()).volume === 1, 'released there, a move drags nothing');
// SOUND's OFF, read back after a reload: the setting is kept. Then a double click on the message area opens the dialog, and a right click
// closes it, off KEYS' slots.
await canvasClick(284, 65, 0); await vbls(SHOWN);
check((await settingsValues()).sound === false, 'SOUND\'s OFF turns the sound off');
// KEYS (`src/renderer/ui/SettingsKeys.ts`), KEY LABELS shown, as the browser here gives
// no layout: a click on MOVE FORWARD's first slot waits for its key, and a key pressed
// fills it by its code, AZERTY's Z being KeyW.
await canvasClick(240, 45, 0); await vbls(SHOWN);
await canvasClick(190, 105, 0); await vbls(SHOWN);
console.log('state: settings, KEYS');    await shot('24-settings-keys');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyW',bubbles:true})),1`); await vbls(SHOWN);
const rebound = await settingsValues();
check(rebound.keyBindings['move.forward'][0] === 'KeyW' && rebound.keyBindings['attack.1.0'][0] === '' && rebound.keyPreset === 'custom',
  'a key pressed fills the slot by its code, leaves the slot it was in, and the table is CUSTOM');
// A notch of the wheel scrolls the list three rows, and the VBL's frame draws them, the
// pointer still (`GameScreen.takeWheelTurned`).
const screenSum = () => evaluate(`window.__probe.screen.ui.screenIndexBuffer.pixels.reduce((s,p,i)=>(s+p*(i%997+1))%1000000007,0)`);
const unscrolled = await screenSum();
await evaluate(`document.getElementById('game-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:100,cancelable:true,bubbles:true})),1`); await vbls(SHOWN);
check(await evaluate(`window.__probe.screen.ui.settingsDialog.keys.scrollTop`) === 3 && await screenSum() !== unscrolled,
  'a notch of the wheel scrolls the keys three rows, drawn with the pointer still');
await canvasClick(160, 100, 2); await vbls(SHOWN);
check(!(await settingsUp()), 'a right click closes the settings');
// DISPLAY's LEFT HANDED (85,107), checked last, as the party it builds would change
// the cursor of the dialogs above: the dialog closed and the party built, the panels are
// on the left and the view on the right, each band's gap between them. A frame of it,
// with the pointer at (84,100), on the right-hand column's (317,100): its arrow is drawn
// there, across the gap into the view, not cut where the column ends on CSBWin's screen. A click where the
// turn-right arrow is shown, (80,135), turns the party. Under the dialog the screen is
// CSBWin's again, so the clicks that turn it off land where they always do.
const facing = () => evaluate(`window.__probe.screen.ui.partyState.facing`);
await key('Escape'); await vbls(SHOWN);
await canvasClick(120, 45, 0); await vbls(SHOWN);
await canvasClick(85, 107, 0); await vbls(SHOWN);
check((await settingsValues()).leftHanded === true, 'LEFT HANDED turns the left-handed screen on');
await key('Escape'); await vbls(SHOWN);
await evaluate(BUILD_PARTY); await vbls(TICK);
await pointerAt(84, 100); await vbls(SHOWN);
const leftHover = await evaluate(`(()=>{const p=window.__probe.screen.ui.hoverPoint;return Math.floor(p.x)+','+Math.floor(p.y);})()`);
check(leftHover === '317,100',
  `left-handed, the pointer at (84,100) is the column's (317,100) (${leftHover})`);
console.log('state: left-handed');       await shot('29-left-handed');
await leaveCanvas(); await vbls(SHOWN);
const facingBefore = await facing();
await canvasClick(80, 135, 0); await vbls(TICK);
check(await facing() === ((facingBefore + 1) & 3), 'left-handed, a click where the turn-right arrow is shown turns the party right');
await key('Escape'); await vbls(SHOWN);
check(await settingsUp(), 'left-handed, Esc opens the settings, the screen CSBWin\'s under them');
await canvasClick(120, 45, 0); await vbls(SHOWN);
await canvasClick(85, 107, 0); await vbls(SHOWN);
check((await settingsValues()).leftHanded === false, 'LEFT HANDED again turns it off');
await key('Escape'); await vbls(SHOWN);
await navigate(`${APP}?intro=0&keepsaves&keepsettings&dungeon=dm-atari`, GAME);
const kept = await settingsValues();
check(kept.sound === false && kept.volume === 1, 'after a reload, the sound is still off, at full volume');
await canvasClick(100, 185, 0); await canvasClick(150, 190, 0); await vbls(SHOWN);
check(await settingsUp(), 'a double click on the message area opens the settings');
// EXIT asks first, in `_DoMenu`'s centred menu (a frame of it, the pointer off the
// canvas); Esc puts the dialog back, and the question's EXIT, once it has flashed, opens
// the welcome page, the page's other parameters kept.
const exiting = () => evaluate(`window.__probe.screen.ui.settingsDialog?.exiting === true`);
await canvasClick(279, 19, 0); await vbls(SHOWN);
check(await exiting(), 'EXIT asks first');
await leaveCanvas(); await vbls(SHOWN);
console.log('state: settings, EXIT');    await shot('28-settings-exit');
await key('Escape'); await vbls(SHOWN);
check(await settingsUp() && !(await exiting()), 'Esc on the question puts the settings back');
await canvasClick(279, 19, 0); await vbls(SHOWN);
const exitButton = await evaluate(`(()=>{const b=window.__probe.screen.ui.uiTables.graphic231.buttons.buttons18828.find((e)=>e.word0===210);
  return {x:(b.x1+b.x2-1)>>1, y:(b.y1+b.y2-1)>>1};})()`);
await canvasClick(exitButton.x, exitButton.y, 0); await until(WELCOME, 'the welcome page');
const left = await evaluate(`(()=>{const p=new URLSearchParams(location.search);
  return {search: location.search, welcome: document.querySelector('.welcome-page') !== null,
    query: !p.has('dungeon') && p.get('intro') === '0' && p.has('keepsaves') && p.has('keepsettings')};})()`);
check(left.welcome && left.query, `the question's EXIT opens the welcome page, the other parameters kept (${left.search})`);

// The store held by another tab (`openSaveDatabase`, `src/data/saves/idb.ts`). A newer
// build's open, here a raw one at the next version, is not blocked: the game lets its
// connection go, and its next open says the game was updated. An earlier build's tab,
// here a raw connection at version 4 that never lets go, has the game's open refused at
// once, asking for the other tabs to be closed, where it used to hang ENTER, F5, F9 and the
// disk menu for ever; and so is the next, which would only queue behind it. Let go, the
// open goes on, and the store lists.
await navigate(`${APP}?intro=0&dungeon=dm-atari`, GAME);
const heldStore = await evaluate(`(async()=>{
  // Every step bounded, so a store that hangs fails the checks instead of the run.
  const within = (promise) => Promise.race([promise, new Promise((r) => setTimeout(() => r('hung'), 2000))]);
  const list = () => within(window.__probe.saves.list().then(() => 'listed', (e) => e.message));
  const opened = await list();
  const version = await within(new Promise((r) => { const o = indexedDB.open('csbweb-saves');
    o.onsuccess = () => { const v = o.result.version; o.result.close(); r(v); }; }));
  const newer = await new Promise((resolve) => { let blocked = false; const o = indexedDB.open('csbweb-saves', version + 1);
    o.onblocked = () => { blocked = true; };
    o.onsuccess = () => { o.result.close(); resolve(blocked ? 'blocked, then opened' : 'opened'); };
    o.onerror = () => resolve('error');
    setTimeout(() => resolve(blocked ? 'blocked' : 'pending'), 2000); });
  const updated = await list();
  if (newer !== 'opened') return { opened, version, newer, updated };
  await within(new Promise((r) => { const d = indexedDB.deleteDatabase('csbweb-saves'); d.onsuccess = d.onerror = r; }));
  const older = await within(new Promise((r) => { const o = indexedDB.open('csbweb-saves', 4);
    o.onupgradeneeded = () => o.result.createObjectStore('saves', { keyPath: 'id' }); o.onsuccess = () => r(o.result); }));
  if (older === 'hung') return { opened, version, newer, updated, older };
  const held = await list();
  const again = await list();
  older.close();
  await new Promise((r) => setTimeout(r, 500));
  const released = await list();
  return { opened, version, newer, updated, held, again, released };})()`);
console.log('  store held:', JSON.stringify(heldStore));
check(heldStore.opened === 'listed' && heldStore.newer === 'opened'
  && heldStore.updated === 'THE GAME WAS UPDATED IN ANOTHER TAB. RELOAD THIS PAGE',
  'a newer build\'s open is not blocked: the game lets the store go, and then says it was updated');
check(heldStore.held === 'CLOSE THE GAME IN YOUR OTHER TABS, THEN TRY AGAIN' && heldStore.again === heldStore.held
  && heldStore.released === 'listed',
  'an earlier build holding the store refuses the game\'s open at once, asking to close it; let go, the store lists');

// The store's upgrade to version 6 (`upgradeRows`, `src/data/saves/idb.ts`). A store of
// version 5, staged on `/package.json` (the origin's, without the app), holds a row and
// its file in one. The welcome page opens it: the row is kept without its file, which is
// in `saveFiles` under the row's id, byte for byte. Then the game's store: a list reads
// the row alone, a read gives the file back, and an import writes, and a DELETE deletes,
// a row and its file together.
const rawSaves = `new Promise((resolve, reject) => { const o = indexedDB.open('csbweb-saves');
  o.onerror = () => reject(o.error);
  o.onsuccess = () => { const db = o.result, tx = db.transaction(['saves', 'saveFiles']);
    const rows = tx.objectStore('saves').getAll(), files = tx.objectStore('saveFiles').getAll();
    const sum = (b) => new Uint8Array(b).reduce((a, x) => (a * 31 + x) >>> 0, 0);
    tx.oncomplete = () => { db.close(); resolve({ version: db.version, stores: [...db.objectStoreNames].sort().join(),
      rows: rows.result.map((r) => r.id + ('bytes' in r ? '+bytes' : '')).sort().join(),
      files: files.result.map((f) => f.id + ':' + f.bytes.byteLength + ':' + sum(f.bytes)).sort().join() }); }; }; })`;
await navigate(`${APP}package.json?keepsaves`, LOADED);
const stagedV5 = await evaluate(`(async()=>{
  const file = new Uint8Array(await (await fetch('/gamefiles/csb/csbgame2.dat')).arrayBuffer());
  await new Promise((r) => { const d = indexedDB.deleteDatabase('csbweb-saves'); d.onsuccess = d.onerror = r; });
  await new Promise((resolve, reject) => { const o = indexedDB.open('csbweb-saves', 5);
    o.onupgradeneeded = () => { o.result.createObjectStore('saves', { keyPath: 'id' }); o.result.createObjectStore('dataSets', { keyPath: 'id' }); };
    o.onerror = () => reject(o.error);
    o.onsuccess = () => { const tx = o.result.transaction('saves', 'readwrite');
      tx.objectStore('saves').put({ id: 'probe-v5.dat', name: 'probe-v5.dat', dataSet: 'csb', playthrough: 7, quick: false, sleep: false,
        savedAt: 1, usedAt: 1, playTime: 0, level: 1, champions: ['PROBE'], unofficial: false, bytes: file.slice().buffer });
      tx.oncomplete = () => { o.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; });
  return 'probe-v5.dat:' + file.length + ':' + file.reduce((a, x) => (a * 31 + x) >>> 0, 0); })()`);
await navigate(`${APP}?dungeon=nowhere&keepsaves`, WELCOME);
const upgradedV5 = await evaluate(rawSaves);
console.log('  version 5 upgraded:', JSON.stringify(upgradedV5));
check(upgradedV5.version === 7 && upgradedV5.rows === 'probe-v5.dat' && upgradedV5.files === stagedV5,
  "the upgrade to version 6 keeps a row without its file, and its file byte for byte in saveFiles under the row's id");
check(upgradedV5.stores === 'dataSets,recordingParts,recordings,saveFiles,saves', `and to version 7 adds the recordings' two stores (${upgradedV5.stores})`);
await navigate(`${APP}?intro=0&dungeon=csb&keepsaves`, GAME);
const filesApart = await evaluate(`(async()=>{ const { saves } = window.__probe;
  const listed = await saves.list(), entry = listed.find((e) => e.id === 'probe-v5.dat');
  if (!entry) return { listed: listed.map((e) => e.id).join() };
  const { bytes } = await saves.open(entry);
  const read = 'probe-v5.dat:' + bytes.length + ':' + bytes.reduce((a, x) => (a * 31 + x) >>> 0, 0);
  const imported = await saves.importSave({ name: 'probe-import.dat', bytes });
  const afterImport = await ${rawSaves};
  if (imported.kind === 'stored') await saves.remove(imported.entry);
  return { listedBytes: 'bytes' in entry, read, imported: imported.kind, afterImport, afterDelete: await ${rawSaves} }; })()`);
console.log('  files apart:', JSON.stringify(filesApart));
check(filesApart.listedBytes === false && filesApart.read === stagedV5,
  'a listed save carries no file, and a read gives its file back');
check(filesApart.imported === 'stored' && filesApart.afterImport?.rows === 'probe-import.dat,probe-v5.dat'
  && filesApart.afterImport.files.split(',').map((f: string) => f.split(':')[0]).join() === 'probe-import.dat,probe-v5.dat'
  && filesApart.afterDelete?.rows === 'probe-v5.dat' && filesApart.afterDelete.files === stagedV5,
  'an import writes a row and its file, and a DELETE deletes both');

// The game's recording in the store (`BrowserRecordingStore`, `RecordingWriter`): a write
// puts its row and its parts, and a read puts them back together as the recorder has it.
// A second write, after a click, adds a part of its changes alone.
const recordingWritten = await evaluate(`(async()=>{ const { recorder, recordings, recordingStore } = window.__probe;
  const summary = (r) => r && JSON.stringify({ ...r, start: r.start.kind, vbls: 0 });
  await recordings.flush();
  const entry = (await recordingStore.list()).find((e) => e.dataSet === 'csb' && !e.ended);
  if (!entry) return { entries: (await recordingStore.list()).length };
  const first = await recordingStore.read(entry.id);
  window.__probe.game.input.apply({ kind: 'unclick' });
  await recordings.flush();
  const second = await recordingStore.read(entry.id), live = recorder.recording;
  const rows = (await recordingStore.list()).find((e) => e.id === entry.id);
  return { parts: entry.parts, partsAfter: rows.parts, changes: first.changes.length, changesAfter: second.changes.length,
    same: summary(second) === summary(live), start: second.start.kind, kinds: second.changes.map((c) => c.change.kind).join() }; })()`);
console.log('  recording written:', JSON.stringify(recordingWritten));
check(recordingWritten.parts === 2 && recordingWritten.start === 'new' && recordingWritten.changes >= 1
  && recordingWritten.partsAfter === 3 && recordingWritten.changesAfter === recordingWritten.changes + 1 && recordingWritten.same,
  "the game's recording is written to the store, its head and its changes, and a write after a click adds a part, read back as the recorder has it");

// A recording cut and a write held against the row (`BrowserRecordingStore`): a write
// after the first that finds the row otherwise than it says writes nothing; a cut keeps
// the changes before the point, its last part cut, and ends the row there. The running
// recording removed, as another tab's prune removes it, is written whole at the next write.
const recordingPruned = await evaluate(`(async()=>{ const { recorder, recordings, recordingStore } = window.__probe;
  const id = 'probe-cut', change = (n) => ({ change: { kind: 'unclick' }, vbl: n, time: 0, random: n });
  const entry = { id, dataSet: 'csb', build: 'probe', parent: null, playthrough: 7, recordedAt: 1, writtenAt: 1, vbls: 9, ended: false, changes: 4, parts: 3 };
  await recordingStore.write(entry, [{ id, seq: 0, start: { kind: 'new', random: 1, randomGameID: 7 }, parent: null, rules: {}, extras: {} },
    { id, seq: 1, changes: [change(1), change(2)] }, { id, seq: 2, changes: [change(3), change(4)] }], null);
  let refused = '';
  try { await recordingStore.write({ ...entry, changes: 5, parts: 4 }, [{ id, seq: 3, changes: [change(5)] }], { parts: 2, changes: 2 }); }
  catch (error) { refused = error.name; }
  const unchanged = (await recordingStore.read(id)).changes.length;
  await recordingStore.cut(id, { changes: 3, vbls: 3 });
  const cut = await recordingStore.read(id), row = (await recordingStore.list()).find((e) => e.id === id);
  await recordingStore.remove(id);
  const running = recorder.recording.id;
  await recordingStore.remove(running);
  window.__probe.game.input.apply({ kind: 'unclick' });
  await recordings.flush();
  const healed = await recordingStore.read(running);
  return { refused, unchanged, cut: cut.changes.map((c) => c.random).join(), vbls: cut.vbls, ended: cut.ended, parts: row.parts,
    healed: healed.changes.length === recorder.recording.changes.length && healed.changes.length > 0 }; })()`);
console.log('  recording pruned:', JSON.stringify(recordingPruned));
check(recordingPruned.refused === 'RecordingPrunedError' && recordingPruned.unchanged === 4,
  'a write held against a row that says otherwise is refused, and writes nothing');
check(recordingPruned.cut === '1,2,3' && recordingPruned.vbls === 3 && recordingPruned.ended && recordingPruned.parts === 3,
  'a cut keeps the changes before its point, its last part cut, and ends the row there');
check(recordingPruned.healed, "the running recording removed, as another tab's prune removes it, is written whole at the next write");

// A recording played back in the page (`playRecording`, `src/main.ts`): the game's own,
// played on with a turn, the settings dialog holding the clock and a turn back, then its
// loop stopped and the recording written. `?recording=` plays it to its end, at the wall
// clock's pace times the viewer's and the held clock at once: the game's keys reach
// nothing; the viewer's strip (`src/renderer/ui/RecordingStrip.ts`) pauses on Space, no
// VBL running, sets the pace on `+`, and plays on at a click on it; the store's
// recordings and saves are as they were; the game ends as the recorded one stood, its
// loop stopped; and the message area says what was skipped, the settings' span, and that
// the recording ends, a frame of it with the strip over it. Backspace plays it again from
// its start, the message area emptied, to the same end, and Esc goes back to the welcome
// page.
await key('KeyL'); await vbls(TICK);
await key('Escape'); await vbls(30);
await key('Escape'); await vbls(SHOWN);
await key('KeyJ'); await vbls(TICK);
const recordedGame = await evaluate(`(async()=>{ const { game, recorder, recordings, recordingStore, saves } = window.__probe;
  game.stop();
  await recordings.flush();
  const { ctx } = game, { position, facing } = ctx.party.state, { id, changes, vbls } = recorder.recording;
  return { id, changes: changes.length, pauses: changes.filter((c) => c.change.kind === 'pause').length, vbls,
    state: JSON.stringify([ctx.state.tickCount, ctx.random.getSeed(), position, facing]),
    recordings: (await recordingStore.list()).length, saves: (await saves.list()).length }; })()`);
await navigate(`${APP}?dungeon=csb&recording=${recordedGame.id}&keepsaves`, 'window.__probe?.player() != null');
await key('KeyL');
await key('F5');
await key('Space');
const pausedAt = await evaluate(`window.__probe.player().vbls`);
await wait(300);
const paused = await evaluate(`(({ screen }) => ({ vbls: window.__probe.player().vbls, playing: window.__probe.player().playing,
  dialog: screen.ui.dialog !== null }))(window.__probe)`);
await key('+');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'=',code:'Equal',bubbles:true})),1`);
await canvasClick(14, 175);
const paced = await evaluate(`window.__probe.game.pace`);
await until('!window.__probe.player().playing', 'the recording played to its end');
await until(`window.__probe.game.ctx.host.messages.snapshot().includes('THE RECORDING ENDS HERE.')`, 'the line at its end');
await until(`(m => m.backlog().printQueue === 0 && m.backlog().futureLines === 0 && m.scrollState().textScanlineScrollCount < 0)(window.__probe.game.ctx.host.messages)`,
  'the message area at rest');
const playedLines: string[] = await evaluate(`window.__probe.game.ctx.host.messages.snapshot()`);
const playedState = `(async()=>{ const { game, recordingStore, saves, screen } = window.__probe, player = window.__probe.player();
  const { ctx } = game, { position, facing } = ctx.party.state;
  return { drift: player.drift, running: game.running, dialog: screen.ui.dialog !== null || screen.ui.saveMenu !== null,
    state: JSON.stringify([ctx.state.tickCount, ctx.random.getSeed(), position, facing]),
    recordings: (await recordingStore.list()).length, saves: (await saves.list()).length }; })()`;
const playedGame = await evaluate(playedState);
console.log('  recording played:', JSON.stringify({ recordedGame, playedGame, pausedAt, paused, paced }));
check(recordedGame.pauses === 2 && playedGame.drift === null && playedGame.state === recordedGame.state && !playedGame.running,
  `?recording= plays the store's recording to its end, the settings' held clock among it, the game as the recorded one stood, and stops (${recordedGame.vbls} VBLs, ${recordedGame.changes} changes)`);
check(!paused.dialog && !playedGame.dialog, 'the game\'s keys reach nothing while it plays: its turn turns nothing, F5 saves nothing, and no dialog opens');
check(paused.playing && paused.vbls === pausedAt && paced === 4,
  `Space pauses it, no VBL running for 300 ms (${pausedAt} VBLs played), +, then its key unshifted, sets the pace to x4, and a click on PLAY plays on`);
check(playedLines.some((line) => /^SKIPPED \d+S ON THE SETTINGS$/.test(line)),
  `a line in the message area says what was run at once, and another the end: ${JSON.stringify(playedLines.filter((line) => line))}`);
check(playedGame.recordings === recordedGame.recordings && playedGame.saves === recordedGame.saves,
  'and the page records nothing and saves nothing');
await shot('32-recording-ended');
await key('Backspace');
const restartedLines: string[] = await evaluate(`window.__probe.game.ctx.host.messages.snapshot()`);
await until('!window.__probe.player().playing', 'the recording played again to its end');
const replayedGame = await evaluate(playedState);
check(!restartedLines.includes('THE RECORDING ENDS HERE.') && replayedGame.drift === null && replayedGame.state === recordedGame.state,
  'Backspace plays it again from its start, the message area emptied, to the same end');
await leave(() => key('Escape'), WELCOME);
check(await evaluate(`!new URLSearchParams(location.search).has('recording')`), 'and Esc goes back to the welcome page');

// A site's recording (`fetchSharedRecording`, `src/main.ts`), through the dev server's
// `api/recordings` and `recordings/` (`vite.config.mts`; the image's own server in
// `tools/check-image.sh`): CSB's `csbgame2.dat` read, a turn, and F5, the package of the
// quick save's path shared at its point by a player. Pending, it is listed to its
// uploader alone, then to everyone once the moderator approves it. `?recording=<id>`
// plays it from the server to the save's point, the file made there the save's, and the
// store, which a shared recording never enters, is as it was.
const SHARER = '00000000-0000-4000-8000-000000000002';
await navigate(`${APP}?intro=0&dungeon=csb`, GAME);
await evaluate(`(async()=>{ const { saves } = window.__probe;
  const bytes = new Uint8Array(await (await fetch('/gamefiles/csb/csbgame2.dat')).arrayBuffer());
  const imported = await saves.importSave({ name: 'csbgame2.dat', bytes });
  if (imported.kind === 'stored') saves.read(await saves.open(imported.entry));
  return imported.kind; })()`);
await vbls(TICK);
await key('KeyL'); await vbls(TICK);
await key('F5');
await until(`window.__probe.saves.list().then((rows) => rows.some((e) => e.quick && e.recording))`, 'the quick save');
const sharedRecording = await evaluate(`(async()=>{ const { saves, recordings, recordingStore, readRecordingPath, packageOfSave, writeRecordingPackage } = window.__probe;
  await recordings.flush();
  const entry = (await saves.list()).find((e) => e.quick && e.recording);
  const path = await readRecordingPath(recordingStore, entry.recording.recording);
  const { bytes } = await saves.open(entry);
  const pkg = packageOfSave(path, entry.recording, bytes, { title: 'Probe', author: '', description: '' },
    { recordedAt: entry.savedAt, endedAt: entry.savedAt, playTime: entry.playTime });
  const form = new FormData();
  form.append('package', new Blob([await writeRecordingPackage(pkg)]), 'probe.gz');
  const shared = await fetch('api/recordings', { method: 'POST', headers: { 'X-Player-Id': ${JSON.stringify(SHARER)} }, body: form });
  const { id } = await shared.json();
  const listed = async (player) => (await (await fetch('api/recordings?dataSet=csb', player ? { headers: { 'X-Player-Id': player } } : undefined)).json())
    .recordings.find((r) => r.id === id) ?? null;
  const toSharer = await listed(${JSON.stringify(SHARER)}), toNobody = await listed(null);
  const approved = (await fetch('api/recordings/' + id, { method: 'POST', headers: { 'X-Player-Id': ${JSON.stringify(MODERATOR)} },
    body: JSON.stringify({ action: 'approve' }) })).status;
  const afterApproval = await listed(null);
  return { status: shared.status, id, joins: path.length - 1, changes: entry.recording.changes, vbls: entry.recording.vbls,
    toSharer: toSharer && [toSharer.title, toSharer.status, toSharer.mine].join(), toNobody, approved,
    afterApproval: afterApproval && [afterApproval.title, afterApproval.status ?? 'listed', afterApproval.mine ?? false].join(),
    recordings: (await recordingStore.list()).length, saves: (await saves.list()).length }; })()`);
console.log('  recording shared:', JSON.stringify(sharedRecording));
check(sharedRecording.status === 201 && /^[0-9A-F]{16}$/.test(sharedRecording.id) && sharedRecording.toSharer === 'Probe,pending,true'
  && sharedRecording.toNobody === null && sharedRecording.approved === 200 && sharedRecording.afterApproval === 'Probe,listed,false',
  'a save\'s package shared through api/recordings is pending, listed to its uploader alone, and to everyone once the moderator approves it');
await navigate(`${APP}?dungeon=csb&recording=${sharedRecording.id}&keepsaves`, 'window.__probe?.player() != null');
await until('!window.__probe.player().playing', 'the shared recording played to its end');
const playedShared = await evaluate(`(async()=>{ const { game, recordingStore, saves } = window.__probe, player = window.__probe.player();
  return { drift: player.drift, joins: player.joins, point: [player.point.changes, player.point.vbls].join(), running: game.running,
    recordings: (await recordingStore.list()).length, saves: (await saves.list()).length }; })()`);
console.log('  shared recording played:', JSON.stringify(playedShared));
check(playedShared.drift === null && playedShared.joins === sharedRecording.joins && !playedShared.running
  && playedShared.point === `${sharedRecording.changes},${sharedRecording.vbls}`,
  `?recording=<id> plays the site's recording from the server to the save's point, through its ${sharedRecording.joins} join(s), the file made there the save's, and stops`);
check(playedShared.recordings === sharedRecording.recordings && playedShared.saves === sharedRecording.saves,
  'and the shared recording enters no store');

// The book's RECORDINGS (`src/ui/welcomePage.ts`): first the site's recordings of CSB, the
// one shared above, approved, which a click selects, its panel offering a player PLAY,
// `?recording=<id>`, alone. Then the browser's points of CSB, the latest
// made first, among them the quick save above, by its name, and a game's end, a copy of
// its recording the game's end ended, written here. A click selects one, and the panel
// says where its path starts, its times, its build, with PLAY, and on the game's end
// DELETE: it asks first, then the end leaves the list and the store. PLAY on the quick
// save plays the path the store holds to it, `?recording=save:<row>`, to its point, the
// file made there the save's.
const endWritten = await evaluate(`(async()=>{ const { recordingStore, saves } = window.__probe;
  const entry = (await saves.list()).find((e) => e.quick && e.recording);
  const row = (await recordingStore.list()).find((r) => r.id === entry.recording.recording);
  const recording = await recordingStore.read(row.id), id = 'probe-end', now = Date.now();
  await recordingStore.write({ ...row, id, parent: null, ended: true, end: { word11694: true }, endedAt: now, playTime: 754000, parts: 2 },
    [{ id, seq: 0, start: recording.start, parent: null, rules: recording.rules, extras: recording.extras }, { id, seq: 1, changes: recording.changes }], null);
  return { save: entry.name, saveId: entry.id, recording: entry.recording.recording, point: [entry.recording.changes, entry.recording.vbls].join(), level: entry.level }; })()`);
await navigate(`${APP}?dungeon=nowhere&keepsaves`, WELCOME);
await clickOn('.pick-cell:has(.pick[data-set="csb"]) .pick-documents');
await clickOn('#documents-tab-recordings');
const recordingsTab = () => evaluate(`(d=>d&&{ title: d.querySelector('h2').textContent,
  tabs: [...d.querySelectorAll('.documents-tab')].map(t=>t.textContent+':'+t.getAttribute('aria-selected')).join(),
  shown: [...d.querySelectorAll('.documents-pane')].map(p=>p.id+':'+!p.hidden).join(), add: !(d.querySelector('#documents-add')?.hidden ?? true),
  site: [...d.querySelectorAll('.recordings-site li')].map(l=>(b=>b ? [b.dataset.recording, ...[...b.children].slice(0, -1).map(c=>c.textContent), b.getAttribute('aria-selected')].join('|') : l.textContent)(l.querySelector('.recordings-item'))),
  items: [...d.querySelectorAll('.recordings-browser .recordings-item')].map(b=>b.dataset.recording+'|'+b.querySelector('.recordings-name').textContent+'|'+b.getAttribute('aria-selected')),
  panel: [...d.querySelectorAll('.recordings-info, .recordings-description, .recordings-panel .recordings-failure')].map(l=>l.textContent), play: d.querySelector('.recordings-play')?.getAttribute('href') ?? null,
  buttons: [...d.querySelectorAll('.recordings-panel .btn')].map(b=>b.textContent).join(), status: d.querySelector('.documents-status').textContent,
  remove: !!d.querySelector('.recordings-delete') })(document.querySelector('dialog.documents'))`);
const listed = await recordingsTab();
await clickOn(`.recordings-item[data-recording="${sharedRecording.id}"]`);
const siteSelected = await recordingsTab();
console.log('  the site\'s recordings:', JSON.stringify({ listed: listed?.site, siteSelected }));
check(listed?.site.join() === `${sharedRecording.id}|Probe|false`, 'RECORDINGS lists the site\'s recording of the set first, by its title, unmarked to a player');
const siteQuery = new URLSearchParams(siteSelected?.play ?? '');
check(siteSelected?.site.join() === `${sharedRecording.id}|Probe|true` && siteSelected.panel[0]?.startsWith('From a saved game, level ')
  && siteSelected.panel.some((line: string) => /^Time played \d+:\d\d:\d\d$/.test(line)) && siteSelected.panel.some((line: string) => /^Shared \d{4}-\d\d-\d\d \d\d:\d\d$/.test(line))
  && siteSelected.buttons === 'Play' && siteQuery.get('dungeon') === 'csb' && siteQuery.get('recording') === sharedRecording.id,
  'a click selects it, and the panel says where it starts, its times and when it was shared, with PLAY alone, ?recording=<id>');
const savePoint = `save:${endWritten.saveId}`;
await clickOn(`.recordings-item[data-recording="${savePoint}"]`);
const saveSelected = await recordingsTab();
await clickOn('.recordings-item[data-recording="probe-end"]');
const endSelected = await recordingsTab();
await clickOn('.recordings-delete');
const askedDelete = await evaluate(`(d=>d&&{ title: d.querySelector('h2').textContent, button: d.querySelector('#delete-recording-confirm').textContent })(document.querySelector('dialog.delete-recording'))`);
await evaluate(`document.querySelector('#delete-recording-confirm').click()`);
await settled();
const afterDelete = await recordingsTab();
const endInStore = await evaluate(`new Promise((resolve) => { const open = indexedDB.open('csbweb-saves');
  open.onsuccess = () => { const tx = open.result.transaction(['recordings', 'recordingParts']);
    const row = tx.objectStore('recordings').get('probe-end'), parts = tx.objectStore('recordingParts').getAllKeys();
    tx.oncomplete = () => { open.result.close(); resolve(!!row.result || parts.result.some((k) => k[0] === 'probe-end')); }; }; })`);
console.log('  the browser\'s recordings:', JSON.stringify({ endWritten, listed, saveSelected, endSelected, askedDelete, afterDelete, endInStore }));
check(listed?.title === 'Chaos Strikes Back', 'the book\'s dialog is titled with the set\'s name');
check(listed?.tabs === 'Documents:false,Recordings:true' && listed.shown === 'documents-pane:false,recordings-pane:true' && !listed.add,
  'its RECORDINGS tab, clicked, is shown in DOCUMENTS\' place, without ADD');
check(listed?.items[0] === 'probe-end|The game won|false' && listed.items.includes(`${savePoint}|${endWritten.save}|false`) && listed.panel.length === 0,
  'it lists the browser\'s points of the set, the latest made first, a game\'s end and the quick save by its name, none selected');
const playQuery = new URLSearchParams(saveSelected?.play ?? '');
check(saveSelected?.items.includes(`${savePoint}|${endWritten.save}|true`) && saveSelected.panel[0]?.startsWith('From a saved game, level ')
  && saveSelected.panel.some((line: string) => /^Time played \d+:\d\d:\d\d$/.test(line)) && saveSelected.panel.some((line: string) => line.startsWith('Build '))
  && playQuery.get('dungeon') === 'csb' && playQuery.get('recording') === savePoint && playQuery.has('keepsaves') && !saveSelected.remove,
  'a click selects the save, and the panel says where it starts, the time played and its build, with PLAY, ?recording=save:<row>, and no DELETE');
const endQuery = new URLSearchParams(endSelected?.play ?? '');
check(endSelected?.panel.includes('Time played 0:12:34') && endQuery.get('dungeon') === 'csb' && endQuery.get('recording') === 'probe-end' && endSelected.remove,
  'the game\'s end selected, the panel says the play time its row keeps, with PLAY and DELETE');
check(askedDelete?.button === 'Delete' && afterDelete?.items.every((item: string) => !item.startsWith('probe-end|')) && afterDelete.items.length === listed!.items.length - 1 && !endInStore,
  'DELETE asks first, then the game\'s end leaves the list and the store');
await leave(() => clickOn(`.recordings-item[data-recording="${savePoint}"]`).then(() => clickOn('.recordings-play', true)), 'window.__probe?.player() != null');
await until('!window.__probe.player().playing', 'the save\'s point played to its end');
const playedSavePoint = await evaluate(`(p => ({ drift: p.drift, point: [p.point.changes, p.point.vbls].join() }))(window.__probe.player())`);
console.log('  the save\'s point played:', JSON.stringify(playedSavePoint));
check(playedSavePoint.drift === null && playedSavePoint.point === endWritten.point,
  'PLAY on the save plays the path the store holds to it, to its point, the file made there the save\'s');

// The site's recordings moderated from the book (`server/recordings.ts`), by the dev
// server's moderator: a second share of the package above, pending and listed first to
// them alone, APPROVE approves; on the first, HIDE hides it, marked so, and SHOW shows it.
// With the moderator's switch off, the list is a player's. A refusal is said in the
// dialog: HIDE on the recording hidden meanwhile behind the page's back, the list then
// anew. DELETE asks first, then the second leaves the list. Then the first's uploader,
// who sees it hidden and theirs, withdraws it, which asks first, and the site has neither.
const pendingId: string = await evaluate(`(async()=>{ const form = new FormData();
  form.append('package', await (await fetch('recordings/${sharedRecording.id}.gz')).blob(), 'probe.gz');
  return (await (await fetch('api/recordings', { method: 'POST', headers: { 'X-Player-Id': ${JSON.stringify(SHARER)} }, body: form })).json()).id; })()`);
const openCsbRecordings = async () => {
  await clickOn('.pick-cell:has(.pick[data-set="csb"]) .pick-documents');
  await clickOn('#documents-tab-recordings');
};
const confirmDelete = async () => {
  const asked = await evaluate(`(d=>d&&{ title: d.querySelector('h2').textContent, button: d.querySelector('#delete-recording-confirm').textContent })(document.querySelector('dialog.delete-recording'))`);
  await evaluate(`document.querySelector('#delete-recording-confirm').click()`);
  await settled();
  return asked;
};
await asPlayer(MODERATOR);
await openCsbRecordings();
const toModerator = await recordingsTab();
await clickOn('#documents-close');
await clickOn('.welcome-moderation');
await openCsbRecordings();
const switchedOffList = await recordingsTab();
await clickOn('#documents-close');
await clickOn('.welcome-moderation');
await openCsbRecordings();
await clickOn(`.recordings-item[data-recording="${pendingId}"]`);
const pendingSelected = await recordingsTab();
await clickOn('.recordings-approve');
const approvedNow = await recordingsTab();
await clickOn(`.recordings-item[data-recording="${sharedRecording.id}"]`);
await clickOn('.recordings-hide');
const hiddenNow = await recordingsTab();
await clickOn('.recordings-show');
const shownNow = await recordingsTab();
await evaluate(`fetch('api/recordings/${sharedRecording.id}', { method: 'POST', headers: { 'X-Player-Id': ${JSON.stringify(MODERATOR)} },
  body: JSON.stringify({ action: 'hide' }) }).then((r) => r.status)`);
await clickOn('.recordings-hide');
const refusedHide = await recordingsTab();
await clickOn(`.recordings-item[data-recording="${pendingId}"]`);
await clickOn('.recordings-delete');
const askedSiteDelete = await confirmDelete();
const siteDeleted = await recordingsTab();
await clickOn('#documents-close');
await asPlayer(SHARER);
await openCsbRecordings();
await clickOn(`.recordings-item[data-recording="${sharedRecording.id}"]`);
const toUploader = await recordingsTab();
await clickOn('.recordings-withdraw');
const askedSiteWithdraw = await confirmDelete();
const siteWithdrawn = await recordingsTab();
await clickOn('#documents-close');
const leftOnSite = await evaluate(`fetch('api/recordings?dataSet=csb', { headers: { 'X-Player-Id': ${JSON.stringify(MODERATOR)} } })
  .then((r) => r.json()).then((j) => j.recordings.filter((r) => [${JSON.stringify(sharedRecording.id)}, ${JSON.stringify(pendingId)}].includes(r.id)).length)`);
console.log('  the site\'s recordings moderated:', JSON.stringify({ pendingId, toModerator: toModerator?.site, switchedOff: switchedOffList?.site,
  pendingSelected, approvedNow, hiddenNow, shownNow, refusedHide, askedSiteDelete, siteDeleted: siteDeleted?.site, toUploader, askedSiteWithdraw,
  siteWithdrawn: siteWithdrawn?.site, leftOnSite }));
const first = sharedRecording.id;
check(toModerator?.site.join() === `${pendingId}|Probe|pending|false,${first}|Probe|false` && switchedOffList?.site.join() === `${first}|Probe|false`,
  'to a moderator, the site\'s list holds the pending recording too, marked, the latest shared first; with the switch off, it is a player\'s');
check(pendingSelected?.buttons === 'Play,Approve,Delete' && pendingSelected.panel.some((line: string) => line.endsWith(', awaiting a moderator'))
  && approvedNow?.site[0] === `${pendingId}|Probe|true` && approvedNow.buttons === 'Play,Hide,Delete',
  'the pending one offers APPROVE and DELETE, and APPROVE approves it, the list asked anew, the selection kept, HIDE offered');
check(hiddenNow?.site.includes(`${first}|Probe|hidden|true`) && hiddenNow.buttons === 'Play,Show,Delete' && hiddenNow.panel.some((line: string) => line.endsWith(', hidden by a moderator'))
  && shownNow?.site.includes(`${first}|Probe|true`) && shownNow.buttons === 'Play,Hide,Delete',
  'HIDE hides the approved one, marked hidden, SHOW offered, and SHOW shows it again');
check(refusedHide?.status === 'Hiding Probe failed: The recording is hidden, which hide does not take.'
  && refusedHide.site.includes(`${first}|Probe|hidden|true`) && refusedHide.buttons === 'Play,Show,Delete',
  'a refusal is said in the dialog, and the list is the server\'s anew');
check(askedSiteDelete?.title === 'Delete Probe?' && askedSiteDelete.button === 'Delete' && siteDeleted?.site.join() === `${first}|Probe|hidden|false`,
  'DELETE asks first, then the recording leaves the list');
check(toUploader?.site.join() === `${first}|Probe|hidden|yours|true` && toUploader.buttons === 'Play,Withdraw'
  && askedSiteWithdraw?.title === 'Withdraw Probe?' && askedSiteWithdraw.button === 'Withdraw'
  && siteWithdrawn?.site.join() === 'No recording of this dungeon on the site yet.' && leftOnSite === 0,
  'its uploader sees it hidden and theirs, with WITHDRAW, which asks first, then the site has neither recording');

// UPLOAD on the browser's points (`src/ui/welcomePage.ts`), by the uploader above: a game's
// end whose path holds a move of `?dev`, a copy of the quick save's recording with one
// added, is not uploadOffered it, and the panel says why. The quick save is: its form in the
// panel, UPLOAD waiting for a title, CANCEL back to its panel; then filled and sent, the
// site has it pending, listed to its uploader alone, selected, with WITHDRAW, its text as
// given. Its uploader withdraws it, and the game's end is deleted.
await navigate(`${APP}?intro=0&dungeon=csb&keepsaves&keepsettings`, GAME);
await evaluate(`(async()=>{ const { recordingStore } = window.__probe;
  const row = (await recordingStore.list()).find((r) => r.id === ${JSON.stringify(endWritten.recording)});
  const recording = await recordingStore.read(row.id), id = 'probe-dev-end';
  const changes = [...recording.changes, { change: { kind: 'devLevel', delta: 1 }, vbl: recording.changes.at(-1)?.vbl ?? 0, time: 0, random: 0 }];
  await recordingStore.write({ ...row, id, parent: null, ended: true, end: { word11694: false }, endedAt: Date.now(), playTime: 1000, changes: changes.length, parts: 2 },
    [{ id, seq: 0, start: recording.start, parent: null, rules: recording.rules, extras: recording.extras }, { id, seq: 1, changes }], null);
  return 1; })()`);
await navigate(`${APP}?dungeon=nowhere&keepsaves&keepsettings`, WELCOME);
await openCsbRecordings();
await clickOn('.recordings-item[data-recording="probe-dev-end"]');
const devEnd = await recordingsTab();
const devWhy: string | null = await evaluate(`document.querySelector('.recordings-panel .recordings-why')?.textContent ?? null`);
await clickOn(`.recordings-item[data-recording="${savePoint}"]`);
const uploadOffered = await recordingsTab();
const uploadForm = () => evaluate(`(p=>({ fields: [...p.querySelectorAll('input, textarea')].map(f=>f.name+':'+f.maxLength).join(),
  buttons: [...p.querySelectorAll('.btn')].map(b=>b.textContent+(b.disabled?':off':'')).join(), focused: document.activeElement?.name ?? null }))(document.querySelector('.recordings-panel'))`);
await clickOn('.recordings-upload');
const blankForm = await uploadForm();
await clickOn('.recordings-cancel');
const cancelled = await recordingsTab();
await clickOn('.recordings-upload');
await evaluate(`(p=>{ for (const [name, value] of [['title', '  Probe upload '], ['author', 'A Probe'], ['description', 'Up to the quick save.\\nTwo lines.']]) {
  const f = p.querySelector('[name=' + name + ']'); f.value = value; f.dispatchEvent(new Event('input')); } return 1; })(document.querySelector('.recordings-panel'))`);
const filledForm = await uploadForm();
await clickOn('.recordings-send');
await until(`!document.querySelector('.recordings-panel .recordings-upload-form') && !!document.querySelector('.recordings-withdraw')`, 'the upload listed');
const uploaded = await recordingsTab();
const uploadedId: string | null = await evaluate(`document.querySelector('.recordings-site .recordings-item[aria-selected="true"]')?.dataset.recording ?? null`);
const uploadedRow = await evaluate(`(async()=>{ const row = (p) => fetch('api/recordings?dataSet=csb', p ? { headers: { 'X-Player-Id': p } } : undefined)
  .then((r) => r.json()).then((j) => j.recordings.find((r) => r.id === ${JSON.stringify(uploadedId)}) ?? null);
  const mine = await row(${JSON.stringify(SHARER)});
  return { mine: mine && [mine.title, mine.author, mine.description, mine.status, mine.mine].join('|'), toNobody: await row(null) }; })()`);
await clickOn('.recordings-withdraw');
await confirmDelete();
await clickOn('.recordings-item[data-recording="probe-dev-end"]');
await clickOn('.recordings-delete');
await confirmDelete();
const uploadLeft = await recordingsTab();
await clickOn('#documents-close');
console.log('  UPLOAD:', JSON.stringify({ devEnd: devEnd?.buttons, devWhy, uploadOffered: uploadOffered?.buttons, blankForm, cancelled: cancelled?.buttons, filledForm,
  uploaded, uploadedId, uploadedRow, uploadLeft: uploadLeft && { site: uploadLeft.site, items: uploadLeft.items.length } }));
check(devEnd?.buttons === 'Play,Delete' && devWhy === 'Not to upload: it holds a move of ?dev, which no game holds.',
  'a game\'s end whose path holds a move of ?dev is not offered UPLOAD, and its panel says why');
check(uploadOffered?.buttons === 'Play,Upload' && blankForm.fields === 'title:60,author:200,description:300' && blankForm.buttons === 'Cancel,Upload:off'
  && blankForm.focused === 'title' && cancelled?.buttons === 'Play,Upload' && filledForm.buttons === 'Cancel,Upload',
  'the save offers UPLOAD: its form in the panel, a title, an author and a description within their limits, UPLOAD waiting for the title; CANCEL is its panel again');
check(/^[0-9A-F]{16}$/.test(uploadedId ?? '') && uploaded?.site.join() === `${uploadedId}|Probe upload|pending|yours|true` && uploaded.buttons === 'Play,Withdraw'
  && uploaded.panel.includes('By: A Probe') && uploaded.panel.includes('Up to the quick save.\nTwo lines.') && uploaded.status.startsWith('Probe upload is uploaded: ')
  && uploadedRow.mine === 'Probe upload|A Probe|Up to the quick save.\nTwo lines.|pending|true' && uploadedRow.toNobody === null,
  'UPLOAD sends its package: the site has it pending, its text trimmed, listed to its uploader alone, selected, with WITHDRAW');
check(uploadLeft?.site.join() === 'No recording of this dungeon on the site yet.' && !uploadLeft.items.some((item: string) => item.startsWith('probe-dev-end|')),
  'its uploader withdraws it, and the game\'s end with the ?dev move is deleted');

// A lost game's end played back (`playRecording`, `src/main.ts`): `csbgame7.dat`, every
// champion at 1 HP, saved by F5 and read back, which begins a recording from it, then put
// before the Stone Golem by `?dev`, which kills the party, at x8. `?recording=` plays it to
// its end as to any other point: no credits, the line saying the game is lost there, a
// frame of it with the strip over it, and Backspace, which the credits' host would take,
// playing it again.
await navigate(`${APP}?intro=0&dungeon=csb`, GAME);
const lostBytes = readFileSync(new URL('fixtures/csbgame7.dat', import.meta.url)).toString('base64');
const lostRecorded = await evaluate(`(async()=>{
  const { game, saves, recorder, recordings, applySaveBytes } = window.__probe;
  applySaveBytes(game, Uint8Array.from(atob(${JSON.stringify(lostBytes)}), (c) => c.charCodeAt(0)));
  for (const champion of game.ctx.party.state.champions) champion.attributes.health = 1;
  await saves.quickSave();
  const opened = await saves.open((await saves.list())[0]);
  saves.read({ ...opened, entry: { ...opened.entry, recording: null } });
  if (!game.devMoveParty(6, 18, 13)) return null;
  game.setPace(8);
  for (let n = 0; n < 200 && !game.mainLoopHasReturned(); n++) await new Promise((r) => setTimeout(r, 50));
  await recordings.flush();
  const { id, end } = recorder.recording;
  return { id, end, lost: game.ctx.party.state.gameIsLost };
})()`);
check(lostRecorded?.lost && lostRecorded.end?.word11694 === false, `the golem kills the party in the page, and its recording ends with the game (${JSON.stringify(lostRecorded)})`);
await navigate(`${APP}?dungeon=csb&recording=${lostRecorded.id}&keepsaves`, 'window.__probe?.player() != null');
await key('+'); await key('+'); await key('+');
const lostIntroVbls = await evaluate(`window.__probe.intro.vbls`);
await until('!window.__probe.player().playing', 'the lost game played to its end');
await until(`(m => m.backlog().printQueue === 0 && m.backlog().futureLines === 0 && m.scrollState().textScanlineScrollCount < 0)(window.__probe.game.ctx.host.messages)`,
  'the message area at rest');
await wait(100);
const lostPlayed = await evaluate(`(({ game, intro }) => ({ drift: window.__probe.player().drift, returned: game.mainLoopHasReturned(),
  introVbls: intro.vbls, lines: game.ctx.host.messages.snapshot().filter((line) => line) }))(window.__probe)`);
console.log('  lost game played:', JSON.stringify({ lostIntroVbls, lostPlayed }));
check(lostPlayed.drift === null && lostPlayed.returned && lostPlayed.introVbls === lostIntroVbls,
  'the lost game plays to its end, and no credits follow it');
check(lostPlayed.lines.includes('THE GAME IS LOST HERE.') && !lostPlayed.lines.includes('THE RECORDING ENDS HERE.'),
  `the message area says the game is lost there: ${JSON.stringify(lostPlayed.lines)}`);
await leaveCanvas(); await wait(100);
await shot('33-recording-lost');
await key('Backspace');
const lostRestarted = await evaluate(`window.__probe.player().playing && !window.__probe.game.mainLoopHasReturned()`);
await until('!window.__probe.player().playing', 'the lost game played again to its end');
const lostAgain = await evaluate(`(({ game }) => ({ drift: window.__probe.player().drift, returned: game.mainLoopHasReturned(),
  lines: game.ctx.host.messages.snapshot().filter((line) => line) }))(window.__probe)`);
check(lostRestarted && lostAgain.drift === null && lostAgain.returned,
  `and Backspace plays it again from its start, to the same end (${JSON.stringify(lostAgain)})`);
await leave(() => key('Escape'), WELCOME);

// The map dialog (`src/renderer/ui/MapDialog.ts`), over CSB's `csbgame2.dat`, its party
// where the save left it: a press held on the message area opens it, with MAP VIEW on
// alone. A frame of it with the pointer off the canvas; a right click closes it.
await navigate(`${APP}?intro=0&dungeon=csb`, GAME);
await evaluate(`(async()=>{
  const { game, applySaveBytes } = window.__probe;
  applySaveBytes(game, new Uint8Array(await (await fetch('/gamefiles/csb/csbgame2.dat')).arrayBuffer()));
  return 1;
})()`);
await vbls(TICK);
const mapUp = () => evaluate(`window.__probe.screen.ui.mapDialog !== null`);
await cdpMouse('mousePressed', 100, 185); await wait(900); await cdpMouse('mouseReleased', 100, 185); await vbls(SHOWN);
check(!(await mapUp()), 'with MAP VIEW off, a long press on the message area opens no map');
await evaluate(`window.__probe.screen.ui.settings.update({ mapView: true }), 1`);
await cdpMouse('mousePressed', 100, 185); await wait(900);
check(await mapUp(), 'with MAP VIEW on, it opens the map while the press is held');
await cdpMouse('mouseReleased', 100, 185); await vbls(SHOWN);
check(await mapUp(), 'and the release leaves it up');
await leaveCanvas(); await vbls(SHOWN);
console.log('state: map');               await shot('25-map');
// `>` shows the next level, CSB's level 6 (map 5, 31x30, cells of 4 pixels from (27,48)),
// and a click on its square (17,9) shows its lock, the onyx keys its links, and I marks the
// items. A frame of it with the pointer on (20,12), whose numbers the title shows.
const mapShown = () => evaluate(`JSON.stringify([window.__probe.screen.ui.mapDialog.map, window.__probe.screen.ui.mapDialog.selected])`);
await canvasClick(163, 20); await vbls(SHOWN);
check(await mapShown() === '[5,null]', '`>` shows the next level, no square shown');
await canvasClick(96, 85); await vbls(SHOWN);
check(await mapShown() === '[5,{"map":5,"x":17,"y":9}]', 'a click on (17,9) shows it');
await canvasClick(233, 20); await vbls(SHOWN);
check(await evaluate(`window.__probe.screen.ui.mapDialog.mark`) === 'item', 'I marks the items');
await pointerAt(108, 97); await vbls(SHOWN);
console.log('state: map, level 6');      await shot('31-map-level');
await canvasClick(160, 100, 2); await vbls(SHOWN);
check(!(await mapUp()), 'a right click closes the map');

// The champion dialog (`src/renderer/ui/ChampionDialog.ts`), over the same party: a press
// held on the first champion's stat bars opens it, with CHAMPION VIEW on, that champion's
// column marked and no inventory opened. A frame of each tab with the pointer off the
// canvas; a right click closes it. Then a tap on the bars opens the inventory, at its release.
const championsUp = () => evaluate(`window.__probe.screen.ui.championDialog?.marked ?? (window.__probe.screen.ui.championDialog ? 'none' : null)`);
await evaluate(`window.__probe.screen.ui.settings.update({ championView: true }), 1`);
await cdpMouse('mousePressed', 55, 14); await wait(900);
check((await championsUp()) === 0 && (await selected()) === -1,
  'with CHAMPION VIEW on, a press held on a champion\'s bars opens the champions, that champion marked, and no inventory');
await cdpMouse('mouseReleased', 55, 14); await vbls(SHOWN);
check((await championsUp()) === 0 && (await selected()) === -1, 'and the release leaves it up, with no inventory');
await leaveCanvas(); await vbls(SHOWN);
console.log('state: champions, ATTRIBUTES'); await shot('26-champions-attributes');
await canvasClick(133, 27, 0); await leaveCanvas(); await vbls(SHOWN);
console.log('state: champions, SKILLS');  await shot('27-champions-skills');
await canvasClick(160, 100, 2); await vbls(SHOWN);
check((await championsUp()) === null, 'a right click closes the champions');
await cdpMouse('mousePressed', 55, 14); await wait(100);
check((await selected()) === -1, 'a tap on the bars: nothing while it is down');
await cdpMouse('mouseReleased', 55, 14); await vbls(TICK);
check((await selected()) === 0 && (await championsUp()) === null, 'and at its release, the champion\'s inventory, and no champions');

// Fullscreen (`src/lib/fullscreen.ts`), DISPLAY's FULLSCREEN. A finger's press is no
// gesture a browser enters fullscreen at, only its lift: a tap enters it, on a page no
// mouse has pressed yet. With the scanlines and the curve on, a mouse's press leaves it and enters it
// again, on a 1920x1080 screen: `#game` is the fullscreen element, the game canvas the
// largest whole multiple of 320x200 the screen holds, in device pixels, centred, and the
// effect's canvas covers it exactly, drawn at its size; so again once the screen is
// 1366x768. The pointer is read through the curve, a real click through the effect's
// canvas reaches the dialog, and a real Esc, which the page locks in fullscreen, closes
// and opens the settings and leaves fullscreen be.
await navigate(`${APP}?intro=0&keepsaves&dungeon=dm-atari`, GAME);
const screenLayout = () => evaluate(`(()=>{const g=document.getElementById('game-canvas').getBoundingClientRect();
  const t=document.getElementById('crt-canvas');const r=t.getBoundingClientRect();
  return {element:document.fullscreenElement?.id??null,w:innerWidth,h:innerHeight,ratio:devicePixelRatio,
    game:[g.left,g.top,g.width,g.height],tube:[r.left,r.top,r.width,r.height],drawn:[t.width,t.height],
    tab:window.__probe.screen.ui.settingsDialog?.tab??null};})()`);
const realKey = async (code: string) => {
  for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: code, code, windowsVirtualKeyCode: 27 });
};
await key('Escape'); await vbls(SHOWN);
await canvasClick(120, 45, 0); await vbls(SHOWN);
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await touch('touchStart', 85, 65); await touch('touchEnd', 85, 65); await wait(800);
check((await screenLayout()).element === 'game', 'a tap on FULLSCREEN puts #game in fullscreen, at the lift');
await touch('touchStart', 85, 65); await touch('touchEnd', 85, 65); await wait(800);
check((await screenLayout()).element === null, 'and a second tap leaves it');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await canvasClick(236, 86, 0); await vbls(SHOWN);
await canvasClick(236, 107, 0); await vbls(SHOWN);
const screenSize = (width: number, height: number) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
await screenSize(1920, 1080); await wait(300);
await cdpMouse('mousePressed', 85, 65); await cdpMouse('mouseReleased', 85, 65); await wait(800);
check((await screenLayout()).element === 'game', 'a mouse\'s press on FULLSCREEN, the CRT effect on, puts #game in fullscreen');
for (const [width, height, expected] of [[1920, 1080, 5], [1366, 768, 3]]) {
  if (width !== 1920) { await screenSize(width, height); await wait(800); }
  const full = await screenLayout();
  const scale = Math.floor(Math.min(full.w * full.ratio / 320, full.h * full.ratio / 200));
  console.log(`state: fullscreen, ${full.w}x${full.h} at ${full.ratio}, the screen ${full.game.join(',')}, the effect drawn ${full.drawn.join('x')}`);
  check(full.w === width && scale === expected && full.game[2] === 320 * scale / full.ratio && full.game[3] === 200 * scale / full.ratio,
    `${width}x${height}: the game canvas is ${expected} times 320x200, the most that fit`);
  check(Math.abs(full.game[0] - (full.w - full.game[2]) / 2) <= 0.5 && Math.abs(full.game[1] - (full.h - full.game[3]) / 2) <= 0.5,
    'centred');
  check(full.tube.every((v: number, i: number) => Math.abs(v - full.game[i]) < 0.01), 'the effect\'s canvas covers it exactly');
  check(full.drawn[0] === Math.round(full.game[2] * full.ratio) && full.drawn[1] === Math.round(full.game[3] * full.ratio),
    'and is drawn at its size');
}
// At 4:3, the largest whole multiple of 320x240 that fits, centred, the effect over it.
await canvasClick(236, 65, 0); await wait(500);
{
  const full = await screenLayout();
  const scale = Math.floor(Math.min(full.w * full.ratio / 320, full.h * full.ratio / 240));
  console.log(`state: fullscreen at 4:3, the screen ${full.game.join(',')}`);
  check(scale === 3 && full.game[2] === 320 * scale / full.ratio && full.game[3] === 240 * scale / full.ratio
    && Math.abs(full.game[1] - (full.h - full.game[3]) / 2) <= 0.5 && full.tube.every((v: number, i: number) => Math.abs(v - full.game[i]) < 0.01),
    `at 4:3, the game canvas is 3 times 320x240, centred, the effect over it`);
}
check(await hoverAt(0.5, 0.5) === '160,100', 'at 4:3, the tube\'s middle is the screen\'s');
await canvasClick(236, 65, 0); await wait(500);
check((await screenLayout()).game[3] === 600, 'and at 16:10 again, 3 times 320x200');
check(await hoverAt(0.5, 0.5) === '160,100', 'in fullscreen, the tube\'s middle is the screen\'s');
check(await hoverAt(0.002, 0.002) === '0,0', 'and a point of its black corner is the screen\'s corner');
await realClick(197, 45); await vbls(SHOWN);
check((await screenLayout()).tab === 'sound', 'a real click through the effect\'s canvas selects SOUND');
await realKey('Escape'); await vbls(SHOWN);
check(!(await settingsUp()) && (await screenLayout()).element === 'game', 'a real Esc closes the settings, in fullscreen still');
await realKey('Escape'); await vbls(SHOWN);
check(await settingsUp(), 'and a second opens them');
await canvasClick(120, 45, 0); await vbls(SHOWN);
await cdpMouse('mousePressed', 85, 65); await cdpMouse('mouseReleased', 85, 65); await wait(800);
const windowed = await screenLayout();
check(windowed.element === null && windowed.game[2] === 960 && windowed.game[3] === 600 && windowed.tube.every((v: number, i: number) => v === windowed.game[i]),
  'FULLSCREEN again leaves it: the canvas and the effect\'s at 960x600');

// The installed game's window (`src/assets/manifest.webmanifest`): `#game` fills it, the
// screen sized in it as in fullscreen. CDP emulates no `display-mode`, but Chrome matches
// `display-mode: fullscreen` while an element is in fullscreen, so `<html>` in fullscreen,
// at a real click on the page's margin, lays the page out as the installed game. With
// an element in fullscreen the page is not the installed game: FULLSCREEN still turns.
await screenSize(1920, 1080); await wait(300);
await evaluate(`addEventListener('pointerup', () => document.documentElement.requestFullscreen(), { once: true }), 1`);
for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 5, y: 5, button: 'left', clickCount: 1 });
await wait(800);
{
  const app = await screenLayout();
  const installed = await evaluate(`[matchMedia('(display-mode: fullscreen)').matches, window.__probe.screen.ui.fullscreen.isInstalled()]`);
  console.log(`state: <html> in fullscreen, ${app.w}x${app.h}, the screen ${app.game.join(',')}`);
  check(app.element === '' && installed[0] && !installed[1], 'with <html> in fullscreen, display-mode: fullscreen matches, and the page is not the installed game');
  check(app.game[2] === 1600 && app.game[3] === 1000 && Math.abs(app.game[0] - 160) <= 0.5 && Math.abs(app.game[1] - 40) <= 0.5
    && app.tube.every((v: number, i: number) => Math.abs(v - app.game[i]) < 0.01),
    'the installed game\'s window: the screen 5 times 320x200 in 1920x1080, centred, the effect over it');
}
await evaluate(`document.exitFullscreen().then(() => 1)`); await wait(500);
check((await screenLayout()).game[2] === 960, 'out of it, the screen is 960x600 again');
await screenSize(1600, 1000);

// The eye on a weapon, with the eye's item properties on (`showItemProperties`,
// `getItemPropertyLines`, `src/renderer/ui/Objects.ts`): a new game's HALK, as in frame 03,
// his weapon taken from his weapon hand (62-77 x 86-101) into the cursor, and the eye
// (12-27 x 46-61) held on it. Under CSBWin's description, the extra's lines, from the
// panel's foot up.
await navigate(`${APP}?intro=0&dungeon=dm-atari`, GAME);
await evaluate(BUILD_PARTY); await vbls(TICK);
await canvasClick(15, 15, 2); await vbls(TICK);
await evaluate(`(()=>{const s=window.__probe.screen.ui.settings;s.update({ extras: { ...s.values.extras, showItemProperties: true } });return 1;})()`);
await canvasClick(69, 93, 0); await vbls(TICK);
await realMouse('mousePressed', 19, 53); await vbls(TICK);
console.log('state: eye on a weapon');   await shot('30-eye-weapon');
await realMouse('mouseReleased', 19, 53); await vbls(SHOWN);

// The CRT effect's input surface. The effect's canvas is shown over the game canvas, and
// the page listens on the game canvas alone, the pre-game and end-of-game screens' input
// included (`createIntroHost`, `src/renderer/intro/BootSequence.ts`), so it must let a
// click through. Boot with the
// effect in the saved settings: the intro is drawn through it, and a real click on the
// entrance's scroll brings up the credits, as the click for frame 08 did. The record's one
// `crt`, from before the scanlines and the curve were apart, is both.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try { localStorage.setItem('csbweb_settings_v2', JSON.stringify({ crt: true })); } catch (e) {}
` });
await navigate(`${APP}?keepsaves&dungeon=dm-atari`, ENTRANCE);
console.log('state: entrance, CRT effect saved on');
check(await crtEffect() === 'on', 'the effect is on at the entrance');
check(await canvasPixels() === entrance, 'the entrance is frame 07');
await realClick(270, 192); await until(ENTRANCE, 'the entrance at rest');
check(await canvasPixels() === credits, 'a real click on the scroll brings up frame 08, the credits');

check(!logs.some((line) => line.startsWith('error: CSP: ')), 'nothing the content security policy refuses');

console.log('--- console errors ---');
console.log(logs.length ? logs.join('\n') : '(none)');
ws.close();
if (failures.length) {
  console.log(`--- ${failures.length} check(s) failed ---\n${failures.join('\n')}`);
  process.exit(1);
}
