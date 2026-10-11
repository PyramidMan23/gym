const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const Core = require('../core.js');
const at = (y, m, d, h = 0) => new Date(y, m - 1, d, h).getTime();
const set = (weight, reps, extra = {}) => ({ weight, reps, done: true, ...extra });
const session = (id, started, sets, exerciseId = 'bench') => ({ id, started, finished: started + 3600000,
  exercises: [{ exerciseId, sets }] });
test.beforeEach(() => { Core.setTimedExercises(['hang']); Core.setBodyweightModel(null); });

// Fixtures below are deliberately synthetic test inputs, never written to an app profile.
test('Monday-local weeks and calendar months have exclusive end boundaries', () => {
  const now = at(2026, 10, 14, 12), week = Core.periodWindow('week', now, now);
  assert.equal(week.start, at(2026, 10, 12)); assert.equal(week.end, at(2026, 10, 19));
  assert.equal(week.elapsedEnd, now); assert.equal(week.partial, true);
  const closed = Core.periodWindow('month', at(2026, 12, 15), at(2027, 2, 1));
  assert.equal(closed.startKey, '2026-12-01'); assert.equal(closed.endKey, '2027-01-01');
  const logs = [session('before', closed.start - 1, [set(20, 5)]), session('first', closed.start, [set(20, 5)]),
    session('last', closed.end - 1, [set(20, 5)]), session('next', closed.end, [set(20, 5)])];
  assert.deepEqual(Core.sessionsInPeriod(logs, closed).map(s => s.id), ['first', 'last']);
  assert.equal(Core.shiftPeriod(closed, 1).startKey, '2027-01-01');
});
test('month navigation handles Jan 31 and leap-February without date overflow', () => {
  const jan = Core.periodWindow('month', at(2024, 1, 31), at(2024, 4, 1));
  const feb = Core.shiftPeriod(jan, 1);
  assert.equal(feb.startKey, '2024-02-01'); assert.equal(feb.endKey, '2024-03-01');
  assert.equal(Core.periodStats([], feb).days.length, 29);
  assert.throws(() => Core.periodWindow('year', Date.now()), /Period/);
  assert.throws(() => Core.periodWindow('week', Infinity), /Invalid/);
});
test('Sydney DST changes keep local midnights and seven buckets across 167/169-hour weeks', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['-e', `
    const C=require('./core.js');
    const windows=[new Date(2026,9,4,12),new Date(2026,3,5,12)].map(d=>C.periodWindow('week',+d,+new Date(2027,0,1)));
    console.log(JSON.stringify(windows.map(w=>({hours:(w.end-w.start)/3600000,days:C.periodStats([],w).days.map(d=>({key:d.key,hour:new Date(d.t).getHours()}))}))));
  `], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, TZ: 'Australia/Sydney' }, encoding: 'utf8' }));
  assert.deepEqual(result.map(w => w.hours), [167, 169]);
  assert.ok(result.every(w => w.days.length === 7 && w.days.every(d => d.hour === 0)));
  assert.equal(new Set(result[0].days.map(d => d.key)).size, 7);
});
test('partial periods cap future logs and suppress misleading comparisons', () => {
  const now = at(2026, 10, 14, 12), w = Core.periodWindow('week', now, now);
  const logs = [session('last', at(2026, 10, 11), [set(100, 5)]),
    session('today', at(2026, 10, 14, 9), [set(10, 5)]), session('future', at(2026, 10, 15), [set(999, 5)])];
  const stats = Core.periodStats(logs, w);
  assert.equal(stats.workouts, 1); assert.equal(stats.volume, 50);
  assert.equal(stats.comparison, null); assert.equal(stats.comparisonReason, 'Period in progress');
  assert.equal(stats.previous.workouts, 1);
  const future = Core.periodWindow('week', at(2026, 10, 26), now);
  assert.equal(Core.periodStats(logs, future).workouts, 0);
});
test('closed periods compare complete periods and empty previous data produces no percent', () => {
  const w = Core.periodWindow('week', at(2026, 10, 12), at(2026, 10, 26));
  const logs = [session('old', at(2026, 10, 7), [set(20, 5)]), session('new', at(2026, 10, 15), [set(30, 5)])];
  const s = Core.periodStats(logs, w);
  assert.equal(s.comparison.volume, 50); assert.equal(s.comparison.sets, 0);
  const empty = Core.periodStats([logs[1]], w);
  assert.equal(empty.comparison, null); assert.equal(empty.comparisonReason, 'No previous data');
});
test('headline, bars and session table reconcile valid working evidence and exact volume', () => {
  const w = Core.periodWindow('month', at(2026, 10, 1), at(2026, 11, 2));
  const logs = [session('a', at(2026, 10, 3), [set(40, 8), set(99, 0), set(100, 30, {warmup:true}), set(50, 8, {done:false})]),
    session('b', at(2026, 10, 3, 17), [set(20, 10, {drop:true})]),
    session('empty', at(2026, 10, 4), [set(20, 0)]), session('warm', at(2026, 10, 5), [set(20, 10, {warmup:true})])];
  const s = Core.periodStats(logs, w), day = s.days.find(d => d.key === '2026-10-03');
  assert.equal(s.workouts, 2); assert.equal(s.sets, 2); assert.equal(s.volume, 520); assert.equal(s.minutes, 120);
  assert.deepEqual(day.sessions.map(s => s.id), ['a', 'b']); assert.equal(day.volume, 520);
  assert.equal(s.days.reduce((sum,d)=>sum+d.sets,0), s.sets);
  assert.equal(s.days.reduce((sum,d)=>sum+d.volume,0), s.volume);
  assert.equal(s.days.reduce((sum,d)=>sum+d.sessionCount,0), s.workouts);
  assert.equal(s.days.flatMap(d=>d.sessions).reduce((sum,s)=>sum+Core.workingWork(s).volume,0), s.volume);
  // Legacy work-volume policy is preserved deliberately: a warm-up is still work.
  assert.equal(Core.calculateVolume(logs[0]), 3320);
});
test('period muscle ledger uses the same working sets and deduplicates assisting groups', () => {
  const w = Core.periodWindow('week', at(2026, 10, 14), at(2026, 10, 26));
  const s = session('a', at(2026, 10, 14), [set(40, 5),set(20,10,{warmup:true})]);
  const mv = Core.muscleVolumeForPeriod([s], () => ({primary:'Chest',all:['Chest','Arms','Arms']}), w);
  assert.equal(mv.Chest.direct, 1); assert.equal(mv.Arms.assisting, 1); assert.equal(mv.Chest.by.bench.direct, 1);
});
test('missing durations stay unknown rather than contributing a four-hour floor', () => {
  const w = Core.periodWindow('week', at(2026, 10, 14), at(2026, 10, 26));
  const old = session('a', at(2026, 10, 14), [set(40, 5)]); old.finished = old.started + 20 * 3600000;
  const s = Core.periodStats([old], w); assert.equal(s.minutes, 0); assert.equal(s.durationUnknown, 1);
  assert.equal(s.days.find(d => d.sessionCount).durationUnknown, 1);
});
test('holds, measured-bodyweight contribution and unloaded reps retain distinct units', () => {
  Core.setBodyweightModel({ factorFor: id => id === 'pullup' ? 1 : null, bodyweightFor:s => s.bodyweightKg || null });
  const w = Core.periodWindow('week', at(2026, 10, 14), at(2026, 10, 26));
  const a = session('a', at(2026, 10, 14), [set(10, 5)], 'pullup'); a.bodyweightKg = 80;
  const b = session('b', at(2026, 10, 15), [set(0, 8)], 'pullup');
  const c = session('c', at(2026, 10, 16), [set(20, 60)], 'hang');
  const d = session('d', at(2026, 10, 16), [set(0, 12),set(5,4)], 'raise');
  const s = Core.periodStats([a,b,c,d], w);
  assert.equal(s.externalVolume, 70); assert.equal(s.bodyweightVolume, 400); assert.equal(s.volume, 470);
  assert.equal(s.seconds, 60); assert.equal(s.unweightedReps, 20); assert.equal(s.needsBodyweight, true);
  const trend = Core.exerciseTrend([a], 'pullup')[0]; assert.equal(trend.metric, 'reps'); assert.equal(trend.weight, 10);
  assert.equal(Core.allTimeRecords([a]).some(r=>r.type==='e1rm'),false);
});
test('one and two observations remain inspectable, actual e1RM set never mixes heaviest weight', () => {
  const a = session('a', 100, [set(100,1),set(90,10)]);
  const b = session('b', 200, [set(95,10)]);
  const points = Core.exerciseTrend([b,a], 'bench');
  assert.equal(Core.exerciseTrend([a], 'bench').length, 1); assert.equal(points.length, 2);
  assert.equal(points[0].topWeight, 90); assert.equal(points[0].reps, 10); assert.equal(points[0].e1rm, 120);
  assert.equal(points[0].sessionId, 'a'); assert.equal(points[0].setIndex, 1);
  assert.deepEqual(points[0].set, a.exercises[0].sets[1]);
  const records = Core.allTimeRecords([a]);
  assert.equal(records.find(r=>r.type==='weight').reps, 1);
  assert.equal(records.find(r=>r.type==='e1rm').weight, 90);
});
test('mixed loaded and unloaded sessions stay separate metric points, not zero-kg measurements', () => {
  const a = session('a', 100, [set(0,20),set(40,8)]);
  const p = Core.exerciseTrend([a], 'bench');
  assert.deepEqual(p.map(p=>p.metric), ['reps','e1rm']); assert.equal(p[0].value,20); assert.equal(p[1].value,50.7);
  assert.ok(p.every(p=>p.sessionId==='a'));
});
test('hold observations at different added loads are separate actual comparable points', () => {
  const a = session('a', 100, [set(20,5),set(0,60)], 'hang');
  const points = Core.exerciseTrend([a], 'hang');
  assert.equal(points.length, 2); assert.ok(points.every(p=>p.metric==='seconds'&&p.e1rm===0));
  assert.deepEqual(points.map(p=>[p.weight,p.seconds]), [[20,5],[0,60]]);
});
test('duplicate exercise rows earn one exercise receipt with typed actual-set provenance', () => {
  const a = session('a', 100, [set(80,5)]);
  const b = session('b', 200, [set(90,3)]);
  b.exercises.push({exerciseId:'bench',sets:[set(85,10)]});
  const prs = Core.detectPRs([a], b); assert.equal(prs.length,1); assert.equal(prs[0].weight,85); assert.equal(prs[0].reps,10);
  assert.equal(prs[0].estimated1RM,113.3); assert.equal(prs[0].exerciseIndex,1);
  assert.equal(prs[0].records.find(r=>r.type==='weight').weight,90);
  assert.deepEqual(Core.exerciseExposures([a,b]),{bench:2});
});
test('first log and first metric at a new load establish baselines while all-time bests remain', () => {
  const first = session('a',100,[set(0,12)],'raise');
  assert.deepEqual(Core.detectPRs([],first),[]); assert.equal(Core.allTimeRecords([first])[0].value,12);
  assert.equal(Core.setRecordStatus([],first,0,0).baseline,true);
  const next = session('b',200,[set(0,13)],'raise'); assert.equal(Core.detectPRs([first],next).length,1);
  const weighted = session('c',300,[set(10,20)],'raise');
  assert.deepEqual(Core.detectPRs([first,next],weighted),[], 'first typed-load metric is a baseline');
});
test('row PR status distinguishes better than last from an older all-time best', () => {
  const old = session('old',100,[set(100,5)]), last = session('last',200,[set(70,5)]), today = session('today',300,[set(80,5)]);
  const status = Core.setRecordStatus([today,last,old],today,0,0);
  assert.equal(status.pr,false); assert.equal(status.betterThanLast,true); assert.equal(status.baseline,false);
  today.exercises[0].sets[0]=set(110,5);
  assert.equal(Core.setRecordStatus([today,last,old],today,0,0).pr,true);
  assert.equal(Core.detectPRs([today,last,old],today).length,1);
});
test('warm-ups, incomplete, zero/negative reps and non-finite inputs mint no evidence', () => {
  const a = session('a',100,[set(999,50,{warmup:true}),set(999,20,{done:false}),set(999,0),set(999,-1),set(Infinity,5),set(10,Infinity)]);
  assert.deepEqual(Core.exerciseTrend([a],'bench'),[]); assert.deepEqual(Core.allTimeRecords([a]),[]);
  assert.deepEqual(Core.exerciseExposures([a]),{}); assert.equal(Core.setRecordStatus([],a,0,0).pr,false);
});
test('chronological edits and deletions rebuild later records without mutating history', () => {
  const a = session('a',100,[set(80,5)]), b = session('b',200,[set(90,5)]), c = session('c',300,[set(95,5)]);
  const before = JSON.stringify([c,b,a]);
  assert.deepEqual(Core.rebuildPRs([c,b,a]).map(s=>s.prs.length),[1,1,0]);
  assert.equal(JSON.stringify([c,b,a]),before);
  const edited = {...a,exercises:[{exerciseId:'bench',sets:[set(100,5)]}]};
  assert.deepEqual(Core.rebuildPRs([c,b,edited]).map(s=>s.prs.length),[0,0,0]);
  assert.deepEqual(Core.rebuildPRs([c,b]).map(s=>s.prs.length),[1,0]);
  assert.equal(Core.allTimeRecords([c,b,edited]).find(r=>r.type==='weight').sessionId,'a');
});
test('period earned records respect earlier baseline even when it is outside selected period', () => {
  const w = Core.periodWindow('month',at(2026,10,14),at(2026,11,2));
  const a=session('a',at(2026,9,10),[set(80,5)]), b=session('b',at(2026,10,10),[set(90,5)]);
  const records=Core.recordsInPeriod([b,a],w); assert.ok(records.length); assert.ok(records.every(r=>r.sessionId==='b'));
  assert.deepEqual(Core.recordsInPeriod([b],w),[]);
  assert.equal(Core.allTimeRecords([a,b]).find(r=>r.type==='weight').value,90);
});
test('all-time tied records retain their first earning date and independent source snapshots', () => {
  const a=session('a',100,[set(80,5)]), b=session('b',200,[set(80,5)]);
  const r=Core.allTimeRecords([b,a]); assert.ok(r.every(r=>r.sessionId==='a'));
  r[0].set.weight=999; assert.equal(a.exercises[0].sets[0].weight,80);
  assert.deepEqual(Core.detectPRs([a],b),[]);
});

