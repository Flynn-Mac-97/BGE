import { analyzeFiles, layout } from './toolkit/analysis.js'
import { layoutCalls } from './toolkit/call-layout.js'
import { programFlow } from './toolkit/program-flow.js'
import { architectureView } from './toolkit/architecture-view.js'
import { newDocument, validateDocument, applyEdit, documentFindings, exportMermaid, exportSVG, implementationBrief } from './toolkit/document.js'
import { flowFromSource, applyFlowToSource } from './toolkit/flow.js'
import { inspectCalls } from './toolkit/javascript.js'
import { parse } from 'acorn'

const copy=value=>JSON.parse(JSON.stringify(value))
export function createSystemsWorkspace(context, services = {}) {
  const state={open:false,mode:'inspect',scope:'Engine Core',relation:'call',search:'',showCallbacks:false,selected:null,selectedEdge:null,analysis:null,loading:false,error:'',notice:'',document:newDocument(),documentId:null,revision:null,dirty:false,documents:[],source:null,sourceDraft:'',flow:null,connectFrom:null,connecting:false,view:{x:0,y:0,scale:.7},history:[],future:[],flowHistory:[],flowFuture:[],generation:0}
  let sequence=0
  state.diagramView='program'
  let viewModule, layoutCache, layoutKey, layoutPending, disposed=false, layoutRevision=0
  const prepareView=async()=>{
    if(typeof document==='undefined')return
    viewModule ||= await import('./view.js')
    await import('./workspace.css')
    await Promise.all([services.code?.ready(),services.diagram?.ready()])
  }
  const recoveryKey='systems-design:'+ (context.editor?.projectName || 'project')
  const modes=['inspect','code','design','script']
  const route=()=>{
    if(typeof window==='undefined')return
    const url=new URL(window.location.href)
    if(state.open){const hash=new URLSearchParams();hash.set('systems',state.mode);url.hash=hash.toString()}
    else if(new URLSearchParams(url.hash.slice(1)).has('systems'))url.hash=''
    window.history.replaceState(null,'',url)
  }
  const persist=()=>{
    try{globalThis.sessionStorage?.setItem(recoveryKey,JSON.stringify({document:state.document,id:state.documentId,revision:state.revision,dirty:state.dirty,
      source:state.source&&(state.sourceDraft!==state.source.text||state.flowDirty)?state.source:null,sourceDraft:state.source&&(state.sourceDraft!==state.source.text||state.flowDirty)?state.sourceDraft:null,
      flow:state.mode==='script'&&state.flowDirty?state.flow:null,flowBase:state.mode==='script'&&state.flowDirty?state.flowBase:null}))}catch{}
  }
  const recover=()=>{
    try{
      const saved=JSON.parse(globalThis.sessionStorage?.getItem(recoveryKey)||'null')
      if(saved?.dirty){state.document=validateDocument(saved.document);state.documentId=saved.id;state.revision=saved.revision;state.dirty=true;state.mode='design';state.notice='Recovered unsaved design from this tab.'}
      if(saved?.source&&typeof saved.sourceDraft==='string'&&saved.sourceDraft.length<=2_000_000){state.source=saved.source;state.sourceDraft=saved.sourceDraft;state.selected=saved.source.id;state.codeEditing=true;state.mode='inspect';state.notice='Recovered unsaved source edits. Apply checks the disk hash.'}
      if(saved?.flow&&saved.flowBase?.length<=2_000_000){state.flow=saved.flow;state.flowBase=saved.flowBase;state.flowDirty=true;state.mode='script'}
    }catch{state.notice='A recovery record could not be read; saved documents are unchanged.'}
  }
  const redraw=()=>{if(disposed)return;persist();context.redraw()}
  const arrangeGraph=(graph,key)=>{
    if(services.layout&&key!==layoutKey){
      layoutKey=key;layoutCache=null
      layoutPending=services.layout.arrange(graph).then(result=>{
        if(disposed||layoutKey!==key)return
        layoutCache={...graph,...result}
        if(state.open)redraw()
      }).catch(error=>{if(!disposed&&layoutKey===key){state.error='Graph arrangement failed: '+error.message;redraw()}})
    }
    return layoutCache||graph
  }
  const protect=()=>{if(state.dirty)throw new Error('Save this design or use Discard changes before opening another design.')}
  const protectSource=()=>{if(state.source&&(state.sourceDraft!==state.source.text||state.flowDirty))throw new Error('Apply or discard your source edits before navigating to another file.')}
  const id=prefix=>`${prefix}${Date.now().toString(36)}${(++sequence).toString(36)}`
  const commit=next=>{state.history.push(copy(state.document));if(state.history.length>100)state.history.shift();state.future=[];state.document=validateDocument(next);state.dirty=true;redraw()}
  const rememberFlow=()=>{state.flowHistory.push(copy(state.flow));if(state.flowHistory.length>100)state.flowHistory.shift();state.flowFuture=[];state.flowDirty=true}
  const file=(id)=>state.analysis?.files.find(file=>file.id===id)
  const setSource=(id,line=1)=>{
    const found=file(id);if(!found)throw new Error('Source is not in this scan; scan All source to resolve the link.')
    protectSource()
    state.source=found;state.sourceDraft=found.text;state.line=line;state.flow=null;state.codeEditing=false
  }
  const api={state,services,
    render(){return viewModule?.makeDesignWorkspace(api)},
    dispose(){disposed=true;state.open=false;layoutKey=null},
    async open(mode){await prepareView();if(disposed)return;state.open=true;recover();const requested=mode||(typeof window!=='undefined'?new URLSearchParams(window.location.hash.slice(1)).get('systems'):null);if(modes.includes(requested)&&!state.flowDirty)state.mode=requested;await api.scan();await api.list();await api.arrangeSource();route();redraw();return api.summary()},
    close(){state.open=false;route();redraw();return {open:false}},
    async scan(){
      const generation=++state.generation;state.loading=true;state.error='';redraw()
      try{const catalog=await context.files.sourceCatalog('all');const analysis=analyzeFiles(catalog.files);if(generation!==state.generation)return;state.analysis=analysis;layoutRevision++;state.catalogErrors=catalog.errors;
        if (!state.source) {
          const html = analysis.files.find(file=>file.path.endsWith('.html'))
          const entry = analysis.edges.find(edge=>edge.kind==='import'&&edge.from===html?.id&&edge.to.endsWith('.js'))?.to || analysis.nodes[0]?.id
          if(entry){state.selected=entry;setSource(entry)}
        }
        state.notice=`${analysis.nodes.length} source files · ${analysis.edges.filter(edge=>edge.kind==='call').length} resolved calls`;}
      catch(error){if(generation===state.generation)state.error=error.message;throw error}
      finally{if(generation===state.generation){state.loading=false;redraw()}}
      return api.summary()
    },
    summary(){return {files:state.analysis?.nodes.length||0,edges:state.analysis?.edges.length||0,documents:state.documents,mode:state.mode,dirty:state.dirty,error:state.error,providers:{code:!!services.code,diagram:!!services.diagram,layout:!!services.layout}}},
    filter(values){for(const key of Object.keys(values))if(!['scope','relation','search','selected','view','showCallbacks','diagramView'].includes(key))throw new Error('Unsupported graph filter');if(values.diagramView&&!['program','files','modules'].includes(values.diagramView))throw new Error('Unknown diagram view');Object.assign(state,values);state.selectedEdge=null;redraw();return api.graph()},
    graph(){
      if(state.mode==='design')return {nodes:state.document.nodes.map(node=>({...node,width:240,height:76})),edges:state.document.edges}
      if(state.mode==='script'&&state.flow)return {nodes:state.flow.nodes.map(node=>({...node,title:node.kind==='start'?'Start':node.code||node.kind,group:node.kind,width:240,height:76})),edges:state.flow.edges}
      if(state.mode==='script')return {nodes:[],edges:[]}
      if(state.mode==='inspect'&&state.diagramView==='program')return arrangeGraph(programFlow(state.analysis),'program:'+layoutRevision)
      if(state.mode==='inspect'&&state.diagramView==='modules'){const scoped=api.scopedFiles();return arrangeGraph(architectureView(scoped.nodes,scoped.edges),'modules:'+state.scope+':'+state.search+':'+layoutRevision)}
      return api.fileGraph()
    },
    scopedFiles(){
      let nodes=state.analysis?.nodes||[]
      nodes=nodes.filter(node=>(state.scope==='All source'||node.group===state.scope)&&(!state.search||`${node.path} ${node.title}`.toLowerCase().includes(state.search.toLowerCase())))
      const ids=new Set(nodes.map(node=>node.id))
      return {nodes,edges:(state.analysis?.edges||[]).filter(edge=>ids.has(edge.from)&&ids.has(edge.to))}
    },
    fileGraph(){
      let {nodes}=api.scopedFiles()
      if(!state.showCallbacks)nodes=nodes.map(node=>({...node,functions:node.functions.filter(item=>!/^callback at L\d+$/.test(item.name))}))
      const ids=new Set(nodes.map(node=>node.id))
      const edges=(state.analysis?.edges||[]).filter(edge=>edge.kind===state.relation&&ids.has(edge.from)&&ids.has(edge.to))
      const graph={nodes:layoutCalls(nodes,edges),edges}
      if(!state.analysis)return graph
      const key=JSON.stringify([layoutRevision,state.scope,state.relation,state.search,state.showCallbacks])
      return arrangeGraph(graph,key)
    },
    async arrangeSource(){api.graph();await layoutPending;return api.graph()},
    mode(mode){if(!modes.includes(mode))throw new Error('Unknown workspace mode');state.mode=mode;state.selected=mode==='inspect'||mode==='code'?state.source?.id||null:mode==='script'?state.flow?.entry||null:null;state.selectedEdge=null;state.connecting=false;state.view={x:0,y:0,scale:.7};route();redraw();return {mode}},
    select(nodeId){
      // Program-flow steps and subsystem boxes are not files; open the source they point at.
      if(state.mode==='inspect'&&(state.diagramView==='program'||state.diagramView==='modules')){
        const node=api.graph().nodes.find(node=>node.id===nodeId)
        if(node?.source){setSource(node.source.file,node.source.line||1);state.selected=nodeId;state.selectedEdge=null;state.view={x:node.x-30,y:node.y-30,scale:.7};redraw();return {selected:nodeId}}
      }
      if(state.connecting){if(!state.connectFrom){state.connectFrom=nodeId;state.notice='Now select the destination node';redraw();return}api.connect(state.connectFrom,nodeId);state.connecting=false;state.connectFrom=null;state.notice='Connection created';redraw();return}
      state.selected=nodeId;state.selectedEdge=null
      if(state.mode==='inspect'||state.mode==='code')setSource(nodeId)
      redraw();return {selected:nodeId}
    },
    edge(edgeId){state.selectedEdge=edgeId;state.selected=null;const edge=api.graph().edges.find(edge=>edge.id===edgeId);if(edge?.evidence)setSource(edge.evidence.file,edge.evidence.line);redraw();return edge},
    sourceLink(reference){setSource(reference.file,reference.line);redraw()},
    async list(){const result=await context.files.listDocuments();state.documents=result.documents;state.documentErrors=result.errors;redraw();return result},
    new(title='Untitled design'){protect();state.document=newDocument(title);state.documentId=null;state.revision=null;state.dirty=true;state.history=[];state.future=[];api.mode('design');return state.document},
    import(value){protect();state.document=validateDocument(typeof value==='string'?JSON.parse(value):value);state.documentId=null;state.revision=null;state.dirty=true;state.history=[];state.future=[];api.mode('design');return state.document},
    fromCode(){
      protect();const graph=api.fileGraph(),mapping=new Map(graph.nodes.map((node,index)=>[node.id,`n${index+1}`]));if(!graph.nodes.length)throw new Error('No source files in this scope to draft. Widen the scope or clear the file search.');if(graph.nodes.length>500)throw new Error('Filter the graph to at most 500 nodes before drafting')
      state.document={...newDocument('Design from source'),nodes:graph.nodes.map(node=>({id:mapping.get(node.id),title:node.title,kind:'system',group:node.group,x:node.x,y:node.y,description:`Observed source module: ${node.path}`,source:node.source})),edges:graph.edges.map((edge,index)=>({id:`e${index+1}`,from:mapping.get(edge.from),to:mapping.get(edge.to),kind:edge.kind==='call'?'calls':'depends',label:edge.label}))}
      state.documentId=null;state.revision=null;state.dirty=true;state.history=[];state.future=[];api.mode('design');return state.document
    },
    async load(documentId,backup=false){protect();const saved=await context.files.readDocument(documentId,backup);if(!saved)throw new Error('No saved document found');state.document=validateDocument(saved.data);state.documentId=documentId;state.revision=backup?(await context.files.readDocument(documentId))?.revision:saved.revision;state.dirty=backup;state.history=[];state.future=[];api.mode('design');return state.document},
    async save(asCopy=false){
      const document=validateDocument(state.document);const documentId=asCopy||!state.documentId?id('design-'):state.documentId
      const saved=await context.files.writeDocument(documentId,document,asCopy?null:state.revision)
      state.documentId=documentId;state.revision=saved.revision;state.dirty=JSON.stringify(state.document)!==JSON.stringify(document);state.notice='Saved '+document.title;await api.list();redraw();return {id:documentId,revision:saved.revision}
    },
    async discard(){const wasDirty=state.dirty;state.dirty=false;try{if(state.documentId)await api.load(state.documentId);else{state.document=newDocument();state.history=[];state.future=[];redraw()}}catch(error){state.dirty=wasDirty;redraw();throw error}},
    edit(edit){commit(applyEdit(state.document,edit));return state.document},
    addNode(kind='system'){const node={id:id('n'),title:'New '+kind,kind,x:80+(state.document.nodes.length%3)*280,y:80+Math.floor(state.document.nodes.length/3)*130};api.edit({type:'add-node',node});state.selected=node.id;redraw();return node},
    connect(from,to,kind='depends',label='depends on'){
      if(state.mode==='script'){rememberFlow();const next=copy(state.flow);const port=state.flowPort||'next';next.edges=next.edges.filter(edge=>!(edge.from===from&&edge.port===port));next.edges.push({id:id('fedge'),from,to,port,label:port});state.flow=next;redraw();return}
      return api.edit({type:'add-edge',edge:{id:id('e'),from,to,kind,label}})
    },
    move(nodeId,x,y){if(state.mode==='design')api.edit({type:'node',id:nodeId,values:{x:Math.round(x),y:Math.round(y)}});else if(state.mode==='script'){const node=state.flow.nodes.find(node=>node.id===nodeId);node.x=x;node.y=y;redraw()}},
    remove(){if(state.mode==='script'){rememberFlow();if(state.selected===state.flow.entry)throw new Error('Start cannot be removed');state.flow.nodes=state.flow.nodes.filter(node=>node.id!==state.selected);state.flow.edges=state.flow.edges.filter(edge=>edge.id!==state.selectedEdge&&edge.from!==state.selected&&edge.to!==state.selected);redraw();return}if(state.selected)api.edit({type:'remove-node',id:state.selected});else if(state.selectedEdge)api.edit({type:'remove-edge',id:state.selectedEdge});state.selected=null;state.selectedEdge=null;redraw()},
    undo(){if(state.mode==='script'){if(!state.flowHistory.length)return;state.flowFuture.push(copy(state.flow));state.flow=state.flowHistory.pop();state.flowDirty=true;redraw();return}if(!state.history.length)return;state.future.push(copy(state.document));state.document=state.history.pop();state.dirty=true;redraw()},
    redo(){if(state.mode==='script'){if(!state.flowFuture.length)return;state.flowHistory.push(copy(state.flow));state.flow=state.flowFuture.pop();state.flowDirty=true;redraw();return}if(!state.future.length)return;state.history.push(copy(state.document));state.document=state.future.pop();state.dirty=true;redraw()},
    async arrange(){const document=state.document;const arranged=services.layout?await services.layout.arrange(document):{nodes:layout(document.nodes)};if(disposed||state.document!==document)return;const positions=Object.fromEntries(arranged.nodes.map(node=>[node.id,{x:node.x,y:node.y}]));api.edit({type:'layout',positions})},
    findings(){return state.mode==='design'?documentFindings(state.document,state.analysis?.files||[]):[...(state.analysis?.findings||[]),...(state.catalogErrors||[]).map(message=>({kind:'scan',message}))]},
    export(format){const document=validateDocument(state.document);if(format==='json')return JSON.stringify(document,null,2);if(format==='svg')return exportSVG(document);if(format==='mermaid')return exportMermaid(document);if(format==='brief')return implementationBrief(document,state.analysis?.files||[]);throw new Error('Unknown export format')},
    functions(){return state.source?inspectCalls(state.sourceDraft).functions:[]},
    focusFunction(start){const fn=api.functions().find(item=>item.start===start);if(!fn)throw new Error('That function is not in the open file');state.line=fn.line;redraw();return {line:fn.line}},
    editSource(text){state.sourceDraft=text;persist()},
    discardSource(){if(state.source)state.sourceDraft=state.source.text;state.flow=null;state.flowDirty=false;if(state.mode==='script')state.mode='code';route();redraw()},
    visual(start){if(!state.source)throw new Error('Select a source file first');const fn=api.functions().find(item=>item.start===Number(start));state.flow=flowFromSource(state.sourceDraft,Number(start));state.flowDirty=false;state.flowHistory=[];state.flowFuture=[];state.flowBase=state.sourceDraft;state.mode='script';if(fn)state.line=fn.line;state.selected=state.flow.entry;state.selectedEdge=null;state.view={x:0,y:0,scale:.7};route();redraw();return state.flow},
    flowEdit(values){const node=state.flow?.nodes.find(node=>node.id===state.selected);if(!node)throw new Error('Select a flow node');if(node.kind==='start')throw new Error('Start marks function entry and has no editable code');rememberFlow();Object.assign(node,values);state.flowDirty=true;redraw()},
    flowAdd(kind='code'){if(!['code','if','while','return'].includes(kind))throw new Error('Unsupported flow node');const node={id:id('f'),kind,code:kind==='if'||kind==='while'?'true':'',x:400,y:80};rememberFlow();state.flow.nodes.push(node);state.flowDirty=true;state.selected=node.id;redraw()},
    previewFlow(){state.sourceDraft=applyFlowToSource(state.flowBase,state.flow);state.flowDirty=false;state.notice='Preview updated. Apply to source writes the selected file.';redraw();return state.sourceDraft},
    async applySource(){if(state.mode==='script'&&state.flowDirty)throw new Error('Preview generated code before applying flow changes');if(!state.source)throw new Error('No source selected');parse(state.sourceDraft,{ecmaVersion:'latest',sourceType:'module'});const result=await context.files.writeSource(state.source.scope,state.source.path,state.sourceDraft,state.source.hash);state.source.text=state.sourceDraft;state.source.hash=result.hash;state.notice='Source saved; the host may reload this page.';redraw();return result},
    safe(action){return Promise.resolve().then(action).catch(error=>{state.error=error.message;redraw();return {error:error.message}})},
    notify: redraw
  }
  return api
}
