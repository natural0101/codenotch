const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../codenotch/ui/notch.js'),'utf8');
function fixture(){
 class Node{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.events={};this.classes=new Set();this.classList={contains:n=>this.classes.has(n),toggle:(n,on)=>on?this.classes.add(n):this.classes.delete(n),remove:n=>this.classes.delete(n)};this.isConnected=true;}append(...ns){this.children.push(...ns);}replaceChildren(...ns){this.children=ns;}set innerHTML(v){this.children=[];this.markup=v;}setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,fn){this.events[k]=fn;}focus(){this.focused=true;}}
 const card=new Node('card'),rootNode=new Node('root'),calls=[],renders=[],timers=[],windowEvents={};card.classes.add('show');
 const context={card,uiLang:'ru',hoverId:'codex',codexSnap:{windows:[]},drawerPreferences:{showTodos:true},moduleSection:'todos',moduleEditing:false,hideTimer:null,explicitDrawerUntil:0,
 document:{getElementById:id=>id==='root'?rootNode:card,createElement:tag=>new Node(tag)},window:{addEventListener:(k,fn)=>windowEvents[k]=fn,CodenotchModules:{render:(host,o)=>{const input=new Node('input');input.value='unsaved';host.append(input);renders.push({host,o,input});}},CodexDrawer:{render:host=>host.append(new Node('quota'))}},
 invoke:(cmd,args)=>{calls.push({cmd,args});return Promise.resolve();},notice(){},clearTimeout(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return 1;},placeCard(){},armWatchdog(){},renderRing(){},providers:()=>[{id:'claude',name:'Claude',snap:{windows:[]}}],hideCard(){},glyphHtml:()=>'',staleOf:()=>false,textCopy:s=>s,esc:s=>s,renderTasks:()=>'',scalePct:100,wireScaleRow(){},codexAccounts:[],accountSort:'remaining',accountExpanded:new Set(),accountRefreshing:false,redrawAccounts(){}};
 vm.createContext(context);
 const renderer=source.slice(source.indexOf('function renderAccountsDrawer(host){'),source.indexOf("card.addEventListener('contextmenu'",source.indexOf('function renderAccountsDrawer(host){')));
 const renderCard=source.slice(source.indexOf('function renderCard(){'),source.indexOf('// The card follows'));
 const language=source.slice(source.indexOf('function setUiLanguage(lang){'),source.indexOf('// Notch size, as a percentage'));
 const edit=source.slice(source.indexOf('function setModuleEditing(value){'),source.indexOf("let accountSort='remaining'",source.indexOf('function setModuleEditing(value){')));
 const hide=source.match(/function scheduleHide\(\)\{[^\n]+/)[0];
 vm.runInContext(renderer+'\n'+renderCard+'\n'+language+'\n'+edit+'\n'+hide,context);
 return {context,card,calls,renders,timers,windowEvents};
}
test('quota refresh and closing/reopening preserve live module inputs',()=>{
 const f=fixture();f.context.renderCard();const input=f.renders[0].input;input.value='draft survives';f.context.renderCard();assert.equal(f.renders.length,1);assert.equal(f.renders[0].input.value,'draft survives');
 f.card.classes.delete('show');f.card.classes.add('show');f.context.renderCard();assert.equal(f.renders.length,1);
});
test('visiting another provider invalidates module DOM cache before returning',()=>{
 const f=fixture();f.context.renderCard();assert.equal(f.renders.length,1);
 f.context.hoverId='claude';f.context.renderCard();assert.ok(f.card.markup.includes('Claude'));
 f.context.hoverId='codex';f.context.renderCard();assert.equal(f.renders.length,2);assert.equal(f.renders[1].o.section,'todos');
});
test('language update refreshes module labels instead of reusing stale locale',()=>{
 const f=fixture();f.context.renderCard();assert.equal(f.renders[0].o.lang,'ru');f.context.setUiLanguage('en');assert.equal(f.renders.at(-1).o.lang,'en');
});
test('editing holds collapse and blur releases native editing before grace timeout',()=>{
 const f=fixture();f.context.setModuleEditing(true);assert.equal(f.calls.at(-1).cmd,'set_drawer_editing');assert.equal(f.calls.at(-1).args.editing,true);
 f.context.scheduleHide();assert.equal(f.timers.length,0);f.windowEvents.blur();assert.equal(f.calls.at(-1).args.editing,false);assert.equal(f.timers.at(-1).ms,450);
});
test('input pointer activation focuses after native activation resolves',async()=>{
 const f=fixture(),input={isConnected:true,matches:q=>q.includes('input'),focus(){this.focused=true;}};f.card.events.pointerdown({target:input});assert.equal(input.focused,undefined);await Promise.resolve();assert.equal(input.focused,true);assert.equal(f.calls.at(-1).args.editing,true);
});

test('checkbox clicks do not enter native text-edit mode',()=>{
 const f=fixture(),checkbox={isConnected:true,matches:q=>q.includes('input')&&!q.includes(':not([type=checkbox])'),focus(){this.focused=true;}};
 f.card.events.pointerdown({target:checkbox});assert.equal(f.calls.length,0);assert.equal(f.context.moduleEditing,false);
});
