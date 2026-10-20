// Golden-frame probe.
//
// Drives the running dev server over the Chrome DevTools Protocol — boot, enable Debug,
// build a party at the Hall of Champions mirrors, open a champion's inventory, select in
// it, open the attack menu —
// and writes a PNG per state.
//
// What it captures is the **320x200 screen as CSBWin draws it**, not a screenshot of the
// page, nor even the canvas's colours: the palette-index buffer the canvas was last given,
// and the palette each pixel went through (`GameScreen.presentedFrame`,
// `src/renderer/csbwin/PresentedFrame.ts`), written as `tools/lib/frames.mjs` says. A
// renderer that draws a slot holding the same colour as the right one fails, and a change
// to how an Atari colour is shown on the canvas alone fails nothing. The page around the
// canvas is DOM debug chrome, drawn with the host's fonts and widget theme, and enters into
// nothing. `compare-frames.mjs` then compares what the frames hold, so the PNG encoder does
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
// opened by a long press, but not with MAP VIEW off, the champion dialog opened by a
// long press on the bars, where a tap opens the inventory, and fullscreen, entered by a
// tap and a click, the screen and the effect sized and placed in it, at 16:10 and at 4:3,
// in it and out of it, and in the installed app's window, the save store held by another tab, and the welcome
// page: its tiles and their order, its fonts, its selection, where PLAY and CONTINUE go, and CONTINUE's save read
// straight into play, its form adding, editing, publishing and deleting a player's own set, the
// tiles' controls moderating a published one, the book listing its documents, a moderator adding
// and removing them, and each tile's name in its set's state's colour,
// to a moderator, the statistics page its footer links to, and, against a page whose server sends a content security policy
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
//   node tools/probe-frames.mjs tools/frames        # refresh the committed baseline
//   node tools/probe-frames.mjs /tmp/now            # then diff /tmp/now against it
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
import { BUILD_PARTY } from './lib/buildParty.mjs';
import { encodeFrame } from './lib/frames.mjs';

const PORT = Number(process.env.CDP_PORT ?? 9222);
const DEV_PORT = Number(process.env.DEV_PORT ?? 9000);
// APP_URL: a page served elsewhere than the dev server, built with its probe handle
// (`check-frames.sh --url`).
const APP = process.env.APP_URL ?? `http://localhost:${DEV_PORT}/`;
const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
const page = (await res.json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const downloads = [];
// What answers a request `Fetch.enable` paused, while a block stands in for the server.
let onPaused = null;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Browser.downloadWillBegin') downloads.push(m.params.suggestedFilename);
  if (m.method === 'Fetch.requestPaused') onPaused?.(m.params);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error','warning'].includes(m.params.type))
    logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown')
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
};
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

const evaluate = async (expr) => {
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
  const frame = window.__probe.screen.presentedFrame();
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
const shot = async (name) => {
  const { frame, colours, stray } = await evaluate(CAPTURE_FRAME);
  if (stray) check(false, `${name}: code ${stray.code} shows ${stray.was} on the canvas, and ${stray.rgb} at (${stray.x},${stray.y})`);
  writeFileSync(`${process.argv[2]}/${name}.png`, encodeFrame(frame, colours));
  console.log('  wrote', name + '.png', `(${frame.width}x${frame.height})`);
  return canvasPixels();
};
const failures = [];
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };
// The CRT effect is a WebGL canvas, `#crt-canvas` (`createCrtEffect`, `src/lib/crt.ts`):
// absent where Chrome gives no WebGL context. Nothing about the effect can
// be checked then, and that fails the run rather than pass it unseen.
const crtEffect = () => evaluate(`(()=>{const gl=document.getElementById('crt-canvas');
  return !gl ? 'unavailable' : getComputedStyle(gl).display === 'none' ? 'off' : 'on';})()`);
// A named key's `code` is its `key`; the bindings match the code, the save menu the key.
const key = (k) => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},code:${JSON.stringify(k)},bubbles:true})),1`);
// Whether the game takes a notch of the wheel over the canvas, rather than leave it to the
// page: a save menu's list does, the disk menu's and the entrance's chooser's, and nothing
// else. That it scrolls the list is `tools/dump-save-menu.ts`'s to show.
const wheelTaken = () => evaluate(`(()=>{const e=new WheelEvent('wheel',{deltaY:100,cancelable:true,bubbles:true});
  document.getElementById('game-canvas').dispatchEvent(e); return e.defaultPrevented;})()`);
// button: 0 = left (DM mask 2), 2 = right (DM mask 1)
const canvasClick = (x, y, button = 0) => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  const sx=r.left+${x}*r.width/320, sy=r.top+${y}*r.height/200;
  for (const t of ['pointerdown','pointerup']) c.dispatchEvent(new PointerEvent(t,{isPrimary:true,pointerType:'mouse',clientX:sx,clientY:sy,button:${button},buttons:${button===2?2:1},bubbles:true}));
  return 1;})()`);
// A click as a player makes it: CDP's own mouse events at a point of the page, which the
// browser hit-tests, where `canvasClick` hands its events to the game canvas whatever lies
// over it.
const realClick = async (x, y) => {
  const p = await evaluate(`(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();
    return {x:r.left+(${x}+0.5)*r.width/320, y:r.top+(${y}+0.5)*r.height/200};})()`);
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

await send('Runtime.enable');
await send('Page.enable');
// What the server's policy refuses (`SECURITY_HEADERS`, `server/app.ts`), said on the
// console of every page loaded, and checked at the end. The dev server sends no policy.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  document.addEventListener('securitypolicyviolation', (e) => console.error('CSP: ' + e.effectiveDirective + ' refused ' + e.blockedURI));
` });
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
  // throwaway profile (probe-ui.mjs and check-frames.sh both pass --user-data-dir), so
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
// default set, dm-atari, is selected, so PLAY opens it, and every tile is dimmed, by name.
// The page with a save is checked further down.
await send('Page.navigate', { url: `${APP}?dungeon=nowhere` });
await wait(2500);
const firstVisit = await evaluate(`({tiles: [...document.querySelectorAll('.pick[data-set]')].map(t=>t.dataset.set+(t.classList.contains('dim')?'':'*')+(t.getAttribute('aria-pressed')==='true'?'!':'')).join(','),
  play: document.getElementById('welcome-play').getAttribute('href'),
  resume: document.getElementById('welcome-continue').getAttribute('href'),
  above: !!(document.querySelector('.welcome-actions').compareDocumentPosition(document.querySelector('.welcome-grid')) & Node.DOCUMENT_POSITION_FOLLOWING),
  sections: [...document.querySelectorAll('.welcome-sets')].map(s=>s.querySelector('h2').textContent+':'+[...s.querySelectorAll('.pick')].map(t=>t.dataset.set??'add').join('/')).join('|')})`);
console.log('state: welcome page, no save');
console.log('  ', JSON.stringify(firstVisit));
check(firstVisit.tiles === 'dm-atari!,kids-dungeon,csb,conflux-3.5,towers-of-chaos' && /dungeon=dm-atari/.test(firstVisit.play ?? '')
  && firstVisit.resume === null && firstVisit.above,
  'no save: the official games in the manifest\'s order, then the others by name, dm-atari selected, PLAY opens it, CONTINUE disabled, the buttons above the grids');
check(firstVisit.sections === 'Official games:dm-atari/kids-dungeon/csb|Fan-made dungeons:conflux-3.5/towers-of-chaos/add',
  'two sections, each under its title: the official games, then the fan-made dungeons, "+ Add my own" last');

// A new server's answer, no set and no default: the grid holds only "+ Add my own", PLAY
// and CONTINUE are disabled, and the form it opens has no base set to offer.
onPaused = ({ requestId }) => send('Fetch.fulfillRequest', { requestId, responseCode: 200,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
  body: Buffer.from(JSON.stringify({ default: null, dataSets: [] })).toString('base64') });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/data-sets*' }] });
await send('Page.navigate', { url: `${APP}?dungeon=nowhere` });
await wait(2500);
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
// `?intro=0` skips the title animation and the dungeon entrance
// (`src/renderer/intro/BootSequence.ts`), so the six frames below still open on the
// adventure screen. The entrance gets frames of its own at the end.
await send('Page.navigate', { url: `${APP}?intro=0&dungeon=dm-atari` });
await wait(3500);
console.log('state: booted');            await shot('01-boot');
// The four champions, from the Hall of Champions mirrors (`tools/lib/buildParty.mjs`).
await evaluate(BUILD_PARTY).then(names => console.log('  party:', names));
await wait(600);
console.log('state: party built');       await shot('02-party');
// Right-click a party block (DM mask 1, button id 7) opens that champion's inventory.
await canvasClick(15, 15, 2);  await wait(700);
console.log('state: inventory');
const inventory = await shot('03-inventory');
// The effect is shown the game canvas and paints nothing on it: its curve and scanlines are
// drawn on its own canvas, at the size it is shown. The pointer is read through the same
// curve, so a point of the tube is the screen pixel it shows: the middle stays where it is,
// and a point towards a corner shows a pixel nearer the corner, the picture being shrunk
// into the glass. Without the effect, the pointer is the plain scaling.
const hoverAt = (u, v) => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent('pointermove',{isPrimary:true,pointerType:'mouse',clientX:r.left+${u}*r.width,clientY:r.top+${v}*r.height,bubbles:true}));
  const p=window.__probe.screen.ui.hoverPoint; return p ? p.x+','+p.y : 'none';})()`);
