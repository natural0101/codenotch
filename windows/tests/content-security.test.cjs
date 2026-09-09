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
test('usage refreshes preserve the running indicator and do not reset its animation', () => {
  let stateWrites = 0, ringWrites = 0, currentState = 'idle', workState = 'running';
  const dataset = {get state(){return currentState;}, set state(v){stateWrites++;currentState=v;}};
  const indicator = {dataset};
  const ring = {set innerHTML(value){ringWrites++;}};
  const classList = {toggle(){}};
  const elements = {'svg.ring':ring,'.pct':{},'.glyph':{classList},'.ringwrap':{classList},'.activity-indicator':indicator};
  const cell = {querySelector:selector=>elements[selector]};
  const pill = {dataset:{cells:'codex:-'},querySelector:()=>cell,set innerHTML(value){throw new Error('Cell was recreated');}};
  const snapshot = {status:'ok',windows:[{used:0.2}]};
  const c = vm.createContext({pill,glyphs:{},providers:()=>[{id:'codex',snap:snapshot}],
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
  const c = vm.createContext({document:{getElementById:()=>card}, hoverId:'codex', stateSnap:{sessions:[]}, activity:[], placeCard:()=>{}, glyphHtml:()=>'', staleOf:()=>false, tone:()=>'', resetCopy:()=>'',
    providers:()=>[{id:'codex',name:'Codex',snap:{status:'ok',windows:[{label:'<img onerror="alert(1)">',used:0.5}],note:'<svg onload="alert(1)">',fetched_at:0}}]});
  const fn = script.slice(script.indexOf('function renderCard()'),script.indexOf('// The card follows'));
  vm.runInContext(escapeFunction+'\n'+fn+'\nrenderCard();', c);
  assert.ok(!card.innerHTML.includes('<svg') && !card.innerHTML.includes('<img'));
  assert.ok(card.innerHTML.includes('&lt;svg') && card.innerHTML.includes('&lt;img'));
});
test('CSP blocks objects, frames, inline handlers and external connections', () => {
  const csp = JSON.parse(fs.readFileSync(path.join(root,'tauri.conf.json'))).app.security.csp;
  for (const directive of ["script-src 'self'", "script-src-attr 'none'", "object-src 'none'", "frame-src 'none'", "connect-src ipc: http://ipc.localhost"]) assert.ok(csp.includes(directive));
  assert.ok(!csp.includes('unsafe-eval'));
});
