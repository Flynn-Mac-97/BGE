import test from 'node:test'
import assert from 'node:assert/strict'
import { makeLoader } from '../engine/loader.js'
import { makeBus } from '../engine/bus.js'
import { compileSchedule } from '../engine/plugin-runtime.js'
import { makeInspect } from '../engine/inspect.js'
import contracts from '../plugins/builtin/agent-contracts.js'

function setup(definitions) {
  const bus = makeBus(), loader = makeLoader(bus), context = { bus, loader }
  for (const definition of definitions) loader.add(definition)
  loader.boot(context)
  return { bus, loader, context }
}

test('owned services initialize before consumers regardless of discovery order', () => {
  const calls = []
  const { loader } = setup([
    { name:'Consumer', lifecycle:'scoped', requires:['clock'], onLoad(context, scope) { calls.push(scope.require('clock').value) } },
    { name:'Provider', lifecycle:'scoped', provides:['clock'], onLoad(context, scope) { calls.push('provider'); scope.provide('clock', {value:42}) } }
  ])
  assert.deepEqual(calls, ['provider',42]); assert.deepEqual(loader.contracts().services,[{name:'clock',owner:'Provider'}])
  assert.throws(()=>loader.order([{name:'Missing',needs:['Absent']}]), /missing plugin dependency: Absent/)
  assert.throws(()=>loader.order([{name:'Missing',requires:['absent']}]), /missing service provider: absent/)
  assert.throws(()=>loader.order([{name:'A',provides:['x']},{name:'B',provides:['x']}]), /declared by both/)
  assert.throws(()=>loader.add({name:'Provider'}), /duplicate plugin/)
})

test('repeated disable and enable leaves one listener and revokes services', () => {
  let received = 0, disposed = 0
  const {bus,loader} = setup([{name:'Owned', lifecycle:'scoped', provides:['owned'], onLoad(context,scope) {
    scope.provide('owned', {});scope.on('ping',()=>received++);scope.defer(()=>disposed++)
  }}])
  for(let index=0;index<10;index++) { bus.emit('ping'); loader.enable('Owned',false); bus.emit('ping'); assert.equal(loader.contracts().services.length,0); loader.enable('Owned',true) }
  bus.emit('ping');assert.equal(received,11);assert.equal(disposed,10)
  loader.dispose();loader.dispose();bus.emit('ping');assert.equal(received,11);assert.equal(disposed,11)
})

test('failed initialization rolls back partial registrations and cleanup continues after errors', () => {
  let received=0,cleaned=0
  const {bus,loader}=setup([{name:'Broken',lifecycle:'scoped',provides:['broken'],onLoad(context,scope){
    scope.on('ping',()=>received++);scope.provide('broken',{});scope.defer(()=>cleaned++);scope.defer(()=>{throw new Error('cleanup failure')});throw new Error('boot failure')
  }}])
  bus.emit('ping');assert.equal(received,0);assert.equal(cleaned,1);assert.equal(loader.contracts().services.length,0)
  assert.match(loader.failures()[0].error,/boot failure/);assert.ok(loader.contracts().diagnostics.some(item=>item.error.includes('cleanup failure')))
})

test('provider shutdown disposes dependent plugins first and refuses premature restart', () => {
  const disposed=[]
  const {loader}=setup([{name:'Provider',lifecycle:'scoped',provides:['clock'],onLoad(context,scope){scope.provide('clock',{});scope.defer(()=>disposed.push('provider'))}},
    {name:'Consumer',lifecycle:'scoped',requires:['clock'],onLoad(context,scope){scope.require('clock');scope.defer(()=>disposed.push('consumer'))}}])
  loader.enable('Provider',false);assert.deepEqual(disposed,['consumer','provider']);assert.equal(loader.plugins.get('Consumer').enabled,false)
  assert.throws(()=>loader.enable('Consumer',true),/dependency unavailable/)
  loader.enable('Provider',true);loader.enable('Consumer',true);assert.equal(loader.plugins.get('Consumer').active,true)
})