// DISPLAY's SCANLINES (236,86) and SCREEN CURVE (236,107), in the settings dialog: Esc
// opens it, the tab is DISPLAY (120,45), and Esc closes it again over the inventory.
const SCANLINES = [236, 86];
const CURVE = [236, 107];
const toggleCrt = async ([x, y]) => {
  await key('Escape'); await wait(300);
  await canvasClick(120, 45, 0); await wait(300);
  await canvasClick(x, y, 0); await wait(300);
  await key('Escape'); await wait(300);
  await evaluate(`document.getElementById('game-canvas').dispatchEvent(new PointerEvent('pointerleave',{isPrimary:true,pointerType:'mouse'})),1`);
  await wait(200);
};
await toggleCrt(SCANLINES);
const crtInPlay = await crtEffect();
check(crtInPlay !== 'unavailable', 'the CRT effect exists (without it this Chrome gives no WebGL context, and nothing below is checked)');
check(crtInPlay === 'on', 'DISPLAY\'s SCANLINES turns the effect on');
check(await canvasPixels() === inventory, 'CRT effect on: the game canvas keeps its pixels');
const tubeSize = await evaluate(`(()=>{const t=document.getElementById('crt-canvas');return t.width+'x'+t.height;})()`);
check(tubeSize === '960x600', `the effect is drawn at the size it is shown, 960x600 (${tubeSize})`);
check(await hoverAt(0.1, 0.1) === '32,20', 'the scanlines alone: the pointer is the plain scaling');
await toggleCrt(CURVE);
check(await hoverAt(0.5, 0.5) === '160,100', 'the curve on: the tube\'s middle is the screen\'s');
const curved = (await hoverAt(0.1, 0.1)).split(',').map(Number);
check(curved[0] < 32 && curved[1] < 20, `the curve on: the pointer at (32,20)'s place shows a pixel nearer the corner (${curved})`);
check(await hoverAt(0.002, 0.002) === '0,0', 'the curve on: a point of the tube\'s black corner is the screen\'s corner');
// A lost WebGL context hides the tube and the game canvas shows through, flat, so the
// pointer is read flat until the context is restored. The extension is kept from before
// the loss, after which the context gives none.
const loseContext = (how) => evaluate(`(()=>{window.__loseContext??=document.getElementById('crt-canvas').getContext('webgl').getExtension('WEBGL_lose_context');
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
// what 03 already proved. `compare-frames.mjs` now refuses a baseline with two identical
// frames, which is what makes that mistake visible instead of silent.
await canvasClick(41, 66, 0);  await wait(400);
console.log('state: inventory+select');  await shot('04-inventory-sel');
// Put it back, so the frames below are unaffected by the detour.
await canvasClick(41, 66, 0);  await wait(400);
await canvasClick(15, 15, 2);  await wait(500);   // back out
// Champion 0's attack button (233-252 x 86-120) opens the real attack menu, listing
// that champion's legal attacks. This used to be a dev-only F7 preview of a
// placeholder panel; the panel is now `ui/Attack.ts` driven by `word20252`.
await canvasClick(240, 100, 0); await wait(600);
console.log('state: attack panel');      await shot('05-attack');
// The disk icon (`buttons17760[1]`, id 140) raises the save/load dialog over the whole
// screen, cleared. Reopen an inventory first — the attack-panel step backed out of it.
// The browser store was emptied on boot, so the list is reliably its "NEW SAVE" row alone
// and this frame pins the dialog itself: the frame, the two panels and the four buttons,
// all pieces of graphic 0, with LOAD and EXPORT unlabelled because that row holds no save
// to load or to export.
await canvasClick(15, 15, 2);  await wait(600);
await canvasClick(177, 40, 0); await wait(900);
console.log('state: save menu');         await shot('06-savemenu');
check(await wheelTaken(), 'the disk menu takes the wheel, for its list');
// A move of the pointer paints nothing: the VBL's frame draws the cursor where the mouse
// is by then, as CSBWin's VBL handler does. A mouse reports faster than the screen is
// composed, and a paint for each move kept the browser from showing any. The pointer
// leaves again, so that no later frame holds a cursor.
const moves = await evaluate(`(async()=>{const {screen}=window.__probe;const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  let paints=0; const own=screen.presentViewport; screen.presentViewport=function(){paints++; return own.call(this);};
  for (let i=0;i<50;i++) c.dispatchEvent(new PointerEvent('pointermove',{isPrimary:true,pointerType:'mouse',clientX:r.left+(100.5+i)*r.width/320,clientY:r.top+100.5*r.height/200,bubbles:true}));
  const during=paints; await new Promise(r=>setTimeout(r,200));
  const at=screen.ui.hoverPoint; delete screen.presentViewport;
  c.dispatchEvent(new PointerEvent('pointerleave',{isPrimary:true,pointerType:'mouse'})); await new Promise(r=>setTimeout(r,200));
  return {during, after:paints, at, left:screen.ui.hoverPoint===null};})()`);
console.log('  fifty moves of the pointer:', JSON.stringify(moves));
check(moves.during === 0, 'a move of the pointer paints nothing itself');
check(moves.after >= 1 && moves.after < 50 && moves.at.x === 149 && moves.at.y === 100, 'the VBL\'s frame draws the cursor where the pointer last was');
check(moves.left, 'the pointer gone, no cursor is left for the frames that follow');
// SAVE (x 95..143, y 161..174), a new save from that row, for the resume from the
// entrance below.
await canvasClick(120, 168, 0); await wait(1200);
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

// The dungeon entrance, with the intro left on. The wait has to cover the FTL logo — 98
// vertical blanks — and the whole title animation — about 116 — plus the entrance's own
// fade; once that fade finishes the screen is static until the player clicks, so the
// capture is stable.
//
// This is the only evidence that the corridor behind the doors actually renders. It is
// drawn by the real viewport renderer over a synthetic 5x5 level
// (`src/renderer/intro/PrisonLevel.ts`), and `tools/dump-intro.ts` can check the level and
// the compositing but not the pixels the bytecode programs produce.
// The welcome page (`src/ui/welcomePage.ts`): the page with no known `?dungeon=`, HTML and
// no game. The store holds the one save made above, of dm-atari, so its tile is bright and
// first, the others dimmed and by name, none is selected, and CONTINUE reads that save while no set is selected. Each tile
// shows its set's thumbnail, and the page fetches no game file to draw them. A click
// selects a tile, and PLAY opens its set; a click on another set, with no save, leaves
// CONTINUE disabled; a click on the selected tile selects none. Then PLAY's own click,
// as a player makes it, is the way into the entrance below.
await send('Page.navigate', { url: `${APP}?dungeon=nowhere&keepsaves` });
await wait(2500);
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
const clickOn = async (selector) => {
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();
    return {x:r.left+r.width/2, y:r.top+r.height/2};})()`);
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  await wait(300);
};
console.log('state: welcome page');
const atWelcome = await welcome();
console.log('  ', JSON.stringify(atWelcome));
const saveId = /[?&]save=([^&]+)/.exec(atWelcome.resume ?? '')?.[1];
check(!atWelcome.canvas && atWelcome.tiles === 'dm-atari*,kids-dungeon,csb,conflux-3.5,towers-of-chaos',
  'an unknown ?dungeon= is the welcome page, no game canvas, its tiles the sets not hidden, the one with a save bright and first, the others by name, none selected');
check(atWelcome.pictures.length === 5 && atWelcome.pictures.every(Boolean) && atWelcome.gameFiles === 0,
  'each tile shows its set\'s 320x200 thumbnail, <id>-thumbnail.png, and the page fetches no .dat');
check(atWelcome.play === null && /dungeon=dm-atari/.test(atWelcome.resume ?? '') && saveId !== undefined,
  'none selected: PLAY is disabled, CONTINUE reads the last save used, of any set');
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
await clickOn('.pick[data-set="dm-atari"]');
const atDm = await welcome();
check(atDm.tiles.startsWith('dm-atari*!') && atDm.resume === atWelcome.resume, 'dm-atari selected: CONTINUE reads its last save');
check(atWelcome.last === 'pick add +Add my own', 'the fan-made dungeons end with "+ Add my own", never selected');
// HOW TO PLAY (`src/ui/howToPlay.ts`): the page opened at `#how-to-play` shows its
// dialog, the moves, attacks and runes keyed as the player's settings have them, the 24
// runes the font's (U+E060 to U+E077, `gen-font.ts`). Its chooser's ARROWS makes the
// settings the ARROWS preset, stored, the sheet shown anew; CSBWIN KEYS puts them back.
// Its links to print are the sheets `tools/gen-help-sheet.mjs` made for the preset shown,
// which are there, and the sheet is the text that tool recorded (`sheets.json`): a sheet
// changed without its files made again fails here. CLOSE takes the fragment off, and the
// page's button opens it again. The selection made above is made again after.
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
await send('Page.navigate', { url: `${APP}?dungeon=nowhere&keepsaves#how-to-play` });
await wait(2500);
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
await clickOn('.pick[data-set="dm-atari"]');
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
// thumbnail the site's DM thumbnail pixel for pixel, and the page shows its tile selected. What the check refuses is `tools/dump-local-data-set.ts`'s.
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
const inForm = (body) => evaluate(`(async()=>{const d=document.querySelector('dialog.add-set');${body};return 1;})()`);
const typeIn = (name, value) => inForm(`const i=d.querySelector('[name=${name}]');i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input'))`);
const dropIn = (files) => inForm(`const dt=new DataTransfer();
  for(const [path,name] of ${JSON.stringify(files)}){const b=await (await fetch(path)).blob(); dt.items.add(new File([b],name,{type:b.type}));}
  d.querySelector('.add-set-drop').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}))`);
