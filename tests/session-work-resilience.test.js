const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const Core=require('../core.js');
const at=(year,month,day,hour=0)=>new Date(year,month-1,day,hour).getTime();
const set=(weight,reps,extra={})=>({weight,reps,done:true,...extra});
const makeSession=(id='s1')=>({id,started:at(2026,10,10,9),finished:at(2026,10,10,10),exercises:[{exerciseId:'bench',_logId:'ex1',sets:[set(40,8)]}]});
const backup=extra=>({version:2,routines:[],history:[],customExercises:[],activeSession:null,preferences:{},...extra});
test.beforeEach(()=>{Core.setTimedExercises(['hang']);Core.setBodyweightModel(null);});

test('rolling trend windows clamp month-end anchors and span leap/year boundaries',()=>{
  const now=at(2024,5,31,12),three=Core.exerciseTrendWindow('3months',now,now);
  assert.equal(three.startKey,'2024-02-29');assert.equal(three.endKey,'2024-06-01');assert.equal(three.elapsedEnd,now);
  assert.equal(three.current,true);assert.equal(three.partial,true);
  const six=Core.exerciseTrendWindow('6months',at(2026,3,31),at(2026,4,2));
  assert.equal(six.startKey,'2025-09-30');assert.equal(six.endKey,'2026-04-01');assert.equal(six.partial,false);
  const year=Core.exerciseTrendWindow('year',at(2024,2,29),at(2024,3,1));
  assert.equal(year.startKey,'2023-02-28');assert.equal(year.endKey,'2024-03-01');
});
test('long-range source filtering is exclusive and caps unfinished-day/future evidence',()=>{
  const now=at(2026,10,11,12),w=Core.exerciseTrendWindow('3months',now,now);
  const log=(id,t)=>({...makeSession(id),started:t});
  const history=[log('before',w.start-1),log('start',w.start),log('last',now-1),log('future',now+1),log('end',w.end)];
  assert.deepEqual(Core.sessionsInPeriod(history,w).map(s=>s.id),['start','last']);
  assert.equal(Core.exerciseTrend(Core.sessionsInPeriod(history,w),'bench').length,2);
  assert.throws(()=>Core.exerciseTrendWindow('90days',now,now),/Trend range/);
  assert.throws(()=>Core.exerciseTrendWindow('__proto__',now,now),/Trend range/);
  assert.throws(()=>Core.exerciseTrendWindow('year',Infinity),/Invalid/);
});
test('Sydney long-range windows use calendar midnights across both DST directions',()=>{
  const result=JSON.parse(execFileSync(process.execPath,['-e',`
    const C=require('./core');
    const anchors=[new Date(2026,9,4,12),new Date(2026,3,5,12)];
    console.log(JSON.stringify(anchors.map(anchor=>{const w=C.exerciseTrendWindow('3months',+anchor,+anchor);const start=new Date(w.start),end=new Date(w.end);return {start:w.startKey,end:w.endKey,startHour:start.getHours(),endHour:end.getHours(),hours:(w.end-w.start)/3600000};})));
  `],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,TZ:'Australia/Sydney'},encoding:'utf8'}));
  assert.deepEqual(result.map(w=>[w.start,w.end]),[['2026-07-04','2026-10-05'],['2026-01-05','2026-04-06']]);
  assert.ok(result.every(w=>w.startHour===0&&w.endHour===0));
  assert.equal(result[0].hours%24,23);assert.equal(result[1].hours%24,1);
});
test('session summary separates working and warmup ledgers while preserving legacy totals',()=>{
  const s=makeSession();s.exercises[0].sets=[set(40,8),set(20,10,{warmup:true}),set(99,0),set(60,8,{done:false}),set(25,5,{drop:true})];
  const summary=Core.sessionWorkSummary(s);
  assert.equal(summary.workingSets,2);assert.equal(summary.warmupSets,1);assert.equal(summary.totalSets,3);
  assert.equal(summary.completedSets,2);assert.equal(summary.workingVolume,445);assert.equal(summary.volume,445);
  assert.equal(summary.warmupVolume,200);assert.equal(summary.totalVolume,645);
  assert.equal(Core.calculateVolume(s),645);assert.equal(Core.summarizeSession(s).completedSets,3);
  assert.equal(summary.minutes,60);assert.equal(summary.durationUnknown,false);
});
test('mixed warmups/bodyweight/holds/unloaded reps reconcile independently across three ledgers',()=>{
  Core.setBodyweightModel({factorFor:id=>id==='pullup'?1:null,bodyweightFor:s=>s.bodyweightKg||null});
  const s=makeSession();s.bodyweightKg=80;s.exercises=[
    {exerciseId:'pullup',sets:[set(10,5),set(0,3,{warmup:true})]},
    {exerciseId:'hang',sets:[set(20,45),set(0,20,{warmup:true})]},
    {exerciseId:'raise',sets:[set(0,12),set(5,4),set(0,6,{warmup:true})]}
  ];
  const r=Core.sessionWorkSummary(s);
  assert.equal(r.volume,470);assert.equal(r.externalVolume,70);assert.equal(r.bodyweightVolume,400);
  assert.equal(r.seconds,45);assert.equal(r.unweightedReps,12);assert.equal(r.warmup.volume,240);
  assert.equal(r.warmup.seconds,20);assert.equal(r.warmup.unweightedReps,6);
  assert.equal(r.total.seconds,65);assert.equal(r.total.unweightedReps,18);assert.equal(r.total.volume,Core.calculateVolume(s));
  for(const field of ['sets','volume','externalVolume','bodyweightVolume','seconds','unweightedReps'])
    assert.equal(r.total[field],r.working[field]+r.warmup[field]);
});
test('unknown bodyweight never invents kilograms in either working or warmup summary',()=>{
  Core.setBodyweightModel({factorFor:id=>id==='pullup'?1:null,bodyweightFor:()=>null});
  const s=makeSession();s.exercises=[{exerciseId:'pullup',sets:[set(0,8),set(0,5,{warmup:true})]}];
  const r=Core.sessionWorkSummary(s);assert.equal(r.volume,0);assert.equal(r.warmup.volume,0);assert.equal(r.total.volume,0);
  assert.equal(r.unweightedReps,8);assert.equal(r.warmup.unweightedReps,5);assert.equal(r.needsBodyweight,true);
});
test('summary duration stays unknown with missing or implausible clocks, uses actual set stamps when supported',()=>{
  const s=makeSession();delete s.finished;let r=Core.sessionWorkSummary(s);
  assert.equal(r.minutes,null);assert.equal(r.durationMinutes,null);assert.equal(r.durationUnknown,true);
  s.finished=s.started+20*3600000;r=Core.sessionWorkSummary(s);
  assert.equal(r.minutes,null);assert.equal(r.durationCapped,true);
  s.exercises[0].sets=[set(40,8,{at:s.started}),set(40,8,{at:s.started+20*60000})];
  r=Core.sessionWorkSummary(s);assert.equal(r.minutes,20);assert.equal(r.durationEstimated,true);assert.equal(r.durationUnknown,false);
});
test('period totals and session summaries share exact working metrics and unknown-duration count',()=>{
  const a=makeSession('a'),b=makeSession('b');a.exercises[0].sets.push(set(20,10,{warmup:true}));delete b.finished;
  const window=Core.periodWindow('week',a.started,at(2026,10,12));
  const totals=Core.periodStats([a,b],window),summaries=[a,b].map(Core.sessionWorkSummary);
  assert.equal(totals.sets,summaries.reduce((sum,s)=>sum+s.completedSets,0));
  assert.equal(totals.volume,summaries.reduce((sum,s)=>sum+s.volume,0));
  assert.equal(totals.minutes,summaries.reduce((sum,s)=>sum+(s.minutes??0),0));
  assert.equal(totals.durationUnknown,summaries.filter(s=>s.durationUnknown).length);
});
test('backup preserves full recoverable workouts and deletion metadata without mutating input',()=>{
  const s=makeSession();s.exercises[0].sets[0].side='L';s.exercises[0].sets[0].warmup=true;
  const data=backup({deletedHistory:[{session:s,deletedAt:at(2026,10,11),reason:'user deletion'}]});
  const validated=Core.validateBackup(data);assert.deepEqual(validated.deletedHistory,data.deletedHistory);
  validated.deletedHistory[0].session.exercises[0].sets[0].weight=999;
  assert.equal(data.deletedHistory[0].session.exercises[0].sets[0].weight,40);
  assert.deepEqual(Core.validateBackup(backup()).deletedHistory,[]);
});
test('backup rejects malformed recovery entries before they can become restored live history',()=>{
  const s=makeSession();
  for(const deletedHistory of [{},[null],[{session:s,deletedAt:Infinity}],[{session:s,deletedAt:false}],[{session:s,deletedAt:-1}],
    [{session:{...s,id:''},deletedAt:1}],[{session:{...s,exercises:[{sets:'bad'}]},deletedAt:1}],
    [{session:{id:'s'},deletedAt:1}]]) assert.throws(()=>Core.validateBackup(backup({deletedHistory})),/Invalid Duck Gym backup/);
});
test('backup preserves paused rest identity, normalizes timers, and retains exact active Undo journal',()=>{
  const s=makeSession();delete s.finished;s.pausedAt=at(2026,10,10,9);s.pausedMs=12000;
  s.restState={deadline:String(s.started+90000),totalSeconds:'90',exerciseInstanceId:'ex1'};
  s._setEdits=[{exercise:'ex1',row:{weight:60,reps:8,done:true,drop:true,side:'R'},action:'remove'}];
  s._exerciseEdits={profile:'source-profile',session:s.id,stack:[{exercise:{exerciseId:'hang',_logId:'removed-ex',sets:[set(0,30)]},
    index:1,before:'ex1',after:null,restState:{deadline:s.started+60000,totalSeconds:60,exerciseInstanceId:'removed-ex'}}]};
  const original=JSON.stringify(s),v=Core.validateBackup(backup({activeSession:s})).activeSession;
  assert.equal(v.restState.deadline,s.started+90000);assert.equal(v.restState.totalSeconds,90);
  assert.equal(v.restState.exerciseInstanceId,'ex1');assert.equal(v.pausedAt,s.pausedAt);assert.equal(v.pausedMs,12000);
  assert.deepEqual(v._setEdits,s._setEdits);assert.equal(JSON.stringify(s),original);
  assert.deepEqual(v._exerciseEdits,s._exerciseEdits);
});
test('backup drops malformed optional rest state while preserving workout and recovery data',()=>{
  for(const restState of [[],false,0,'old timer',{deadline:Infinity,totalSeconds:90,exerciseInstanceId:'ex1'},
    {deadline:1,totalSeconds:0,exerciseInstanceId:'ex1'},{deadline:1,totalSeconds:3601,exerciseInstanceId:'ex1'},
    {deadline:true,totalSeconds:90,exerciseInstanceId:'ex1'},{deadline:1,totalSeconds:90,exerciseInstanceId:'missing'},
    {deadline:1,totalSeconds:90}]) {
    const activeSession={...makeSession(),pausedAt:123,_setEdits:[{action:'remove',row:set(20,8)}],restState};
    const input=backup({activeSession,history:[makeSession('history')],deletedHistory:[{session:makeSession('deleted'),deletedAt:456}],
      routines:[{id:'routine',exerciseIds:['bench']}],bodyweight:[{t:1,kg:80}]});
    const validated=Core.validateBackup(input);
    assert.equal('restState' in validated.activeSession,false);
    const {restState:ignored,...expected}=activeSession;
    assert.deepEqual(validated.activeSession,expected);
    for(const key of ['history','deletedHistory','routines','bodyweight'])assert.deepEqual(validated[key],input[key]);
    assert.equal(input.activeSession.restState,restState);
  }
});

