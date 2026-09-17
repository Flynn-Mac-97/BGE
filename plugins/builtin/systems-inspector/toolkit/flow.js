import { parse, parseExpressionAt } from 'acorn'

const functionType = node => ['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)
function findFunction(tree, start) {
  if (functionType(tree) && tree.start === start) return tree
  for (const value of Object.values(tree)) for (const child of Array.isArray(value) ? value : [value]) {
    if (child?.type) { const found = findFunction(child,start); if (found) return found }
  }
  return null
}
/** Convert one function without evaluating it. Other source ranges remain untouched. */
export function flowFromSource(source, start) {
  const comments=[]
  const tree = parse(source,{ecmaVersion:'latest',sourceType:'module',onComment:comments})
  const fn = findFunction(tree,start)
  if (!fn) throw new Error('Select a function before opening visual scripting')
  if (fn.generator) throw new Error('Generator functions stay in the source editor; visual conversion is not supported')
  const nodes=[], edges=[]
  const add = (kind,code='') => { const node={id:`f${nodes.length+1}`,kind,code}; nodes.push(node); return node }
  const link = (from,to,port='next') => { if (to) edges.push({id:`e${edges.length+1}`,from,to,port,label:port}) }
  const block = (statements,next) => {
    let cursor=next
    for (const statement of [...statements].reverse()) {
      if (statement.type==='ReturnStatement') { const node=add('return',statement.argument?source.slice(statement.argument.start,statement.argument.end):''); cursor=node.id }
      else if (statement.type==='IfStatement') {
        const node=add('if',source.slice(statement.test.start,statement.test.end)); node.join=cursor
        const asBlock=statement=>statement?.type==='BlockStatement'?statement.body:statement?[statement]:[]
        link(node.id,block(asBlock(statement.consequent),cursor),'yes')
        link(node.id,block(asBlock(statement.alternate),cursor),'no')
        if (cursor) link(node.id,cursor,'after')
        cursor=node.id
      } else if (statement.type==='WhileStatement') {
        const node=add('while',source.slice(statement.test.start,statement.test.end))
        link(node.id,block(statement.body.type==='BlockStatement'?statement.body.body:[statement.body],node.id),'body')
        link(node.id,cursor,'next'); cursor=node.id
      } else { const node=add('code',source.slice(statement.start,statement.end)); link(node.id,cursor); cursor=node.id }
    }
    return cursor
  }
  const body=fn.body.type==='BlockStatement'?fn.body.body:[{type:'ReturnStatement',argument:fn.body}]
  const first=block(body,null), entry=add('start')
  link(entry.id,first)
  const ordered=[],seen=new Set()
  function order(id,depth=0) { if(!id||seen.has(id))return; seen.add(id); const node=nodes.find(node=>node.id===id); node.x=60+depth*290;node.y=40+ordered.length*115;ordered.push(node);for(const edge of edges.filter(edge=>edge.from===id&&edge.port!=='after'))order(edge.to,depth+(edge.port==='no'?1:0)) }
  order(entry.id)
  const prefix=source.slice(fn.start,fn.body.start)
  return {version:1,comments:comments.filter(comment=>comment.start>=fn.start&&comment.end<=fn.end).map(comment=>source.slice(comment.start,comment.end)),start:fn.start,end:fn.end,prefix,async:!!fn.async,name:fn.id?.name||'Selected function',entry:entry.id,nodes:ordered,edges}
}
const expression = text => {
  if (!text.trim()) throw new Error('Condition or expression is empty')
  const parsed=parseExpressionAt(text,0,{ecmaVersion:'latest',allowAwaitOutsideFunction:true})
  if(text.slice(parsed.end).trim())throw new Error('Expected one expression')
}
export function compileFlow(flow) {
  if (!flow || flow.version!==1 || !Array.isArray(flow.nodes)||!Array.isArray(flow.edges)||flow.nodes.length>500) throw new Error('Invalid visual script')
  const byId=new Map(flow.nodes.map(node=>[node.id,node]))
  if(byId.size!==flow.nodes.length||!byId.has(flow.entry))throw new Error('Duplicate nodes or missing Start node')
  for(const edge of flow.edges)if(!byId.has(edge.from)||!byId.has(edge.to))throw new Error('A connection points to a missing node')
  const visited=new Set()
  const target=(id,port)=>{
    const matches=flow.edges.filter(edge=>edge.from===id&&edge.port===port)
    if(matches.length>1)throw new Error(`Node ${id} has multiple ${port} connections`)
    return matches[0]?.to
  }
  const indent=text=>text.split('\n').map(line=>line?'  '+line:'').join('\n')
  const render=(id,stop,active=new Set())=>{
    if(!id||id===stop)return ''
    if(active.has(id))throw new Error('Use an explicit While node for cycles')
    active=new Set(active);active.add(id);visited.add(id)
    const node=byId.get(id)
    const next=()=>render(target(id,'next'),stop,active)
    if(node.kind==='start')return next()
    if(node.kind==='return'){if(node.code.trim())expression(node.code);return `return${node.code.trim()?' '+node.code:''};\n`}
    if(node.kind==='code'){
      return node.code+'\n'+next()
    }
    if(node.kind==='if'){
      expression(node.code)
      const join=target(id,'after')
      return `if (${node.code}) {\n${indent(render(target(id,'yes'),join,active))}} else {\n${indent(render(target(id,'no'),join,active))}}\n${render(join,stop,active)}`
    }
    if(node.kind==='while'){
      expression(node.code)
      return `while (${node.code}) {\n${indent(render(target(id,'body'),id,active))}}\n`+next()
    }
    throw new Error(`Unsupported flow node: ${node.kind}`)
  }
  let body=render(flow.entry)
  body=(flow.comments||[]).filter(comment=>!body.includes(comment)).join('\n')+'\n'+body
  if(visited.size!==flow.nodes.length)throw new Error('Unconnected flow nodes must be connected or removed before applying')
  const replacement=flow.prefix+'{\n'+body.split('\n').filter(Boolean).map(line=>'  '+line).join('\n')+'\n}'
  return replacement
}
export function applyFlowToSource(source,flow) {
  const replacement=compileFlow(flow)
  const result=source.slice(0,flow.start)+replacement+source.slice(flow.end)
  parse(result,{ecmaVersion:'latest',sourceType:'module'})
  return result
}