const removeIn = (about) => inForm(`d.querySelector('.add-set-checklist li[data-about="${about}"] .add-set-remove').click()`);
await clickOn('.pick.add');
await wait(500);
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
await wait(1500);
const filled = await form();
console.log('  form:', JSON.stringify(filled));
check(filled.id === 'my-own-dungeon' && filled.rows === 'name+,id+,dungeon.dat+,graphics.dat+,CSBgraphics.dat,hcsb.hct+,hcsb.datx,thumbnail+'
  && filled.dropped === "Not one of a dungeon's files: notes.txt." && !filled.confirm && filled.asTitle === 'off'
  && filled.problems.join() === 'The Hint Oracle needs hcsb.dat beside hcsb.hct.',
  'dropped files go where what they hold says, whatever their names, an image to the thumbnail; the id is the name\'s; hcsb.hct alone crosses hcsb.dat and holds CONFIRM');
await dropIn([['/gamefiles/dm-atari/graphics.dat', 'GFX']]);
await wait(1500);
const ownGraphics = await form();
await removeIn('graphics.dat');
await removeIn('hcsb.hct');
await typeIn('id', MINE);
await wait(1500);
const ready = await form();
check(ownGraphics.base === 'dm-atari*-,csb-' && ownGraphics.dropped === '' && ready.base === 'dm-atari*,csb',
  'a graphics.dat given turns the choice of graphics off, and its removal on');
check(ready.rows === 'name+,id+,dungeon.dat+,graphics.dat+,CSBgraphics.dat,hcsb.hct,hcsb.dat,thumbnail+' && ready.id === MINE
  && ready.confirm && ready.problems.length === 0,
  'a row\'s × takes its file back, and with nothing wrong CONFIRM is given');
await inForm(`const c=new OffscreenCanvas(640,400);c.getContext('2d').fillRect(0,0,640,400);
  const dt=new DataTransfer();dt.items.add(new File([await c.convertToBlob({type:'image/png'})],'large.png',{type:'image/png'}));
  d.querySelector('.add-set-drop').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}))`);
await wait(1000);
const large = await form();
console.log('  large:', JSON.stringify(large));
check(large.rows === ready.rows && large.thumbnail === 'title.png' && large.confirm
  && large.problems.join() === 'It is 640x400, not 320x200.' && large.height <= 600,
  'an image of 640x400 is not taken as the thumbnail, its row saying why, and the one before stays');
await removeIn('thumbnail');
await wait(500);
const unthumbed = await form();
await inForm(`d.querySelector('.add-set-generate').click()`);
await wait(3000);
const generated = await form();
console.log('  generated:', JSON.stringify(generated));
check(unthumbed.rows.endsWith(',thumbnail') && unthumbed.generate === 'on' && unthumbed.confirm && unthumbed.problems.length === 0
  && generated.rows === ready.rows && generated.thumbnail === 'title.png' && generated.generate === '' && generated.confirm,
  'without a thumbnail, its refusal gone with it, its row offers "Generate from data", which gives it title.png');
check(ready.asTitle === 'off' && unthumbed.asTitle === '' && generated.asTitle === 'off',
  'a thumbnail\'s row offers to show it as the title, off at first, also for one drawn from the title; without one, it does not');
await inForm(`d.querySelector('.add-set-as-title input').click()`);
await wait(1000);
const titled = await form();
check(titled.asTitle === 'on' && titled.confirm && titled.height <= 600, 'the checkbox checked, CONFIRM is still given, on one screen');
check(filled.holds === '14 | Weapons 106Clothing 121Scrolls 34Potions 55Containers 12Misc 278 | 303 in 182 groups, of 25 kinds | None'
  && ready.holds === filled.holds && ready.height <= 600,
  'what the dungeon holds shows under the checklist, whatever else is wrong, and the form stays on one screen');
await inForm(`d.querySelector('#add-set-confirm').click()`);
await wait(2000);
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
  && stored.dmRules && stored.asTitle === true && stored.files === 'dungeon.dat,thumbnail' && stored.levels === 14 && stored.sizes.every((size) => size > 0),
  'CONFIRM stores the record: its name, DM\'s graphics, its thumbnail as the title, its two files and its dungeon\'s signature, and closes the form');
check(stored?.thumbnail === 'image/png' && stored.sameThumbnail,
  'the thumbnail drawn from DM\'s graphics is the site\'s DM thumbnail, pixel for pixel');
check(afterAdd.tiles.includes(`local:${MINE}!`) && new RegExp(`dungeon=local%3A${MINE}(&|$)`).test(afterAdd.play ?? ''), 'the page shows the new set, selected');
// A save filed under the new set's id, a copy of dm-atari's one save made a millisecond
// older. Its tile is bright and second, its picture the record's image, and it counts its
// save; selected, PLAY and CONTINUE lead to it. "+ Add my own" stays last, and a click on
// it opens the form and selects nothing.
// Then the pen on the local set's picture, the only tile with one, opens the form on its
// record: its name, its id fixed, dungeon.dat replaceable but not removable, and DELETE.
// A new name confirmed is stored over the record, which keeps when it was added, and its
// save stays. DELETE asks first, counting the save; CANCEL keeps the set, and DELETE
// removes the record and its save, its row and its file, so that the pages below see the
// one save.
const saveDatabase = (body) => evaluate(`(async()=>{${body.before ?? ''}
  return new Promise((resolve, reject) => { const open = indexedDB.open('csbweb-saves');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction(['saves', 'saveFiles', 'dataSets'], 'readwrite');
      const saves = tx.objectStore('saves'), files = tx.objectStore('saveFiles'), dataSets = tx.objectStore('dataSets');
      ${body.write}
      tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = () => reject(tx.error); }; });})()`);