test('dropping an invalid optional timer never bypasses malformed session nesting',()=>{
  assert.throws(()=>Core.validateBackup(backup({activeSession:{exercises:{},restState:{deadline:1,totalSeconds:90,exerciseInstanceId:'ex1'}}})),/Invalid Duck Gym backup/);
  assert.throws(()=>Core.validateBackup(backup({activeSession:{exercises:[{sets:'bad'}],restState:false}})),/Invalid Duck Gym backup/);
});
test('exercise rest preferences preserve explicit no-rest and drop invalid values/unsafe keys',()=>{
  const raw=JSON.parse('{"bench":0,"row":"120","hang":3600,"negative":-1,"fraction":90.5,"infinite":"Infinity","blank":"","boolean":false,"__proto__":60,"constructor":60,"quote\\\"":90}');
  const v=Core.validateBackup(backup({preferences:{exerciseRestSeconds:raw}}));
  assert.deepEqual(v.preferences.exerciseRestSeconds,{bench:0,row:120,hang:3600});
  assert.equal(Object.getPrototypeOf(v.preferences.exerciseRestSeconds),Object.prototype);
});
test('progress view preferences round-trip whitelisted ranges and metric semantics without absolute anchors',()=>{
  const progressView={tab:'trends',period:'month',trendRange:'6months',exerciseId:'pullup',exerciseMetric:'reps:10.5',activityMetric:'volume',historyAll:false,anchor:123};
  const v=Core.validateBackup(backup({preferences:{progressView}})).preferences.progressView;
  const {anchor,...expected}=progressView;assert.deepEqual(v,expected);
  for(const exerciseMetric of ['e1rm','seconds:0','reps:0.5',null])
    assert.equal(Core.validateBackup(backup({preferences:{progressView:{exerciseMetric}}})).preferences.progressView.exerciseMetric,exerciseMetric);
});
test('malformed progress preferences do not smuggle unsupported tabs/ranges/metric keys through import',()=>{
  const view={tab:'admin',period:'year',trendRange:'90days',exerciseId:'quoted"',exerciseMetric:'reps:-5',activityMetric:'kg',historyAll:'yes',anchor:Infinity};
  assert.deepEqual(Core.validateBackup(backup({preferences:{progressView:view}})).preferences.progressView,{});
  assert.equal(Core.validateBackup(backup({preferences:{progressView:[]}})).preferences.progressView,undefined);
});

