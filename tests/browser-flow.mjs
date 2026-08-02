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
function command(method, params = {}, tmo = 30000) {
  const id = ++nextId;
  // 30s watchdog on every CDP command: a renderer wedge or dropped response otherwise hangs the
  // whole run SILENTLY until the outer process timeout - a named timeout is diagnosable, a silent
  // hang is not (2026-07-28, found while chasing a stall that produced zero output for 7 minutes).
  return new Promise((resolve, reject) => {
    const watchdog = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, tmo);
    pending.set(id, { resolve: v => { clearTimeout(watchdog); resolve(v); }, reject: e => { clearTimeout(watchdog); reject(e); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, tmo = 30000) {
  let result;
  try { result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, tmo); }
  catch (e) { throw new Error(`${e.message} :: ${String(expression).slice(0, 90).replace(/\s+/g, ' ')}`); }
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text);
  return result.result?.result?.value;
}
// Trusted hit-tested click via CDP - an invisible blocking layer makes this fail where element.click() would pass.
async function realClick(selector) {
  console.error('>>rc-eval1 ', selector);
  const rect = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  if (!rect) throw new Error(`realClick: no element for ${selector}`);
  const onTarget = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const hit=document.elementFromPoint(${rect.x},${rect.y});return !!hit&&(hit===el||el.contains(hit)||hit.contains(el));})()`);
  if (!onTarget) throw new Error(`realClick: ${selector} is covered by another element at its center`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
}
async function waitFor(expression, timeout = 8000) {
  // Short per-poll timeout: an evaluate issued mid-navigation can have its response dropped when
  // the context is destroyed - with the default 30s watchdog one dropped poll eats the whole retry
  // window and the run dies. 1.2s polls fail fast and the fresh context answers the retry
  // (2026-07-28, the "silent 7-minute hang" root cause).
  return retry(async () => {
    const value = await evaluate(expression, 1200);
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
    if (message.method === 'Page.javascriptDialogOpening') {
      // A surprise dialog wedges headless Chrome forever if unhandled - accept it and say so loudly.
      console.error('!!DIALOG auto-accepted:', (message.params && message.params.message) || '');
      command('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    } else if (message.method && /crashed|detached/i.test(message.method)) console.error('!!EVENT', message.method);
    if (!message.id || !pending.has(message.id)) return;
    const task = pending.get(message.id); pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message);
  };
  await command('Runtime.enable');
  await command('Page.enable');
  await waitFor(`document.readyState === 'complete' && typeof startQuickWorkout === 'function'`);

  await evaluate(`window.__preReload=1;localStorage.clear();setTimeout(()=>location.reload(),60);true`);
  await waitFor(`!window.__preReload`);
  await waitFor(`document.readyState === 'complete' && typeof startQuickWorkout === 'function'`);
  // Track B: a clean boot opens the first-run "Who's training?" sheet. Name the migrated/created
  // profile programmatically so the modal doesn't block hit-tested clicks later (does not weaken any guard).
  await waitFor(`document.getElementById('sheet').open && typeof submitFirstRun === 'function'`);
  await evaluate(`submitFirstRun('Tester'); true`);
  await waitFor(`!document.getElementById('sheet').open && typeof stateKey === 'string' && !!stateKey`);
  await capture('today', 320, 800);
  await capture('today', 390, 844);

  // ---- Drag to reorder (2026-08-01). Runs BEFORE the reduced-motion override so the animated path
  // (FLIP gap + settle) is the one under test. A trusted CDP mouse drag on the grip: element.click()
  // and synthetic events would both miss the pointer-capture + autoscroll machinery entirely.
  await evaluate(`(()=>{if(state.activeSession)state.activeSession=null;startQuickWorkout();
    addExerciseToWorkout('ch1');addExerciseToWorkout('ch2');addExerciseToWorkout('ch3');})();true`);
  await waitFor(`document.querySelectorAll('#workoutExercises .workout-exercise').length === 3`);
  assert.deepEqual(await evaluate(`state.activeSession.exercises.map(e=>e.exerciseId)`), ['ch1', 'ch2', 'ch3']);
  // Index mapping must come from the stamped attribute: check-in and bookend cards share the container.
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#workoutExercises .workout-exercise')].map(c=>c.dataset.index)`), ['0', '1', '2']);
  // html{scroll-behavior:smooth}: scroll first, settle, THEN measure, or every coordinate is pre-scroll.
  await evaluate(`document.querySelector('#workoutExercises .workout-exercise[data-index="2"]').scrollIntoView({block:'center',behavior:'instant'});true`);
  await sleep(150);
  const grip = await evaluate(`(()=>{
    const card=document.querySelector('#workoutExercises .workout-exercise[data-index="2"]');
    const g=card.querySelector('.exercise-grip').getBoundingClientRect();
    const head=document.querySelector('.workout-header').getBoundingClientRect();
    return {x:Math.round(g.left+g.width/2), y:Math.round(g.top+g.height/2), top:Math.round(head.bottom)+20,
      touch:getComputedStyle(card.querySelector('.exercise-grip')).touchAction, w:Math.round(g.width), h:Math.round(g.height)};
  })()`);
  assert.ok(grip.w >= 44 && grip.h >= 44, `the grip must be a 44px touch target, got ${grip.w}x${grip.h}`);
  assert.equal(grip.touch, 'none', 'touch-action:none must be scoped to the grip');
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.x, y: grip.y, button: 'left', clickCount: 1 });
  // Steps first (the lift needs a move past the slop), then park in the top autoscroll band and hold:
  // the rAF loop drives the page to the top, which is what puts the card in slot 0.
  for (const y of [grip.y - 10, grip.y - 80, grip.y - 200, grip.top]) {
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x, y: Math.max(grip.top, y), button: 'left', buttons: 1 });
    await sleep(90);
  }
  await sleep(1200);
  const midDrag = await evaluate(`(()=>{const c=document.querySelector('.workout-exercise.drag-lift');
    return {lifted:!!c, ink:document.body.classList.contains('reordering'), scroll:window.scrollY,
      shifted:[...document.querySelectorAll('#workoutExercises .workout-exercise')].filter(e=>e.style.transform.includes('translateY(')).length};})()`);
  assert.equal(midDrag.lifted, true, 'the dragged card must be lifted mid-gesture');
  assert.equal(midDrag.ink, true, 'the body must be in the reordering state mid-gesture');
  assert.equal(midDrag.scroll, 0, `autoscroll must have driven the page to the top, still at ${midDrag.scroll}`);
  assert.equal(midDrag.shifted, 3, 'the lifted card plus both displaced siblings must all be transformed');
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.x, y: grip.top, button: 'left', clickCount: 1 });
  await waitFor(`JSON.parse(localStorage.getItem(stateKey)).activeSession.exercises.map(e=>e.exerciseId).join() === 'ch3,ch1,ch2'`);
  const dropped = await evaluate(`({
    order:state.activeSession.exercises.map(e=>e.exerciseId),
    sheetOpen:document.getElementById('sheet').open,
    stray:[...document.querySelectorAll('#workoutExercises *')].filter(e=>e.style.transform||e.style.transition).map(e=>e.className),
    classes:document.querySelectorAll('.drag-lift,.drag-settle').length,
    body:document.body.classList.contains('reordering')
  })`);
  assert.deepEqual(dropped.order, ['ch3', 'ch1', 'ch2'], 'a drag must MOVE the exercise, not swap it');
  assert.equal(dropped.sheetOpen, false, 'the drop must not leak a ghost click into the grip menu');
  assert.deepEqual(dropped.stray, [], `no zombie inline transforms may survive the drop: ${JSON.stringify(dropped.stray)}`);
  assert.equal(dropped.classes, 0, 'no drag classes may survive the drop');
  assert.equal(dropped.body, false, 'the reordering state must be cleared after the drop');
  // A plain tap on the grip is the no-pointer fallback: it must still open the move options.
  await realClick('#workoutExercises .workout-exercise[data-index="0"] .exercise-grip');
  await waitFor(`document.getElementById('sheet').open`);
  await evaluate(`closeSheet();true`);
  // Cancel paths leave the state alone and the DOM clean.
  for (const [name, cancel] of [
    ['Escape', `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`],
    ['hidden tab', `Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden`]
  ]) {
    const cancelled = await evaluate(`(()=>{
      const card=document.querySelector('#workoutExercises .workout-exercise[data-index="0"]');
      const g=card.querySelector('.exercise-grip');
      g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:7,clientY:100,button:0}));
      document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:7,clientY:400,button:0}));
      const lifted=!!document.querySelector('.workout-exercise.drag-lift');
      ${cancel};
      return {lifted, order:state.activeSession.exercises.map(e=>e.exerciseId),
        stray:[...document.querySelectorAll('#workoutExercises *')].filter(e=>e.style.transform||e.style.transition).length,
        classes:document.querySelectorAll('.drag-lift,.drag-settle').length,
        body:document.body.classList.contains('reordering')};
    })()`);
    assert.equal(cancelled.lifted, true, `${name}: the drag must have been live before cancelling`);
    assert.deepEqual(cancelled.order, ['ch3', 'ch1', 'ch2'], `${name}: a cancelled drag must not change the order`);
    assert.equal(cancelled.stray, 0, `${name}: a cancelled drag must leave no zombie transforms`);
    assert.equal(cancelled.classes, 0, `${name}: a cancelled drag must leave no drag classes`);
    assert.equal(cancelled.body, false, `${name}: a cancelled drag must clear the reordering state`);
  }
  await evaluate(`window.__preReload=1;setTimeout(()=>location.reload(),60);true`);
  await waitFor(`!window.__preReload`);
  await waitFor(`document.readyState === 'complete' && typeof startQuickWorkout === 'function'`);
  assert.deepEqual(await evaluate(`state.activeSession.exercises.map(e=>e.exerciseId)`), ['ch3', 'ch1', 'ch2'],
    'the reordered list must survive a reload - the drop has to have committed through saveState');
  await evaluate(`state.activeSession=null;saveState();navigate('today');true`);
  await waitFor(`!document.body.classList.contains('workout-active')`);

  // SLICE NAV gate. A guard that never renders the new state proves nothing (07-23 lesson), so
  // this DRAWS the minimised capsule and reads it back rather than trusting the stylesheet.
  const nav = await evaluate(`(() => {
    closeSheet();
    const bar=document.getElementById('bottomNav');
    const active=bar.querySelector('button.active'), idle=bar.querySelector('button:not(.active)');
    const cs=getComputedStyle(bar);
    const pill=s=>{const p=getComputedStyle(s,'::before');return {opacity:p.opacity,transform:p.transform};};
    const rest={radius:cs.borderTopLeftRadius,transform:cs.transform,
      label:getComputedStyle(active.querySelector('small')).opacity,
      cursor:getComputedStyle(document.getElementById('navCursor')).display,
      activePill:pill(active),idlePill:pill(idle)};
    document.body.classList.add('nav-min');
    return {rest};
  })()`);
  // The capsule minimises through a 360ms transition, so a read taken in the same tick as the
  // class add returns the START value (none). Poll for the transition to have actually moved.
  await waitFor(`(()=>{const b=document.getElementById('bottomNav');
    return getComputedStyle(b).transform !== 'none'
      && parseFloat(getComputedStyle(b.querySelector('button.active small')).opacity) === 0;})()`);
  nav.min = await evaluate(`(() => {
    const bar=document.getElementById('bottomNav');
    const out={transform:getComputedStyle(bar).transform,
      label:getComputedStyle(bar.querySelector('button.active small')).opacity};
    document.body.classList.remove('nav-min');
    return out;
  })()`);
  assert.equal(nav.rest.radius, '999px', 'the nav must be a full capsule, not a rounded rectangle');
  assert.equal(nav.rest.cursor, 'none', 'the sliding cursor is replaced by the per-tab pill and must not paint');
  assert.equal(nav.rest.activePill.opacity, '1', 'the active tab must actually render its concentric pill');
  assert.equal(nav.rest.idlePill.opacity, '0', 'an idle tab must not render a pill');
  assert.notEqual(nav.rest.activePill.transform, nav.rest.idlePill.transform,
    'the pill must spring from scale(.7) to scale(1) - identical transforms mean the animation never ran');
  assert.equal(nav.rest.label, '1', 'labels are visible at rest (SliceCo parity)');
  assert.equal(nav.rest.transform, 'none', 'the capsule sits untransformed at rest, so minimise is purely additive');
  assert.notEqual(nav.min.transform, 'none', 'body.nav-min must actually transform the capsule');
  assert.equal(nav.min.label, '0', 'minimised labels fade out');

  // SLICE PANE gate, v3 (no-overlay design). v1 asserted animation NAMES; v2 asserted the curtain
  // was opaque - and the OPACITY WAS THE BUG. This app draws content over two fixed radial blooms
  // at z-index -1, so ANY opaque full-screen overlay hides them and fading it washes a 16% amber
  // tint across the whole screen. v3 therefore asserts the invariant that outlaws the whole class:
  // during a swap NOTHING may cover the page, and no pane may animate opacity at all. Only
  // transform may move.
  const pane = await evaluate(`(() => {
    navigate('library');                     // 254 catalogue rows: the tallest view
    const before=document.querySelectorAll('#view-library.active > *').length;
    const kids=[...document.querySelectorAll('#view-library.active > *')]
      .map(el=>getComputedStyle(el).animationName).filter(n=>n&&n!=='none');
    // behavior:'instant' or the html{scroll-behavior:smooth} rule makes the very next scrollY
    // read return 0 - the smooth animation has not moved yet (the w4b readback-lie gotcha).
    scrollTo({top:120,behavior:'instant'});
    navigate('progress');                    // forward: library(2) -> progress(3)
    // Mid-swap: how many views are painted, and is anything covering the page?
    const painted=[...document.querySelectorAll('.view')].filter(v=>getComputedStyle(v).display!=='none');
    const ics=getComputedStyle(document.getElementById('view-progress'));
    // The bloom must be reachable at the viewport corner - if an overlay covers it, that IS the flash.
    const corner=document.elementFromPoint(3,innerHeight-3);
    const out={children:before,animatedChildren:kids,
      paintedViews:painted.map(v=>v.id),
      incomingAnim:ics.animationName,incomingOpacity:ics.opacity,
      // Every keyframe running on the incoming pane must touch transform only, never opacity.
      incomingAnimatesOpacity:ics.animationName!=='none'&&[...document.styleSheets]
        .flatMap(s=>{try{return [...s.cssRules]}catch(e){return []}})
        .filter(r=>r.type===7&&r.name===ics.animationName)
        .some(r=>/opacity/.test(r.cssText)),
      cornerIsOverlay:!!(corner&&corner.classList&&corner.classList.contains('leaving')),
      dirFwd:document.getElementById('main').classList.contains('pane-fwd')};
    navigate('train');                       // back: progress(3) -> train(1)
    out.dirBack=document.getElementById('main').classList.contains('pane-back');
    // The droplet: fire a real pointerdown on an idle tab, SliceCo's trigger.
    const tab=document.querySelector('.bottom-nav button:not(.active)');
    tab.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    out.ring=tab.classList.contains('ring');
    out.ringAnim=getComputedStyle(tab,'::after').animationName;
    return out;
  })()`);
  assert.ok(pane.children > 3, 'Library must actually have children for the stagger check to mean anything');
  assert.deepEqual(pane.animatedChildren, [],
    'no direct child of a view may carry its own entrance animation - the staggered `rise` on N children was the FIRST flash');
  assert.deepEqual(pane.paintedViews, ['view-progress'],
    'exactly ONE view may be painted mid-swap - a second painted view is an overlay, and an overlay over the bloom was the SECOND flash');
  assert.equal(pane.cornerIsOverlay, false,
    'nothing may cover the viewport corner mid-swap: an opaque layer hides the radial bloom and fading it tints the whole screen');
  assert.equal(pane.incomingAnim, 'paneSlideRight', 'a forward swap slides the incoming view in from the right');
  assert.equal(pane.incomingOpacity, '1', 'the incoming pane is fully opaque at all times');
  assert.equal(pane.incomingAnimatesOpacity, false,
    'the swap animation must touch TRANSFORM ONLY - any opacity keyframe re-introduces a blend or a tint');
  assert.equal(pane.dirFwd, true, 'today -> progress is a forward move');
  assert.equal(pane.dirBack, true, 'progress -> train is a backward move');
  assert.equal(pane.ring, true, 'pointerdown on a tab must arm the press ring');
  assert.equal(pane.ringAnim, 'pressRing', 'the armed ring must actually run the droplet animation');
  await evaluate(`navigate('today'); true`);

  // The probe is the reason the capsule does not sit under Android's system nav buttons.
  // Assert it RAN, and that the bar's resting position is DERIVED from what it wrote - a
  // token that exists but nothing consumes would sail through a naive presence check.
  const inset = await evaluate(`(() => {
    const root=document.documentElement;
    const written=root.style.getPropertyValue('--sai-bottom');
    const bar=document.getElementById('bottomNav');
    const at=()=>Math.round(innerHeight - bar.getBoundingClientRect().bottom);
    const before=at();
    root.style.setProperty('--sai-bottom','24px');
    const after=at();
    root.style.setProperty('--sai-bottom',written);
    return {written,before,after};
  })()`);
  // The material. Headless does not composite backdrop-filter, so a screenshot can never
  // prove the blur - these read the resolved values instead. An opaque bar is the failure
  // that shipped first: the blur has nothing to refract and it renders as a flat lozenge.
  const material = await evaluate(`(() => {
    const cs=getComputedStyle(document.getElementById('bottomNav'));
    return {bg:cs.backgroundColor,filter:cs.backdropFilter||cs.webkitBackdropFilter,image:cs.backgroundImage};
  })()`);
  assert.match(material.bg, /^rgba\(/, 'the capsule must be translucent - an opaque bar is not glass');
  assert.ok(parseFloat(material.bg.split(',')[3]) < 0.7, 'and translucent enough to actually refract');
  assert.match(material.filter, /blur\(24px\)/, 'SliceCo blur radius');
  assert.match(material.filter, /saturate\(1\.8\)/, 'SliceCo saturation lift (Chrome normalises 180% to 1.8)');
  assert.match(material.image, /gradient/, 'the specular sheen must survive - background-color alone flattens it');

  assert.match(inset.written, /^[\d.]+px$/, 'the probe must write a resolved pixel inset onto the root');
  assert.equal(inset.after - inset.before, 24,
    'the capsule must ride on --sai-bottom - an unchanged position means it still reads raw env()');

  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`), true);

  await evaluate(`navigate('train'); document.querySelector('#view-train .big-button').click(); true`);
  await waitFor(`document.body.classList.contains('workout-active') && !!JSON.parse(localStorage.getItem(stateKey)).activeSession`);

  await evaluate(`addExerciseToWorkout('ch1'); true`);
  await waitFor(`document.querySelectorAll('.set-row').length === 1`);
  await evaluate(`(() => {
    const inputs=document.querySelectorAll('.set-row .set-input');
    inputs[0].value='80'; inputs[0].dispatchEvent(new Event('change',{bubbles:true}));
    inputs[1].value='8'; inputs[1].dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('.set-done').click();
    return true;
  })()`);
  await waitFor(`document.querySelector('.set-row.completed') && JSON.parse(localStorage.getItem(stateKey)).activeSession.exercises[0].sets[0].done === true`);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('main')).outlineStyle`), 'none', 'Programmatically focused main landmark must not draw a page-sized outline');
  await capture('active-workout', 390, 844);

  // Mid-workout tab switch (2026-07-28): NO confirm() dialog may gate it (the browser-chrome
  // "thesolvagroup.com says" popup was the most webpage-looking moment in the app), and the return
  // chip must appear on the other tab and lead straight back to the running session.
  await evaluate(`navigate('today'); true`);
  const chip = await evaluate(`(()=>{const c=document.getElementById('returnChip');
    return {visible:!!c&&!c.hidden,onWorkout:document.body.classList.contains('workout-active'),
      text:c?c.textContent:''};})()`);
  assert.equal(chip.onWorkout, false, 'tab switch mid-workout must actually leave the workout view - no confirm gate');
  assert.equal(chip.visible, true, 'the return chip must show on other tabs while a session runs');
  assert.match(chip.text, /On the clock|Paused/, 'chip must state the session state in words');
  await realClick('#returnChip');
  await waitFor(`document.body.classList.contains('workout-active')`);
  assert.equal(await evaluate(`document.getElementById('returnChip').hidden`), true, 'chip hides on the workout screen itself');


  const draft = await evaluate(`JSON.parse(localStorage.getItem(stateKey)).activeSession`);
  assert.equal(draft.exercises[0].sets[0].weight, '80');
  assert.equal(draft.exercises[0].sets[0].reps, '8');
  // Carry-forward: completing set 1 pre-fills the next (auto-added) set with today's numbers, flagged
  // prefilled so it renders muted. Cells are now readonly (tap → numeric pad), but JS value+change still logs.
  assert.equal(draft.exercises[0].sets[1].weight, '80', 'next set should carry forward the completed weight');
  assert.equal(draft.exercises[0].sets[1].reps, '8', 'next set should carry forward the completed reps');
  assert.equal(draft.exercises[0].sets[1].prefilled, true, 'carried-forward set must be flagged prefilled');
  assert.equal(await evaluate(`document.querySelector('.set-input[data-key="weight"]').readOnly`), true, 'weight cell must be readonly so a tap opens the pad, not the keyboard');
  const replacementGuard = await evaluate(`(() => {
    const before=state.activeSession.id;
    beginSession({id:null,name:'Should not replace',exerciseIds:[]});
    return {same:state.activeSession.id===before,name:state.activeSession.name,toast:document.getElementById('toast').textContent};
  })()`);
  assert.deepEqual(replacementGuard, {same:true,name:'Quick workout',toast:'You already have a workout running'});

  await evaluate(`window.__preReload=1;setTimeout(()=>location.reload(),60);true`);
  await waitFor(`!window.__preReload`);
  await waitFor(`document.readyState === 'complete' && document.querySelector('#resumeSlot .resume-card button')`);
  await realClick('#resumeSlot .resume-card button');
  await waitFor(`document.body.classList.contains('workout-active') && document.querySelector('.set-row.completed')`);

  await realClick('.finish-button');
  await waitFor(`document.querySelector('#confirmDialog[open]')`);
  await realClick('#confirmDialog .primary-button');
  await waitFor(`!JSON.parse(localStorage.getItem(stateKey)).activeSession && JSON.parse(localStorage.getItem(stateKey)).history.length === 1`);
  await waitFor(`!document.getElementById('receiptOverlay').hidden && document.querySelectorAll('.receipt-line').length === 4`);
  // Verdict layer (council 2026-07-28): a first-exposure session must read as a baseline, in words.
  const verdict = await evaluate(`(()=>{const v=document.querySelector('.receipt-verdict');
    return v?{text:v.querySelector('strong').textContent,proof:v.querySelector('small')?.textContent||''}:null;})()`);
  assert.ok(verdict, 'the receipt must carry a verdict block');
  assert.equal(verdict.text, 'Baseline set.', 'first exposure must be a baseline, not a fake win');
  assert.match(verdict.proof, /Progression starts next time/);
  await realClick('#receiptCard .primary-button');
  await waitFor(`document.getElementById('receiptOverlay').hidden`);
  // Hit-test guard: hidden overlays must not eat taps (regression: receipt-overlay display:grid beat [hidden]).
  const hitTest = await evaluate(`(() => {
    const blockers=[];
    for(const b of document.querySelectorAll('.bottom-nav button')){
      const r=b.getBoundingClientRect();
      const el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      if(!el||!(el===b||b.contains(el)))blockers.push((el&&(el.id||el.className))||'nothing');
    }
    return blockers;
  })()`);
  assert.deepEqual(hitTest, [], `Bottom-nav buttons must be hit-testable, blocked by: ${hitTest}`);
  const hiddenBlockers = await evaluate(`(() => {
    return [...document.querySelectorAll('[hidden]')].filter(el=>{
      const cs=getComputedStyle(el);
      return cs.display!=='none'&&cs.pointerEvents!=='none';
    }).map(el=>el.id||el.className);
  })()`);
  assert.deepEqual(hiddenBlockers, [], `[hidden] elements must actually be display:none: ${hiddenBlockers}`);
  const activeViewOutline = await evaluate(`getComputedStyle(document.querySelector('.view.active')).outlineStyle`);
  assert.equal(activeViewOutline, 'none', 'Programmatically focused screen must not draw a page-sized outline');
  const result = await evaluate(`(() => {
    const saved=JSON.parse(localStorage.getItem(stateKey));
    return {
      history:saved.history.length,
      completed:saved.history[0].exercises[0].sets.filter(set=>set.done).length,
      volume:DuckGymCore.calculateVolume(saved.history[0]),
      progressVisible:document.querySelector('#view-progress').classList.contains('active')
    };
  })()`);
  assert.deepEqual(result, { history: 1, completed: 1, volume: 640, progressVisible: true });
  await capture('progress', 500, 900);
  // ---- Routine plumbing + Desk Reset (2026-07-28). All three were Mark's own report: no gap under
  // the Desk Reset row, no way to save the workout he was doing, and a Desk Reset that "stayed a
  // workout" with no sign it was a plan. These assert the WIRING, which the unit tests cannot see.
  const deskAndRoutines = await evaluate(`(() => {
    navigate('today'); renderToday();
    const desk=document.querySelector('.desk-card');
    const gap=desk?parseFloat(getComputedStyle(desk).marginBottom):0;
    const hasPlanEntry=!!document.querySelector('.desk-menu');
    // Starting a Desk Reset must NOT offer a warm-up: the session already is mobility work.
    if(state.activeSession) state.activeSession=null;
    startDeskReset();
    const deskStrip=!!document.querySelector('.bookend-strip');
    // A mix by design: the three holds log SECONDS, the three slow rep drills log reps. Assert the
    // seconds axis actually reaches the logger, or a hold silently records reps again.
    // A mix by design: the three holds log SECONDS, the three slow rep drills log reps. Assert the
    // seconds axis actually reaches the logger, or a hold silently records reps again.
    const deskSecs=state.activeSession.exercises.some(e=>DuckGymCore.isTimed(e.exerciseId))
      && [...document.querySelectorAll('.set-grid.header span')].some(s=>s.textContent==='Sec');
    // A loaded session still gets one.
    state.activeSession=null; startQuickWorkout(); addExerciseToWorkout('lg4');
    const loadedStrip=!!document.querySelector('.bookend-strip');
    // Save the RUNNING workout as a routine.
    const before=state.routines.length;
    saveActiveAsRoutine();
    const saved=state.routines[0];
    // Seeding a brand-new routine from a plan day.
    openRoutineEditor();
    const seedOptions=document.querySelectorAll('#routineSeed option').length;
    const firstSeed=document.querySelectorAll('#routineSeed option')[1];
    seedRoutine(firstSeed.value);
    const seededCount=routineDraft.exerciseIds.length;
    closeSheet();
    state.activeSession=null; saveState();
    return {gap,hasPlanEntry,deskStrip,deskSecs,loadedStrip,
      addedRoutine:state.routines.length-before,savedIds:saved?saved.exerciseIds.length:0,
      seedOptions,seededCount,nameOpensMenu:!!document.querySelector('.routine-open')};
  })()`);
  assert.ok(deskAndRoutines.gap >= 8, `Desk Reset row must clear the card below it, got ${deskAndRoutines.gap}px`);
  assert.equal(deskAndRoutines.hasPlanEntry, true, 'Desk Reset must offer a way to see it as a plan');
  assert.equal(deskAndRoutines.deskStrip, false, 'a drill-only session must not propose a warm-up');
  assert.equal(deskAndRoutines.deskSecs, true, 'every Desk Reset drill must log in seconds');
  assert.equal(deskAndRoutines.loadedStrip, true, 'a loaded session must still propose a warm-up');
  assert.equal(deskAndRoutines.addedRoutine, 1, 'saving the running workout must add exactly one routine');
  assert.ok(deskAndRoutines.savedIds > 0, 'the saved routine must carry the workout exercises');
  assert.ok(deskAndRoutines.seedOptions > 1, 'the routine editor must offer plans/workouts/logged sessions to start from');
  assert.ok(deskAndRoutines.seededCount > 0, 'picking a seed must populate the draft');
  assert.equal(deskAndRoutines.nameOpensMenu, true, 'a routine name must be its own tap target for options');
  // ---- Curated workouts (council 2026-08-01). A workout is a STRUCTURE, so the wiring that matters
  // is: the section renders, the goal chips filter and RESET, the sheet offers the variant control
  // and the disclaimer, and one tap opens a session whose set counts came from the scheme.
  const workoutsUi = await evaluate(`(() => {
    if(state.activeSession) state.activeSession=null;
    navigate('train'); renderTrain();
    const chips=[...document.querySelectorAll('#workoutGoals .filter-chip')].map(c=>c.textContent);
    const cards=document.querySelectorAll('#workoutList .workout-card').length;
    const starts=document.querySelectorAll('#workoutList .workout-start').length;
    // A goal chip filters; a fresh Train render must clear it, or a stale chip hides 12 workouts.
    setWorkoutGoal('STRENGTH');
    const filtered=document.querySelectorAll('#workoutList .workout-card').length;
    renderTrain();
    return {chips,cards,starts,filtered,reset:document.querySelectorAll('#workoutList .workout-card').length,
      seeds:routineSeeds().filter(s=>s.key.startsWith('wk:')).length};
  })()`);
  assert.equal(workoutsUi.cards, 16, 'Train must show all 16 curated workouts');
  assert.equal(workoutsUi.starts, 16, 'every workout card needs its own one-tap Start');
  assert.equal(workoutsUi.chips[0], 'ALL', 'the goal chip row must lead with ALL');
  assert.equal(workoutsUi.chips.length, 9, 'ALL plus every distinct goal, in data order');
  assert.equal(workoutsUi.filtered, 3, 'a goal chip must actually filter the list');
  assert.equal(workoutsUi.reset, 16, 'a fresh Train render must reset the goal filter to ALL');
  assert.equal(workoutsUi.seeds, 16, 'the routine editor must be able to start from any workout');
  await evaluate(`openWorkoutDetail('wk-str-lower'); true`);
  await waitFor(`document.getElementById('sheet').open && !!document.querySelector('.vol-seg')`);
  const workoutSheet = await evaluate(`(() => {
    const seg=[...document.querySelectorAll('.vol-seg .filter-chip')];
    const label=b=>b.textContent.replace('✓ ','');
    return {segments:seg.map(label),active:seg.filter(b=>b.classList.contains('active')).map(label),
      disclaimer:(document.querySelector('.workout-disclaimer')||{}).textContent||'',
      rows:document.querySelectorAll('#sheetContent .selected-row').length,
      planned:document.querySelectorAll('#sheetContent .mv-row').length};
  })()`);
  assert.deepEqual(workoutSheet.segments, ['Reduced', 'Base', 'Expanded'], 'the detail sheet must offer all three volume variants');
  assert.deepEqual(workoutSheet.active, ['Base'], 'a profile with a logged session and no injury defaults to the written volume');
  assert.equal(workoutSheet.disclaimer,
    'General programming, not individualised advice. Loads come from your own history.',
    'the workout sheet must carry the disclaimer verbatim');
  assert.equal(workoutSheet.rows, 5, 'the sheet must list the resolved exercises');
  assert.ok(workoutSheet.planned > 0, 'the sheet must show the planned per-muscle board');

  const startedWorkout = await evaluate(`(() => {
    startWorkout('wk-str-lower');
    const ex=state.activeSession.exercises;
    return {routineId:state.activeSession.routineId,name:state.activeSession.name,
      first:ex[0].sets.length,reps:ex[0].targetReps,rest:ex[0].restSeconds,
      blank:ex.every(e=>e.sets.every(s=>s.weight===''&&s.reps===''&&!s.done))};
  })()`);
  assert.equal(startedWorkout.routineId, 'wk-str-lower', 'the workout id must ride in routineId');
  assert.equal(startedWorkout.name, 'Lower Strength');
  assert.equal(startedWorkout.first, 4, 'base volume must open with the scheme set count');
  assert.equal(startedWorkout.reps, '3-5');
  assert.equal(startedWorkout.rest, 180);
  assert.equal(startedWorkout.blank, true, 'a scheme must never invent a load');
  await waitFor(`document.querySelectorAll('#workoutExercises .plan-line').length === 5`);
  assert.equal(await evaluate(`document.querySelector('.plan-line').textContent`),
    'Plan: 3-5 reps · rest 3 min', 'the running card must restate the plan as neutral structure');
  // An EMPTY profile (nothing logged) must land on reduced with zero setup: 4 sets become 3.
  const emptyProfileVolume = await evaluate(`(() => {
    const history=state.history, saved=state.preferences.workoutVolume;
    state.activeSession=null; state.history=[]; delete state.preferences.workoutVolume;
    const variant=workoutVariant();
    startWorkout('wk-str-lower');
    const first=state.activeSession.exercises[0].sets.length;
    state.activeSession=null; state.history=history;
    if(saved!==undefined) state.preferences.workoutVolume=saved;
    saveState();
    return {variant,first};
  })()`);
  assert.equal(emptyProfileVolume.variant, 'reduced', 'a profile with nothing logged must default to reduced');
  assert.equal(emptyProfileVolume.first, 3, 'reduced must open Lower Strength one set lighter than base');
  await waitFor(`!document.getElementById('sheet').open`);
  // Reduced motion (emulated since the top of this run): the drag still reorders, it just skips the
  // FLIP transitions and the settle, and commits the moment the finger lifts.
  await evaluate(`(()=>{if(state.activeSession)state.activeSession=null;startQuickWorkout();
    addExerciseToWorkout('ch1');addExerciseToWorkout('ch2');addExerciseToWorkout('ch3');})();true`);
  await waitFor(`document.querySelectorAll('#workoutExercises .workout-exercise').length === 3`);
  // Pinned at scrollY 0 so the maths is fixed: synthetic pointer events need no hit-test, and with
  // nothing left to scroll the autoscroll cannot move the target under us.
  await evaluate(`(()=>{
    window.scrollTo(0,0);
    const cards=[...document.querySelectorAll('#workoutExercises .workout-exercise')];
    const g=cards[2].querySelector('.exercise-grip'),r=g.getBoundingClientRect();
    g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:9,button:0,clientY:Math.round(r.top+r.height/2)}));
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:9,button:0,
      clientY:Math.round(cards[0].getBoundingClientRect().top)-20}));
  })();true`);
  await sleep(400); // let the rAF loop pick a slot and run the autoscroll
  const reducedDrag = await evaluate(`(()=>{
    const lifted=!!document.querySelector('.workout-exercise.drag-lift');
    const flip=[...document.querySelectorAll('#workoutExercises .workout-exercise')].some(e=>e.style.transition);
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9,button:0,clientY:0}));
    return {lifted,flip,order:state.activeSession.exercises.map(e=>e.exerciseId),
      settling:document.querySelectorAll('.drag-settle').length,
      stray:[...document.querySelectorAll('#workoutExercises *')].filter(e=>e.style.transform||e.style.transition).length};
  })()`);
  assert.equal(reducedDrag.lifted, true, 'reduced motion must still lift the card');
  assert.equal(reducedDrag.flip, false, 'reduced motion must move the gap instantly, with no FLIP transition');
  assert.deepEqual(reducedDrag.order, ['ch3', 'ch1', 'ch2'], 'reduced motion must commit the same MOVE on pointerup');
  assert.equal(reducedDrag.settling, 0, 'reduced motion must skip the settle animation entirely');
  assert.equal(reducedDrag.stray, 0, 'reduced motion drop must leave no zombie transforms');
  await evaluate(`state.activeSession=null;saveState();navigate('today');true`);

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
  assert.deepEqual(storageFailureHandled, { returned: false, toast: 'Could not save - browser storage is full' });
  const pwa = await evaluate(`(async()=>{await navigator.serviceWorker.ready;return {controlled:!!navigator.serviceWorker.controller,keys:await caches.keys()}})()`);
  assert.equal(pwa.controlled, true, 'Service worker must control the app');
  const expectedCache = /CACHE='([^']+)'/.exec(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'))[1];
  assert.ok(pwa.keys.includes(expectedCache), `Current offline cache ${expectedCache} must exist`);
  await command('Network.enable');
  await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' });
  await command('Page.reload', { ignoreCache: true });
  await sleep(500);
  await waitFor(`document.readyState === 'complete' && typeof startQuickWorkout === 'function' && document.querySelector('#todayTitle')?.textContent.length > 0 && JSON.parse(localStorage.getItem(stateKey)).history.length === 1`);
  await command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' });

  // Codex P0-1: a LOCKED profile's cold boot must gate behind a non-dismissible PIN sheet with
  // ZERO profile data rendered behind it, and Escape/cancel must not close the gate.
  await evaluate(`window.__preReload=1;DuckGymProfiles.setPin(localStorage, activeProfileId, '4321').then(()=>setTimeout(()=>location.reload(),60));true`);
  await waitFor(`!window.__preReload`);
  await sleep(400);
  await waitFor(`document.readyState === 'complete' && typeof pinKey === 'function' && document.getElementById('sheet').open`);
  const lockedBoot = await evaluate(`(() => {
    const sheetHasPad = !!document.querySelector('#sheetContent .pin-pad');
    const hasClose = !!document.querySelector('#sheetContent .close-button');
    // No profile data behind the gate: history list + recent session must be empty-state, state itself neutral.
    const dataLeak = state.history.length > 0 || !!document.querySelector('#historyList .history-card') || !!document.querySelector('#recentSession .history-card');
    const cancelEvt = new Event('cancel', { cancelable: true });
    const cancelAllowed = document.getElementById('sheet').dispatchEvent(cancelEvt); // false = preventDefault fired
    const saveBlocked = saveState() === false; // lockGate must refuse writes behind the gate
    return { sheetHasPad, hasClose, dataLeak, cancelAllowed, saveBlocked, stillOpen: document.getElementById('sheet').open };
  })()`);
  assert.deepEqual(lockedBoot, { sheetHasPad: true, hasClose: false, dataLeak: false, cancelAllowed: false, saveBlocked: true, stillOpen: true },
    `Locked boot must gate with no data, no close path, cancel prevented: ${JSON.stringify(lockedBoot)}`);
  // Wrong PIN keeps the gate; right PIN unlocks and renders the real profile data.
  await evaluate(`pinKey('0');pinKey('0');pinKey('0');pinKey('0'); true`);
  await sleep(400);
  assert.equal(await evaluate(`document.getElementById('sheet').open && state.history.length === 0`), true, 'Wrong PIN must keep the gate closed');
  await evaluate(`pinKey('4');pinKey('3');pinKey('2');pinKey('1'); true`);
  await waitFor(`!document.getElementById('sheet').open && state.history.length === 1`);
  const unlocked = await evaluate(`(async () => ({
    saveWorks: saveState(),
    removedWithoutPin: await DuckGymProfiles.clearPin(localStorage, activeProfileId), // must refuse (no pin)
    removedWithPin: await DuckGymProfiles.clearPin(localStorage, activeProfileId, '4321')
  }))()`);
  assert.deepEqual(unlocked, { saveWorks: true, removedWithoutPin: false, removedWithPin: true });

  console.log('browser-flow-ok', JSON.stringify(result), 'responsive=320,390,500', 'reduced-motion=ok', 'drag-reorder=ok', 'offline=ok', 'pin-gate=ok');
} finally {
  try { socket?.close(); } catch {}
  chrome.kill();
  await sleep(750);
  for (let attempt = 0; attempt < 5; attempt++) {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); break; }
    catch (error) { if (attempt === 4) console.warn('temporary-profile-cleanup-warning', error.code); else await sleep(300); }
  }
}
