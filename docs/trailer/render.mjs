// Renders docs/assets/trailer.webp. trailer.html draws frame f deterministically; this drives
// headless Chrome over CDP and saves each frame as a PNG, then encode.py packs them:
//   cd docs/trailer && node render.mjs /tmp/trailer-frames all
//   python3 encode.py /tmp/trailer-frames ../assets/trailer.webp 75 24 0.8 4
// usage: node render.mjs <outDir> [all | f1,f2,... | every:N]   (CHROME=<path> to override the browser)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const outDir = resolve(process.argv[2] || 'frames');
const which = process.argv[3] || 'all';
mkdirSync(outDir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), 'trailer-chrome-'));
const chrome = spawn(process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let k = 0; k < 50; k++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.find(t => t.type === 'page')) break; } catch {} await sleep(200); }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown' || m.method === 'Runtime.consoleAPICalled') console.error(JSON.stringify(m.params).slice(0, 600)); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalv = async expr => { const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 800)); return m.result?.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
const url = 'file://' + resolve(new URL('.', import.meta.url).pathname, 'trailer.html');
await send('Page.navigate', { url });
for (let k = 0; k < 100; k++) { if (await evalv('document.readyState') === 'complete' && await evalv('typeof window.ready')) break; await sleep(100); }
const total = await evalv('window.ready');
let frames;
if (which === 'all') frames = [...Array(total).keys()];
else if (which.startsWith('every:')) { const n = +which.slice(6); frames = [...Array(total).keys()].filter(f => f % n === 0); }
else frames = which.split(',').map(Number);
const t0 = Date.now();
for (const f of frames) {
  const data = await evalv(`(renderFrame(${f}), document.getElementById('c').toDataURL('image/png'))`);
  writeFileSync(join(outDir, `f${String(f).padStart(4, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
}
console.log(`total=${total} rendered=${frames.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
ws.close(); chrome.kill();
