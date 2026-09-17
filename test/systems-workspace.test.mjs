import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { analyzeFiles, fingerprint } from '../plugins/builtin/systems-inspector/toolkit/analysis.js'
import { newDocument, applyEdit, validateDocument, documentFindings, exportSVG, implementationBrief } from '../plugins/builtin/systems-inspector/toolkit/document.js'
import { flowFromSource, applyFlowToSource } from '../plugins/builtin/systems-inspector/toolkit/flow.js'
import { listDocuments, readDocument, writeDocument, replaceSource, sourceHash } from '../engine/document-store.mjs'
import { createSystemsWorkspace } from '../plugins/builtin/systems-inspector/workspace.js'
import { layoutCalls } from '../plugins/builtin/systems-inspector/toolkit/call-layout.js'

test('workspace modes are directly reachable and retain source drafts across navigation',async()=>{
  const context={redraw(){},editor:{},files:{
    async sourceCatalog(){return {files:[{scope:'engine',path:'main.js',group:'Engine Core',text:'function start() { return 1 }'}],errors:[]}},
    async listDocuments(){return {documents:[]}}
  }}
  const workspace=createSystemsWorkspace(context)
  await workspace.open('code')
  assert.equal(workspace.state.mode,'code');assert.ok(workspace.state.source)
  workspace.editSource('function start() { return 2 }')
  for(const mode of ['script','design','inspect','code']){
    workspace.mode(mode);assert.equal(workspace.state.mode,mode)
    assert.match(workspace.state.sourceDraft,/return 2/)
  }
  workspace.mode('script');assert.deepEqual(workspace.graph(),{nodes:[],edges:[]})
  workspace.discardSource();assert.match(workspace.state.sourceDraft,/return 1/)
})

test('anonymous callback rows are optional while their call edges remain available',async()=>{
  const workspace=createSystemsWorkspace({redraw(){},editor:{},files:{
    async sourceCatalog(){return {files:[{scope:'engine',path:'main.js',group:'Engine Core',text:"import { run } from './service.js'; function start(){ [1].forEach(() => run()) }"},{scope:'engine',path:'service.js',group:'Engine Core',text:'export function run() {}'}],errors:[]}},
    async listDocuments(){return {documents:[]}}
  }})
  await workspace.open()
  const plain=workspace.filter({diagramView:'files'})
  assert.ok(plain.nodes.every(node=>node.functions.every(item=>!item.name.startsWith('callback at L'))))
  const detailed=workspace.filter({showCallbacks:true})
  assert.ok(detailed.nodes.some(node=>node.functions.some(item=>item.name.startsWith('callback at L'))))
  assert.deepEqual(plain.edges,detailed.edges)
})

test('call diagram ranks callers before callees, keeps cycles together and fits function compartments',()=>{
  const nodes=['entry','service','cycle-a','cycle-b','isolated'].map(id=>({id,title:id,functions:Array.from({length:id==='service'?20:1},(_,index)=>({name:'function'+index}))}))
  const edges=[['entry','service'],['service','cycle-a'],['cycle-a','cycle-b'],['cycle-b','cycle-a']].map(([from,to])=>({from,to}))
  const result=layoutCalls(nodes,edges),byId=new Map(result.map(node=>[node.id,node]))
  assert.ok(byId.get('entry').x<byId.get('service').x)
  assert.ok(byId.get('service').x<byId.get('cycle-a').x)
  assert.equal(byId.get('cycle-a').x,byId.get('cycle-b').x)
  assert.equal(byId.get('cycle-a').cycle,true)
  assert.equal(byId.get('isolated').disconnected,true)
  assert.ok(byId.get('service').height>=82+20*24)
  for(const first of result)for(const second of result)if(first.id!==second.id){
    assert.ok(first.x+first.width<=second.x||second.x+second.width<=first.x||first.y+first.height<=second.y||second.y+second.height<=first.y,`${first.id} overlaps ${second.id}`)
  }
  assert.deepEqual(layoutCalls([...nodes].reverse(),edges),result)
  assert.deepEqual(layoutCalls([],[]),[])
})

