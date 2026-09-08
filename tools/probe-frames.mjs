// Golden-frame probe.
//
// Drives the running dev server over the Chrome DevTools Protocol — boot, enable Debug,
// inject a party (F8), open a champion's inventory, select in it, open the attack menu —
// and writes a PNG per state. `Math.random` is seeded and localStorage cleared on every
// load, so the frames are byte-identical run to run and can be compared directly.
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
// CDP_PORT overrides the DevTools port (default 9222).
//
// This is the closest thing the project has to a rendering test (PLAN.md Phase 15) — it
// caught nothing during the Phase 14 split, which is exactly what it was there to do.
import { writeFileSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9222);
const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
const page = (await res.json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
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
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${process.argv[2]}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('  wrote', name + '.png');
};
const key = (k) => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true})),1`);
const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click(),1`);
// button: 0 = left (DM mask 2), 2 = right (DM mask 1)
const canvasClick = (x, y, button = 0) => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  const sx=r.left+${x}*r.width/320, sy=r.top+${y}*r.height/200;
  for (const t of ['mousedown','mouseup']) c.dispatchEvent(new MouseEvent(t,{clientX:sx,clientY:sy,button:${button},buttons:${button===2?2:1},bubbles:true}));
  return 1;})()`);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

await send('Runtime.enable');
await send('Page.enable');
// Pin the viewport instead of inheriting whatever --window-size the browser was started
// with. Without this the frames are only comparable against captures from an identically
// launched Chrome — the committed baseline was 1600x861 purely because of one instance's
// window decoration, and any freshly started browser diffed on all five frames.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
});
// Deterministic run: no persisted UI settings / quick-save, and a seeded Math.random so
// the injected party is always the same. Frames are then byte-comparable across runs.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try { localStorage.clear(); } catch (e) {}
  let seed = 0x2545f491;
  Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
                        return ((seed >>> 0) % 1000000) / 1000000; };
` });
await send('Page.reload', { ignoreCache: true });
await wait(3500);
console.log('state: booted');            await shot('01-boot');
// Ensure Debug is ON (it persists in localStorage, so toggle only when needed).
await evaluate(`(()=>{const b=document.getElementById('btn-debug');
  if(!b.classList.contains('is-pressed')) b.click(); return b.classList.contains('is-pressed');})()`);
await wait(200);
await key('F8');             await wait(600);
console.log('state: party injected');    await shot('02-party');
// Right-click a party block (DM mask 1, button id 7) opens that champion's inventory.
await canvasClick(15, 15, 2);  await wait(700);
console.log('state: inventory');         await shot('03-inventory');
// The eye: hovering an item shows the object-info panel.
await canvasClick(15, 15, 0);  await wait(400);
console.log('state: inventory+select');  await shot('04-inventory-sel');
await canvasClick(15, 15, 2);  await wait(500);   // back out
// Champion 0's attack button (233-252 x 86-120) opens the real attack menu, listing
// that champion's legal attacks. This used to be a dev-only F7 preview of a
// placeholder panel; the panel is now `ui/Attack.ts` driven by `word20252`.
await canvasClick(240, 100, 0); await wait(600);
console.log('state: attack panel');      await shot('05-attack');

console.log('--- console errors ---');
console.log(logs.length ? logs.join('\n') : '(none)');
ws.close();
