const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '../codenotch');
const html = fs.readFileSync(path.join(root, 'ui/notch.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const glyphFunction = script.slice(script.indexOf('function glyphHtml('), script.indexOf('// Provider table'));
const escapeFunction = script.match(/function esc\(s\)\{[^\n]+/)[0];
const context = vm.createContext({glyphs:{}});
vm.runInContext(glyphFunction + '\n' + escapeFunction, context);
const provider = {id:'codex',name:'Codex',glyph:'Cx'};

test('complete UI JavaScript parses', () => { new vm.Script(script); });
test('native hit regions follow panel, card visibility, and DPI without a full-window rectangle', () => {
  let expanded=false;
  const pill={style:{},rect:[540,140,140,640]};
  const card={rect:[20,180,492,420],classList:{contains:()=>expanded}};
  const c=vm.createContext({pill,card,window:{devicePixelRatio:2},rectOf:el=>el.rect});
  const fn=script.slice(script.indexOf('function visibleHitRects()'),script.indexOf('function updateHitRegions()'));
  vm.runInContext(fn,c);
  assert.equal(c.visibleHitRects().length,3);
  assert.ok(c.visibleHitRects().every(r=>r[0]>=540));
  expanded=true;
  assert.equal(c.visibleHitRects().length,4);
  assert.equal(c.visibleHitRects()[3],card.rect);
  expanded=false;
  assert.equal(c.visibleHitRects().length,3);
  pill.style.display='none';
  assert.equal(c.visibleHitRects().length,0);
});
test('usage refreshes preserve the running indicator and do not reset its animation', () => {
  let stateWrites = 0, ringWrites = 0, currentState = 'idle', workState = 'running';
  const dataset = {get state(){return currentState;}, set state(v){stateWrites++;currentState=v;}};
  const indicator = {dataset};
  const ring = {set innerHTML(value){ringWrites++;}};
  const classList = {toggle(){}};
  const elements = {'svg.ring':ring,'.pct':{},'.glyph':{classList},'.ringwrap':{classList},'.activity-indicator':indicator};
  const cell = {querySelector:selector=>elements[selector]};
  const pill = {style:{},dataset:{cells:'codex:-'},querySelector:()=>cell,set innerHTML(value){throw new Error('Cell was recreated');}};
  const snapshot = {status:'ok',windows:[{used:0.2}]};
  const c = vm.createContext({pill,glyphs:{},updateHitRegions:()=>{},providers:()=>[{id:'codex',snap:snapshot}],
    headlineOf:s=>s.windows[0],workState:()=>workState,TRACK:'#333',tone:()=>'#fff',staleOf:()=>false});
  const arc = script.slice(script.indexOf('function svgArc('),script.indexOf('function headline()'));
  const render = script.slice(script.indexOf('function renderRing()'),script.indexOf('function resetCopy('));
  vm.runInContext(arc+'\n'+render, c);
  c.renderRing();
  c.renderRing();
  assert.equal(stateWrites,1);
  assert.equal(ringWrites,1);
  snapshot.windows[0].used=0.4;
  c.renderRing();
  assert.equal(ringWrites,2);
  assert.equal(stateWrites,1);
  workState='attention';
  c.renderRing();
  assert.equal(currentState,'attention');
  assert.equal(stateWrites,2);
});
test('malicious SVG stays inside an image URL, never document markup', () => {
  for (const payload of ['<svg\nonload="alert(1)"></svg>', '<svg><script>alert(1)</script></svg>', '<svg><foreignObject><iframe src="https://example.com"/></foreignObject></svg>']) {
    const url = 'data:image/svg+xml;base64,' + Buffer.from(payload).toString('base64');
    context.glyphs.codex = {kind:'svg',url};
    const result = context.glyphHtml(provider,false);
    assert.ok(result.startsWith('<img '));
    assert.ok(result.includes('src="'+url+'"'));
    assert.ok(!result.includes('<svg') && !result.includes('<script') && !result.includes('<iframe'));
  }
});
test('raw markup, remote URLs and attribute breakouts are rejected', () => {
  for (const glyph of [
    {kind:'svg',svg:'<svg onload="alert(1)"></svg>'},
    {kind:'png',url:'https://example.com/track.png'},
    {kind:'svg',url:'javascript:alert(1)'},
    {kind:'png',url:'data:image/png;base64,AA==" onerror="alert(1)'},
    {kind:'png" onload="alert(1)',url:'data:image/png;base64,AA=='},
  ]) {
    context.glyphs.codex = glyph;
    assert.equal(context.glyphHtml(provider,false), 'Cx');
  }
});
test('text and attribute delimiters are escaped', () => {
  assert.equal(context.esc('<img src=x onerror="alert(1)">\'&'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;');
  assert.equal(context.esc(null), '');
});
test('usage card escapes provider notes and labels', () => {
  const card = {innerHTML:''};
  const c = vm.createContext({document:{getElementById:()=>card}, hoverId:'codex', stateSnap:{sessions:[]}, activity:[], placeCard:()=>{},updateHitRegions:()=>{}, glyphHtml:()=>'', staleOf:()=>false, tone:()=>'', resetCopy:()=>'',
    providers:()=>[{id:'codex',name:'Codex',snap:{status:'ok',windows:[{label:'<img onerror="alert(1)">',used:0.5}],note:'<svg onload="alert(1)">',fetched_at:0}}]});
  const fn = script.slice(script.indexOf('function renderCard()'),script.indexOf('// The card follows'));
  const tasks=script.slice(script.indexOf('const expandedProviders='),script.indexOf('function renderCard()'));
  vm.runInContext(escapeFunction+'\n'+tasks+'\n'+fn+'\nrenderCard();', c);
  assert.ok(!card.innerHTML.includes('<svg') && !card.innerHTML.includes('<img'));
  assert.ok(card.innerHTML.includes('&lt;svg') && card.innerHTML.includes('&lt;img'));
});
test('compact tasks truncate text, keep status separate, and expand beyond three', () => {
  const c=vm.createContext({AMBER:'#fb0',RUNGREEN:'#0f0',stateSnap:{sessions:[]},
    activity:Array.from({length:5},(_,i)=>({provider:'codex',state:i===4?'waiting':'busy',name:'Задача '+i+' <img onerror="x"> '+ 'длинный текст '.repeat(100)}))});
  const tasks=script.slice(script.indexOf('const expandedProviders='),script.indexOf('function renderCard()'));
  vm.runInContext(escapeFunction+'\n'+tasks,c);
  const compact=c.renderTasks('codex');
  assert.equal((compact.match(/class="s-row"/g)||[]).length,3);
  assert.ok(compact.includes('Ещё 2'));
  assert.ok(compact.indexOf('Ждёт ответа')<compact.indexOf('Работает'));
  assert.ok(!compact.includes('<img'));
  assert.equal(Array.from(c.shortTaskName('я'.repeat(1000))).length,88);
  assert.ok(compact.includes('class="s-title"') && compact.includes('class="s-status"'));
  vm.runInContext("expandedProviders.add('codex')",c);
  const expanded=c.renderTasks('codex');
  assert.equal((expanded.match(/class="s-row"/g)||[]).length,5);
  assert.ok(expanded.includes('Свернуть'));
  vm.runInContext("expandedProviders.clear()",c);
  assert.equal((c.renderTasks('codex').match(/class="s-row"/g)||[]).length,3);
  c.stateSnap.sessions=[{state:'idle',title:'Idle'},{state:'done',title:'Done'},{state:'running',title:'Active'}];
  assert.equal(c.taskRows('claude').length,1);
  assert.equal(c.taskRows('claude')[0].name,'Active');
});
test('hidden providers disappear, forced providers remain without data, all-hidden is valid', () => {
  const c=vm.createContext({usage:{status:'ok'},codexSnap:{status:'ok'},cursorSnap:{status:'absent'},agSnap:{status:'absent'}});
  const providers=script.slice(script.indexOf('let providerVisibility='),script.indexOf('function headlineOf('));
  vm.runInContext(providers,c);
  assert.equal(c.providers().length,0);
  vm.runInContext('providerVisibility={claude:false,codex:true,cursor:true,gemini:false}',c);
  assert.deepEqual(Array.from(c.providers(),p=>p.id),['codex','cursor']);
});
test('CSP blocks objects, frames, inline handlers and external connections', () => {
  const csp = JSON.parse(fs.readFileSync(path.join(root,'tauri.conf.json'))).app.security.csp;
  for (const directive of ["script-src 'self'", "script-src-attr 'none'", "object-src 'none'", "frame-src 'none'", "connect-src ipc: http://ipc.localhost"]) assert.ok(csp.includes(directive));
  assert.ok(!csp.includes('unsafe-eval'));
});
