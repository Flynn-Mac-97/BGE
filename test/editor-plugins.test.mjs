import test from 'node:test'
import assert from 'node:assert/strict'
import { makeLoader } from '../engine/loader.js'
import { makeBus } from '../engine/bus.js'
import monaco from '../plugins/builtin/monaco-editor.js'
import diagrams from '../plugins/builtin/joint-diagrams.js'
import elk from '../plugins/builtin/elk-layout.js'
import systems from '../plugins/builtin/systems-inspector.js'
import { createSystemsWorkspace } from '../plugins/builtin/systems-inspector/workspace.js'

test('editor providers load headlessly and disable their workspace consumer through normal dependencies',()=>{
  const bus=makeBus(),loader=makeLoader(bus),context={bus,loader,redraw(){},editor:{},world:{entities:[]}}
  for(const definition of [systems,monaco,diagrams,elk])loader.add(definition)
  loader.boot(context)
  assert.equal(loader.failures().length,0)
  assert.equal(loader.contracts().services.length,4)
  assert.deepEqual(context.systemsWorkspace.summary().providers,{code:true,diagram:true,layout:true})
  const editor=context.systemsWorkspace.services.code
  assert.equal(editor.status().loaded,false)
  assert.throws(()=>editor.create({}),/browser/)
  loader.enable(monaco.name,false)
  assert.equal(loader.plugins.get(systems.name).active,false)
  assert.equal(context.systemsWorkspace,undefined)
  assert.equal(editor.status().closed,true)
  loader.enable(monaco.name,true);loader.enable(systems.name,true)
  assert.equal(loader.plugins.get(systems.name).active,true)
  loader.dispose()
  assert.equal(loader.contracts().services.length,0)
})

test('ELK service routes function ports and returns separate deterministic graph data',async()=>{
  let layout
  elk.onLoad({}, {provide(key,value){layout=value},defer(){}})
  const graph={nodes:[{id:'a',title:'A',width:300,height:130,functions:[{name:'start',line:1,endLine:5,start:0}]},{id:'b',title:'B',width:300,height:130,functions:[{name:'run',line:8,endLine:9,start:20}]}],edges:[{id:'call',from:'a',to:'b',evidence:{line:2},target:{line:8}}]}
  const before=JSON.stringify(graph),result=await layout.arrange(graph)
  assert.equal(JSON.stringify(graph),before)
  assert.ok(result.nodes[0].x<result.nodes[1].x)
  assert.equal(result.edges[0].sourcePort,'a:out:0')
  assert.equal(result.edges[0].targetPort,'b:in:0')
  assert.ok(result.edges[0].sections.length)
  assert.deepEqual(await layout.arrange(graph),result)
})

test('workspace never replaces a completed scan with an earlier empty layout',async()=>{
  const context={redraw(){workspace.graph()},editor:{},files:{
    async sourceCatalog(){return {files:[{scope:'engine',path:'main.js',group:'Engine Core',text:'function start() {}'}],errors:[]}},
    async listDocuments(){return {documents:[]}}
  }}
  const workspace=createSystemsWorkspace(context,{layout:{async arrange(graph){return {...graph,nodes:graph.nodes.map(node=>({...node,x:123,y:40}))}}}})
  workspace.state.diagramView='files'
  await workspace.open()
  assert.equal(workspace.graph().nodes.length,1)
  assert.equal(workspace.graph().nodes[0].x,123)
  await workspace.scan();await workspace.arrangeSource()
  assert.equal(workspace.graph().nodes.length,1)
  workspace.dispose()
})
