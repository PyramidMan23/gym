// DESIGN CONTRACT GATE - the reference artifact is the oracle.
//
// Why this exists (2026-08-03). The v2 port ran ~20 builds re-implementing each prototype screen with
// the APP'S OWN components and tokens. Every gate stayed green and the design still drifted, because
// as Codex put it: those gates "validate internal correctness... they are testing the wrong
// specification." Mark found it by eye - "these boxes dont match up... theres so much more the more I
// look at it" - and the clearest case was the primary CTA: the design's is a GRADIENT, ours was flat.
//
// So this gate never stores a hand-authored expected value. It renders the PROTOTYPE and the APP in
// the same pinned headless browser at the same viewport, finds the same element in each by a stable
// SEMANTIC anchor (visible text), and asserts the app's geometry and paint match the prototype's.
// A plausible imitation cannot pass it, because the expectation is regenerated from the prototype
// every run.
//
// Usage:  node tests/design-contract.mjs [--app <url>] [--proto <file-url>] [--json]
//
// WHAT THIS GATE MAY AND MAY NOT COMPARE. The prototype renders as a static DEVICE MOCK: a 390x844
// rounded frame inside a 962px page, with its nav bar in NORMAL FLOW at y=848. Our app is a real page
// with a position:fixed floating nav at y=776. So ABSOLUTE Y POSITIONS ARE NOT COMPARABLE between the
// two, and this gate deliberately never asserts them - it compares size, radius, paint, type and child
// structure, which belong to the component rather than to the page around it. Learned the hard way:
// the CTA sits at exactly 787-843 in BOTH, which looks like proof the layouts agree and is not; the
// nav delta is a mock-vs-real artifact. Check occlusion against OUR app alone (elementFromPoint).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const APP = arg('--app', 'https://thesolvagroup.com/gym/?e2e=1');
const PROTO = arg('--proto', 'file:///C:/Users/markh/OneDrive/Desktop/Gym%20v2%20Standalone.html');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const W = 390, H = 844;

// Elements to compare, keyed by the text you can SEE. Text is how a human identifies them, and it is
// the only anchor that survives both a bundled prototype (generated class names) and our app.
// `kind` decides WHICH node the text resolves to, which is the whole game: the smallest element
// containing "UP NEXT" is the kicker <p>, not the card, and comparing those produces pure noise.
//   button  = the <button> itself
//   surface = the smallest element that both matches AND paints a surface (bg / gradient / border)
const ANCHORS = [
  // minW guards against the anchor resolving to a smaller lookalike: "Start" matched the tiny teal
  // Desk Reset button in both builds and quietly compared the WRONG control, hiding the real CTA.
  { id: 'cta-start',    kind: 'button',  minW: 200, match: t => /^Start\b/.test(t) && t.length < 40 },
  { id: 'desk-start',   kind: 'button',  match: t => /^Start$/.test(t) },
  { id: 'up-next-card', kind: 'surface', match: t => /^UP NEXT/.test(t) },
  // Anchor the ROW, not the card that holds it. The card's height also depends on its SIBLING row,
  // which is a populated last-session row in the prototype's demo data and an empty state in a fresh
  // app - a data difference, not a design one, and comparing it produced a permanent phantom delta.
  // A container is only comparable when both sides hold identical data; a component always is.
  { id: 'desk-reset',   kind: 'any', minW: 200, match: t => /^↺?\s*Desk Reset/.test(t) && t.length < 80 },
  { id: 'nav-bar',      kind: 'surface', match: t => /^Today Train Library Progress$/.test(t) },
  { id: 'charge-ring',  kind: 'any',     minW: 200, match: t => /WEEK CHARGED/.test(t) },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, t = 15000) { const e = Date.now() + t; let l; while (Date.now() < e) { try { return await fn(); } catch (x) { l = x; await sleep(120); } } throw l; }

