const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const now=1800000000000;
class Node{constructor(tag){this.tag=tag;this.children=[];this.style={};this.events={};this.attributes={};this._text='';}set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}set innerHTML(v){throw Error('Unsafe HTML');}append(...ns){for(const n of ns)this.children.push(...(n.tag==='#fragment'?n.children:[n]));}replaceChildren(...ns){this.children=[];this.append(...ns);}setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,v){this.events[k]=v;}}
const walk=n=>[n,...n.children.flatMap(walk)],classes=(n,c)=>walk(n).filter(x=>x.className===c);
function setup(){const window={AccountsModel:require('../codenotch/ui/accounts-model.js')};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../codenotch/ui/accounts-drawer.js'),'utf8'),{window,Date:class extends Date{static now(){return now;}},document:{createElement:t=>new Node(t),createElementNS:(_,t)=>new Node(t),createDocumentFragment:()=>new Node('#fragment')}});return window.CodexDrawer;}
const profile=(id,windows)=>({id,label:id,email:id+'@example.test',active:true,snapshot:{status:'ok',fetched_at:now,windows}});
const weekly={id:'secondary',label:'Weekly limit',used:.2,resets_at:now+10000};

test('known plan is retained from the provider response while missing plan stays unknown',()=>{
 const d=setup(),host=new Node('host'),a=profile('x',[weekly]);
 const o={accounts:[a],lang:'ru',sort:'remaining',expanded:new Set(),sortChange(){},settings(){},refresh(){},expand(){}};
 a.snapshot.note='Pro · via Codex';d.render(host,o);assert.equal(classes(host,'cd-plan')[0].textContent,'PRO');
 a.snapshot.note='Live read failed';d.render(host,o);assert.equal(classes(host,'cd-plan')[0].textContent,'—');
});
test('compact drawer renders weekly only and preserves source dimensions',()=>{
 const d=setup(),host=new Node('host'),a=profile('<img onerror=x>',[weekly,{id:'spark-secondary',label:'Weekly limit',group:'Spark',used:.99},{id:'primary',label:'5h limit',used:.9}]);
 d.render(host,{accounts:[a],lang:'ru',sort:'remaining',expanded:new Set(),sortChange(){},settings(){},refresh(){},expand(){}});
 assert.equal(classes(host,'cd-percent')[0].textContent,'80%');assert.equal(classes(host,'cd-row active').length,1);assert.equal(classes(host,'cd-extra').length,0);
 assert.ok(!host.textContent.includes('Основной аккаунт'));assert.ok(!host.textContent.includes('Spark'));assert.ok(!walk(host).some(n=>n.tag==='img'));assert.ok(host.textContent.includes('<img onerror=x>'));
 const css=fs.readFileSync(path.join(__dirname,'../codenotch/ui/accounts-drawer.css'),'utf8');for(const expected of ['width:286px','height:58px','height:49px','border-radius:24px','right:28px'])assert.ok(css.includes(expected));
});
test('no weekly window means unknown, never 5h or Spark substitution; reset remains approximate',()=>{
 const d=setup(),a=profile('x',[{id:'primary',label:'5h limit',used:0},{id:'spark-secondary',group:'Spark',label:'Weekly limit',used:0}]);assert.equal(d.weekly(a),null);
 const host=new Node('host');a.snapshot.windows=[{...weekly,resets_at:now-1}];d.render(host,{accounts:[a],lang:'ru',sort:'remaining',expanded:new Set(),sortChange(){},settings(){},refresh(){},expand(){}});assert.equal(classes(host,'cd-percent')[0].textContent,'~80%');assert.ok(host.textContent.includes('Ожидаем сброса'));
});
test('extra limits require disclosure; icon controls invoke real supplied actions',()=>{
 const d=setup(),host=new Node('host'),a=profile('x',[weekly,{id:'spark',label:'5h limit',group:'Spark',used:.99}]);let expanded,refresh=0,sort=0;
 const o={accounts:[a],lang:'ru',sort:'remaining',expanded:new Set(),sortChange(){sort++;},settings(){},refresh(){refresh++;},expand:id=>expanded=id};d.render(host,o);
 classes(host,'cd-expand')[0].events.click();assert.equal(expanded,'x');o.expanded.add('x');d.render(host,o);assert.ok(host.textContent.includes('Spark'));assert.equal(classes(host,'cd-extra').length,1);
 classes(host,'cd-icon')[0].events.click();classes(host,'cd-icon').at(-1).events.click();assert.equal(sort,1);assert.equal(refresh,1);
});
test('compact sorting ignores Spark and empty state keeps one compact row',()=>{
 const d=setup(),a=profile('a',[weekly,{id:'spark',label:'Weekly limit',group:'Spark',used:1}]),b=profile('b',[{...weekly,used:.5}]);assert.equal(d.ordered([b,a],'remaining',now)[0].id,'a');
 const host=new Node('host');d.render(host,{accounts:[],lang:'ru',expanded:new Set(),sortChange(){},settings(){},refresh(){}});assert.equal(classes(host,'cd-empty').length,1);assert.ok(host.textContent.includes('Войдите в Codex'));
});
