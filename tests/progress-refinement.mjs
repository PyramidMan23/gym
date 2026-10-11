import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE=process.env.DUCK_GYM_URL||'http://127.0.0.1:4174/';
const profile=mkdtempSync(join(tmpdir(),'gym-progress-'));
const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,`${BASE}?e2e=1`],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function retry(fn,timeout=12000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{return await fn();}catch(e){last=e;await sleep(80);}}throw last;}
let socket,nextId=0;const pending=new Map();
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},20000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result?.result?.value;}
async function wait(expr){return retry(async()=>{const value=await evaluate(expr);assert.ok(value,expr);return value;});}
const auditorSource=readFileSync(new URL('./contrast-guard.mjs',import.meta.url),'utf8');
const sweepLiteral=auditorSource.match(/const SWEEP = ([\s\S]*?);\r?\n\r?\nconst failures/)[1];
const sweep=new Function(`return ${sweepLiteral}`)();
const out=new URL('../artifacts/design-qa/surfaces/refinement/',import.meta.url);mkdirSync(out,{recursive:true});
const contrast=[];
async function capture(name,width,height=844,focusSelector=null){
  await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.getAnimations().forEach(a=>{try{if(a.effect.getTiming().iterations!==Infinity)a.finish()}catch{}});document.getElementById('main').scrollTop=0;window.scrollTo(0,0);true`);
  if(focusSelector)await evaluate(`document.querySelector(${JSON.stringify(focusSelector)}).scrollIntoView({block:'start'});window.scrollBy(0,-78);true`);
  await sleep(120);
  const dimensions=await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})`);
  assert.ok(dimensions.scroll<=dimensions.width,`${name}: horizontal overflow ${JSON.stringify(dimensions)}`);
  const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(new URL(`${name}-${width}.png`,out),Buffer.from(shot.result.data,'base64'));
}
async function audit(name){const rows=await evaluate(sweep);const relevant=rows.filter(r=>!r.disabled);const failures=relevant.filter(r=>r.ratio<r.bar);contrast.push({name,samples:relevant.length,failures});assert.deepEqual(failures,[],`${name} contrast failures`);}
try{
  const port=await retry(()=>readFileSync(join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);
  const tab=await retry(async()=>{const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const found=tabs.find(t=>t.type==='page'&&t.url.startsWith(BASE));assert.ok(found);return found;});
  socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;});
  socket.onmessage=event=>{const m=JSON.parse(event.data);if(!m.id||!pending.has(m.id))return;const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m);};
  await command('Runtime.enable');await command('Page.enable');await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await wait(`document.readyState==='complete'&&typeof renderProgress==='function'`);
  await evaluate(`if(document.getElementById('sheet').open)submitFirstRun('Progress QA');true`);
  await wait(`!document.getElementById('sheet').open`);
  await evaluate(`state.history=[];state.bodyweight=[];state.goals=[];navigate('progress');renderProgress();true`);
  assert.equal(await evaluate(`document.querySelectorAll('#weekPane .progress-day').length`),7);
  assert.equal(await evaluate(`document.querySelector('#progressSegments button').textContent`),'Overview');
  await evaluate(`setProgressTab('trends');true`);
  assert.match(await evaluate(`document.getElementById('strengthTrend').textContent`),/Finish a workout/);
  await capture('progress-empty-trends',390);
  const fixture=await evaluate(`(()=>{
    const w=Core.shiftPeriod(Core.periodWindow('week'),-1),start=w.start;
    const day=n=>{const d=new Date(start);d.setDate(d.getDate()+n);d.setHours(12);return d.getTime()};
    const timed=allExercises().find(e=>e.timed).id,cali=allExercises().find(e=>Core.bodyweightFactor(e.id)!=null&&!e.timed).id;
    const set=(weight,reps,extra={})=>({weight,reps,done:true,...extra});
    const session=(id,n,exercises)=>({id,name:'QA '+id,started:day(n),finished:day(n)+30*60000,exercises});
    const lift=(weight,reps)=>({exerciseId:'ch1',sets:[set(weight,reps)]});
    const old=session('older-best',-7,[lift(120,5)]);
    const a=session('monday',0,[{exerciseId:'ch1',sets:[set(80,5),set(20,10,{warmup:true}),set(200,0),set(200,10,{done:false})]},{exerciseId:timed,sets:[set(0,30)]},{exerciseId:cali,sets:[set(0,8)]}]);
    const b=session('wednesday',2,[lift(85,5),{exerciseId:'ch1',sets:[set(82.5,5)]},{exerciseId:timed,sets:[set(0,45),set(5,25)]},{exerciseId:cali,sets:[set(10,6),set(0,10)]}]);
    const c=session('friday',4,[lift(90,5),{exerciseId:timed,sets:[set(0,40)]}]);
    window.__progressFixture={old,a,b,c,timed,cali,start};state.history=[a];progressAnchor=start;progressKind='week';progressTab='trends';strengthPick='ch1';strengthMetric=null;strengthPoint=null;renderProgress();return {timed,cali,start};
  })()`);
  assert.equal(await evaluate(`document.querySelectorAll('#strengthTrend .progress-point').length`),1);
  assert.match(await evaluate(`document.getElementById('strengthTrend').textContent`),/1 logged observation/);
  await capture('progress-single-observation',390);
  await evaluate(`state.history=[__progressFixture.a,__progressFixture.c];renderProgress();true`);
  assert.equal(await evaluate(`document.querySelectorAll('#strengthTrend .progress-point').length`),2);
  await evaluate(`state.history=[__progressFixture.c,__progressFixture.old,__progressFixture.a,__progressFixture.b];state.bodyweight=[{t:__progressFixture.a.started,kg:80.2},{t:__progressFixture.c.started,kg:80.7}];progressTab='week';renderProgress();true`);
  const reconcile=await evaluate(`(()=>{const s=Core.periodStats(state.history,progressWindow());const valid=s.sessions.flatMap(x=>x.exercises.flatMap(e=>e.sets.filter(set=>set.done&&!set.warmup&&Number(set.reps)>0).map(set=>({e,set}))));return {sessions:s.sessionCount,sets:s.sets,independent:valid.length,daySets:s.days.reduce((n,d)=>n+d.sets,0),tableSets:Number(document.querySelector('#weekPane tfoot td:nth-of-type(2)').textContent),volume:s.volume,tableVolume:Number(document.querySelector('#weekPane tfoot td:nth-of-type(3)').textContent.replaceAll(',','')),summary:Array.from(document.querySelectorAll('.progress-summary strong'),x=>x.textContent),firstDay:s.days[0].key};})()`);
  assert.equal(reconcile.sessions,3);assert.equal(reconcile.sets,11);assert.equal(reconcile.sets,reconcile.independent);assert.equal(reconcile.sets,reconcile.daySets);assert.equal(reconcile.sets,reconcile.tableSets);assert.equal(reconcile.volume,reconcile.tableVolume);
  await evaluate(`selectProgressDay(${JSON.stringify(reconcile.firstDay)});true`);
  assert.match(await evaluate(`document.querySelector('.progress-sources').textContent`),/3 working sets/);
  assert.doesNotMatch(await evaluate(`document.querySelector('.progress-sources').textContent`),/4 working sets/);
  await evaluate(`setProgressActivity('sessions');true`);assert.match(await evaluate(`document.querySelector('#weekPane .progress-readout').textContent`),/1 session/);
  await evaluate(`setProgressActivity('volume');true`);assert.equal(await evaluate(`document.querySelectorAll('[data-progress-day][aria-pressed="true"]').length`),1);
  await evaluate(`setProgressActivity('sets');setProgressTab('trends');pickStrength('ch1');selectStrengthPoint(0,true);true`);
  assert.match(await evaluate(`document.querySelector('#strengthTrend .progress-trend-head').textContent`),/80 kg × 5/);
  assert.equal(await evaluate(`document.querySelector('#strengthTrend .progress-source button').getAttribute('onclick').includes('monday')`),true);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  assert.equal(await evaluate(`strengthPoint`),1);assert.match(await evaluate(`document.querySelector('#strengthTrend .progress-trend-head').textContent`),/85 kg × 5/);
  await evaluate(`document.querySelector('#strengthTrend details').open=true;document.querySelector('[data-strength-row="0"]').focus();true`);
  for(const index of [0,1]){
    await evaluate(`document.querySelector('[data-strength-row="${index}"]').focus();true`);
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    assert.equal(await evaluate(`document.querySelector('#strengthTrend details').open&&document.activeElement.dataset.strengthRow==='${index}'`),true,'Repeated observation table selection retains disclosure and keyboard focus');
  }
  await evaluate(`document.querySelector('#bodyweightCard details').open=true;document.querySelector('[data-bodyweight-row="0"]').focus();true`);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(await evaluate(`document.querySelector('#bodyweightCard details').open&&document.activeElement.dataset.bodyweightRow==='0'`),true);
  await evaluate(`const slider=document.querySelector('#strengthTrend input[type=range]');slider.value='2';slider.dispatchEvent(new Event('input',{bubbles:true}));true`);
  assert.match(await evaluate(`document.querySelector('#strengthTrend .progress-source').textContent`),/90 kg × 5/);
  assert.equal(await evaluate(`document.querySelector('#strengthTrend .progress-source button').getAttribute('onclick').includes('friday')`),true);
  await evaluate(`pickStrength(${JSON.stringify(fixture.timed)});pickStrengthMetric('seconds:0');selectStrengthPoint(1);true`);
  assert.match(await evaluate(`document.getElementById('strengthTrend').textContent`),/Best hold/);assert.match(await evaluate(`document.querySelector('#strengthTrend .progress-readout').textContent`),/45 s/);assert.doesNotMatch(await evaluate(`document.getElementById('strengthTrend').textContent`),/Estimated 1RM/);
  await capture('progress-holds',390);
  await evaluate(`const loadSelect=document.querySelector('.progress-series-select select');loadSelect.focus();loadSelect.value='seconds:5';loadSelect.dispatchEvent(new Event('change',{bubbles:true}));true`);
  assert.equal(await evaluate(`document.activeElement.matches('.progress-series-select select')`),true,'Added-load selector retains keyboard focus');
  await evaluate(`const exerciseSelect=document.querySelector('#strengthPicker select');exerciseSelect.focus();exerciseSelect.value='ch1';exerciseSelect.dispatchEvent(new Event('change',{bubbles:true}));true`);
  assert.equal(await evaluate(`document.activeElement.matches('#strengthPicker select')`),true,'Exercise selector retains keyboard focus');
  await evaluate(`pickStrength(${JSON.stringify(fixture.cali)});pickStrengthMetric('reps:10');true`);
  assert.match(await evaluate(`document.getElementById('strengthTrend').textContent`),/6 reps · \+10 kg/);assert.doesNotMatch(await evaluate(`document.getElementById('strengthTrend').textContent`),/Estimated 1RM/);
  await capture('progress-added-load-reps',390);
  await evaluate(`pickStrength('ch1');setProgressTab('records');true`);
  assert.match(await evaluate(`document.getElementById('allTimeBests').textContent`),/120 kg/);
  assert.doesNotMatch(await evaluate(`document.getElementById('prFeed').textContent`),/120 kg/);
  assert.equal(await evaluate(`document.querySelectorAll('#historyList .history-card').length`),3);
  await evaluate(`toggleAllHistory();searchProgressHistory('bench');true`);
  assert.equal(await evaluate(`document.querySelectorAll('#historyList .history-card').length`),4);
  await evaluate(`toggleAllHistory();searchProgressHistory('no-such-exercise');true`);
  assert.match(await evaluate(`document.getElementById('historyList').textContent`),/No matching workouts/);
  await evaluate(`searchProgressHistory('');setProgressPeriod('month');true`);
  assert.equal(await evaluate(`progressKind`),'month');assert.equal(await evaluate(`progressTab`),'records');
  await evaluate(`setProgressTab('week');progressAnchor=new Date(new Date(__progressFixture.start).getFullYear(),6,1).getTime();window.__weekHistory=state.history;state.history=state.history.map((s,i)=>{const d=new Date(progressAnchor);d.setDate([1,10,20,31][i]);d.setHours(12);return {...s,started:d.getTime(),finished:d.getTime()+30*60000}});renderProgress();true`);
  assert.equal(await evaluate(`document.querySelectorAll('.progress-month-day').length`),31);
  assert.equal(await evaluate(`(()=>{const chart=document.querySelector('.progress-bars.month');return chart.scrollWidth<=chart.clientWidth})()`),true);
  await evaluate(`const monthSlider=document.querySelector('#weekPane input[type=range]');monthSlider.value='30';monthSlider.dispatchEvent(new Event('input',{bubbles:true}));true`);
  assert.match(await evaluate(`document.querySelector('#weekPane .progress-readout').textContent`),/31/);
  for(const scheme of ['light','dark']){await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-motion',value:'reduce'}]});await capture('progress-month-'+scheme,390);await capture('progress-month-chart-'+scheme,390,844,'#weekPane .progress-activity');await capture('progress-month-chart-'+scheme,320,844,'#weekPane .progress-activity');const monthLabels=await evaluate(`(()=>{const chart=document.querySelector('.progress-bars.month').getBoundingClientRect();return [...document.querySelectorAll('.progress-month-day small')].filter(el=>el.textContent).map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,left:r.left-chart.left,right:chart.right-r.right}})})()`);console.log('Month320 '+scheme+' label boundary margins: '+JSON.stringify(monthLabels));assert.ok(monthLabels.every(label=>label.left>=0&&label.right>=0),'Month labels remain inside their clipping boundary');await capture('progress-month-'+scheme,320);await audit('month-'+scheme);}
  await evaluate(`state.history=__weekHistory;setProgressPeriod('week');progressAnchor=__progressFixture.start;renderProgress();const table=[...document.querySelectorAll('#weekPane details')].find(d=>d.querySelector('summary').textContent==='Daily data table');table.open=true;document.querySelector('[data-progress-day-row]').focus();true`);
  for(const key of [reconcile.firstDay,await evaluate(`Core.periodStats(state.history,progressWindow()).days[1].key`)]){
    await evaluate(`document.querySelector('[data-progress-day-row="${key}"]').focus();true`);await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    assert.equal(await evaluate(`document.activeElement.dataset.progressDayRow==='${key}'&&document.activeElement.closest('details').open`),true,'Repeated daily table selection retains disclosure and keyboard focus');
  }
  for(const scheme of ['light','dark']){
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-motion',value:'reduce'}]});
    for(const tab of ['week','trends','records']){
      await evaluate(`setProgressTab('${tab}');true`);
      await capture(`progress-${tab}-${scheme}`,390);await audit(`${tab}-${scheme}`);
      await capture(`progress-${tab}-${scheme}`,320);await capture(`progress-${tab}-${scheme}`,768);
    }
  }
  const rebuildCalls=await evaluate(`(()=>{
    const original=Core.rebuildPRs;let calls=0;
    Core.rebuildPRs=(...args)=>{calls++;return original(...args)};
    try{progressTab='records';renderProgress();const paint=calls;calls=0;searchProgressHistory('bench');const search=calls;return {paint,search};}
    finally{Core.rebuildPRs=original;progressHistoryQuery='';renderProgress();}
  })()`);
  assert.equal(rebuildCalls.paint,1,'Records paint shares one chronological rebuild across record and history renderers');
  assert.equal(rebuildCalls.search,1,'Standalone history search always obtains a fresh rebuild');
  console.log('Chronological rebuild spy: '+JSON.stringify(rebuildCalls));
  const largeHistory=await evaluate(`(()=>{
    const saved={history:state.history,kind:progressKind,anchor:progressAnchor,tab:progressTab};
    const ids=allExercises().filter(e=>!e.timed&&Core.bodyweightFactor(e.id)==null).slice(0,6).map(e=>e.id);
    state.history=Array.from({length:1000},(_,i)=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-(1000-i));return {id:'perf-'+i,name:'Synthetic performance fixture '+i,started:d.getTime(),finished:d.getTime()+30*60000,exercises:ids.map(exerciseId=>({exerciseId,sets:[{weight:10+i,reps:6,done:true}]}))}});
    progressKind='week';progressAnchor=null;progressTab='records';
    const start=performance.now();renderProgress();const elapsedMs=performance.now()-start;
    const result={sessions:state.history.length,lifts:ids.length,recordCount:Core.allTimeRecords(state.history).length,exerciseGroups:document.querySelectorAll('#allTimeBests .progress-record-exercise').length,renderedRecordRows:document.querySelectorAll('#allTimeBests .progress-record').length,deferredDetails:document.querySelectorAll('#allTimeBests .progress-record-loads:empty').length,elapsedMs:Math.round(elapsedMs*100)/100};
    state.history=saved.history;progressKind=saved.kind;progressAnchor=saved.anchor;progressTab=saved.tab;renderProgress();
    result.fixtureRestored=state.history.length===4;return result;
  })()`);
  assert.equal(largeHistory.sessions,1000);assert.equal(largeHistory.lifts,6);
  assert.ok(largeHistory.recordCount>=6000,'Large fixture contains thousands of distinct per-load records');
  assert.equal(largeHistory.exerciseGroups,6,'All-time bests are grouped once per exercise');
  assert.ok(largeHistory.renderedRecordRows<=24,'Initial all-time DOM stays bounded rather than painting all per-load records');
  assert.equal(largeHistory.deferredDetails,6,'Per-load bests remain deferred until disclosure opens');
  assert.equal(largeHistory.fixtureRestored,true);
  writeFileSync(new URL('large-history.json',out),JSON.stringify(largeHistory,null,2));
  console.log('Large-history browser render (informational, no timing threshold): '+JSON.stringify(largeHistory));
  await evaluate(`progressAnchor=null;progressKind='week';setProgressTab('week');renderProgress();true`);
  assert.match(await evaluate(`document.querySelector('#weekPane>.progress-note').textContent`),/Period in progress/);
  writeFileSync(new URL('contrast.json',out),JSON.stringify(contrast,null,2));
  console.log('Progress refinement passed: calendar context, working-set/table reconciliation, one/two observations, typed loaded/reps/holds, keyboard/scrub provenance, period vs all-time records, searched history, empty states, 320/390/768 both themes and contrast.');
}finally{if(socket)socket.close();chrome.kill();await sleep(300);try{rmSync(profile,{recursive:true,force:true});}catch{}}