test('compiled schedule executes dependencies and preserves unrelated legacy order', () => {
  const calls=[]
  const {loader}=setup([{name:'Systems',systems:[{id:'consume',phase:'fixed',after:['produce'],run:()=>calls.push('consume')},{id:'produce',phase:'fixed',run:()=>calls.push('produce')},{phase:'frame',run:()=>calls.push('frame')}]}])
  for(const system of loader.schedule.fixed)system.run()
  assert.deepEqual(calls,['produce','consume']);assert.equal(loader.schedule.frame.length,1)
  const original=loader.schedule.fixed;assert.equal(loader.schedule.fixed,original)
  const legacy=compileSchedule([{plugin:'A',phase:'fixed'},{plugin:'B',phase:'fixed'}]);assert.deepEqual(legacy.fixed.map(system=>system.plugin),['A','B'])
  assert.throws(()=>compileSchedule([{id:'a',phase:'fixed',after:['b']},{id:'b',phase:'fixed',after:['a']}]),/cycle/)
  assert.throws(()=>compileSchedule([{id:'a',phase:'fixed',before:['missing']}]),/missing/)
  assert.throws(()=>compileSchedule([{id:'a',phase:'fixed',after:['b']},{id:'b',phase:'frame'}]),/another phase/)
  assert.throws(()=>compileSchedule([{id:'a',phase:'fixed'},{id:'a',phase:'frame'}]),/duplicate/)
})

test('invalid schedule fails closed while diagnostic commands remain available', () => {
  const {loader}=setup([contracts,{name:'Bad',systems:[{id:'a',phase:'fixed',after:['missing'],run(){}}]}])
  assert.equal(loader.schedule.fixed.length,0);assert.match(loader.contracts().scheduleError,/missing/)
  assert.ok(loader.contrib.commands.some(command=>command.id==='agent.contracts'))
  loader.enable('Bad',false);assert.equal(loader.contracts().scheduleError,null)
})

test('command discovery is bounded and bad arguments fail before a handler runs', async () => {
  let calls=0
  const {bus,loader,context}=setup([contracts,{name:'Probe',commands:Array.from({length:60},(_,index)=>({id:`probe.${index}`,label:'Probe',inputSchema:{type:'object',required:['count'],properties:{count:{type:'integer',minimum:1}},additionalProperties:false},run(){calls++;return {ok:true}}}))}])
  const engine=makeInspect({world:{},loader,bus,editor:{context},log:{lines:[],push(){}},loop:{}})
  const page=await engine.run('agent.commands',{query:'probe.',limit:5});assert.equal(page.items.length,5);assert.equal(page.total,60);assert.equal(page.nextOffset,5)
  const second=await engine.run('agent.commands',{query:'probe.',limit:5,offset:5});assert.equal(second.items[0].id,'probe.5')
  await assert.rejects(engine.run('probe.0',{count:'bad'}),/expected integer/);assert.equal(calls,0)
  await assert.rejects(engine.run('probe.0',{count:2,typo:true}),/unknown argument/);assert.equal(calls,0)
  await engine.run('probe.0',{count:2});assert.equal(calls,1)
  await assert.rejects(engine.run('agent.commands',{limit:500}),/outside allowed range/)
  assert.ok(JSON.stringify(page).length < JSON.stringify(engine.commands()).length)
})
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('real headless host skips failed plugin siblings in the same tick and reactivates a scoped builtin', async () => {
  const project=await fs.mkdtemp(path.join(os.tmpdir(),'engine-contract-host-'))
  try {
    await fs.cp(new URL('./fixture-project/',import.meta.url),project,{recursive:true})
    const entry=new URL('../engine/start-world-node.mjs',import.meta.url).href
    const script=`
      import { startWorldInNode } from ${JSON.stringify(entry)};
      const {loader,context,loop,engine}=await startWorldInNode({project:${JSON.stringify(project)}});
      const calls=[];
      loader.add({name:'Failure Probe',systems:[{id:'probe.fail',phase:'fixed',run(){calls.push('first');throw new Error('intentional test failure')}},{id:'probe.skipped',phase:'fixed',after:['probe.fail'],run(){calls.push('must not run')}}]});
      loader.rebuild();loop.step(1);
      const disabled=loader.plugins.get('Failure Probe').enabled===false;
      loader.enable('Profiler',false);const removed=context.profiler===undefined;
      loader.enable('Profiler',true);const result=await engine.run('profile.steps',{steps:2});
      console.log(JSON.stringify({calls,disabled,removed,steps:result.steps,service:loader.contracts().services.some(item=>item.name==='profiler')}));process.exit(0);
    `
    const output=execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',cwd:fileURLToPath(new URL('../',import.meta.url))})
    assert.deepEqual(JSON.parse(output.trim().split('\n').at(-1)),{calls:['first'],disabled:true,removed:true,steps:2,service:true})
  } finally { await fs.rm(project,{recursive:true,force:true}) }
})
