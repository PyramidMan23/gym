// DESIGN AUDIT - the full delta list per screen, generated from the prototype.
//
// design-contract.mjs gates a hand-picked set of anchors and is the CI gate. This is the working
// tool behind it: it walks BOTH documents, pairs every element it can match by visible text, and
// prints every property that differs. Codex's critique of the gate was that six anchors on one
// screen are structurally blind to most drift - this closes that by pairing everything.
//
//   node tests/design-audit.mjs [today|train|library|progress] [--app URL] [--light]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SCREEN = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'today';
const APP = arg('--app', 'http://127.0.0.1:4173/?e2e=1');
const PROTO = arg('--proto', 'file:///C:/Users/markh/OneDrive/Desktop/Gym%20v2%20Standalone.html');
const LIGHT = process.argv.includes('--light');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TAB = { today: 'Today', train: 'Train', library: 'Library', progress: 'Progress', workout: null }[SCREEN];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, t = 15000) { const e = Date.now() + t; let l; while (Date.now() < e) { try { return await fn(); } catch (x) { l = x; await sleep(120); } } throw l; }

async function open(url) {
  const profile = mkdtempSync(join(tmpdir(), 'da-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--allow-file-access-from-files', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
  const port = await retry(() => { const v = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]; if (!v) throw new Error('p'); return v; });
  const tab = await retry(async () => { const d = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = d.find(t => t.type === 'page'); if (!p) throw new Error('t'); return p; });
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  let id = 0; const pending = new Map();
  socket.onmessage = e => { const m = JSON.parse(e.data); if (!m.id || !pending.has(m.id)) return; const t = pending.get(m.id); pending.delete(m.id); m.error ? t.reject(new Error(m.error.message)) : t.resolve(m); };
  const cmd = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; const w = setTimeout(() => rej(new Error('timeout ' + method)), 40000);
    pending.set(i, { resolve: v => { clearTimeout(w); res(v); }, reject: x => { clearTimeout(w); rej(x); } });
    socket.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async expr => {
    const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  await cmd('Runtime.enable'); await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: LIGHT ? 'light' : 'dark' }] });
  await sleep(2600);
  return { evaluate, close: () => { try { socket.close(); } catch {} chrome.kill(); } };
}

// Every element that carries visible text or paints a surface, keyed by its normalised text.
const HARVEST = `(() => {
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
    const t = norm(el.innerText);
    if (!t || t.length > 60) continue;
    out.push({
      key: t, tag: el.tagName.toLowerCase(),
      paints: (cs.backgroundImage||'none')!=='none' || parseFloat(cs.borderTopWidth)>0 || (()=>{const p=(cs.backgroundColor.match(/[0-9.]+/g)||[]).map(Number);return p.length>=3&&(p.length<4||p[3]>0.02);})(),
      depth: (() => { let d = 0; for (let n = el; n; n = n.parentElement) d++; return d; })(),
      w: Math.round(r.width), h: Math.round(r.height),
      radius: cs.borderRadius, bgImage: cs.backgroundImage, bgColor: cs.backgroundColor,
      color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      letterSpacing: cs.letterSpacing, textTransform: cs.textTransform,
      borderW: cs.borderTopWidth, borderC: cs.borderTopColor,
      padding: cs.padding, kids: el.children.length
    });
  }
  return out;
})()`;

const goTo = name => `(() => { const b=[...document.querySelectorAll('button,[role=tab],a')].find(x=>(x.innerText||'').trim()===${JSON.stringify(name)}); if(b){b.click(); return true;} return false; })()`;
const SEED = `(() => new Promise(r => {
  const i = document.querySelector('dialog[open] input');
  if (i) { i.value='Ty'; i.dispatchEvent(new Event('input',{bubbles:true}));
    const g=[...document.querySelectorAll('dialog[open] button')].find(b=>/continue/i.test(b.innerText||'')); if(g) g.click(); }
  setTimeout(()=>r(1),700);
}))()`;

// The cockpit is not a tab: both sides reach it by starting a session from Today.
const ENTER_WORKOUT_PROTO = `(()=>{const c=[...document.querySelectorAll('button')].filter(b=>/^Start/.test((b.innerText||'').trim())&&b.getBoundingClientRect().width>200)[0]; if(c)c.click(); return !!c;})()`;
const ENTER_WORKOUT_APP = `(()=>{ startQuickWorkout(); addExerciseToWorkout('lg22'); addExerciseToWorkout('lg8'); return 1; })()`;