test('legacy weekly recap compares the same local weekday/time rather than previous Sunday', () => {
  const now=at(2026,10,14,12), look=()=>({primary:'Chest',all:['Chest']});
  const priorEarly=session('early',at(2026,10,7,9),[set(20,5)]);
  const priorLate=session('late',at(2026,10,11,12),[set(200,5)]);
  const current=session('now',at(2026,10,14,9),[set(30,5)]);
  const r=Core.weeklyRecap([current,priorLate,priorEarly],look,now);
  assert.equal(r.setsDelta,0); assert.equal(r.volumeDelta,50); assert.equal(r.workoutsDelta,0);
  assert.equal(r.comparisonLabel,'Same point last week');
  assert.equal(Core.weeklyRecap([current],look,now).volumeDelta,null);
});
test('single ledger rebuild matches independent prefix detection across metrics, ties and duplicate rows', () => {
  const chronological=[];
  for(let i=0;i<12;i++) {
    const s=session('s'+i,100+i,[set(40+(i%4)*5,3+(i%3)),set(20,10+(i%2),{warmup:true})]);
    s.exercises.push({exerciseId:'hang',sets:[set(i%2?10:0,20+i)]});
    s.exercises.push({exerciseId:'bench',sets:[set(40,4+(i%3))]});
    chronological.push(s);
  }
  const input=[...chronological].reverse(), rebuilt=Core.rebuildPRs(input);
  chronological.forEach((s,i)=>assert.deepEqual(rebuilt.find(r=>r.id===s.id).prs,Core.detectPRs(chronological.slice(0,i),s)));
});
test('logger matrix agrees with per-row helpers and re-derives after source edits', () => {
  const old=session('old',100,[set(80,5)]), current=session('current',200,[set(90,5),set(20,10,{warmup:true}),set(0,0)]);
  current.exercises.push({exerciseId:'bench',sets:[set(85,10)]});
  current.exercises.push({exerciseId:'hang',sets:[set(0,30)]});
  let statuses=Core.sessionRecordStatuses([old],current);
  for(let e=0;e<current.exercises.length;e++) for(let k=0;k<current.exercises[e].sets.length;k++)
    assert.deepEqual(statuses[e][k],Core.setRecordStatus([old],current,e,k));
  assert.equal(statuses[0][1].pr,false); assert.equal(statuses[0][2].baseline,false);
  assert.equal(statuses[2][0].baseline,true);
  old.exercises[0].sets[0]=set(120,10);
  statuses=Core.sessionRecordStatuses([old],current);
  assert.equal(statuses[0][0].pr,false); assert.equal(statuses[1][0].pr,false);
});