async function open(url, seed) {
  const profile = mkdtempSync(join(tmpdir(), 'dc-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--allow-file-access-from-files', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
  const port = await retry(() => { const v = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]; if (!v) throw new Error('p'); return v; });
  const tab = await retry(async () => { const d = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = d.find(t => t.type === 'page'); if (!p) throw new Error('t'); return p; });
  const socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  let nextId = 0; const pending = new Map();
  socket.onmessage = e => { const m = JSON.parse(e.data); if (!m.id || !pending.has(m.id)) return; const t = pending.get(m.id); pending.delete(m.id); m.error ? t.reject(new Error(m.error.message)) : t.resolve(m); };
  const command = (method, params = {}) => new Promise((res, rej) => {
    const id = ++nextId; const w = setTimeout(() => rej(new Error('timeout ' + method)), 40000);
    pending.set(id, { resolve: v => { clearTimeout(w); res(v); }, reject: x => { clearTimeout(w); rej(x); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(2600);
  if (seed) { await evaluate(seed); await sleep(1200); }
  return { evaluate, command, close: () => { try { socket.close(); } catch {} chrome.kill(); } };
}

// Normalise so the same paint expressed differently still compares equal, but a FLAT vs GRADIENT
// difference never can.
const PROBE = `(() => {
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
  const out = {};
  const anchors = ANCHORS_JSON;
  const all = [...document.querySelectorAll('body *')].filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  });
  for (const a of anchors) {
    const fn = new Function('t', 'return (' + a.src + ')(t)');
    const paints = el => {
      const cs = getComputedStyle(el);
      if ((cs.backgroundImage || 'none') !== 'none') return true;
      if (parseFloat(cs.borderTopWidth) > 0) return true;
      const p = (cs.backgroundColor.match(/[0-9.]+/g) || []).map(Number);
      return p.length >= 3 && (p.length < 4 || p[3] > 0.02);
    };
    let hits = all.filter(el => { try { return fn(norm(el.innerText)); } catch { return false; } });
    if (a.kind === 'button') hits = hits.filter(el => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
    if (a.kind === 'surface') hits = hits.filter(paints);
    if (a.minW) hits = hits.filter(el => el.getBoundingClientRect().width >= a.minW);
    if (!hits.length) { out[a.id] = null; continue; }
    // Smallest matching box wins - but a slot wrapper and the row inside it are often the SAME size,
    // and then the tie is arbitrary: it once resolved to our #deskSlot (1 child) instead of the row
    // (3 children) and reported a phantom structural delta. Deepest wins the tie, since the deeper
    // node is the component and the shallower one is just the container holding it.
    const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    const depth = el => { let d = 0; for (let n = el; n; n = n.parentElement) d++; return d; };
    const el = hits.sort((x, y) => (area(x) - area(y)) || (depth(y) - depth(x)))[0];
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    out[a.id] = {
      text: norm(el.innerText).slice(0, 60),
      w: Math.round(r.width), h: Math.round(r.height),
      radius: cs.borderRadius,
      hasGradient: (cs.backgroundImage || 'none') !== 'none',
      backgroundImage: (cs.backgroundImage || 'none').slice(0, 120),
      backgroundColor: cs.backgroundColor,
      borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing,
      color: cs.color,
      childCount: el.children.length
    };
  }
  return out;
})()`;

// `kind` MUST be serialised too. It was omitted once and the probe silently ignored the filters,
// producing byte-identical output after a real edit - which is itself the tell that a change never
// reached the code it was meant to change.
const anchorsSrc = JSON.stringify(ANCHORS.map(a => ({ id: a.id, kind: a.kind, minW: a.minW || 0, src: a.match.toString() })));
const probeFor = () => PROBE.replace('ANCHORS_JSON', anchorsSrc);

const SEED_APP = `(() => new Promise(r => {
  const i = document.querySelector('dialog[open] input');
  if (i) { i.value='Mark'; i.dispatchEvent(new Event('input',{bubbles:true}));
    const g=[...document.querySelectorAll('dialog[open] button')].find(b=>/continue/i.test(b.innerText||'')); if(g) g.click(); }
  setTimeout(()=>{ try{navigate('today');}catch{} setTimeout(()=>r(1),600); },700);
}))()`;

const proto = await open(PROTO, null);
const protoFP = await proto.evaluate(probeFor());
proto.close();

const app = await open(APP, SEED_APP);
const appFP = await app.evaluate(probeFor());
app.close();

// Compare. Geometry within 2px (device pixel rounding), paint exactly on the properties that carry
// the design's identity.
const TOL = 2;
const findings = [];
for (const a of ANCHORS) {
  const p = protoFP[a.id], m = appFP[a.id];
  if (!p) { findings.push({ id: a.id, level: 'SKIP', why: 'not found in prototype' }); continue; }
  if (!m) { findings.push({ id: a.id, level: 'FAIL', why: 'MISSING IN APP - the prototype has this element and the app renders nothing matching' }); continue; }
  const d = [];
  if (Math.abs(p.w - m.w) > TOL) d.push(`width ${m.w} vs ${p.w}`);
  if (Math.abs(p.h - m.h) > TOL) d.push(`height ${m.h} vs ${p.h}`);
  if (p.radius !== m.radius) d.push(`radius ${m.radius} vs ${p.radius}`);
  if (p.hasGradient !== m.hasGradient) d.push(`gradient ${m.hasGradient ? 'present' : 'ABSENT'} vs ${p.hasGradient ? 'present' : 'absent'}`);
  // PAINT AND INK, added 2026-08-04 after Codex pointed out the gate CAPTURED these and never
  // compared them - so a wrong gradient angle, wrong stops, wrong tint, wrong border or wrong text
  // colour all passed silently. That is precisely the drift this gate exists to catch.
  if (p.backgroundImage !== m.backgroundImage) d.push(`background-image
            app:   ${m.backgroundImage}
            proto: ${p.backgroundImage}`);
  if (p.backgroundColor !== m.backgroundColor) d.push(`background-color ${m.backgroundColor} vs ${p.backgroundColor}`);
  if (p.borderWidth !== m.borderWidth) d.push(`border-width ${m.borderWidth} vs ${p.borderWidth}`);
  if (p.borderColor !== m.borderColor) d.push(`border-color ${m.borderColor} vs ${p.borderColor}`);
  if (p.color !== m.color) d.push(`color ${m.color} vs ${p.color}`);
  if (p.letterSpacing !== m.letterSpacing) d.push(`letter-spacing ${m.letterSpacing} vs ${p.letterSpacing}`);
  if (p.fontSize !== m.fontSize) d.push(`font-size ${m.fontSize} vs ${p.fontSize}`);
  if (p.fontWeight !== m.fontWeight) d.push(`font-weight ${m.fontWeight} vs ${p.fontWeight}`);
  if (p.childCount !== m.childCount) d.push(`children ${m.childCount} vs ${p.childCount}`);
  findings.push(d.length ? { id: a.id, level: 'FAIL', diffs: d, protoText: p.text, appText: m.text }
                         : { id: a.id, level: 'ok' });
}

if (process.argv.includes('--json')) {
  mkdirSync(new URL('../artifacts/design-qa/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../artifacts/design-qa/design-contract.json', import.meta.url),
    JSON.stringify({ proto: protoFP, app: appFP, findings }, null, 2));
}
const fails = findings.filter(f => f.level === 'FAIL');
for (const f of findings) {
  if (f.level === 'ok') { console.log(`  ok    ${f.id}`); continue; }
  if (f.level === 'SKIP') { console.log(`  skip  ${f.id} (${f.why})`); continue; }
  console.log(`  FAIL  ${f.id}${f.why ? ' - ' + f.why : ''}`);
  for (const x of f.diffs || []) console.log(`          ${x}`);
}
console.log(fails.length
  ? `design-contract FAIL: ${fails.length} of ${ANCHORS.length} anchors differ from the prototype`
  : `design-contract-ok anchors=${ANCHORS.length} viewport=${W}x${H}`);
process.exit(fails.length ? 1 : 0);
