const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../codenotch/ui/library.js'),'utf8');
const walk=n=>[n,...n.children.flatMap(walk)],cls=(n,c)=>walk(n).filter(x=>x.className===c),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(section='memory'){
 let document;
 class Node{constructor(tag){this.tag=tag;this.children=[];this.events={};this.dataset={};this.attributes={};this.style={};this._text='';this.classList={add:c=>this.className=(this.className||'')+' '+c};this.selectionStart=0;this.selectionEnd=0;}
  set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}set innerHTML(v){throw Error('Unsafe HTML');}append(...ns){this.children.push(...ns);}prepend(n){this.children.unshift(n);}replaceChildren(...ns){this.children=ns;}
  setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,fn){this.events[k]=fn;}contains(n){return walk(this).includes(n);}querySelectorAll(q){return walk(this).filter(n=>q==='[data-focus]'&&n.dataset.focus);}focus(){document.activeElement=this;this.events.focus?.();}setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}}
 const pending=[],calls=[],host=new Node('host');document={activeElement:null,createElement:t=>new Node(t)};
 const window={__TAURI__:{core:{invoke:(cmd,args)=>{calls.push({cmd,args});return new Promise((resolve,reject)=>pending.push({cmd,args,resolve,reject}));}}}};vm.runInNewContext(source,{window,document,navigator:{clipboard:{writeText:()=>Promise.resolve()}}});
 const options={section,lang:'ru',changed(){},onEditing(){}};window.CodenotchLibrary.render(host,options);
 const next=cmd=>{const i=pending.findIndex(p=>p.cmd===cmd);assert.ok(i>=0,'pending '+cmd);return pending.splice(i,1)[0];};
 return {host,window,options,document,pending,calls,next};
}
const submit=f=>cls(f.host,'lib-form')[0].events.submit({preventDefault(){}});
const clickText=(f,text)=>{const b=walk(f.host).find(n=>n.tag==='button'&&n.textContent===text);assert.ok(b,'button '+text);b.events.click();};
test('parallel initial memory reads preserve typed focus draft, caret and deduplicate rerenders',async()=>{
 const f=fixture(),input=cls(f.host,'lib-field')[0];input.value='my new draft';input.selectionStart=5;input.selectionEnd=5;input.focus();input.events.input();
 f.window.CodenotchLibrary.render(f.host,f.options);assert.equal(f.calls.filter(c=>c.cmd==='get_focus').length,1);assert.equal(f.calls.filter(c=>c.cmd==='get_memory').length,1);
 f.next('get_focus').resolve('older saved focus');await tick();f.next('get_memory').resolve({available:false,documents:[]});await tick();
 assert.equal(cls(f.host,'lib-field')[0].value,'my new draft');assert.equal(f.document.activeElement,cls(f.host,'lib-field')[0]);assert.equal(f.document.activeElement.selectionStart,5);
});
test('failed save retains draft/error across parent render; busy fields are read-only',async()=>{
 const f=fixture();f.next('get_focus').resolve('saved');f.next('get_memory').resolve({available:false,documents:[]});await tick();let input=cls(f.host,'lib-field')[0];input.value='unsaved';input.events.input();submit(f);
 assert.equal(cls(f.host,'lib-field')[0].readOnly,true);assert.ok(walk(f.host).filter(n=>n.tag==='button').every(b=>b.disabled));
 f.next('set_focus').reject(Error('Write denied'));await tick();f.window.CodenotchLibrary.render(f.host,f.options);assert.equal(cls(f.host,'lib-field')[0].value,'unsaved');assert.ok(f.host.textContent.includes('Write denied'));assert.equal(cls(f.host,'lib-field')[0].readOnly,false);
});
test('late initial focus response cannot overwrite successfully saved new focus',async()=>{
 const f=fixture();let input=cls(f.host,'lib-field')[0];input.value='new saved';input.events.input();submit(f);f.next('set_focus').resolve('new saved');await tick();f.next('get_focus').resolve('old saved');f.next('get_memory').resolve({available:false,documents:[]});await tick();assert.equal(cls(f.host,'lib-field')[0].value,'new saved');
});
test('module switch starts independent reads and ignores stale document navigation',async()=>{
 const f=fixture('services');f.window.CodenotchLibrary.render(f.host,{...f.options,section:'memory'});assert.ok(f.calls.some(c=>c.cmd==='get_memory'));f.next('get_services').resolve([{id:'s',name:'Service',description:'x',url:'https://example.test'}]);await tick();assert.ok(!f.host.textContent.includes('Service'));
 f.next('get_focus').resolve('focus');f.next('get_memory').resolve({available:true,documents:[{id:'doc.md',title:'Doc',modified:1}]});await tick();clickText(f,'Последнее');const doc=walk(f.host).find(n=>n.tag==='button'&&n.textContent.startsWith('Doc'));doc.events.click();
 f.window.CodenotchLibrary.render(f.host,{...f.options,section:'services'});f.next('read_memory').resolve({id:'doc.md',title:'Doc',text:'late document'});await tick();assert.ok(!f.host.textContent.includes('late document'));assert.ok(f.host.textContent.includes('Service'));
});
test('service form safely retains drafts when initial catalogue arrives',async()=>{
 const f=fixture('services');clickText(f,'+ Добавить сервис');const fields=cls(f.host,'lib-field');fields[0].value='<img onerror=x>';fields[0].events.input();fields[1].value='https://example.test';fields[1].events.input();fields[2].value='my instructions';fields[2].events.input();fields[2].focus();fields[2].selectionStart=2;
 f.next('get_services').resolve([]);await tick();assert.equal(cls(f.host,'lib-field')[0].value,'<img onerror=x>');assert.equal(cls(f.host,'lib-field')[2].value,'my instructions');assert.equal(f.document.activeElement,cls(f.host,'lib-field')[2]);
 submit(f);f.next('add_service').reject(Error('Invalid service'));await tick();assert.equal(cls(f.host,'lib-field')[0].value,'<img onerror=x>');assert.ok(!walk(f.host).some(n=>n.tag==='img'));
});