test('portable analysis resolves renamed re-exports, reports cycles and keeps unknown code explicit',()=>{
  const result=analyzeFiles([
    {path:'main.js',text:"import { run } from './public.js'; function start(){ run(); dynamic.call() }"},
    {path:'public.js',text:"export { execute as run } from './logic.js'"},
    {path:'logic.js',text:"import './main.js'; export function execute() {}"},
    {path:'broken.js',text:'export function {'}
  ])
  const call=result.edges.find(edge=>edge.kind==='call')
  assert.equal(call.from,'source:main.js');assert.equal(call.to,'source:logic.js');assert.equal(call.label,'start → execute')
  assert.ok(result.findings.some(item=>item.kind==='cycle'));assert.ok(result.findings.some(item=>item.kind==='parse'));assert.ok(result.findings.some(item=>item.kind==='unresolved'))
})
test('design edits validate edges, undo-safe values and evidence drift; exports escape markup',()=>{
  let document=newDocument('Plan')
  document=applyEdit(document,{type:'add-node',node:{id:'one',title:'<script>bad()</script>',kind:'system',x:10,y:20,source:{file:'source:main.js',line:1,fingerprint:fingerprint('old')}}})
  document=applyEdit(document,{type:'add-node',node:{id:'two',title:'Output',kind:'data',x:350,y:20}})
  document=applyEdit(document,{type:'add-edge',edge:{id:'edge',from:'one',to:'two',kind:'data',label:'result'}})
  assert.throws(()=>applyEdit(document,{type:'add-edge',edge:{id:'bad',from:'one',to:'absent'}}),/dangling/)
  assert.throws(()=>validateDocument({...document,version:2}),/version/)
  assert.ok(documentFindings(document,[{id:'source:main.js',fingerprint:fingerprint('new')}]).some(item=>item.kind==='changed-evidence'))
  assert.ok(!exportSVG(document).includes('<script>'));assert.match(implementationBrief(document),/Code evidence: source:main.js:1/)
  assert.equal(applyEdit(document,{type:'remove-node',id:'one'}).edges.length,0)
})
test('visual function round-trip preserves other code and conditions, loops and returns',()=>{
  const source='const before = 10;\nexport function sum(n) { let value=0; while(n>0){ if(n===2){ value+=3 } else { value+=n } n--; } return value; }\nconst after=20;'
  const start=source.indexOf('function sum')
  const flow=flowFromSource(source,start)
  const next=applyFlowToSource(source,flow)
  assert.ok(next.startsWith('const before = 10;\nexport function sum'));assert.ok(next.endsWith('const after=20;'))
  const original=new Function(source.replace('export ', '')+'; return sum(4)')()
  const generated=new Function(next.replace('export ', '')+'; return sum(4)')()
  assert.equal(original,generated)
  flow.nodes.find(node=>node.kind==='return').code='value + 10'
  assert.equal(new Function(applyFlowToSource(source,flow).replace('export ','')+'; return sum(4)')(),original+10)
  flow.nodes.push({id:'orphan',kind:'code',code:'value=0',x:0,y:0})
  assert.throws(()=>applyFlowToSource(source,flow),/Unconnected/)
})
test('document store round-trips and preserves revisions while refusing concurrent overwrites',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'systems-store-'))
  try{
    const first=await writeDocument(root,'test',newDocument('First'))
    const second=await writeDocument(root,'test',newDocument('Second'),first.revision)
    await assert.rejects(writeDocument(root,'test',newDocument('Stale'),first.revision),/Revision conflict/)
    assert.equal((await readDocument(root,'test')).data.title,'Second')
    assert.equal((await readDocument(root,'test',true)).data.title,'First')
    assert.equal((await listDocuments(root)).documents.length,1)
    await assert.rejects(readDocument(root,'../secret'),/Invalid document ID/)
    const file=path.join(root,'code.js');await fs.writeFile(file,'const a=1')
    await assert.rejects(replaceSource(file,'const a=2','stale'),/changed on disk/)
    await replaceSource(file,'const a=2',sourceHash('const a=1'))
    assert.equal(await fs.readFile(file+'.systems-backup','utf8'),'const a=1')
    assert.ok(second.revision!==first.revision)
  }finally{await fs.rm(root,{recursive:true,force:true})}
})
test('workspace edits, save, reopen and undo share the same portable document state',async()=>{
  const saved=new Map()
  const context={redraw(){},editor:{projectName:'test'},files:{
    async sourceCatalog(){return {files:[{scope:'engine',file:'main.js',path:'main.js',group:'Engine Core',text:'function start() {}'}],errors:[]}},
    async listDocuments(){return {documents:[...saved].map(([id,value])=>({id,title:value.data.title})),errors:[]}},
    async readDocument(id){return saved.get(id)},
    async writeDocument(id,data){const value={data:JSON.parse(JSON.stringify(data)),revision:'1'};saved.set(id,value);return value}
  }}
  const workspace=createSystemsWorkspace(context);await workspace.open();workspace.new('Demo');const node=workspace.addNode();workspace.edit({type:'node',id:node.id,values:{title:'Changed'}});workspace.undo();assert.equal(workspace.state.document.nodes[0].title,'New system');workspace.redo();assert.equal(workspace.state.document.nodes[0].title,'Changed')
  const result=await workspace.save();workspace.new('Other');await assert.rejects(workspace.load(result.id),/Save this design/);await workspace.discard();await workspace.load(result.id);assert.equal(workspace.state.document.title,'Demo')
})

test('namespace calls and function comments survive portable inspection and visual editing',()=>{
  const graph=analyzeFiles([{path:'a.js',text:"import * as service from './b.js'; service.run()"},{path:'b.js',text:'export function run() {}'}])
  assert.ok(graph.edges.some(edge=>edge.kind==='call'&&edge.to==='source:b.js'))
  const source='function run(n) { /* keep this explanation */ while(n>0) { if(n===2) break; n--; } return n; }'
  const next=applyFlowToSource(source,flowFromSource(source,0))
  assert.match(next,/keep this explanation/)
  assert.equal(new Function(next+';return run(4)')(),2)
})


test('unpreviewed visual edits recover with their source and block source navigation',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');const records=new Map()
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>records.get(key),setItem:(key,value)=>records.set(key,value)}})
  try{
    const context={redraw(){},editor:{projectName:'recovery-test'},files:{async sourceCatalog(){return {files:[{scope:'engine',file:'main.js',path:'main.js',text:'function run(){return 2}',hash:'disk-hash',group:'Engine Core'}],errors:[]}},async listDocuments(){return {documents:[]}}}}
    const first=createSystemsWorkspace(context);await first.open();first.visual(0);first.state.selected=first.state.flow.nodes.find(node=>node.kind==='return').id;first.flowEdit({code:'3'})
    assert.throws(()=>first.sourceLink({file:first.state.source.id,line:1}),/Apply or discard/)
    const second=createSystemsWorkspace(context);await second.open();assert.equal(second.state.mode,'script');assert.equal(second.state.source.hash,'disk-hash');assert.equal(second.state.flowDirty,true);assert.match(second.previewFlow(),/return 3/)
  }finally{if(previous)Object.defineProperty(globalThis,'sessionStorage',previous);else delete globalThis.sessionStorage}
})
