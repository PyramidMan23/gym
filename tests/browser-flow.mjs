import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.DUCK_GYM_URL || 'http://127.0.0.1:4173/';
const profile = mkdtempSync(join(tmpdir(), 'duck-gym-e2e-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, `${BASE}?e2e=1`
], { stdio: 'ignore' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function retry(fn, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { return await fn(); } catch (error) { last = error; await sleep(100); }
  }
  throw last || new Error('Timed out');
}

let socket;
let nextId = 0;
const pending = new Map();
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text);
  return result.result?.result?.value;
}
async function waitFor(expression, timeout = 8000) {
  return retry(async () => {
    const value = await evaluate(expression);
    if (!value) throw new Error(`Waiting for: ${expression}`);
    return value;
  }, timeout);
}
async function capture(name, width, height) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await sleep(100);
  const dimensions = await evaluate(`({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})`);
  assert.ok(dimensions.scroll <= dimensions.client, `${name} overflows horizontally: ${dimensions.scroll} > ${dimensions.client}`);
  const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const folder = new URL('../artifacts/design-qa/', import.meta.url);
  mkdirSync(folder, { recursive: true });
  writeFileSync(new URL(`${name}-${width}x${height}.png`, folder), Buffer.from(shot.result.data, 'base64'));
}

try {
  const port = await retry(() => {
    const value = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
    if (!value) throw new Error('No DevTools port yet');
    return value;
  });
  const tabs = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const data = await response.json();
    const page = data.find(target => target.type === 'page' && target.url.startsWith(BASE));
    if (!page) throw new Error('Duck Gym page is not available yet');
    return page;
  });
  socket = new WebSocket(tabs.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const task = pending.get(message.id); pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message);
  };
  await command('Runtime.enable');
  await command('Page.enable');
  await waitFor(`document.readyState === 'complete' && typeof startQuickWorkout === 'function'`);

  await evaluate(`localStorage.clear(); location.reload()`);
  await waitFor(`document.readyState === 'complete' && typeof startQuickWorkout === 'function'`);
  await capture('today', 320, 800);
  await capture('today', 390, 844);
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`), true);

  await evaluate(`navigate('train'); document.querySelector('#view-train .big-button').click(); true`);
  await waitFor(`document.body.classList.contains('workout-active') && !!JSON.parse(localStorage.duckGymV2).activeSession`);

  await evaluate(`addExerciseToWorkout('b0'); true`);
  await waitFor(`document.querySelectorAll('.set-row').length === 1`);
  await evaluate(`(() => {
    const inputs=document.querySelectorAll('.set-row .set-input');
    inputs[0].value='80'; inputs[0].dispatchEvent(new Event('change',{bubbles:true}));
    inputs[1].value='8'; inputs[1].dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('.set-done').click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.set-row.completed') && JSON.parse(localStorage.duckGymV2).activeSession.exercises[0].sets[0].done === true`);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('main')).outlineStyle`), 'none', 'Programmatically focused main landmark must not draw a page-sized outline');
  await capture('active-workout', 390, 844);

  const draft = await evaluate(`JSON.parse(localStorage.duckGymV2).activeSession`);
  assert.equal(draft.exercises[0].sets[0].weight, '80');
  assert.equal(draft.exercises[0].sets[0].reps, '8');
  const replacementGuard = await evaluate(`(() => {
    const before=state.activeSession.id;
    beginSession({id:null,name:'Should not replace',exerciseIds:[]});
    return {same:state.activeSession.id===before,name:state.activeSession.name,toast:document.getElementById('toast').textContent};
  })()`);
  assert.deepEqual(replacementGuard, {same:true,name:'Quick workout',toast:'You already have a workout running'});

  await evaluate(`location.reload()`);
  await waitFor(`document.readyState === 'complete' && document.querySelector('#resumeSlot .resume-card button')`);
  await evaluate(`document.querySelector('#resumeSlot .resume-card button').click(); true`);
  await waitFor(`document.body.classList.contains('workout-active') && document.querySelector('.set-row.completed')`);

  await evaluate(`document.querySelector('.finish-button').click(); true`);
  await waitFor(`document.querySelector('#confirmDialog[open]')`);
  await evaluate(`document.querySelector('#confirmDialog .primary-button').click(); true`);
  await waitFor(`!JSON.parse(localStorage.duckGymV2).activeSession && JSON.parse(localStorage.duckGymV2).history.length === 1`);
  await waitFor(`!document.getElementById('receiptOverlay').hidden && document.querySelectorAll('.receipt-line').length === 4`);
  await evaluate(`document.querySelector('#receiptCard .primary-button').click(); true`);
  await waitFor(`document.getElementById('receiptOverlay').hidden`);
  const activeViewOutline = await evaluate(`getComputedStyle(document.querySelector('.view.active')).outlineStyle`);
  assert.equal(activeViewOutline, 'none', 'Programmatically focused screen must not draw a page-sized outline');

  const result = await evaluate(`(() => {
    const saved=JSON.parse(localStorage.duckGymV2);
    return {
      history:saved.history.length,
      completed:saved.history[0].exercises[0].sets.filter(set=>set.done).length,
      volume:DuckGymCore.calculateVolume(saved.history[0]),
      progressVisible:document.querySelector('#view-progress').classList.contains('active')
    };
  })()`);
  assert.deepEqual(result, { history: 1, completed: 1, volume: 640, progressVisible: true });
  await capture('progress', 500, 900);
  const invalidImport = await evaluate(`(async()=>{
    const malformed=new File([JSON.stringify({version:2,routines:[],history:[],customExercises:[],activeSession:'bad',preferences:{}})],'bad-duck-gym.json',{type:'application/json'});
    await importBackup(malformed);
    return {history:state.history.length,activeSession:state.activeSession,toast:document.getElementById('toast').textContent};
  })()`);
  assert.deepEqual(invalidImport, { history: 1, activeSession: null, toast: 'That backup could not be read' });
  const storageFailureHandled = await evaluate(`(() => {
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=()=>{throw new DOMException('Storage full','QuotaExceededError')};
    let returned;
    try{returned=saveState()}finally{Storage.prototype.setItem=original}
    return {returned,toast:document.getElementById('toast').textContent};
  })()`);
  assert.deepEqual(storageFailureHandled, { returned: false, toast: 'Could not save — browser storage is full' });

  const pwa = await evaluate(`(async()=>{await navigator.serviceWorker.ready;return {controlled:!!navigator.serviceWorker.controller,keys:await caches.keys()}})()`);
  assert.equal(pwa.controlled, true, 'Service worker must control the app');
  const expectedCache = /CACHE='([^']+)'/.exec(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'))[1];
  assert.ok(pwa.keys.includes(expectedCache), `Current offline cache ${expectedCache} must exist`);
  await command('Network.enable');
  await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' });
  await command('Page.reload', { ignoreCache: true });
  await sleep(500);
  await waitFor(`document.readyState === 'complete' && typeof startQuickWorkout === 'function' && document.querySelector('#todayTitle')?.textContent.length > 0 && JSON.parse(localStorage.duckGymV2).history.length === 1`);
  await command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' });
  console.log('browser-flow-ok', JSON.stringify(result), 'responsive=320,390,500', 'reduced-motion=ok', 'offline=ok');
} finally {
  try { socket?.close(); } catch {}
  chrome.kill();
  await sleep(750);
  for (let attempt = 0; attempt < 5; attempt++) {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); break; }
    catch (error) { if (attempt === 4) console.warn('temporary-profile-cleanup-warning', error.code); else await sleep(300); }
  }
}
