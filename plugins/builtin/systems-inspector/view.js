

export function makeDesignWorkspace(workspace) {
  const state=workspace.state,graph=workspace.graph()
  const element=(tag,className='',text)=>{const node=document.createElement(tag);node.className=className;if(text!=null)node.textContent=text;return node}
  const run=action=>()=>workspace.safe(action)
  const button=(text,action,disabled=false)=>{const node=element('button','u-btn sw-button',text);node.type='button';node.disabled=disabled;node.addEventListener('click',run(action));return node}
  const select=(label,values,value,onChange)=>{const node=element('select','sw-input');node.setAttribute('aria-label',label);for(const item of values){const option=element('option','',typeof item==='string'?item:item.label);option.value=typeof item==='string'?item:item.value;node.append(option)}node.value=value||'';if(onChange)node.addEventListener('change',run(()=>onChange(node.value)));return node}
  const field=(parent,label,value='',multiline=false)=>{const wrapper=element('label','sw-field');wrapper.append(element('span','',label));const input=element(multiline?'textarea':'input','sw-input');input.value=value||'';input.setAttribute('aria-label',label);if(multiline)input.rows=3;wrapper.append(input);parent.append(wrapper);return input}
  const download=(name,text,type='text/plain')=>{const url=URL.createObjectURL(new Blob([text],{type}));const anchor=element('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  const root=element('div','sw-root');root.setAttribute('role','dialog');root.setAttribute('aria-label','Systems Workspace');root.setAttribute('aria-modal','true')
  const header=element('header','sw-header');header.append(element('strong','','Systems Workspace'))
  const modes=[['inspect','Diagram'],['code','Code'],['design','Design'],['script','Visual Script']]
  const navigation=element('nav','sw-modes');navigation.setAttribute('aria-label','Workspace modes')
  for(const [mode,label]of modes){const choice=element('a','u-btn sw-button',label);choice.href='#systems='+mode;choice.setAttribute('aria-current',state.mode===mode?'page':'false');choice.classList.toggle('primary',state.mode===mode);choice.addEventListener('click',event=>{event.preventDefault();workspace.safe(()=>workspace.mode(mode))});navigation.append(choice)}
  header.append(navigation)
  header.append(button('Rescan source',()=>workspace.scan(),state.loading),element('span','sw-status',state.loading?'Scanning source…':state.notice),button('Close ×',()=>workspace.close()))
  root.append(header)
  const inspectTitles={program:['Program Flow','Startup calls from left to right. Select a step to read its source.'],modules:['Architecture','The main parts of this scope and how they depend on each other. Select a part to read its main file.'],files:['File Relationships','Files and function calls. Select a function to read its source.']}
  const titles={inspect:inspectTitles[state.diagramView]||inspectTitles.files,code:['Code editor','Browse and edit source. Apply writes your draft; Discard restores it.'],design:['Design workspace','Create, connect and save architecture components.'],script:['Visual script',state.flow?'Edit the selected function as a flow, then preview the generated code.':'Choose a source function below to create its visual flow.']}
  const banner=element('div','sw-mode-banner');banner.append(element('h2','',titles[state.mode][0]),element('p','',titles[state.mode][1]));root.append(banner)
  if(state.error){const error=element('div','sw-error');error.setAttribute('role','alert');error.append(element('span','',state.error),button('Dismiss',()=>{state.error='';workspace.notify()}));root.append(error)}
  const body=element('div','sw-body'+(state.mode==='code'?' sw-code-mode':'')),left=element('aside','sw-left'),centre=element('main','sw-main'),right=element('aside','sw-right')
  if(state.mode==='inspect'&&state.diagramView==='program'&&!state.selectedEdge&&!graph.nodes.some(node=>node.id===state.selected))body.classList.add('sw-program-overview')
  if(state.mode==='inspect')left.append(select('Diagram view',[{value:'program',label:'Program Flow'},{value:'modules',label:'Architecture'},{value:'files',label:'File Relationships'}],state.diagramView,value=>workspace.filter({diagramView:value,selected:null,view:{x:0,y:0,scale:.7}})))
  if(state.mode==='inspect'&&state.diagramView==='program'){
    left.append(element('h3','','Startup path'),element('p','sw-muted',graph.message),element('p','sw-muted','Select a step to bring it into view. Drag the background to follow the arrows.'))
    const steps=element('div','sw-file-list')
    graph.nodes.forEach((node,index)=>steps.append(button(`${index+1}. ${node.title}`,()=>workspace.select(node.id))))
    left.append(steps)
  }else if(state.mode==='inspect'&&state.diagramView==='modules'){
    left.append(element('h3','','Source scope'),select('Source scope',['Engine Core','Built-in Plugins','Project Plugins','Game Code','All source'],state.scope,value=>workspace.filter({scope:value,selected:null,view:{x:0,y:0,scale:.7}})))
    left.append(element('h3','','Subsystems'),element('p','sw-muted',graph.message))
    const list=element('div','sw-file-list')
    for(const node of [...graph.nodes].sort((first,second)=>first.title.localeCompare(second.title)))list.append(button(`${node.title} · ${node.group}`,()=>workspace.select(node.id)))
    left.append(list)
  }else if(state.mode==='inspect'||state.mode==='code'){
    left.append(element('h3','','Source scope'),select('Source scope',['Engine Core','Built-in Plugins','Project Plugins','Game Code','All source'],state.scope,value=>workspace.filter({scope:value,selected:null,view:{x:0,y:0,scale:.7}})))
    const search=field(left,'Find file',state.search);left.append(button('Find',()=>workspace.filter({search:search.value})));search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();workspace.safe(()=>workspace.filter({search:search.value}))}})
    // Relationship controls only make sense with the file diagram shown; Code has no diagram, so it keeps scope, search and the file list alone.
    if(state.mode==='inspect'){
      left.append(select('Connection type',[{value:'call',label:'Function calls'},{value:'import',label:'Imports'}],state.relation,value=>workspace.filter({relation:value})),element('p','sw-muted',`${graph.nodes.length} files · ${graph.edges.length} connections`),button('Create design from these files',()=>workspace.fromCode()))
      const callbacks=element('label','sw-callbacks'),toggle=element('input');toggle.type='checkbox';toggle.checked=state.showCallbacks;toggle.addEventListener('change',run(()=>workspace.filter({showCallbacks:toggle.checked})));callbacks.append(toggle,document.createTextNode('Show anonymous callbacks'));left.append(callbacks)
      left.append(element('p','sw-muted','Anonymous callback rows are optional detail. Their call connections remain included. Pan the diagram background; scroll to zoom.'))
    }
    const files=element('div','sw-file-list')
    for(const node of graph.nodes)files.append(button(node.path,()=>workspace.select(node.id)))
    left.append(files)
  }else if(state.mode==='design'){
    left.append(element('h3','','Design library'),select('Saved design',[{value:'',label:state.documents.length?'Choose a saved design':'No saved designs'},...state.documents.map(item=>({value:item.id,label:item.title}))],state.documentId,value=>value&&workspace.load(value)))
    const savedStatus=state.dirty?(state.documentId?'Unsaved changes':'New, not saved'):(state.documentId?'Saved / unchanged':'No design open')
    left.append(button('New design',()=>workspace.new()),button('Save design',()=>workspace.save()),button('Save a copy',()=>workspace.save(true)),element('p','sw-muted',savedStatus),button('Discard changes',()=>workspace.discard(),!state.dirty),button('Restore previous revision',()=>workspace.load(state.documentId,true),!state.documentId))
    const tools=element('div','sw-tools');tools.append(select('New node kind',['system','function','event','data','decision','note'],'system'))
    tools.append(button('Add node',()=>workspace.addNode(tools.querySelector('select').value)),button(state.connecting?'Cancel connection':'Connect nodes',()=>{state.connecting=!state.connecting;state.connectFrom=null;state.notice=state.connecting?'Select the source node, then the destination':'';workspace.notify()}),button('Delete selected',()=>workspace.remove(),!state.selected&&!state.selectedEdge),button('Undo',()=>workspace.undo(),!state.history.length),button('Redo',()=>workspace.redo(),!state.future.length),button('Arrange nodes',()=>workspace.arrange()))
    left.append(element('h3','','Diagram tools'),tools,element('h3','','Export'))
    for(const [format,label,extension]of [['json','Editable JSON','json'],['svg','SVG image','svg'],['mermaid','Mermaid','mmd'],['brief','AI implementation brief','md']])left.append(button(label,()=>download('systems-design.'+extension,workspace.export(format),format==='svg'?'image/svg+xml':'text/plain')))
    const upload=element('input','sw-input');upload.type='file';upload.accept='.json';upload.setAttribute('aria-label','Import design JSON');upload.addEventListener('change',run(async()=>{const file=upload.files[0];if(file){if(file.size>2_000_000)throw new Error('Import exceeds 2 MB');workspace.import(await file.text())}}));left.append(element('label','sw-muted','Import editable JSON'),upload)
  }else if(state.flow){
    left.append(element('h3','','Visual scripting'),element('p','sw-muted','Edit a structured function flow. Connections use named ports. Preview validates the complete function before it can be applied.'))
    const kinds=select('Flow node kind',['code','if','while','return'],'code');left.append(kinds,button('Add flow node',()=>workspace.flowAdd(kinds.value)),select('Connection port',['next','yes','no','after','body'],state.flowPort||'next',value=>{state.flowPort=value;workspace.notify()}),button(state.connecting?'Cancel connection':'Connect flow nodes',()=>{state.connecting=!state.connecting;state.connectFrom=null;workspace.notify()}),button('Delete selected',()=>workspace.remove()),button('Undo flow edit',()=>workspace.undo()),button('Redo flow edit',()=>workspace.redo()),button('Preview generated code',()=>workspace.previewFlow()),button('Apply to source',()=>workspace.applySource(),!!state.flowDirty))
  }else left.append(element('h3','','Choose a function'),element('p','sw-muted','Use the function selector in the source panel, then select Edit function as flow.'),button('Browse source files',()=>workspace.mode('code')))
  if(state.mode!=='code'){
    if(state.mode==='design'&&!graph.nodes.length){
      const empty=element('div','sw-empty');empty.append(element('p','','This design has no components yet. A design is architecture you author, kept separate from the scanned source graph.'))
      const actions=element('div','sw-empty-actions');actions.append(button('Create a design',()=>workspace.new()),button('Start from the source diagram',()=>workspace.fromCode()));empty.append(actions);centre.append(empty)
    }
    else if(!graph.nodes.length)centre.append(element('p','sw-empty',graph.message||'Choose a source function below, then select Edit function as flow.'))
    else centre.append(workspace.services.diagram.create({className:'sw-canvas',nodes:graph.nodes.map(node=>({...node})),edges:graph.edges,selected:state.selected,selectedEdge:state.selectedEdge,view:state.view,editable:state.mode!=='inspect',focusEdges:state.mode==='inspect',onFunction:(id,line)=>workspace.safe(()=>{workspace.select(id);workspace.sourceLink({file:id,line})}),onSelect:runId=>workspace.safe(()=>workspace.select(runId)),onEdge:edgeId=>workspace.safe(()=>workspace.edge(edgeId)),onMove:(id,x,y)=>workspace.safe(()=>workspace.move(id,x,y))}))
  }
  const selected=graph.nodes.find(node=>node.id===state.selected),edge=graph.edges.find(edge=>edge.id===state.selectedEdge)
  if(state.mode==='design'){
    if(selected){
      right.append(element('h3','','Component properties'))
      const fields=Object.fromEntries(['title','group','description','inputs','outputs','constraints','acceptance'].map(key=>[key,field(right,key[0].toUpperCase()+key.slice(1),selected[key],!['title','group'].includes(key))]))
      const source=select('Linked source',[{value:'',label:'Proposed concept — no source'},...(state.analysis?.files||[]).map(file=>({value:file.id,label:file.id}))],selected.source?.file);right.append(source)
      const line=field(right,'Source line',String(selected.source?.line||1))
      right.append(button('Apply component properties',()=>{const values=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value]));const file=state.analysis?.files.find(file=>file.id===source.value);values.source=file?{file:file.id,line:Number(line.value),fingerprint:file.fingerprint}:null;workspace.edit({type:'node',id:selected.id,values})}))
      if(selected.source)right.append(button('Open linked source',()=>workspace.sourceLink(selected.source)))
    }else if(edge){
      right.append(element('h3','','Connection contract'));const label=field(right,'Connection label',edge.label,true),kind=select('Relationship kind',['depends','calls','data','event','contains','flow'],edge.kind);right.append(kind,button('Apply connection',()=>workspace.edit({type:'edge',id:edge.id,values:{label:label.value,kind:kind.value}})))
    }else{
      right.append(element('h3','','Design intent'));const fields=Object.fromEntries(['title','purpose','constraints','decisions','acceptance'].map(key=>[key,field(right,key[0].toUpperCase()+key.slice(1),state.document[key],key!=='title')]))
      right.append(button('Apply design details',()=>workspace.edit({type:'document',values:Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value]))})))
    }
  }
  if(state.mode==='script'&&selected&&selected.kind!=='start'){right.append(element('h3','',selected.kind+' node'));const code=field(right,'Node JavaScript',selected.code,true);right.append(button('Apply flow node',()=>workspace.flowEdit({code:code.value})))}
  if(state.source&&(state.mode!=='design'||state.source.id===selected?.source?.file)){
    // A program-flow step opens at its call site. Say so, and offer a jump to the function it runs.
    const flowStep=state.mode==='inspect'&&state.diagramView==='program'?selected:null
    const atCallSite=flowStep?.definition&&state.source.id===flowStep.source?.file&&state.line===flowStep.source?.line
    right.append(element('h3','',state.source.path),element('p','sw-muted',`${atCallSite?'Call site · ':''}Line ${state.line||1} · ${state.source.scope}`))
    if(flowStep?.definition)right.append(button('Open definition',()=>workspace.sourceLink(flowStep.definition)))
    const functions=workspace.functions()
    if(functions.length){const current=functions.filter(item=>item.line<=state.line&&item.endLine>=state.line).sort((first,second)=>second.start-first.start)[0]||functions[0];const seen=new Map();const options=functions.map(fn=>{const base=`${fn.name} · L${fn.line}`;const count=(seen.get(base)||0)+1;seen.set(base,count);return {value:fn.start,label:count>1?`${base} #${count}`:base}});const choose=select('Source function',options,String(current.start),start=>workspace.focusFunction(Number(start)));right.append(choose,button('Edit function as flow',()=>workspace.visual(Number(choose.value))))}
    const editing=state.mode==='code'||state.mode==='script'||state.codeEditing
    if(state.mode==='inspect')right.append(button('Open code editor',()=>workspace.mode('code')))
    if(editing)right.append(button('Apply to source',()=>workspace.applySource(),!!state.flowDirty),button('Discard source edits',()=>workspace.discardSource()))
    else right.append(button('Edit source code',()=>{state.codeEditing=true;workspace.notify()}))
    right.append(workspace.services.code.create({className:'sw-monaco',path:`${state.source.scope}/${state.source.path}`,value:state.sourceDraft,line:state.line,readOnly:!editing,wordWrap:true,files:state.analysis?.files,onChange:text=>workspace.editSource(text)}))
  }
  const allFindings=workspace.findings()
  const findings=element('details','sw-findings');findings.append(element('summary','',`Analysis · ${allFindings.length} findings`))
  // Sort by kind so like findings sit together; link the ones that name a scanned file so a click opens it.
  const known=id=>state.analysis?.files.some(file=>file.id===id)
  for(const finding of [...allFindings].sort((first,second)=>first.kind.localeCompare(second.kind)).slice(0,100)){
    const label=`[${finding.kind}] ${finding.message}`
    if(known(finding.node)){const link=element('button','sw-finding',label);link.type='button';link.addEventListener('click',run(()=>workspace.sourceLink({file:finding.node,line:finding.line||1})));findings.append(link)}
    else findings.append(element('p','sw-muted sw-finding',label))
  }
  right.append(findings)
  body.append(left,centre,right);root.append(body)
  root.addEventListener('keydown',event=>{
    event.stopPropagation()
    if(event.target.closest('.monaco-editor'))return
    if(event.key==='Escape'){if(state.connecting){state.connecting=false;workspace.notify()}else workspace.close()}
    if(!(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLSelectElement)&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&state.mode==='design'){event.preventDefault();event.shiftKey?workspace.redo():workspace.undo()}
    if(event.key==='Tab'){const targets=[...root.querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length);const first=targets[0],last=targets.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
  })
  return root
}