await saveDatabase({
  write: `const all = saves.getAll();
    all.onsuccess = () => { const row = all.result[0];
      saves.put({ ...row, id: 'probe-local-save', dataSet: 'local:${MINE}', savedAt: row.savedAt - 1, usedAt: (row.usedAt ?? row.savedAt) - 1 });
      const file = files.get(row.id);
      file.onsuccess = () => files.put({ ...file.result, id: 'probe-local-save' }); };`,
});
await send('Page.navigate', { url: `${APP}?dungeon=nowhere&keepsaves` });
await wait(2500);
const withLocal = await welcome();
console.log('  local set:', JSON.stringify(withLocal));
check(withLocal.tiles === `dm-atari*,kids-dungeon,csb,local:${MINE}*,conflux-3.5,towers-of-chaos`
  && withLocal.saves[3] === '1 save' && withLocal.pictures.length === 6 && withLocal.pictures.every(Boolean)
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
  open.onsuccess = () => { const tx = open.result.transaction(['saves', 'saveFiles', 'dataSets']);
    const set = tx.objectStore('dataSets').get('local:${MINE}'), saves = tx.objectStore('saves').getAllKeys(), files = tx.objectStore('saveFiles').getAllKeys();
    tx.oncomplete = () => { open.result.close(); resolve({ name: set.result?.name ?? null, createdAt: set.result?.createdAt ?? null,
      saves: saves.result.sort().join(), files: files.result.sort().join() }); }; }; })`);
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
check(pen.rows.split(',').every((row) => !row.includes('/')), "a local set's tile is as tall as the others on its row");
check(pen.names.split('|').every((name) => name.endsWith(name.startsWith('local:') ? ' rgb(0, 216, 216)' : ' rgb(252, 252, 252)')),
  "a local set's name is in cyan, palette entry 4, the others' in white");
await clickOn('.pick-edit');
await wait(1500);
const editing = await form();
console.log('  editing:', JSON.stringify(editing));
check(editing?.open === true && editing.title === 'Edit my own dungeon' && editing.name === 'My Own Dungeon' && editing.id === MINE
  && editing.fixedId && editing.deletable && editing.base === 'dm-atari*,csb' && editing.removable === 'thumbnail'
  && editing.rows === ready.rows && editing.thumbnail === 'title.png' && editing.asTitle === 'on' && editing.confirm && editing.height <= 600,
  'the pen opens the form on the record: its fields and files, its id fixed, dungeon.dat not removable, DELETE offered');
await typeIn('name', 'My Edited Dungeon');
await wait(1500);
await inForm(`d.querySelector('#add-set-confirm').click()`);
await wait(2000);
const edited = await readStore();
const afterEdit = await welcome();
check(await form() === null && edited.name === 'My Edited Dungeon' && edited.createdAt === stored.createdAt
  && edited.saves === ['probe-local-save', decodeURIComponent(saveId)].sort().join() && edited.files === edited.saves
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
await wait(1500);
const offered = await publishState();
await typeIn('name', 'My Changed Dungeon');
await wait(1000);
const whileChanged = await publishState();
await typeIn('name', 'My Edited Dungeon');
await wait(1000);
const undone = await publishState();
check(notOffered === 'hidden' && offered === 'on' && whileChanged === 'off' && undone === 'on',
  'PUBLISH is on the pen\'s form alone, offered on the stored set, held while the form shows a change');
await inForm(`d.querySelector('.add-set-publish').click()`);
await wait(3000);
const afterPublish = await welcome();
const publishedTile = await evaluate(`(t=>t&&{ colour: getComputedStyle(t.querySelector('.pick-name')).color, name: t.querySelector('.pick-name').textContent })(document.querySelector('.pick[data-set="${MINE}"]'))`);
const publishedRecord = await readStore();
console.log('  published:', JSON.stringify({ tiles: afterPublish.tiles, tile: publishedTile }));
const tilesOf = (page) => page.tiles.split(',');
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
const manifestRows = JSON.parse(readFileSync(new URL('data-sets.json', import.meta.url), 'utf8')).dataSets;
check(owned[MINE] === 'pick-documents:Documents of My Edited Dungeon,pick-reject:Withdraw My Edited Dungeon' && owned[`local:${MINE}`] === 'pick-edit:Edit My Edited Dungeon'
  && Object.entries(owned).every(([set, controls]) => set === MINE || set.startsWith('local:')
    || controls === `pick-documents:Documents of ${manifestRows.find((row) => row.id === set)?.name}`),
  'to its owner, the pending set has the book and the cross, which withdraws it, every other published set the book alone, and a local set the pen');
await clickOn('.pick-edit');
await wait(1500);
await inForm(`d.querySelector('.add-set-publish').click()`);
await wait(1500);
const again = { form: await form(), failure: await failureText(), publish: await publishState() };
console.log('  published again:', JSON.stringify({ failure: again.failure, publish: again.publish }));
check(again.form?.open === true && again.failure === 'It could not be published: The site already has a set of this id.' && again.publish === 'on',
  'a second PUBLISH of the id is refused, the server\'s answer said under the checklist, the form open');
onPaused = ({ requestId }) => send('Fetch.fulfillRequest', { requestId, responseCode: 422,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
  body: Buffer.from(JSON.stringify({ error: 'The set does not pass the check.', problems: [{ about: 'dungeon.dat', text: 'Its walls are wrong.' }] })).toString('base64') });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/data-sets*' }] });
await inForm(`d.querySelector('.add-set-publish').click()`);
await wait(1500);
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
await wait(1000);
await inForm(`d.querySelector('.add-set-delete').click()`);
const asked = await confirmation();
console.log('  delete:', JSON.stringify(asked));
await evaluate(`document.querySelector('#delete-set-cancel').click()`);
await wait(300);
const keptSet = { dialog: await confirmation(), form: await form(), store: await readStore() };
check(asked?.open === true && asked.title === 'Delete My Edited Dungeon?' && /^Its saved game is deleted with it\. .*EXPORT/.test(asked.text)
  && keptSet.dialog === null && keptSet.form?.open === true && keptSet.store.name === 'My Edited Dungeon' && keptSet.store.saves === edited.saves,
  "DELETE asks first, counting the set's save and naming EXPORT; CANCEL keeps the set and its save");
await inForm(`d.querySelector('.add-set-delete').click()`);
await evaluate(`document.querySelector('#delete-set-confirm').click()`);
await wait(1500);
const deleted = { dialog: await confirmation(), form: await form(), store: await readStore(), page: await welcome() };
check(deleted.dialog === null && deleted.form === null && deleted.store.name === null && deleted.store.saves === decodeURIComponent(saveId)
  && deleted.store.files === deleted.store.saves
  && tilesOf(deleted.page).filter((tile) => tile !== MINE).join() === atWelcome.tiles && tilesOf(deleted.page).includes(MINE),
  'its DELETE removes the record and every save filed under its id, and the page shows the sets without it, the published one kept');
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
const asPlayer = async (player) => {
  await evaluate(`localStorage.setItem('csbweb_player_v1', ${JSON.stringify(player)}),1`);
  await send('Page.navigate', { url: `${APP}?dungeon=nowhere&keepsaves&keepsettings` });
  await wait(2500);
};
const mineOf = async () => ({ ...(await evaluate(`(t=>({ colour: getComputedStyle(t.querySelector('.pick-name')).color, selected: t.getAttribute('aria-pressed') }))(document.querySelector('.pick[data-set="${MINE}"]'))`)),
  controls: (await controlsOf())[MINE] });
const onMine = (control) => clickOn(`.pick-cell:has(.pick[data-set="${MINE}"]) .${control}`);
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
await wait(1000);
const switchedOff = { switch: await moderationSwitch(), controls: await controlsOf() };
await asPlayer(MODERATOR);
const offReloaded = { switch: await moderationSwitch(), controls: await controlsOf() };
await clickOn('.welcome-moderation');
await wait(1000);
const switchedBack = { switch: await moderationSwitch(), controls: await controlsOf() };
console.log("  the moderator's switch:", JSON.stringify({ switchedOn, off: switchedOff.switch, reloaded: offReloaded.switch, back: switchedBack.switch }));
const asAPlayer = Object.keys(moderating).filter((set) => set !== MINE && !manifestRows.find((row) => row.id === set)?.hidden);
const playerControls = (controls) => Object.keys(controls).join() === asAPlayer.join() && Object.entries(controls).every(([set, controls]) => set.startsWith('local:')
  || controls === `pick-documents:Documents of ${manifestRows.find((row) => row.id === set)?.name}`);
check(switchedOn?.checked === 'true' && switchedOn.text === 'Moderator on' && switchedOn.corner === '12,12'
  && switchedOff.switch?.checked === 'false' && switchedOff.switch.text === 'Moderator off' && playerControls(switchedOff.controls)
  && offReloaded.switch?.checked === 'false' && playerControls(offReloaded.controls)
  && switchedBack.switch?.checked === 'true' && JSON.stringify(switchedBack.controls) === JSON.stringify(moderating),
  "the moderator's switch, at the top right corner, on: off, the page is a player's, no hidden nor pending set, the book alone, kept across a reload; on again, the moderator's");
await clickOn(`.pick[data-set="${MINE}"]`);
await onMine('pick-approve');
await wait(2000);
const approved = await mineOf();
await onMine('pick-hide');
await wait(2000);
const hidden = await mineOf();
await onMine('pick-show');
await wait(2000);
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
await wait(1500);
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
await wait(3000);
const siteForm = { ...(await form()), publish: await publishState(), note: await noteText(),
  prefix: await evaluate(`document.querySelector('dialog.add-set .add-set-id > span').hidden`) };
console.log('  the pen, to a moderator:', JSON.stringify(siteForm));
check(siteForm.open === true && siteForm.title === 'Edit the published dungeon' && siteForm.name === 'My Edited Dungeon' && siteForm.id === MINE
  && siteForm.fixedId && siteForm.prefix === true && !siteForm.deletable && siteForm.publish === 'hidden' && siteForm.removable === 'graphics.dat,thumbnail'
  && !siteForm.rows.includes('x') && siteForm.rows.includes('dungeon.dat+') && siteForm.thumbnail === 'thumbnail.png' && !siteForm.confirm && siteForm.note === ''
  && siteForm.official === 'off',
  'the pen opens the form on the published set, its files the folder\'s, its id fixed, no PUBLISH nor DELETE, CONFIRM held until a change, the official game\'s checkbox offered, off');
await typeIn('description', 'Edited by a moderator.');
await wait(1500);
const describedConfirm = (await form())?.confirm;
await dropIn([['gamefiles/dm-atari/dungeon.dat', 'dungeon.dat']]);
await wait(2500);
const newDungeonNote = await noteText();
await inForm(`d.querySelector('#add-set-confirm').click()`);
await wait(3000);
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
// then the set's archive, which is made
// in the page and downloaded as `<name>.zip` (`src/data/DataSetArchive.ts`); the set has no
// document yet, which its dialog says, with ADD. A text chosen is added, a link that opens in a new tab, served from
// the set's new folder; a name that is not a document's is refused in the dialog, nothing
// sent; a .doc is a link that downloads. The text's cross asks first, then removes it.
// CLOSE shows the page anew, the book on the set. Its owner, below, has the book, which
// offers neither ADD nor a cross.
const documentsDialog = () => evaluate(`(d=>d&&{ open: d.open, title: d.querySelector('h2').textContent, description: d.querySelector('.documents-description').textContent,
  items: [...d.querySelectorAll('.documents-list li')].map(li=>{const a=li.querySelector('a'), pack=li.querySelector('.documents-pack');
    return pack ? pack.textContent+'|'+li.querySelector('.documents-size').textContent : a ? [a.textContent, a.getAttribute('href'), a.target || (a.hasAttribute('download') ? 'download' : ''), li.querySelector('.documents-size').textContent,
      li.querySelector('.documents-remove')?.getAttribute('aria-label') ?? ''].join('|') : li.textContent;}),
  add: !!d.querySelector('#documents-add'), status: d.querySelector('.documents-status').textContent })(document.querySelector('dialog.documents'))`);
const chooseDocument = (name, text) => evaluate(`(()=>{const input=document.querySelector('#documents-file'), t=new DataTransfer();
  t.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)})); input.files=t.files; input.dispatchEvent(new Event('change')); return 1;})()`);
await onMine('pick-documents');
const noDocument = await documentsDialog();
const downloadsBefore = downloads.length;
await clickOn('dialog.documents .documents-pack');
await wait(2500);
const packed = { downloaded: downloads.slice(downloadsBefore), status: (await documentsDialog())?.status };
await chooseDocument('Notes.txt', 'Read me first.');
await wait(2500);
const oneDocument = await documentsDialog();
const servedDocument = await evaluate(`fetch(document.querySelector('dialog.documents .documents-list a').getAttribute('href')).then(r=>r.text())`);
await chooseDocument('page.html', '<p>no</p>');
await wait(500);
const refusedDocument = await documentsDialog();
await chooseDocument('Solution.doc', 'The answer.');
await wait(2500);
const twoDocuments = await documentsDialog();
await clickOn('dialog.documents .documents-remove[aria-label="Remove Notes.txt"]');
const askedRemoval = await evaluate(`(d=>d&&{ title: d.querySelector('h2').textContent, button: d.querySelector('#remove-document-confirm').textContent })(document.querySelector('dialog.remove-document'))`);
await evaluate(`document.querySelector('#remove-document-confirm').click()`);
await wait(2500);
const afterRemoval = await documentsDialog();
await clickOn('#documents-close');
await wait(2000);
const afterDocuments = { dialog: await documentsDialog(), mine: await mineOf() };
const ARCHIVE = 'My Edited Dungeon.zip|every file';
console.log('  the book:', JSON.stringify({ noDocument, packed, oneDocument, refusedDocument: refusedDocument?.status, twoDocuments, askedRemoval, afterRemoval }));
check(noDocument?.open === true && noDocument.title === 'My Edited Dungeon: documents' && noDocument.description === 'Edited by a moderator.' && noDocument.items.join() === `${ARCHIVE},No document yet.` && noDocument.add,
  'to a moderator, the book opens the set\'s description, its archive, then its documents, none yet, with ADD');
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
await wait(300);
const setsOf = (page) => tilesOf(page).map((tile) => tile.replace(/[*!]+$/, ''));
const keptPending = { dialog: await rejectDialog(), tiles: setsOf(await welcome()) };
await clickOn(`.pick-cell:has(.pick[data-set="${SECOND}"]) .pick-reject`);
await evaluate(`document.querySelector('#reject-set-confirm').click()`);
await wait(2000);
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
await send('Page.navigate', { url: `${APP}stats?keepsaves&keepsettings` });
await wait(2500);
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
const statsMatch = (page) => page.band === page.expectedBand && page.picks === page.expectedPicks && page.name === page.expectedName
  && page.figures === page.expectedFigures && page.wins === page.expectedWins && page.solos === page.expectedSolos
  && page.reincarnated === page.expectedReincarnated && page.levels === page.expectedLevels && page.champions === page.expectedChampions;
check(statsLink === 'stats' && statsFirst.gameCode.length === 0 && statsFirst.weeks > 0,
  'the welcome page\'s footer links to the statistics page, which loads none of the game\'s code, and charts the weeks');
check(statsFirst.sets > 1 && statsFirst.selected === statsFirst.expectedPicks.split(',')[0] && statsMatch(statsFirst),
  'with no ?set=, the column\'s first is selected, and the band, the column and its figures, wins, levels and champions are api/stats\'s');
const secondSet = statsFirst.expectedPicks.split(',')[1];
await clickOn(`.stats-pick[data-set="${secondSet}"]`);
await wait(700);
const statsSecond = await statsPage();
console.log('  ', JSON.stringify(statsSecond));
check(statsSecond.selected === secondSet && new URLSearchParams(statsSecond.search).get('set') === secondSet
  && statsSecond.search.includes('keepsaves') && statsMatch(statsSecond),
  'a click selects a set, in the URL, the other parameters kept, and the page is its own');
await evaluate(`history.back(),1`);
await wait(700);
const statsBack = await statsPage();
check(statsBack.selected === statsFirst.selected && statsMatch(statsBack), 'back selects the first again');
await send('Page.navigate', { url: `${APP}stats?set=dm-atari&keepsaves&keepsettings` });
await wait(2500);
const statsDm = await statsPage();
console.log('  ', JSON.stringify(statsDm));
check(statsDm.selected === 'dm-atari' && statsMatch(statsDm), '?set=dm-atari selects it');
// A tile's name says its set's state, to a moderator (`server/dataSets.ts`), whose answer
// the dev server's manifest stands in for here, with `"moderator": true`, kids-dungeon
// pending and 3d2d1d, a hidden set, pending too: every set is listed, the hidden ones
// included, a pending one's name red, palette entry 8, a hidden one's purple, red winning,
// and the others' white. A local set's cyan is checked above.
const moderated = JSON.parse(readFileSync(new URL('data-sets.json', import.meta.url), 'utf8'));
moderated.moderator = true;
for (const set of moderated.dataSets) if (set.id === 'kids-dungeon' || set.id === '3d2d1d') set.status = 'pending';
onPaused = ({ requestId }) => send('Fetch.fulfillRequest', { requestId, responseCode: 200,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
  body: Buffer.from(JSON.stringify(moderated)).toString('base64') });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/data-sets*' }] });
await send('Page.navigate', { url: `${APP}?dungeon=nowhere&keepsaves` });
await wait(2500);
await send('Fetch.disable');
onPaused = null;
const states = await evaluate(`Object.fromEntries([...document.querySelectorAll('.pick[data-set]')]
  .map(t=>[t.dataset.set, getComputedStyle(t.querySelector('.pick-name')).color]))`);
console.log('  to a moderator:', JSON.stringify(states));
const colourOf = (set) => set.status === 'pending' ? 'rgb(252, 0, 0)' : set.hidden ? 'rgb(216, 0, 216)' : 'rgb(252, 252, 252)';
check(Object.keys(states).sort().join() === moderated.dataSets.map((set) => set.id).sort().join()
  && moderated.dataSets.every((set) => states[set.id] === colourOf(set)),
  "to a moderator, every set is listed, the hidden ones too, a pending set's name red, a hidden one's purple, red winning, the others' white");
await clickOn('.pick[data-set="dm-atari"]');
await clickOn('#welcome-play');
await wait(9000);
check(await evaluate(`location.search`) === '?dungeon=dm-atari&keepsaves=', 'PLAY opens the selected set, the page\'s other parameters kept');
console.log('state: entrance');
const entrance = await shot('07-entrance');
// The scroll at the bottom of the button column (button id 202).
await canvasClick(270, 192, 0); await wait(1500);
console.log('state: credits');
const credits = await shot('08-credits');
// Back to the entrance, "resume" (id 201), the one save the chooser lists, its first
// row, and LOAD (x 24..74, y 161..174):
// the loaded game is played at once, with no "GAME LOADED, READY TO PLAY." before it, so
// this is the adventure's first view of the save made above.
await canvasClick(160, 100, 0); await wait(1000);
check(!(await wheelTaken()), 'the entrance leaves the wheel to the page');
await canvasClick(270, 84, 0);  await wait(1500);
check(await wheelTaken(), 'the entrance\'s chooser takes the wheel, for its list');
// The cursor stays up as the chooser redraws, from `STShowCursor` to `STHideCursor`
// (`doc/CSBwin-src/SaveGame.cpp:1687-1689`): after a notch of the wheel and two keys, the
// arrow is still where the click that opened it left it, and the pointer leaving the
// canvas takes it off. The pointer stays off for the comparisons below.
const leaveCanvas = () => evaluate(`document.getElementById('game-canvas').dispatchEvent(new PointerEvent('pointerleave',{isPrimary:true,pointerType:'mouse'})),1`);
await key('ArrowUp');   await wait(200);
await key('ArrowDown'); await wait(200);
const withArrow = await canvasPixels();
await leaveCanvas(); await wait(200);
check(withArrow !== (await canvasPixels()), 'the entrance\'s chooser keeps its cursor up as it redraws');
// And the keys the list takes in play. The one save is selected under its heading: the up
// arrow moves the selection to the heading, and the down arrow back to the save.
const chooserUp = await canvasPixels();
await key('ArrowUp');   await wait(200);
const onHeading = await canvasPixels();
await key('ArrowDown'); await wait(200);
check(onHeading !== chooserUp && onHeading !== entrance && (await canvasPixels()) === chooserUp,
  'the entrance\'s chooser takes the arrow keys, and stays up');
// EXPORT (x 170..220, y 161..174) on that save: the page's own download
// (`downloadSaveFile`, `src/data/saves/downloadSaveFile.ts`), which no Node tool can run.
// What the file holds is `tools/dump-save-menu.ts`'s to show.
// The welcome page's archive was downloaded before it.
const exportedFrom = downloads.length;
await canvasClick(195, 168, 0); await wait(1000);
const exported = downloads.slice(exportedFrom);
console.log('  downloads:', exported.join(', ') || 'none');
check(exported.length === 1 && /^csbweb-\d{8}-\d{6}\.dat$/.test(exported[0]),
  'EXPORT in the chooser starts one download, a .dat under the save\'s name');
// A file dropped on the page while the chooser is up: the page's own listener
// (`bindSaveDrop`, `src/ui/saveDrop.ts`), which no Node tool can run either. The file is
// the csb set's save, another dungeon's here, so it is refused in a one-option menu and
// nothing is stored; OK (the centred menu's one button, around (159,147)) brings the
// chooser back, its message gone. What is stored and what is asked is
// `tools/dump-save-menu.ts`'s to show.
const dropTaken = await evaluate(`(async()=>{
  const bytes = await (await fetch('/gamefiles/csb/csbgame2.dat')).arrayBuffer();
  const data = new DataTransfer();
  data.items.add(new File([bytes], 'CSBGAME2.DAT'));
  const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
  document.getElementById('game-canvas').dispatchEvent(drop);
  return drop.defaultPrevented;
})()`);
await wait(1000);
const refusal = await canvasPixels();
check(dropTaken && refusal !== chooserUp && refusal !== entrance,
  'a save of another dungeon dropped on the chooser is taken by the page, and a menu comes up');
await canvasClick(159, 147, 0); await wait(600);
await leaveCanvas(); await wait(200);
check((await canvasPixels()) === chooserUp, 'its OK brings the chooser back, with nothing more listed');
await canvasClick(100, 27, 0);  await wait(300);
await canvasClick(48, 168, 0);  await wait(1500);
console.log('state: game loaded');       const loaded = await shot('12-game-loaded');

// The welcome page's CONTINUE, as its link reads (`?dungeon=dm-atari&save=<row id>`): the
// boot reads that save straight into play (`continueSave`, `src/main.ts`), with no
// title and no entrance, so the screen is the one the entrance's LOAD showed of it, its
// party the four the welcome page's box named. A row the store does not hold leaves the
// entrance instead, without the title.
const continued = async (search) => {
  await send('Page.navigate', { url: `${APP}${search}` });
  await wait(3500);
  await leaveCanvas(); await wait(200);
  return evaluate(`(()=>{const p=window.__probe; return p ? p.game.ctx.party.state.champions.map(c=>c.name.trim()).join(' · ') : null;})()`);
};
const continuedParty = await continued(`?dungeon=dm-atari&save=${saveId}&keepsaves`);
console.log('  continued party:', continuedParty);
check(continuedParty === atWelcome.preview[1] && (await canvasPixels()) === loaded,
  'CONTINUE reads its save straight into play: the screen the entrance\'s LOAD showed, the party the box named');
await continued('?dungeon=dm-atari&save=nowhere&keepsaves');
check((await canvasPixels()) === entrance, 'a save the store does not hold leaves the entrance, without the title');

// A pressed crack switch (`doc/PROVEN_FACTS.md`, "Crack Switch (In) placement"): level 4,
// (14,29) facing west, after the click. The pushed-in crack must sit low on the wall where
// the Out crack was, not at eye level where `graphics.dat`'s coordinate set would put it.
// Built from a fresh `?intro=0` boot with the same party, since TouchWall needs a leader.
// The click also opens the grid at (13,28), off to the right; the wait covers its opening.
await send('Page.navigate', { url: `${APP}?intro=0&dungeon=dm-atari` });
await wait(3500);
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
await wait(3000);
console.log('state: crack switch');      await shot('09-crack-switch');

// Door ornaments (`TAG004b26`, `doc/CSBwin-src/CSBCode.cpp:4058`), drawn onto the door's
// bitmap before the blit. The entrance door, level 0 (1,2), seen from the start square:
// ornament 7 at full size, the black double door, over the grid that is its door type.
// Then level 4 door 60 at (4,25), two squares east of (2,25): a wooden door whose lock
// plate, ornament 5 in position set 2, is shrunk to its F2 size through `d.Byte4188`.
const FACE = (x, y, z, facing) => `(()=>{
  const { game, renderView } = window.__probe;
  const party = game.ctx.party.state;
  party.position.x = ${x}; party.position.y = ${y}; party.position.z = ${z};
  party.facing = ${facing};
  party.brightness = 1000;
  renderView();
})()`;
await evaluate(FACE(1, 3, 0, 0)); await wait(500);
console.log('state: entrance door');     await shot('10-entrance-door');
await evaluate(FACE(2, 25, 4, 1)); await wait(500);
console.log('state: door lock, F2');     await shot('11-door-lock-f2');
// A wall decoration on an F2 edge wall, positions 7 and 9 of `DrawWallDecoration`
// (`doc/CSBwin-src/CSBCode.cpp:3599-3623`). One mirror frame in the Hall of Champions,
// the south face of level 0 (16,7), seen from two squares south and one to either side,
// facing north: from (17,9) it is front-left, from (15,9) front-right. It is scaled to the
// F2 centre width and cut by the screen border, so on the left it must show the bitmap's
// right end, and on the right its left end. `tools/dump-hall-of-champions.ts` pins the
// rectangles; these two frames pin the pixels.
await evaluate(FACE(17, 9, 0, 0)); await wait(500);
console.log('state: F2 front-left wall'); await shot('13-edge-decoration-left');
await evaluate(FACE(15, 9, 0, 0)); await wait(500);
console.log('state: F2 front-right wall'); await shot('14-edge-decoration-right');
// A wall text seen from afar is its plaque, cut short for a text of one to three lines
// (`doc/CSBwin-src/CSBCode.cpp:3625-3660`). "HALL OF / CHAMPIONS", on the north
// face of level 0 (8,5), seen from (8,3) facing south: two lines at F2 centre, so the
// plaque stops at `d.Byte4212[10]`, row 53 of its 37-73. `tools/dump-wall-text.ts` pins
// the cut at every position; this frame pins it in a real view.
await evaluate(FACE(8, 3, 0, 2)); await wait(500);
console.log('state: wall text at F2');   await shot('19-wall-text-f2');
// A left click on a portrait box's bars, where CSBWin has no left button, is the box's
// right click (`searchMouseButtons`, `src/renderer/ui/Mouse.ts`): champion 1's inventory
// opens, and a second click closes it. Nothing is drawn, so this is no frame.
const selected = () => evaluate(`window.__probe.screen.ui.partyState.selectedCharacterIndex`);
await canvasClick(124, 10, 0); await wait(600);
check(await selected() === 1, 'a left click on a champion\'s bars opens the inventory');
await canvasClick(124, 10, 0); await wait(600);
check(await selected() === -1, 'and a second one closes it');
// A finger, through CDP's touch events, which Chrome delivers to the page as a touch
// screen's: pointer events as it presses and lifts, and its mouse events only after the
// lift (`bindCanvasEvents`, `src/ui/events.ts`). So the eye (12-27 x 46-61) is held while
// the finger is down, and a tap is one click.
const touch = async (type, x, y) => {
  const p = await evaluate(`(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();
    return {x:r.left+(${x}+0.5)*r.width/320, y:r.top+(${y}+0.5)*r.height/200};})()`);
  await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }] });
};
const pressingEye = () => evaluate(`window.__probe.screen.ui.pressingEye`);
// The tap is this page's first user activation, the clicks above being the page's own
// events, and a touch gives one only at its lift: the sound is unlocked by it
// (`createSoundManager`, `src/main.ts`), not by the press.
const soundRunning = () => evaluate(`window.__probe.sound.isRunning()`);
check(!(await soundRunning()), 'no user activation yet: the sound is locked');
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await touch('touchStart', 124, 10); await touch('touchEnd', 124, 10); await wait(600);
check(await selected() === 1, 'a tap on a champion\'s bars opens the inventory, once');
check(await soundRunning(), 'and unlocks the sound');
await touch('touchStart', 19, 53); await wait(600);
check(await pressingEye(), 'a finger held on the eye keeps it pressed');
await touch('touchEnd', 19, 53); await wait(600);
check(!(await pressingEye()), 'and lifting it lets go');
await touch('touchStart', 124, 10); await touch('touchEnd', 124, 10); await wait(600);
check(await selected() === -1, 'a second tap closes the inventory');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
// A mouse pressed on the eye, moved off the canvas and released there: the canvas has the
// pointer captured (`bindCanvasEvents`), so the release is its, and the eye is let go. A
// move names the button held, or Chrome takes it for a move with none, which ends the
// capture.
const realMouse = async (type, x, y) => {
  const p = await evaluate(`(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();
    return {x:r.left+(${x}+0.5)*r.width/320, y:r.top+(${y}+0.5)*r.height/200};})()`);
  await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
};
await canvasClick(124, 10, 0); await wait(600);
await realMouse('mousePressed', 19, 53); await wait(300);
check(await pressingEye(), 'a mouse held on the eye keeps it pressed');
await realMouse('mouseMoved', 19, 215); await realMouse('mouseReleased', 19, 215); await wait(600);
check(!(await pressingEye()), 'and released off the canvas, lets go');
await canvasClick(124, 10, 0); await wait(600);
check(await selected() === -1, 'the inventory closed again');

// The Hint Oracle's button (`src/renderer/ui/HintOracleButton.ts`), CSB's set only: the
// inventory's close box is the Oracle's `?`, and a real click on it opens the Oracle on the
// party's square. CSB's `csbgame2.dat` is read into a `?intro=0` game, and its party set on
// level 4 (1,7), thirteen squares from the nearest creature, so nothing moves while the
// frames are taken; there the Oracle lists CREATURES and CIRCLE OF POISON. Its title list
// cycles a palette slot every 21 VBLs, so it is no frame: `tools/dump-hint-oracle-screen.ts`
// checks its pixels. A hint's page, the first title's, does not cycle, and is one.
await send('Page.navigate', { url: `${APP}?intro=0&dungeon=csb` });
await wait(3500);
await evaluate(`(async()=>{
  const { game, renderView, applySaveBytes } = window.__probe;
  applySaveBytes(game, new Uint8Array(await (await fetch('/gamefiles/csb/csbgame2.dat')).arrayBuffer()));
  const party = game.ctx.party.state;
  party.position.x = 1; party.position.y = 7;
  renderView();
  return party.champions.map((c) => c.name).join(', ');
})()`).then(names => console.log('  csb party:', names));
await wait(600);
await canvasClick(15, 15, 2);  await wait(700);
await leaveCanvas(); await wait(200);
console.log('state: CSB inventory');
const csbInventory = await shot('15-csb-inventory');
await realClick(214, 40); await wait(2500);
check(await evaluate(`window.__probe.screen.isHintOracleUp()`), 'a real click on the close box opens the Hint Oracle');
await realClick(160, 36); await wait(3000);
await leaveCanvas(); await wait(200);
console.log('state: hint page');         await shot('16-hint-oracle-page');
// DONE (x 221-289, y 179-192) on the page goes back to the title list, and on the list
// closes the Oracle: the inventory comes back as it was.
await realClick(255, 185); await wait(3000);
await realClick(255, 185); await wait(1500);
await leaveCanvas(); await wait(200);
check(!(await evaluate(`window.__probe.screen.isHintOracleUp()`)) && (await canvasPixels()) === csbInventory,
  'DONE on the page and then on the list closes the Oracle, back to frame 15');

// Conflux 3.5 at its start: level 0, (13,24) facing north, no champion. Nearly every view
// of it runs a skin's program from its `CSBgraphics.dat`, and its DSAs run from the first
// tick (`tools/watch-conflux-start.ts`). The square in front is a wall, which its skin
// paints with a picture, and nothing in view moves.
await send('Page.navigate', { url: `${APP}?intro=0&dungeon=conflux-3.5` });
await wait(3500);
await leaveCanvas(); await wait(200);
console.log('state: Conflux start');     const confluxStart = await shot('18-conflux-start');
// A viewport overlay (`src/renderer/csbwin/OverlayScreen.ts`), put up on the engine as a
// DSA's `&OVERLAY` and `&JITTER` would: overlay 1 of Conflux's `CSBgraphics.dat` over this
// view, half of each pixel the overlay's, its colour 0 transparent, and the view shifted
// four pixels right under it. Hidden and shifted back after, the view is frame 18.
const OVERLAY = `window.__probe.game.ctx.overlay`;
await evaluate(`(()=>{const o = ${OVERLAY}; o.SelectOverlay(1, 1, 50, 0, 0, window.__probe.game.ctx.state.tickCount);
  o.Jitter(4, 0, 0, 0); window.__probe.refreshScreen(); return o.active;})()`);
await wait(500);
console.log('state: overlay');           await shot('17-overlay');
await evaluate(`(()=>{const o = ${OVERLAY}; o.active = false; o.Jitter(0, 0, 0, 0); window.__probe.refreshScreen(); return 1;})()`);
await wait(500);
check((await canvasPixels()) === confluxStart, 'the overlay hidden and the view shifted back, it is frame 18 again');
// Wall decorations of Conflux's `CSBgraphics.dat`, their bitmaps read as bitplanes
// (`tools/dump-extended-decorations.ts`), from level 0 (14,14) facing south: on the west
// faces of the squares to the left, decoration 5, a bookshelf, drawn as it stands at F1
// (15,15), and decoration 11, a ladder, its side view scaled by `ShrinkBLT` to F2 (15,16).
await evaluate(FACE(14, 14, 0, 2)); await wait(500);
await leaveCanvas(); await wait(200);
console.log('state: Conflux bookshelf'); await shot('20-conflux-bookshelf');

// The settings dialog (`src/renderer/ui/SettingsDialog.ts`), over the default dungeon's
// first view: Esc opens it, over the whole screen, on GAME, and the clock is held while it
// is up. A frame a tab: GAME's with the pointer on DRINK AT FOUNTAINS' button, so it is
// lit, the help line names it and the cursor is drawn, DISPLAY's and SOUND's with it off the canvas,
// and KEYS' with MOVE FORWARD's first slot waiting for its key.
await send('Page.navigate', { url: `${APP}?intro=0&keepsaves&dungeon=dm-atari` });
await wait(3500);
const settingsUp = () => evaluate(`window.__probe.screen.ui.settingsDialog !== null`);
const settingsValues = () => evaluate(`window.__probe.screen.ui.settings.values`);
const ticks = () => evaluate(`window.__probe.game.ctx.state.tickCount`);
const pointerAt = (x, y) => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent('pointermove',{isPrimary:true,pointerType:'mouse',clientX:r.left+(${x}+0.5)*r.width/320,clientY:r.top+(${y}+0.5)*r.height/200,bubbles:true}));return 1;})()`);
await key('Escape'); await wait(300);
check(await settingsUp(), 'Esc opens the settings in play');
const heldAt = await ticks(); await wait(1000);
check(await ticks() === heldAt, 'the clock is held while they are up');
await pointerAt(85, 65); await wait(200);
console.log('state: settings, GAME');    await shot('21-settings-game');
await leaveCanvas(); await wait(200);
await canvasClick(120, 45, 0); await wait(300);
console.log('state: settings, DISPLAY'); await shot('22-settings-display');
// DISPLAY's ASPECT RATIO (236,65): 4:3 shows the 320x200 canvas 960x720, a click still
// landing on what it shows, and 16:10 again 960x600.
const canvasSize = () => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  return [c.width,c.height,r.width,r.height].join('x');})()`);
await canvasClick(236, 65, 0); await wait(300);
check((await settingsValues()).aspectRatio === '4:3' && await canvasSize() === '320x200x960x720',
  'ASPECT RATIO at 4:3 shows the 320x200 canvas 960x720');
await canvasClick(236, 65, 0); await wait(300);
check((await settingsValues()).aspectRatio === '16:10' && await canvasSize() === '320x200x960x600',
  'a click on it there, where it is shown, makes it 16:10, 960x600');
await canvasClick(197, 45, 0); await wait(300);
console.log('state: settings, SOUND');   await shot('23-settings-sound');
// The VOLUME slider, dragged with CDP's own mouse from its left end, and released off the
// canvas, right of it: the canvas has the pointer captured, so the moves off it come at
// its edge, and the knob goes to the track's right end; the release is the canvas's too,
// and a move after it drags nothing.
const cdpMouse = async (type, x, y) => {
  const p = await evaluate(`(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();
    return {x:r.left+(${x}+0.5)*r.width/320, y:r.top+(${y}+0.5)*r.height/200};})()`);
  await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
};
await cdpMouse('mousePressed', 200, 86); await wait(200);
check((await settingsValues()).volume === 0, 'a press at the VOLUME slider\'s left end sets it to 0');
await cdpMouse('mouseMoved', 254, 86); await wait(200);
const halfway = (await settingsValues()).volume;
check(halfway > 0.4 && halfway < 0.6, `dragged to the track's middle, about a half (${halfway})`);
await cdpMouse('mouseMoved', 400, 86); await cdpMouse('mouseReleased', 400, 86); await wait(200);
check((await settingsValues()).volume === 1, 'dragged off the canvas, to its right, the volume is 1');
await pointerAt(200, 86); await wait(200);
check((await settingsValues()).volume === 1, 'released there, a move drags nothing');
// SOUND's OFF, read back after a reload: the setting is kept. Then a double click on the message area opens the dialog, and a right click
// closes it, off KEYS' slots.
await canvasClick(284, 65, 0); await wait(300);
check((await settingsValues()).sound === false, 'SOUND\'s OFF turns the sound off');
// KEYS (`src/renderer/ui/SettingsKeys.ts`), KEY LABELS shown, as the browser here gives
// no layout: a click on MOVE FORWARD's first slot waits for its key, and a key pressed
// fills it by its code, AZERTY's Z being KeyW.
await canvasClick(240, 45, 0); await wait(300);
await canvasClick(190, 105, 0); await wait(300);
console.log('state: settings, KEYS');    await shot('24-settings-keys');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyW',bubbles:true})),1`); await wait(300);
const rebound = await settingsValues();
check(rebound.keyBindings['move.forward'][0] === 'KeyW' && rebound.keyBindings['attack.1.0'][0] === '' && rebound.keyPreset === 'custom',
  'a key pressed fills the slot by its code, leaves the slot it was in, and the table is CUSTOM');