const proto = await open(PROTO);
if (SCREEN === 'workout') { await proto.evaluate(goTo('Today')); await sleep(900); await proto.evaluate(ENTER_WORKOUT_PROTO); await sleep(1600); }
else { await proto.evaluate(goTo(TAB)); await sleep(1400); }
const P = await proto.evaluate(HARVEST); proto.close();

const app = await open(APP);
await app.evaluate(SEED); await sleep(900);
if (SCREEN === 'workout') { await app.evaluate(ENTER_WORKOUT_APP); await sleep(1500); }
else { await app.evaluate(goTo(TAB)); await sleep(1200); }
const A = await app.evaluate(HARVEST); app.close();

// SMALLEST box wins for a given text, not the first in document order. A slot wrapper and the row
// inside it share the same innerText, and first-wins kept the wrapper - which reports padding 0 and
// other container properties, i.e. pure phantom deltas. Same trap the contract gate hit.
const index = list => {
  const m = new Map();
  for (const e of list) {
    const prev = m.get(e.key);
    // Smallest box wins; DEEPEST wins the tie. A wrapper and the single element inside it share the
    // same innerText and often the same box, and an arbitrary tie reported the container's inherited
    // font as drift - e.g. "QUICK START" resolved to the wrapping <div> (15px) instead of the
    // <p class="kicker"> (11px) that actually carries the design's value. Same trap as the contract gate.
    // The COMPONENT for a given text is the smallest element that PAINTS a surface; only when
    // nothing painting matches do we fall back to the smallest bare text node. Smallest-box-first
    // was wrong across documents: the design wraps chip labels in a transparent inner <span> that is
    // SMALLER than the chip, so the design side resolved to the span (r0, transparent) while ours
    // resolved to the painted chip - a phantom "radius 9 -> 0" on every chip in the app.
    const better = !prev
      || (e.paints && !prev.paints)
      || (e.paints === prev.paints && (e.w * e.h) < (prev.w * prev.h))
      || (e.paints === prev.paints && (e.w * e.h) === (prev.w * prev.h) && e.depth > prev.depth);
    if (better) m.set(e.key, e);
  }
  return m;
};
const pi = index(P), ai = index(A);
// PAINT AND TYPE ONLY. Geometry (w/h/padding/kids) is depth-sensitive: the two DOMs nest text
// differently, so the same string resolves to a <span> here and a <button> there and the sizes
// disagree for reasons that are not design drift. Those belong in design-contract.mjs, which pins
// named anchors to a known node. What survives here is what actually makes a screen LOOK different:
// colour, background, radius, type and borders - and those are depth-stable, because they inherit.
const FIELDS = ['radius', 'bgImage', 'bgColor', 'color', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'borderW', 'borderC'];
const NUM = new Set([]);

let diffs = 0, matched = 0, missing = 0;
const lines = [];
for (const [key, p] of pi) {
  const a = ai.get(key);
  if (!a) { missing++; lines.push(`  MISSING  "${key}"  (prototype has ${p.tag} ${p.w}x${p.h})`); continue; }
  // UA DEFAULTS ARE NOT DESIGN DECISIONS. The exported prototype carries NO font-family - its body
  // computes to "Times New Roman" and its buttons to Arial - so the design tool's real typeface did
  // not survive the bundle. Any prototype value that is simply the browser default therefore means
  // "unspecified here", not "specified as this". Matching them would have restyled ~150 controls to
  // a rendering artifact. Explicit values (14.5px, 11.5px, 33px, a colour, a radius) are the design.
  const UA_DEFAULT = { fontSize: '13.3333px', fontWeight: '400', letterSpacing: 'normal', textTransform: 'none' };
  const bad = [];
  for (const f of FIELDS) {
    if (UA_DEFAULT[f] !== undefined && p[f] === UA_DEFAULT[f]) continue;
    if (NUM.has(f)) { if (Math.abs(p[f] - a[f]) > 2) bad.push(`${f} ${a[f]} vs ${p[f]}`); }
    else if (p[f] !== a[f]) bad.push(`${f}\n              app:   ${a[f]}\n              proto: ${p[f]}`);
  }
  if (bad.length) { diffs++; lines.push(`  DIFF     "${key}"`); for (const b of bad) lines.push(`             ${b}`); }
  else matched++;
}
console.log(`\n=== ${SCREEN.toUpperCase()} (${LIGHT ? 'light' : 'dark'}) ===`);
console.log(lines.join('\n') || '  (no deltas)');
console.log(`\n${SCREEN}: matched=${matched} differing=${diffs} missingInApp=${missing} protoElements=${pi.size}`);
process.exit(diffs + missing ? 1 : 0);