test('backup preserves declared goals and existing explicit preference choices on roundtrip',()=>{
  const goal={id:'goal1',type:'strength',exerciseId:'bench',target:80,startValue:40,created:123,achievedAt:456};
  const preferences={weightStep:1.25,barWeight:15,haptics:false,restNotify:false,injuryMode:true,muscleRanges:{Chest:[0,12],'Upper back':[6,18]}};
  const input=backup({goals:[goal],preferences}),v=Core.validateBackup(input);
  assert.deepEqual(v.goals,[goal]);
  for(const key of Object.keys(preferences))assert.deepEqual(v.preferences[key],preferences[key]);
  v.goals[0].target=999;v.preferences.muscleRanges.Chest[1]=999;
  assert.equal(input.goals[0].target,80);assert.equal(input.preferences.muscleRanges.Chest[1],12);
  assert.deepEqual(Core.validateBackup(backup()).goals,[]);
});

test('backup normalizes goals and rejects malformed known preference values without unsafe keys',()=>{
  const goals=[null,{type:'unknown',target:5},{type:'strength',target:50},{type:'consistency',target:'4',created:'12'}];
  const preferences={weightStep:false,barWeight:-5,haptics:'false',restNotify:1,injuryMode:'true',
    muscleRanges:JSON.parse('{"Chest":["0","12"],"Arms":[8,2],"Legs":[1.5,10],"Back":[0,null],"__proto__":[0,1],"constructor":[0,1]}')};
  const v=Core.validateBackup(backup({goals,preferences}));
  assert.deepEqual(v.goals,[{id:'g12',type:'consistency',exerciseId:null,target:4,startValue:null,created:12,achievedAt:null}]);
  for(const key of ['weightStep','barWeight','haptics','restNotify','injuryMode'])assert.equal(v.preferences[key],undefined);
  assert.deepEqual(v.preferences.muscleRanges,{Chest:[0,12]});
});