// A notch of the wheel scrolls the list three rows, and the VBL's frame draws them, the
// pointer still (`GameScreen.takeWheelTurned`).
const screenSum = () => evaluate(`window.__probe.screen.ui.screenIndexBuffer.pixels.reduce((s,p,i)=>(s+p*(i%997+1))%1000000007,0)`);
const unscrolled = await screenSum();
await evaluate(`document.getElementById('game-canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:100,cancelable:true,bubbles:true})),1`); await wait(300);
check(await evaluate(`window.__probe.screen.ui.settingsDialog.keys.scrollTop`) === 3 && await screenSum() !== unscrolled,
  'a notch of the wheel scrolls the keys three rows, drawn with the pointer still');
await canvasClick(160, 100, 2); await wait(300);
check(!(await settingsUp()), 'a right click closes the settings');
// DISPLAY's LEFT HANDED (85,107), checked last, as the party it builds would change
// the cursor of the dialogs above: the dialog closed and the party built, the panels are
// on the left and the view on the right, each band's gap between them. A frame of it,
// with the pointer at (84,100), on the right-hand column's (317,100): its arrow is drawn
// there, across the gap into the view, not cut where the column ends on CSBWin's screen. A click where the
// turn-right arrow is shown, (80,135), turns the party. Under the dialog the screen is
// CSBWin's again, so the clicks that turn it off land where they always do.
const facing = () => evaluate(`window.__probe.screen.ui.partyState.facing`);
await key('Escape'); await wait(300);
await canvasClick(120, 45, 0); await wait(300);
await canvasClick(85, 107, 0); await wait(300);
check((await settingsValues()).leftHanded === true, 'LEFT HANDED turns the left-handed screen on');
await key('Escape'); await wait(300);
await evaluate(BUILD_PARTY); await wait(600);
await pointerAt(84, 100); await wait(300);
const leftHover = await evaluate(`(()=>{const p=window.__probe.screen.ui.hoverPoint;return Math.floor(p.x)+','+Math.floor(p.y);})()`);
check(leftHover === '317,100',
  `left-handed, the pointer at (84,100) is the column's (317,100) (${leftHover})`);
