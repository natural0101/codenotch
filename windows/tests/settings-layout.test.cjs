const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../codenotch/ui/settings.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../codenotch/ui/settings.js'), 'utf8');

function declaration(name) {
  if (name === 'RU_STATIC') {
    const start = source.indexOf('const RU_STATIC = ') + 'const RU_STATIC = '.length;
    const end = source.indexOf('\n};', start) + 2;
    return vm.runInNewContext(`(${source.slice(start, end)})`);
  }
  const match = source.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(match, `${name} declaration exists`);
  return vm.runInNewContext(`(${match[1]})`);
}
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `${name} has a top-level closing brace`);
  return source.slice(start, end + 2);
}
function contextFor(functions, values = {}) {
  const context = vm.createContext({settingsVisibility:{},...values});
  vm.runInContext(functions.map(functionSource).join('\n'), context);
  return context;
}

test('every settings tab has one matching labelled pane and no duplicate IDs', () => {
  const tabs = Array.from(declaration('TABS'));
  assert.deepEqual(tabs, ['tray', 'notch', 'modules', 'behaviour', 'hooks', 'about']);
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const tab of tabs) {
    const button = html.match(new RegExp(`<button[^>]*id="tab-${tab}"[^>]*>`));
    const pane = html.match(new RegExp(`<section[^>]*id="pane-${tab}"[^>]*>`));
    assert.ok(button && pane, tab);
    assert.match(button[0], new RegExp(`aria-controls="pane-${tab}"`));
    assert.match(pane[0], new RegExp(`aria-labelledby="tab-${tab}"`));
  }
  assert.equal((html.match(/role="tabpanel"/g) || []).length, tabs.length);
});

