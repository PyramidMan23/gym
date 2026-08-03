// Renders the Mark · Right-Side Chain plan sheet and MEASURES it, in both colour schemes.
//
// The unit gate proves the data. This proves the surface, because this repo has learned twice that a
// guard which never draws the new state proves nothing: contrast-guard passed 1018 elements without
// ever opening this sheet, so the two new --faint texts on it (.pd-dose, .pd-note) were unchecked.
// Run: node tests/mark-chain-surface.mjs   (needs a server on 4173)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.DUCK_GYM_URL || 'http://127.0.0.1:4173/';
const profile = mkdtempSync(join(tmpdir(), 'gym-chain-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, `${BASE}?e2e=1`], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, timeout = 12000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { return await fn(); } catch (e) { last = e; await sleep(100); } }
  throw last;
}
let socket, nextId = 0; const pending = new Map();
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const w = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
  pending.set(id, { resolve: v => { clearTimeout(w); resolve(v); }, reject: e => { clearTimeout(w); reject(e); } });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const r = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result?.result?.value;
}
const waitFor = (expr, t = 8000) => retry(async () => {
  const v = await evaluate(expr); if (!v) throw new Error(`waiting: ${expr}`); return v;
}, t);

// WCAG on the composited pixels. Alpha is resolved against the stated backdrop, never assumed opaque.
const relLum = ([r, g, b]) => {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (fg, bg) => {
  const a = relLum(fg), b = relLum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

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
    if (m.method === 'Page.javascriptDialogOpening') command('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    if (!m.id || !pending.has(m.id)) return;
    const t = pending.get(m.id); pending.delete(m.id);
    m.error ? t.reject(new Error(m.error.message)) : t.resolve(m);
  };
  await command('Runtime.enable');
  await command('Page.enable');
  await waitFor(`document.readyState==='complete' && typeof openPlan==='function'`);
  await evaluate(`window.__pre=1;localStorage.clear();setTimeout(()=>location.reload(),60);true`);
  await waitFor(`!window.__pre`);
  await waitFor(`document.readyState==='complete' && typeof openPlan==='function'`);
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  for (const scheme of ['dark', 'light']) {
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await evaluate(`document.querySelector('dialog[open]')?.close(); openPlan('plan-mark-chain'); true`);
    await waitFor(`!!document.querySelector('#sheet[open] .plan-day')`);
    // Open every day so nothing is measured or shot while collapsed.
    await evaluate(`document.querySelectorAll('#sheet .plan-day').forEach(d=>d.open=true); true`);
    await sleep(220);

    const probe = await evaluate(`(() => {
      const px = v => parseFloat(v) || 0;
      const rgb = s => (s.match(/[0-9.]+/g) || []).slice(0, 3).map(Number);
      const stack = el => { // resolve the first opaque ancestor background
        for (let n = el; n; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          const p = (bg.match(/[0-9.]+/g) || []).map(Number);
          if (p.length >= 3 && (p.length < 4 || p[3] === 1)) return p.slice(0, 3);
        }
        return [0, 0, 0];
      };
      const days = [...document.querySelectorAll('#sheet .plan-day')];
      const start = document.querySelector('#sheet .pd-start-row .workout-start');
      const dose = document.querySelector('#sheet .pd-dose');
      const note = document.querySelector('#sheet .pd-note');
      const sr = start && start.getBoundingClientRect();
      return {
        days: days.length,
        rows: days.map(d => d.querySelectorAll('.pd-scheme li').length),
        doses: document.querySelectorAll('#sheet .pd-dose').length,
        notes: document.querySelectorAll('#sheet .pd-note').length,
        starts: document.querySelectorAll('#sheet .pd-start-row .workout-start').length,
        startW: sr ? Math.round(sr.width) : 0,
        startH: sr ? Math.round(sr.height) : 0,
        doseText: dose ? dose.textContent : '',
        doseFg: dose ? rgb(getComputedStyle(dose).color) : null,
        doseBg: dose ? stack(dose) : null,
        noteFg: note ? rgb(getComputedStyle(note).color) : null,
        noteBg: note ? stack(note) : null,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    })()`);

    assert.equal(probe.days, 4, `${scheme}: expected 4 plan days, got ${probe.days}`);
    assert.deepEqual(probe.rows, [6, 6, 6, 7], `${scheme}: wrong exercise counts ${probe.rows}`);
    assert.equal(probe.starts, 4, `${scheme}: every day needs its own Start`);
    assert.equal(probe.notes, 4, `${scheme}: every day needs its note rendered`);
    assert.equal(probe.doses, 25, `${scheme}: every exercise needs a dose, got ${probe.doses}`);
    assert.ok(probe.startW >= 44 && probe.startH >= 44,
      `${scheme}: Start is ${probe.startW}x${probe.startH}, below the 44px minimum`);
    assert.match(probe.doseText, /^\d+ x \d+-\d+s?$/, `${scheme}: dose reads "${probe.doseText}"`);
    assert.ok(!probe.overflow, `${scheme}: the sheet overflows horizontally at 390px`);

    const dr = ratio(probe.doseFg, probe.doseBg), nr = ratio(probe.noteFg, probe.noteBg);
    assert.ok(dr >= 4.5, `${scheme}: .pd-dose contrast ${dr.toFixed(2)}:1 fails AA`);
    assert.ok(nr >= 4.5, `${scheme}: .pd-note contrast ${nr.toFixed(2)}:1 fails AA`);

    const shot = await command('Page.captureScreenshot', { format: 'png' });
    const folder = new URL('../artifacts/design-qa/', import.meta.url);
    mkdirSync(folder, { recursive: true });
    writeFileSync(new URL(`mark-chain-plan-${scheme}.png`, folder), Buffer.from(shot.result.data, 'base64'));
    console.log(`  ${scheme}: 4 days, 25 doses, Start ${probe.startW}x${probe.startH}px, dose ${dr.toFixed(2)}:1, note ${nr.toFixed(2)}:1`);
  }

  // Starting a day must produce the real dose, through the app's own handler - not a synthetic call.
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await evaluate(`document.querySelector('dialog[open]')?.close(); openPlan('plan-mark-chain'); true`);
  await waitFor(`!!document.querySelector('#sheet[open] .plan-day')`);
  await evaluate(`document.querySelectorAll('#sheet .plan-day').forEach(d=>d.open=true); startPlanDay('plan-mark-chain',0); true`);
  await waitFor(`!!JSON.parse(localStorage.getItem(stateKey)).activeSession`);
  const session = await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem(stateKey)).activeSession;
    return { name: s.name, n: s.exercises.length, first: s.exercises[0].exerciseId,
             sets: s.exercises[0].sets.length, target: s.exercises[0].targetReps,
             rest: s.exercises[0].restSeconds, planned: s.exercises[0].sets.every(x => x.planned === true),
             blank: s.exercises[0].sets.every(x => x.weight === '' && x.done === false) };
  })()`);
  assert.equal(session.first, 'lg22', 'Day 1 must open on the Belt Squat');
  assert.equal(session.sets, 4, `Day 1 opener must have 4 planned sets, got ${session.sets}`);
  assert.equal(session.target, '6-10');
  assert.equal(session.rest, 150);
  assert.ok(session.planned && session.blank, 'planned sets must be flagged and blank');
  assert.match(session.name, /Lower/, `session name reads "${session.name}"`);
  console.log(`  start: "${session.name}" -> ${session.n} lifts, opener ${session.sets}x${session.target} @${session.rest}s rest`);

  console.log('mark-chain-surface-ok schemes=2 days=4 doses=25 touch=44px contrast=AA start=real-dose');
} finally {
  try { socket?.close(); } catch {}
  chrome.kill();
}