console.log('state: left-handed');       await shot('29-left-handed');
await leaveCanvas(); await wait(300);
const facingBefore = await facing();
await canvasClick(80, 135, 0); await wait(800);
check(await facing() === ((facingBefore + 1) & 3), 'left-handed, a click where the turn-right arrow is shown turns the party right');
await key('Escape'); await wait(300);
check(await settingsUp(), 'left-handed, Esc opens the settings, the screen CSBWin\'s under them');
await canvasClick(120, 45, 0); await wait(300);
await canvasClick(85, 107, 0); await wait(300);
check((await settingsValues()).leftHanded === false, 'LEFT HANDED again turns it off');
await key('Escape'); await wait(300);
await send('Page.navigate', { url: `${APP}?intro=0&keepsaves&keepsettings&dungeon=dm-atari` });
await wait(3500);
const kept = await settingsValues();
check(kept.sound === false && kept.volume === 1, 'after a reload, the sound is still off, at full volume');
await canvasClick(100, 185, 0); await canvasClick(150, 190, 0); await wait(300);
check(await settingsUp(), 'a double click on the message area opens the settings');
// EXIT asks first, in `_DoMenu`'s centred menu (a frame of it, the pointer off the
// canvas); Esc puts the dialog back, and the question's EXIT, once it has flashed, opens
// the welcome page, the page's other parameters kept.
const exiting = () => evaluate(`window.__probe.screen.ui.settingsDialog?.exiting === true`);
await canvasClick(279, 19, 0); await wait(300);
check(await exiting(), 'EXIT asks first');
await leaveCanvas(); await wait(200);
console.log('state: settings, EXIT');    await shot('28-settings-exit');
await key('Escape'); await wait(300);
check(await settingsUp() && !(await exiting()), 'Esc on the question puts the settings back');
await canvasClick(279, 19, 0); await wait(300);
const exitButton = await evaluate(`(()=>{const b=window.__probe.screen.ui.uiTables.graphic231.buttons.buttons18828.find((e)=>e.word0===210);
  return {x:(b.x1+b.x2-1)>>1, y:(b.y1+b.y2-1)>>1};})()`);
