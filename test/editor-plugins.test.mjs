import test from 'node:test'
import assert from 'node:assert/strict'
import elk from '../plugins/builtin/elk-layout.js'

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
