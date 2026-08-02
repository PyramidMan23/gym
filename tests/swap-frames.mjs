// Mid-transition frame capture. Mark reported a flash that every green gate missed, then sent a
// phone screenshot of the exact frame - which is how the double-exposure was found. This does the
// same thing on demand: fire a real tab swap and screenshot every ~40ms through it, so the frames
// can be LOOKED AT instead of reasoned about. Not a gate; a camera.
//   node tests/swap-frames.mjs [fromView] [toView] [scrollY]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [from = 'library', to = 'today', scroll = '260'] = process.argv.slice(2);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.DUCK_GYM_URL || 'http://127.0.0.1:4173/';
const profile = mkdtempSync(join(tmpdir(), 'gym-frames-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, `${BASE}?e2e=1`], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, timeout = 12000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { return await fn(); } catch (e) { last = e; await sleep(100); } }
  throw last;
}
let socket, nextId = 0; const pending = new Map();
const command = (method, params = {}) => new Promise((res, rej) => {
  const id = ++nextId;
  const t = setTimeout(() => { pending.delete(id); rej(new Error(`timeout ${method}`)); }, 20000);
  pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expr => (await command('Runtime.evaluate',
  { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

try {
  const port = await retry(() => {
    const v = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
    if (!v) throw new Error('no port'); return v;
  });
  const tab = await retry(async () => {
    const d = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = d.find(t => t.type === 'page' && t.url.startsWith(BASE));
    if (!p) throw new Error('no page'); return p;
  });
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  socket.onmessage = e => {
    const m = JSON.parse(e.data);
    if (!m.id || !pending.has(m.id)) return;
    const t = pending.get(m.id); pending.delete(m.id);
    m.error ? t.rej(new Error(m.error.message)) : t.res(m);
  };
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await retry(async () => { if (!await evaluate(`typeof navigate === 'function'`)) throw new Error('not ready'); });
  // First run opens the profile sheet; name it so nothing overlays the capture.
  if (await evaluate(`document.getElementById('sheet').open`)) {
    await evaluate(`submitFirstRun('Tester'); true`);
    await sleep(300);
  }
  await evaluate(`navigate('${from}'); true`);
  await sleep(700);
  await evaluate(`scrollTo({top:${scroll},behavior:'instant'}); true`);
  await sleep(200);
  const startedAt = await evaluate(`scrollY`);

  const folder = new URL('../artifacts/design-qa/swap-frames/', import.meta.url);
  mkdirSync(folder, { recursive: true });
  await evaluate(`navigate('${to}'); true`);
  for (let i = 0; i < 9; i++) {
    const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(new URL(`${from}-to-${to}-${String(i * 40).padStart(3, '0')}ms.png`, folder),
      Buffer.from(shot.result.data, 'base64'));
    await sleep(40);
  }
  console.log(`frames-ok ${from}->${to} scrolledFrom=${startedAt} 9 frames @40ms -> artifacts/design-qa/swap-frames/`);
} finally {
  try { socket && socket.close(); } catch {}
  chrome.kill();
}