test('equal timestamp batches have identical PR results in live, receipt and rebuild paths', () => {
  const baseline=session('baseline',50,[set(80,5)]), a=session('a',100,[set(90,5)]), b=session('b',100,[set(100,5)]);
  for(const history of [[baseline,a,b],[b,a,baseline],[a,baseline,b]]) {
    const rebuilt=Core.rebuildPRs(history);
    for(const source of [a,b]) {
      const live=Core.detectPRs(history,source), rebuiltRecords=rebuilt.find(s=>s.id===source.id).prs;
      assert.deepEqual(live,rebuiltRecords);
      assert.equal(live.length,1,'both improvements are judged against the earlier 80 kg baseline');
      assert.equal(Core.setRecordStatus(history,source,0,0).pr,true);
      assert.equal(Core.sessionRecordStatuses(history,source)[0][0].pr,true);
    }
  }
});
test('simultaneous first logs establish baselines and later logs compare the whole tied batch', () => {
  const a=session('a',100,[set(80,5)]),b=session('b',100,[set(100,5)]),later=session('later',200,[set(90,5)]);
  for(const history of [[a,b,later],[later,b,a]]) {
    const rebuilt=Core.rebuildPRs(history);
    for(const source of [a,b,later]) {
      assert.deepEqual(Core.detectPRs(history,source),[]);
      assert.deepEqual(rebuilt.find(s=>s.id===source.id).prs,[]);
      assert.equal(Core.setRecordStatus(history,source,0,0).pr,false);
    }
    assert.equal(Core.setRecordStatus(history,a,0,0).baseline,true);
    assert.equal(Core.sessionRecordStatuses(history,b)[0][0].baseline,true);
  }
});
test('timestamp-free detector shadows deliberately retain compare-all compatibility', () => {
  const history=[session('earlier',100,[set(80,5)]),session('latest',200,[set(100,5)])];
  const shadow={exercises:[{exerciseId:'bench',sets:[set(90,5)]}]};
  assert.deepEqual(Core.detectPRs(history,shadow),[],'unknown time does not pretend 90 kg preceded the 100 kg evidence');
  shadow.exercises[0].sets[0]=set(110,5);
  assert.equal(Core.detectPRs(history,shadow).length,1,'legacy live-set shadows compare all known historical evidence');
  assert.equal(Core.setRecordStatus(history,shadow,0,0).pr,true);
  assert.equal(Core.sessionRecordStatuses(history,shadow)[0][0].pr,true);
});