await canvasClick(exitButton.x, exitButton.y, 0); await wait(2000);
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
await send('Page.navigate', { url: `${APP}?intro=0&dungeon=dm-atari` });
await wait(3500);
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
    tx.oncomplete = () => { db.close(); resolve({ version: db.version,
      rows: rows.result.map((r) => r.id + ('bytes' in r ? '+bytes' : '')).sort().join(),
      files: files.result.map((f) => f.id + ':' + f.bytes.byteLength + ':' + sum(f.bytes)).sort().join() }); }; }; })`;
await send('Page.navigate', { url: `${APP}package.json?keepsaves` });
await wait(800);
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
await send('Page.navigate', { url: `${APP}?dungeon=nowhere&keepsaves` });
await wait(2500);
const upgradedV5 = await evaluate(rawSaves);
console.log('  version 5 upgraded:', JSON.stringify(upgradedV5));
check(upgradedV5.version === 6 && upgradedV5.rows === 'probe-v5.dat' && upgradedV5.files === stagedV5,
  "the upgrade to version 6 keeps a row without its file, and its file byte for byte in saveFiles under the row's id");
await send('Page.navigate', { url: `${APP}?intro=0&dungeon=csb&keepsaves` });
await wait(3500);
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
  && filesApart.afterImport.files.split(',').map((f) => f.split(':')[0]).join() === 'probe-import.dat,probe-v5.dat'
  && filesApart.afterDelete?.rows === 'probe-v5.dat' && filesApart.afterDelete.files === stagedV5,
  'an import writes a row and its file, and a DELETE deletes both');

// The map dialog (`src/renderer/ui/MapDialog.ts`), over CSB's `csbgame2.dat`, its party
// where the save left it: a press held on the message area opens it, with MAP VIEW on
// alone. A frame of it with the pointer off the canvas; a right click closes it.
await send('Page.navigate', { url: `${APP}?intro=0&dungeon=csb` });
await wait(3500);
await evaluate(`(async()=>{
  const { game, applySaveBytes } = window.__probe;
  applySaveBytes(game, new Uint8Array(await (await fetch('/gamefiles/csb/csbgame2.dat')).arrayBuffer()));
  return 1;
})()`);
await wait(600);
const mapUp = () => evaluate(`window.__probe.screen.ui.mapDialog !== null`);
await cdpMouse('mousePressed', 100, 185); await wait(900); await cdpMouse('mouseReleased', 100, 185); await wait(300);
check(!(await mapUp()), 'with MAP VIEW off, a long press on the message area opens no map');
await evaluate(`window.__probe.screen.ui.settings.update({ mapView: true }), 1`);
await cdpMouse('mousePressed', 100, 185); await wait(900);
check(await mapUp(), 'with MAP VIEW on, it opens the map while the press is held');
await cdpMouse('mouseReleased', 100, 185); await wait(300);
check(await mapUp(), 'and the release leaves it up');
await leaveCanvas(); await wait(200);
console.log('state: map');               await shot('25-map');
await canvasClick(160, 100, 2); await wait(300);
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
await cdpMouse('mouseReleased', 55, 14); await wait(300);
check((await championsUp()) === 0 && (await selected()) === -1, 'and the release leaves it up, with no inventory');
await leaveCanvas(); await wait(200);
console.log('state: champions, ATTRIBUTES'); await shot('26-champions-attributes');
await canvasClick(133, 27, 0); await leaveCanvas(); await wait(300);
console.log('state: champions, SKILLS');  await shot('27-champions-skills');
await canvasClick(160, 100, 2); await wait(300);
check((await championsUp()) === null, 'a right click closes the champions');
await cdpMouse('mousePressed', 55, 14); await wait(100);
check((await selected()) === -1, 'a tap on the bars: nothing while it is down');
await cdpMouse('mouseReleased', 55, 14); await wait(700);
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
await send('Page.navigate', { url: `${APP}?intro=0&keepsaves&dungeon=dm-atari` });
await wait(3500);
const screenLayout = () => evaluate(`(()=>{const g=document.getElementById('game-canvas').getBoundingClientRect();
  const t=document.getElementById('crt-canvas');const r=t.getBoundingClientRect();
  return {element:document.fullscreenElement?.id??null,w:innerWidth,h:innerHeight,ratio:devicePixelRatio,
    game:[g.left,g.top,g.width,g.height],tube:[r.left,r.top,r.width,r.height],drawn:[t.width,t.height],
    tab:window.__probe.screen.ui.settingsDialog?.tab??null};})()`);
const realKey = async (code) => {
  for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: code, code, windowsVirtualKeyCode: 27 });
};
await key('Escape'); await wait(300);
await canvasClick(120, 45, 0); await wait(300);
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await touch('touchStart', 85, 65); await touch('touchEnd', 85, 65); await wait(800);
check((await screenLayout()).element === 'game', 'a tap on FULLSCREEN puts #game in fullscreen, at the lift');
await touch('touchStart', 85, 65); await touch('touchEnd', 85, 65); await wait(800);
check((await screenLayout()).element === null, 'and a second tap leaves it');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await canvasClick(236, 86, 0); await wait(300);
await canvasClick(236, 107, 0); await wait(300);
const screenSize = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
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
  check(full.tube.every((v, i) => Math.abs(v - full.game[i]) < 0.01), 'the effect\'s canvas covers it exactly');
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
    && Math.abs(full.game[1] - (full.h - full.game[3]) / 2) <= 0.5 && full.tube.every((v, i) => Math.abs(v - full.game[i]) < 0.01),
    `at 4:3, the game canvas is 3 times 320x240, centred, the effect over it`);
}
check(await hoverAt(0.5, 0.5) === '160,100', 'at 4:3, the tube\'s middle is the screen\'s');
await canvasClick(236, 65, 0); await wait(500);
check((await screenLayout()).game[3] === 600, 'and at 16:10 again, 3 times 320x200');
check(await hoverAt(0.5, 0.5) === '160,100', 'in fullscreen, the tube\'s middle is the screen\'s');
check(await hoverAt(0.002, 0.002) === '0,0', 'and a point of its black corner is the screen\'s corner');
await realClick(197, 45); await wait(300);
check((await screenLayout()).tab === 'sound', 'a real click through the effect\'s canvas selects SOUND');
await realKey('Escape'); await wait(300);
check(!(await settingsUp()) && (await screenLayout()).element === 'game', 'a real Esc closes the settings, in fullscreen still');
await realKey('Escape'); await wait(300);
check(await settingsUp(), 'and a second opens them');
await canvasClick(120, 45, 0); await wait(300);
await cdpMouse('mousePressed', 85, 65); await cdpMouse('mouseReleased', 85, 65); await wait(800);
const windowed = await screenLayout();
check(windowed.element === null && windowed.game[2] === 960 && windowed.game[3] === 600 && windowed.tube.every((v, i) => v === windowed.game[i]),
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
    && app.tube.every((v, i) => Math.abs(v - app.game[i]) < 0.01),
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
await send('Page.navigate', { url: `${APP}?intro=0&dungeon=dm-atari` });
await wait(3500);
await evaluate(BUILD_PARTY); await wait(600);
await canvasClick(15, 15, 2); await wait(700);
await evaluate(`(()=>{const s=window.__probe.screen.ui.settings;s.update({ extras: { ...s.values.extras, showItemProperties: true } });return 1;})()`);
await canvasClick(69, 93, 0); await wait(400);
await realMouse('mousePressed', 19, 53); await wait(400);
console.log('state: eye on a weapon');   await shot('30-eye-weapon');
await realMouse('mouseReleased', 19, 53); await wait(300);

// The CRT effect's input surface. The effect's canvas is shown over the game canvas, and
// the pre-game and end-of-game screens listen on the game canvas alone (`createIntroHost`,
// `src/renderer/intro/BootSequence.ts`), so it must let a click through. Boot with the
// effect in the saved settings: the intro is drawn through it, and a real click on the
// entrance's scroll brings up the credits, as the click for frame 08 did. The record's one
// `crt`, from before the scanlines and the curve were apart, is both.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try { localStorage.setItem('csbweb_settings_v2', JSON.stringify({ crt: true })); } catch (e) {}
` });
await send('Page.navigate', { url: `${APP}?keepsaves&dungeon=dm-atari` });
await wait(9000);
console.log('state: entrance, CRT effect saved on');
check(await crtEffect() === 'on', 'the effect is on at the entrance');
check(await canvasPixels() === entrance, 'the entrance is frame 07');
await realClick(270, 192); await wait(1500);
check(await canvasPixels() === credits, 'a real click on the scroll brings up frame 08, the credits');

check(!logs.some((line) => line.startsWith('error: CSP: ')), 'nothing the content security policy refuses');

console.log('--- console errors ---');
console.log(logs.length ? logs.join('\n') : '(none)');
ws.close();
if (failures.length) {
  console.log(`--- ${failures.length} check(s) failed ---\n${failures.join('\n')}`);
  process.exit(1);
}
