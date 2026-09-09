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
