const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const model=require('../codenotch/ui/accounts-model.js');
const script=fs.readFileSync(path.join(__dirname,'../codenotch/ui/accounts.js'),'utf8');
const now=1800000000000;

// A minimal DOM surface, deliberately rejecting HTML parsing. The real panel script runs
// unchanged, including its asynchronous IPC bootstrap and event listeners.
class Node {
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.attributes={};this.events={};this.hidden=false;this.disabled=false;this.value='';this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(n=>typeof n==='string'?n:n.textContent).join('');}
 set innerHTML(_){throw new Error('Account data must never be parsed as HTML');}
 append(...nodes){for(const node of nodes)this.children.push(...(node.tag==='#fragment'?node.children:[node]));}
 replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(name,fn){this.events[name]=fn;}
}
const walk=node=>[node,...node.children.filter(x=>typeof x!=='string').flatMap(walk)];
const findClass=(node,name)=>walk(node).filter(n=>n.className===name);
const profile=(id,used,reset,extra={})=>({id,label:id,email:id+'@example.test',active:false,snapshot:{status:'ok',fetched_at:now,windows:[{id:'5h',label:'5h limit',used,resets_at:reset}]},...extra});
async function fixture(profiles,language='ru'){
 const nodes=new Map(),events={},calls=[],saved=new Map(),timers=new Map();let nextTimer=0;
 const document={documentElement:{},getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);},createElement:tag=>new Node(tag),createDocumentFragment:()=>new Node('#fragment')};
 const context=vm.createContext({document,Date:class extends Date{static now(){return now;}},window:{AccountsModel:model,__TAURI__:{core:{invoke:async command=>{calls.push(command);if(command==='get_state')return {lang_resolved:language};if(command==='get_codex_accounts')return profiles;if(command==='refresh_usage')return;}},event:{listen:async(name,fn)=>{events[name]=fn;return ()=>{};}}}},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),setInterval:()=>0});
 vm.runInContext(script,context);
 await new Promise(resolve=>setImmediate(resolve));
 return {nodes,events,calls,saved,timers,document,get:id=>nodes.get(id)};
}
test('real accounts renderer handles profiles, hostile strings and expired data safely',async()=>{
 const malicious='<img src=x onerror="alert(1)">';
 const a=profile('main',.2,now+20000,{label:malicious,active:true});
 a.snapshot.windows.push({id:'extra',group:'<svg onload=alert(1)>',label:'Weekly limit',used:.4,resets_at:now+40000});
 const b=profile('expired',.1,now-1),c=profile('other',.5,now+10000);
 const f=await fixture([a,b,c]),host=f.get('accounts');
 assert.equal(host.children.length,3);assert.equal(f.get('empty').hidden,true);
 assert.equal(walk(host).filter(n=>n.tag==='h2')[0].textContent,malicious);
 assert.equal(walk(host).some(n=>['img','svg','script'].includes(n.tag)),false);
 assert.equal(findClass(host,'badge').length,1);assert.equal(findClass(host,'badge')[0].textContent,'Основной аккаунт');
 assert.ok(host.textContent.includes('Лимит на 5 часов'));assert.ok(host.textContent.includes('Недельный лимит'));
 assert.ok(host.textContent.includes('~90%'));assert.ok(host.textContent.includes('Сброс: ожидаем обновления'));
 assert.equal(findClass(host,'updated').length,3);
});
test('sort persists and refresh stays pending until an account event, keeping controls stable',async()=>{
 const a=profile('ample',.1,now+50000),b=profile('sooner',.8,now+10000);
 const f=await fixture([a,b],'en'),sort=f.get('sort'),refresh=f.get('refresh');
 assert.equal(walk(f.get('accounts')).find(n=>n.tag==='h2').textContent,'ample');
 sort.value='reset';sort.events.change();
 assert.equal(walk(f.get('accounts')).find(n=>n.tag==='h2').textContent,'sooner');
 assert.equal(f.saved.get('codenotch.accounts.sort'),'reset');
 await refresh.events.click();assert.equal(refresh.disabled,true);assert.equal(refresh.textContent,'Refreshing…');
 assert.equal(f.calls.filter(x=>x==='refresh_usage').length,1);
 await refresh.events.click();assert.equal(f.calls.filter(x=>x==='refresh_usage').length,1);
 f.events.codex_accounts({payload:[a]});
 assert.equal(refresh.disabled,false);assert.equal(f.timers.size,0);assert.equal(f.get('refresh'),refresh);assert.equal(f.get('sort'),sort);
 assert.equal(f.get('accounts').children.length,1);
});
test('empty profiles show actionable local-profile copy and language changes update it',async()=>{
 const f=await fixture([],'en');assert.equal(f.get('empty').hidden,false);assert.equal(f.get('accounts').children.length,0);
 assert.ok(f.get('empty').textContent.includes('~/.codex-*'));
 f.events.state({payload:{lang_resolved:'ru'}});assert.equal(f.document.documentElement.lang,'ru');assert.ok(f.get('empty').textContent.includes('Профили Codex не найдены'));
 f.events.codex_accounts({payload:[profile('new',.2,now+100)]});assert.equal(f.get('empty').hidden,true);
});
test('a missing refresh event reports pending data and restores the button',async()=>{
 const f=await fixture([profile('cached',.3,now+100)],'en');await f.get('refresh').events.click();
 const timeout=[...f.timers.values()][0];timeout();
 assert.equal(f.get('refresh').disabled,false);assert.equal(f.get('error').hidden,false);assert.ok(f.get('error').textContent.includes('still pending'));
 assert.equal(f.get('accounts').children.length,1);
});
