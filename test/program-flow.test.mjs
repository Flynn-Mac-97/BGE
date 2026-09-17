import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeFiles } from '../plugins/builtin/systems-inspector/toolkit/analysis.js'
import { programFlow } from '../plugins/builtin/systems-inspector/toolkit/program-flow.js'

const analyze = text => analyzeFiles([{path:'index.html',text:'<script src="./main.js"></script>'},{path:'main.js',text}])

test('startup flow follows the invoked function, marks await, and omits callback bodies',()=>{
  const result=programFlow(analyze('async function launch(){ await load(); bus.on("ready",()=>later()); draw(); setInterval(()=>tick(),100); } launch()'))
  assert.deepEqual(result.nodes.map(node=>node.title),['index.html','main.js','launch()','load()','bus.on("ready")','draw()','setInterval()','launch() completes'])
  assert.equal(result.nodes[3].group,'Await completion')
  assert.equal(result.nodes[4].group,'Register / schedule callback')
  assert.equal(result.edges.length,result.nodes.length-1)
  result.nodes.forEach((node,index)=>{if(index)assert.ok(node.x>result.nodes[index-1].x);assert.ok(node.source.line>=1)})
})

test('a call step links to the definition it runs, in-file and across files',()=>{
  const local=programFlow(analyze('function open(){ return 1 } function launch(){ open() } launch()'))
  assert.deepEqual(local.nodes.find(node=>node.title==='open()').definition,{file:'source:main.js',line:1})
  const cross=programFlow(analyzeFiles([
    {path:'index.html',text:'<script src="./main.js"></script>'},
    {path:'main.js',text:'import { boot } from "./lib.js"\nfunction launch(){ boot() }\nlaunch()'},
    {path:'lib.js',text:'\nexport function boot(){ return 2 }'}
  ]))
  assert.deepEqual(cross.nodes.find(node=>node.title==='boot()').definition,{file:'source:lib.js',line:2})
})

test('nested calls follow evaluation order and conditional entries are not shown as linear',()=>{
  const result=programFlow(analyze('function launch(){ consume(produce()) } launch()'))
  assert.deepEqual(result.nodes.slice(3,-1).map(node=>node.title),['produce()','consume()'])
  assert.match(programFlow(analyze('function launch(){ if(ready) run(); } launch()')).message,/branches/)
  assert.equal(programFlow(analyze('function launch(){ ready && run(); } launch()')).nodes.length,0)
  assert.equal(programFlow(analyzeFiles([])).nodes.length,0)
})
