const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');
// Execute the production callback, not a copied approximation of its conditions.
const start = app.indexOf('    const offer=(w,coldOpen)=>{');
const end = app.indexOf('    if(reg.waiting&&navigator.serviceWorker.controller)', start);
assert.ok(start >= 0 && end > start, 'update callback must remain discoverable');
const callback = app.slice(start, end);
function offer({ active = null, locked = false, unnamed = false, cold = true, age = 25*3600000, stampBuild = 'test' } = {}) {
  let applied = 0, offered = 0;
  const now = Date.now();
  const values = new Map([['waiting', JSON.stringify({build:stampBuild,at:now-age})]]);
  const context = { state:{activeSession:active}, lockGate:locked, bootNeedsName:unnamed,
    WAIT_KEY:'waiting', STALE_MS:24*3600000, BUILD:'test', Date,
    localStorage:{getItem:k=>values.get(k), setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k)},
    showUpdatePill:()=>offered++, applyUpdate:()=>applied++, worker:{}, cold };
  vm.runInNewContext(callback+'offer(worker,cold);', context);
  return {applied, offered, stamp:values.get('waiting')};
}
test('overdue update applies on an idle cold open', () => {
  assert.deepEqual(offer(), {applied:1,offered:1,stamp:undefined});
});
for (const [name, options] of [
  ['saved active workout',{active:{id:'workout'}}],
  ['paused workout',{active:{id:'workout',pausedAt:123}}],
  ['locked profile',{locked:true}],
  ['first-run name sheet',{unnamed:true}],
  ['warm update discovery',{cold:false}],
  ['fresh update',{age:3600000}],
  ['future clock stamp',{age:-3600000}],
  ['stamp from a previous build',{stampBuild:'old'}]
]) test(`update pill preserves ${name}`,()=>{
  const result=offer(options);
  assert.equal(result.applied,0);
  assert.equal(result.offered,1);
  assert.ok(result.stamp);
});
test('release stamp and offline cache match, including every stylesheet',()=>{
  const build=fs.readFileSync(require.resolve('../build.js'),'utf8').match(/const BUILD = '([^']+)'/)[1];
  const sw=fs.readFileSync(require.resolve('../sw.js'),'utf8');
  assert.ok(sw.includes(`const CACHE='gym-${build}'`));
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const deploy=fs.readFileSync(require.resolve('../deploy.sh'),'utf8');
  for(const [, file] of html.matchAll(/rel="stylesheet" href="([^"]+)"/g)) {
    assert.ok(sw.includes(`'./${file}'`),`${file} must work offline`);
    assert.ok(deploy.includes(file),`${file} must ship`);
  }
});