test('all ten drawer toggles live in Sections and start unchecked until loaded', () => {
  const keys = Array.from(declaration('DRAWER_KEYS'));
  const section = html.match(/<section[^>]*id="pane-modules"[\s\S]*?<\/section>/)[0];
  const controls = Array.from(section.matchAll(/<input\b[^>]*data-drawer-pref="([^"]+)"[^>]*>/g));
  assert.equal(keys.length, 10);
  assert.deepEqual(controls.map(match => match[1]).sort(), [...keys].sort());
  assert.equal(new Set(controls.map(match => match[1])).size, keys.length);
  for (const control of controls) {
    assert.match(control[0], /type="checkbox"/);
    assert.match(control[0], /\bdisabled\b/);
    assert.doesNotMatch(control[0], /\bchecked\b/);
  }
  const notch = html.match(/<section[^>]*id="pane-notch"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(notch, /data-drawer-pref/);
  assert.doesNotMatch(html, /\son(?:click|change|input)\s*=/i);
});

test('tab navigation changes selected state, keyboard stop and visible pane together', () => {
  const nodes = new Map();
  const tabs = Array.from(declaration('TABS'));
  for (const tab of tabs) {
    nodes.set(`tab-${tab}`, { attributes: {}, classList: { toggle() {} }, setAttribute(k, v) { this.attributes[k] = v; }, focus() { this.focused = true; } });
    nodes.set(`pane-${tab}`, { hidden: true });
  }
  nodes.set('main', { scrollTop: 20 });
  const stored = [];
  const c = contextFor(['showTab'], { TABS: tabs, TAB_KEY: 'tab', curTab: 'tray', document: { getElementById: id => nodes.get(id) }, localStorage: { setItem: (...args) => stored.push(args) } });
  c.showTab('modules', true);
  assert.equal(nodes.get('pane-modules').hidden, false);
  assert.equal(nodes.get('pane-notch').hidden, true);
  assert.equal(nodes.get('tab-modules').attributes['aria-selected'], 'true');
  assert.equal(nodes.get('tab-modules').tabIndex, 0);
  assert.equal(nodes.get('tab-notch').tabIndex, -1);
  assert.equal(nodes.get('tab-modules').focused, true);
  assert.equal(stored.at(-1)[1], 'modules');
});

test('provider rows escape server labels, status text and attribute values', () => {
  const host = { innerHTML: '' }, note = { textContent: '' };
  const id = 'codex" data-injected="yes';
  const c = contextFor(['esc', 'settingsGlyph', 'renderNotchPreview', 'renderNotch'], {
    document: { getElementById: key => ({ 'notch-list': host, 'notch-note': note })[key] },
    settingsGlyphs: {}, settingsVisibility: {}, FALLBACK_LABEL: {},
    providerList: () => [{ id, label: '<img src=x onerror=attack()>' }],
    notchOn: () => [{ provider: id }], notchSlotOf: () => ({ provider: id }),
    statusText: () => '<script>attack()</script>', ui: (key, fallback) => fallback,
  });
  c.renderNotch();
  assert.doesNotMatch(host.innerHTML, /<img|<script| data-injected="yes/);
  assert.match(host.innerHTML, /&lt;img/);
  assert.match(host.innerHTML, /&lt;script&gt;/);
  assert.match(host.innerHTML, /data-np="codex&quot; data-injected=&quot;yes"/);
  assert.match(host.innerHTML, /role="checkbox" aria-checked="true"/);
  assert.match(host.innerHTML, /p-item on lock/);
});

test('provider SVGs remain image resources and unsafe glyph URLs use escaped fallbacks', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>attack()</script></svg>';
  const url = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const c = contextFor(['esc', 'settingsGlyph'], { settingsGlyphs: { codex: { url } }, FALLBACK_LABEL: { codex: 'Codex' } });
  const safe = c.settingsGlyph('codex');
  assert.match(safe, /^<img src="data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(safe, /<svg|<script|attack\(\)/);
  assert.match(safe, /alt=""/);
  for (const unsafe of [
    'https://example.com/icon.svg',
    'javascript:attack()',
    'data:image/svg+xml,<svg onload="attack()">',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,AAAA" onerror="attack()',
  ]) {
    c.settingsGlyphs.codex = { url: unsafe };
    assert.equal(c.settingsGlyph('codex'), '<img src="glyphs/codex.svg" alt="" class="settings-provider-image">', unsafe);
  }
  c.settingsGlyphs.codex = { svg };
  assert.equal(c.settingsGlyph('codex'), '<img src="glyphs/codex.svg" alt="" class="settings-provider-image">');
  assert.equal(c.settingsGlyph('<bad>'), '<span>&lt;</span>');
  assert.equal(c.settingsGlyph('constructor'), '<span>c</span>');
});

test('every known provider has packaged canonical artwork when absent from runtime glyphs', () => {
  const c = contextFor(['esc', 'settingsGlyph'], { settingsGlyphs: {}, FALLBACK_LABEL: {} });
  for (const id of ['claude', 'codex', 'cursor', 'gemini']) {
    assert.equal(c.settingsGlyph(id), `<img src="glyphs/${id}.svg" alt="" class="settings-provider-image">`);
    const original = fs.readFileSync(path.join(__dirname, `../codenotch/glyphs/${id}.svg`), 'utf8');
    const packaged = fs.readFileSync(path.join(__dirname, `../codenotch/ui/glyphs/${id}.svg`), 'utf8');
    assert.equal(packaged, original.replaceAll('currentColor', '#e8e8ea'));
    assert.match(packaged, /<svg\b/);
    assert.doesNotMatch(packaged, /currentColor/);
  }
  c.settingsGlyphs.cursor = { url: 'data:image/png;base64,Qw==' };
  assert.match(c.settingsGlyph('cursor'), /src="data:image\/png;base64,Qw=="/);
  assert.equal(c.settingsGlyph('../outside'), '<span>.</span>');
  assert.ok(fs.existsSync(path.join(__dirname, '../codenotch/ui/glyphs/NOTICE.md')));
});

test('live preview follows selected provider IDs and scale without fabricated usage readings', () => {
  const preview = { innerHTML: '', style: {} }, count = { textContent: '' };
  const glyphs = {
    codex: { url: 'data:image/png;base64,Qw==' },
    claude: { url: 'data:image/png;base64,RA==' },
  };
  const c = contextFor(['esc', 'settingsGlyph', 'notchOn', 'renderNotchPreview'], {
    settingsGlyphs: glyphs, FALLBACK_LABEL: { codex: 'Codex', claude: 'Claude' },
    notchSlots: [{ provider: 'codex' }], scalePct: 55,
    document: { getElementById: key => ({ 'notch-live-preview': preview, 'notch-preview-count': count })[key] },
    providerList: () => [{ id: 'claude', windows: [] }, { id: 'codex', windows: [] }], ui: (key, fallback) => fallback,
  });
  c.renderNotchPreview();
  assert.ok(preview.innerHTML.includes(glyphs.codex.url));
  assert.ok(!preview.innerHTML.includes(glyphs.claude.url));
  assert.equal(preview.style.transform, 'scale(0.55)');
  assert.equal(count.textContent, '1 tools enabled');
  assert.doesNotMatch(preview.innerHTML, /\d+%|used|remaining|limit/i);
  c.notchSlots = [];
  c.scalePct = 100;
  c.renderNotchPreview();
  assert.ok(preview.innerHTML.includes(glyphs.codex.url));
  assert.ok(preview.innerHTML.includes(glyphs.claude.url));
  assert.equal((preview.innerHTML.match(/class="preview-provider"/g) || []).length, 2);
  assert.equal(preview.style.transform, 'scale(1)');
  c.settingsVisibility.claude=false;
  c.renderNotchPreview();
  assert.equal((preview.innerHTML.match(/class="preview-provider"/g)||[]).length,1);
  assert.equal(count.textContent, '1 tools enabled');
  for (const id of ['notch-live-preview', 'notch-preview-count', 'scale-range', 'scale-val']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
});

test('local plush images preserve labelled buttons and stay hidden from accessible names', () => {
  const tabs = Array.from(declaration('TABS'));
  const buttons = Object.fromEntries(tabs.map(id => [id, {
    textContent: id, children: [],
    querySelector(selector) { return selector === '.settings-nav-icon' ? this.children.find(node => node.attributes.class === 'settings-nav-icon') : null; },
    prepend(node) { this.children.unshift(node); node.remove = () => { this.children.splice(this.children.indexOf(node), 1); }; },
  }]));
  const c = contextFor(['decorateNavigation'], {
    document: {
      getElementById: id => buttons[id.replace('tab-', '')],
      createElement: tag => ({ tag, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } }),
    },
  });
  c.decorateNavigation();
  c.decorateNavigation();
  for (const id of tabs) {
    const button = buttons[id];
    assert.equal(button.textContent, id);
    assert.equal(button.children.length, 1);
    const icon = button.children[0];
    assert.equal(icon.tag, 'img');
    assert.equal(icon.attributes['aria-hidden'], 'true');
    assert.equal(icon.attributes.alt, '');
    assert.equal(icon.attributes.tabindex, '-1');
    assert.equal(icon.attributes.draggable, 'false');
    assert.equal(icon.attributes.src, `icons/plush/${id}.png`);
    assert.doesNotMatch(icon.attributes.src, /:|\.\.|[<>"']/);
    for (const attribute of Object.keys(icon.attributes)) {
      assert.ok(['class', 'src', 'alt', 'aria-hidden', 'draggable', 'tabindex'].includes(attribute));
    }
  }
});

test('every plush navigation image is packaged as a real PNG', () => {
  const root = path.resolve(__dirname, '../codenotch/ui');
  for (const id of Array.from(declaration('TABS'))) {
    const file = path.resolve(root, 'icons/plush', `${id}.png`);
    assert.ok(file.startsWith(root + path.sep));
    assert.ok(fs.existsSync(file), `${id} image is packaged`);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 33, `${id} has PNG content`);
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, `${id} dimensions are valid`);
  }
});

test('provider toggle refuses the last enabled tool but allows removing one of two', () => {
  const saved = [], notices = [];
  const c = contextFor(['notchOn', 'toggleNotch'], {
    notchSlots: [{ provider: 'codex' }],
    providerList: () => [{ id: 'claude' }, { id: 'codex' }],
    saveNotch: slots => saved.push(slots), toast: message => notices.push(message), ui: (key, fallback) => fallback,
  });
  c.toggleNotch('codex');
  assert.equal(saved.length, 0);
  assert.match(notices[0], /At least one provider/);
  c.notchSlots = [];
  c.toggleNotch('claude');
  assert.equal(saved.length, 1);
  assert.deepEqual(Array.from(saved[0], slot => slot.provider), ['codex']);
  c.toggleNotch('unknown');
  assert.equal(saved.length, 1);
});

test('new copy and provider readiness have Russian translations', () => {
  const translations = declaration('RU_STATIC');
  assert.equal(translations.Ready, 'Доступен');
  const phrases = [
    'Show usage beside the clock. Choose a layout, then select what each part displays.',
    'Open Codenotch when you sign in to Windows.',
    'Settings, tasks, logs, and custom icons.',
  ];
  for (const phrase of phrases) {
    assert.ok(html.includes(phrase));
    assert.ok(/[А-Яа-я]/.test(translations[phrase]));
  }
  assert.ok(html.includes('.claude\\settings.json'));
  assert.ok(html.includes('A dated copy of it is saved before anything is written'));
  assert.ok(html.includes('Any hooks you added yourself are left alone.'));
});
