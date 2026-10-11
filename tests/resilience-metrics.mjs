// Cross-surface truth and browser interruption checks use disposable synthetic profiles only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const BASE=process.env.DUCK_GYM_URL||'http://127.0.0.1:4174/';
assert.match(new URL(BASE).hostname,/^(127\.0\.0\.1|localhost)$/,'Synthetic fixtures must remain local');
const profile=mkdtempSync(join(tmpdir(),'gym-metrics-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,`${BASE}?e2e=1`],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function retry(fn){let last;for(let i=0;i<200;i++){try{return await fn();}catch(e){last=e;await sleep(100);}}throw last;}
let socket,serial=0;const pending=new Map(),errors=[];
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timeout ${method}`));},20000);pending.set(id,{resolve:m=>{clearTimeout(timer);resolve(m)},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const m=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(m.result.exceptionDetails)throw Error(m.result.exceptionDetails.exception?.description||m.result.exceptionDetails.text);return m.result.result.value;}
async function wait(expression){return retry(async()=>assert.equal(await evaluate(expression),true,expression));}
const output=new URL('../artifacts/design-qa/surfaces/resilience/',import.meta.url);mkdirSync(output,{recursive:true});
try{
  const port=await retry(()=>readFileSync(join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);
  const tab=await retry(async()=>{const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const tab=tabs.find(t=>t.url.startsWith(BASE)&&t.type==='page');assert.ok(tab);return tab;});
  socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(x=>x.value||x.description).join(' '));const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m);}};
  await command('Runtime.enable');await command('Page.enable');await command('Network.enable');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await wait(`document.readyState==='complete'&&typeof renderToday==='function'`);
  await evaluate(`submitFirstRun('Metrics QA');true`);await wait(`!document.getElementById('sheet').open`);
  await evaluate(`(()=>{const now=Date.now(),start=Core.periodWindow('week').start+60000;window.metricFixture={id:'metric-fixture',name:'Metric fixture',started:start,finished:Math.min(now,start+1800000),exercises:[{exerciseId:'ch1',sets:[{weight:'20',reps:'10',done:true,warmup:true},{weight:'80',reps:'5',done:true},{weight:'100',reps:'0',done:true},{weight:'80',reps:'5',done:false}]},{exerciseId:'gr3',sets:[{weight:'0',reps:'30',done:true}]}]};state.history=[metricFixture];state.bodyweight=[];state.activeSession=null;saveState();renderToday();progressAnchor=null;progressKind='week';setProgressTab('week');return true})()`);
  const truth=await evaluate(`(()=>{const s=Core.sessionWorkSummary(metricFixture),p=Core.periodStats(state.history,Core.periodWindow('week'));return {working:s.sets,kg:s.volume,warmup:s.warmupSets,all:s.totalSets,hold:s.seconds,period:p.sets,periodKg:p.volume,today:document.getElementById('activityDetail').textContent,recent:document.getElementById('recentSession').textContent,summary:[...document.querySelectorAll('#weekPane .progress-summary strong')].map(e=>e.textContent)}})()`);
  assert.equal(truth.working,2);assert.equal(truth.kg,400);assert.equal(truth.warmup,1);assert.equal(truth.all,3);assert.equal(truth.hold,30);
  assert.equal(truth.period,truth.working);assert.equal(truth.periodKg,truth.kg);assert.match(truth.today,/2 of .* working sets/);assert.match(truth.recent,/2 working sets/);assert.match(truth.recent,/1 warm-up/);
  assert.deepEqual(truth.summary.slice(0,3),['1','2','400kg']);
  await evaluate(`openReceipt(metricFixture);true`);
  const receipt=await evaluate(`[...document.querySelectorAll('.receipt-line')].map(el=>el.textContent)`);
  assert.ok(receipt.includes('Working sets2'));assert.ok(receipt.includes('Working volume400 kg'));
  assert.match(await evaluate(`document.getElementById('receiptCard').textContent`),/Also logged 1 warm-up/);
  await evaluate(`closeReceipt();openHistory('metric-fixture');true`);
  assert.match(await evaluate(`document.getElementById('sheetContent').textContent`),/WORKING SETS|Working sets/);
  await evaluate(`closeSheet();openMuscleDetail('Chest');true`);
  assert.match(await evaluate(`document.querySelector('#sheetContent h2').textContent`),/^1 direct/);
  await evaluate(`closeSheet();state.activeSession=JSON.parse(JSON.stringify(metricFixture));state.activeSession.id='active-metric';delete state.activeSession.finished;navigate('workout');renderWorkout();true`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#workoutMetrics strong')].map(el=>el.textContent)`),['2','400','2']);
  await evaluate(`requestFinishWorkout();true`);
  assert.match(await evaluate(`document.getElementById('confirmContent').textContent`),/2 working sets.*400 kg working volume.*1 warm-up/);
  await evaluate(`closeConfirm();state.activeSession.exercises=[{exerciseId:'gr3',rir:'skip',sets:[{weight:20,reps:30,done:true}]}];renderWorkout();true`);
  const collapsed=await evaluate(`document.querySelector('.done-card .row-text small').textContent`);
  assert.match(collapsed,/1 working set.*30 s held/);assert.doesNotMatch(collapsed,/600|kg/);
  await evaluate(`window.mixedFixture={...metricFixture,id:'mixed-work',finished:undefined,exercises:[{exerciseId:'ch1',sets:[{weight:0,reps:12,done:true},{weight:5,reps:4,done:true}]}]};state.history=[mixedFixture];openHistory('mixed-work');true`);
  assert.match(await evaluate(`document.querySelector('#sheetContent .metric').textContent`),/—MINUTES · UNKNOWN/);
  assert.match(await evaluate(`document.querySelector('#sheetContent .work-axes').textContent`),/12 reps/);
  await evaluate(`closeSheet();openReceipt(mixedFixture);true`);
  assert.match(await evaluate(`document.getElementById('receiptCard').textContent`),/Durationnot recorded/);
  assert.match(await evaluate(`document.querySelector('#receiptCard .work-axes').textContent`),/12 reps/);
  await evaluate(`closeReceipt();true`);
  await evaluate(`closeConfirm();state.activeSession=null;state.history=[{...metricFixture,id:'warm-only',exercises:[{exerciseId:'ch1',sets:[{weight:20,reps:10,done:true,warmup:true}]}]}];saveState();navigate('today');renderToday();true`);
  assert.match(await evaluate(`document.getElementById('activityDetail').textContent`),/^0 of .* working sets/);
  assert.equal(await evaluate(`document.querySelectorAll('#weekDots .done').length`),0);
  assert.match(await evaluate(`document.getElementById('recentSession').textContent`),/0 working sets.*1 warm-up/);
  await evaluate(`state.history=[metricFixture];saveState();true`);
  // Offline reload verifies the new shell + data without depending on a live network.
  await evaluate(`navigator.serviceWorker.ready.then(()=>true)`);await wait(`!!navigator.serviceWorker.controller`);
  await evaluate(`window.metricsBeforeReload=true;true`);
  await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await command('Page.reload',{ignoreCache:true});
  await wait(`!window.metricsBeforeReload&&document.readyState==='complete'&&typeof state!=='undefined'&&state.history[0]?.id==='metric-fixture'`);
  await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  for(const scheme of ['light','dark'])for(const width of [320,390,768]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate(`navigate('today');renderToday();document.getAnimations().forEach(a=>{try{a.finish()}catch{}});window.scrollTo(0,0);true`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`),true);
    const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(new URL(`today-working-${scheme}-${width}.png`,output),Buffer.from(shot.result.data,'base64'));
  }
  // Magnified browser layout exercises reflow at half the physical width, not a visual-only pinch.
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.documentElement.style.zoom='2';navigate('today');true`);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`),true,'200% zoom Today must not cause horizontal page overflow');
  await evaluate(`document.documentElement.style.zoom='';true`);
  assert.deepEqual(errors,[],'No uncaught browser/console errors');
  console.log('resilience-metrics-ok working=2 kg=400 warmups=1; Today/live/receipt/Progress/muscle/source reconcile; warmup-only excluded; offline reload; both-theme320/390/768; zoom; pageErrors=0');
}finally{socket?.close();chrome.kill();await sleep(200);try{rmSync(profile,{recursive:true,force:true})}catch{}}
