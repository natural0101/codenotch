const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../codenotch/ui/modules.js'),'utf8');
const walk=n=>[n,...n.children.flatMap(walk)];
const cls=(root,c)=>walk(root).filter(n=>n.className===c);
async function setup(initial=[]){
 let todos=initial.map(a=>({...a})),failure=null,doc;
 class Node{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.attributes={};this.dataset={};this.style={};this._text='';this.selectionStart=0;this.selectionEnd=0;}
  set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  set innerHTML(v){throw Error('Unsafe HTML');}append(...ns){for(const n of ns){n.parent=this;this.children.push(n);}}replaceChildren(...ns){this.children=[];this.append(...ns);}
  setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,fn){this.events[k]=fn;}contains(n){return walk(this).includes(n);}focus(){doc.activeElement=this;this.events.focus?.();}
  setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
  querySelector(q){return walk(this).find(n=>q.startsWith('.')?n.className===q.slice(1):n.dataset.focus===q.match(/"(.*?)"/)[1])||null;}
 }
 const calls=[],editing=[],host=new Node('host');doc={activeElement:null,createElement:t=>new Node(t)};
 const invoke=async(cmd,args)=>{calls.push({cmd,args});if(cmd===failure)throw Error('Disk write failed');
  if(cmd==='add_todo')todos.push({id:'new',text:args.text,completed:false});
  if(cmd==='update_todo'){const a=todos.find(x=>x.id===args.id);if(args.text!==null)a.text=args.text;if(args.completed!==null)a.completed=args.completed;}
  if(cmd==='delete_todo')todos=todos.filter(a=>a.id!==args.id);
  if(cmd==='reorder_todos')todos=args.ids.map(id=>todos.find(a=>a.id===id));return todos.map(a=>({...a}));
 };
 const window={__TAURI__:{core:{invoke}}};vm.runInNewContext(source,{window,document:doc});
 const options={section:'todos',lang:'ru',changed(){},onEditing:v=>editing.push(v)};
 window.CodenotchModules.render(host,options);await tick();return {host,window,options,editing,calls,doc,fail:cmd=>failure=cmd,todos:()=>todos};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const event=(extra={})=>({preventDefault(){},...extra});
test('todos load as safe text, completion disclosure and successful add preserve order',async()=>{
 const f=await setup([{id:'a',text:'<img onerror=x>',completed:false},{id:'b',text:'Done',completed:true}]);
 assert.ok(f.host.textContent.includes('<img onerror=x>'));assert.ok(!walk(f.host).some(n=>n.tag==='img'));assert.equal(cls(f.host,'cn-todo done').length,0);
 cls(f.host,'cn-completed')[0].events.click();assert.equal(cls(f.host,'cn-todo done').length,1);
 let input=cls(f.host,'cn-input')[0];input.value='  New task  ';input.events.input();cls(f.host,'cn-add')[0].events.submit(event());await tick();
 assert.equal(f.todos().at(-1).text,'New task');assert.equal(cls(f.host,'cn-input')[0].value,'');
});
test('failed save and parent rerender retain input text and selection',async()=>{
 const f=await setup();f.fail('add_todo');const input=cls(f.host,'cn-input')[0];input.focus();input.value='keep my draft';input.selectionStart=4;input.selectionEnd=4;input.events.input();
 f.window.CodenotchModules.render(f.host,f.options);assert.equal(cls(f.host,'cn-input')[0].value,'keep my draft');assert.equal(f.doc.activeElement.selectionStart,4);
 cls(f.host,'cn-add')[0].events.submit(event());await tick();assert.equal(cls(f.host,'cn-input')[0].value,'keep my draft');assert.ok(f.host.textContent.includes('Disk write failed'));
});
test('editing supports Enter and Escape; failed edits keep exact draft',async()=>{
 const f=await setup([{id:'a',text:'Original',completed:false}]);cls(f.host,'cn-todo-text')[0].events.click();let edit=cls(f.host,'cn-edit')[0];edit.value='Replacement';edit.events.input();edit.events.keydown(event({key:'Escape'}));assert.equal(f.todos()[0].text,'Original');assert.equal(cls(f.host,'cn-edit').length,0);
 cls(f.host,'cn-todo-text')[0].events.click();edit=cls(f.host,'cn-edit')[0];edit.value='Kept edit';edit.events.input();f.fail('update_todo');edit.events.keydown(event({key:'Enter'}));await tick();assert.equal(cls(f.host,'cn-edit')[0].value,'Kept edit');
 f.fail(null);cls(f.host,'cn-edit')[0].events.keydown(event({key:'Enter'}));await tick();assert.equal(f.todos()[0].text,'Kept edit');assert.equal(cls(f.host,'cn-edit').length,0);
});
test('completion, explicit context delete and drag reordering use bounded IPC',async()=>{
 const f=await setup([{id:'a',text:'A',completed:false},{id:'b',text:'B',completed:false}]);let rows=cls(f.host,'cn-todo');rows[1].events.dragstart(event({dataTransfer:{setData(){}}}));rows[0].events.drop(event());await tick();assert.deepEqual(f.todos().map(a=>a.id),['b','a']);
 const check=cls(f.host,'cn-check')[0];check.checked=true;check.events.change();await tick();assert.equal(f.todos()[0].completed,true);
 cls(f.host,'cn-todo')[0].events.contextmenu(event());assert.equal(f.calls.filter(c=>c.cmd==='delete_todo').length,0);cls(f.host,'cn-delete')[0].events.click();await tick();assert.deepEqual(f.todos().map(a=>a.id),['b']);
});
test('services and memory delegate to library renderer without requesting todo edits',async()=>{
 const f=await setup();let delegated;f.window.CodenotchLibrary={render:(host,o)=>delegated=o.section};f.window.CodenotchModules.render(f.host,{...f.options,section:'memory'});assert.equal(delegated,'memory');
});
