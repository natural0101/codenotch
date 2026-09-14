
/* ---------------------------------------------------------------------------
   Codenotch settings.

   Layout: a fixed list of tabs on the left, one pane visible at a time on the
   right. The panes all exist in the DOM at once and are only hidden, so every
   renderer below can address its elements whether or not its tab is showing.

   Every value on screen comes from a Rust command and is written back by one.
   Every call is wrapped so a failure paints the strip at the top instead of
   leaving a half-rendered window.
--------------------------------------------------------------------------- */

const BRIDGE = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) || null;
function invoke(cmd, args){
  if(!BRIDGE) return Promise.reject(new Error('the app bridge is not available'));
  return BRIDGE(cmd, args);
}
function errText(e){ return (e && (e.message || e.toString())) || String(e); }
/* Every command goes through here: a rejection shows in the strip and resolves to a fallback,
   so no caller ever has to deal with an exception. */
function call(cmd, args, fallback){
  return invoke(cmd, args).catch(e => { strip(cmd + ' failed: ' + errText(e)); return fallback; });
}

/* Escapes everything that is interpolated into innerHTML. Provider and window labels arrive from
   remote servers, so they are never trusted. */
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}
let settingsGlyphs={},settingsVisibility={};
function settingsGlyph(id){
  const g=settingsGlyphs[id],url=g&&g.url;
  if(typeof url==='string'&&/^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+=*$/.test(url)){
    return '<img src="'+url+'" alt="" class="settings-provider-image">';
  }
  // Known provider artwork is packaged with the settings page even when the
  // provider is hidden and consequently omitted from the runtime glyph response.
  const builtins={claude:'glyphs/claude.svg',codex:'glyphs/codex.svg',cursor:'glyphs/cursor.svg',gemini:'glyphs/gemini.svg'};
  if(Object.prototype.hasOwnProperty.call(builtins,id)){
    return '<img src="'+builtins[id]+'" alt="" class="settings-provider-image">';
  }
  const label=Object.prototype.hasOwnProperty.call(FALLBACK_LABEL,id)?FALLBACK_LABEL[id]:String(id);
  return '<span>'+esc(label.slice(0,1))+'</span>';
}

function decorateNavigation(){
  // Original two-tone geometric badges, inspired by the user's selected neon reference.
  const lime='#d8f34b',pink='#f77bea',violet='#683af0',cream='#f6f4db',charcoal='#242523';
  const burst=Array.from({length:24},(_,i)=>{const angle=(i*15-90)*Math.PI/180,r=i%2?11.8:15.4;return (i?'L':'M')+(16+Math.cos(angle)*r).toFixed(2)+' '+(16+Math.sin(angle)*r).toFixed(2);}).join(' ')+'Z';
  const icons={
    tray:[['circle',{cx:16,cy:16,r:15,fill:lime}],['rect',{x:6.5,y:8.5,width:19,height:13.5,rx:3,fill:charcoal}],['rect',{x:9,y:11,width:14,height:8,rx:1,fill:lime}],['path',{d:'M14 22h4v2h3v2H11v-2h3Z',fill:charcoal}]],
    notch:[['rect',{x:1,y:1,width:30,height:30,rx:10,fill:pink}],['path',{d:'M8.5 7.5h15a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Zm.5 3v11h14v-11H9Z',fill:charcoal,'fill-rule':'evenodd'}],['path',{d:'M25 12h-4a3 3 0 0 0-3 3v2a3 3 0 0 0 3 3h4Z',fill:charcoal}]],
    modules:[['rect',{x:4.7,y:4.7,width:22.6,height:22.6,rx:4,transform:'rotate(45 16 16)',fill:violet}],['circle',{cx:16,cy:10.5,r:3.35,fill:cream}],['circle',{cx:10.5,cy:20,r:3.35,fill:cream}],['circle',{cx:21.5,cy:20,r:3.35,fill:cream}]],
    behaviour:[['path',{d:burst,fill:lime}],['circle',{cx:16,cy:16,r:8.2,fill:'none',stroke:charcoal,'stroke-width':2}],['circle',{cx:16,cy:16,r:3.8,fill:charcoal}]],
    hooks:[['circle',{cx:16,cy:16,r:15,fill:violet}],['path',{d:'M16 4.5 18.6 12.4 25.8 7.2 21.3 14 28 16 21.3 18 25.8 24.8 18.6 19.6 16 27.5 13.4 19.6 6.2 24.8 10.7 18 4 16 10.7 14 6.2 7.2 13.4 12.4Z',fill:cream}]],
    about:[['circle',{cx:16,cy:16,r:15,fill:charcoal}],['circle',{cx:16,cy:16,r:9.5,fill:'none',stroke:lime,'stroke-width':1.65}],['path',{d:'M6.5 16h19M16 6.5c-6 4-6 15 0 19m0-19c6 4 6 15 0 19M16 6.5v19M8.5 11.5c5 2 10 2 15 0M8.5 20.5c5-2 10-2 15 0',fill:'none',stroke:lime,'stroke-width':1.5}]]
  };
  for(const [id,shapes] of Object.entries(icons)){
    const button=document.getElementById('tab-'+id);if(!button)continue;
    button.querySelector('.settings-nav-icon')?.remove();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value] of Object.entries({class:'settings-nav-icon',viewBox:'0 0 32 32','aria-hidden':'true',focusable:'false',fill:'none','stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(key,value);
    for(const [tag,attributes] of shapes){const shape=document.createElementNS(svg.namespaceURI,tag);for(const [key,value] of Object.entries(attributes))shape.setAttribute(key,String(value));svg.append(shape);}button.prepend(svg);
  }
}

/* The three usage bands match trayicon.rs, so usage dots and preview pixels agree.
   Decorative navigation badges use their own fixed palette. */
function band(p){ return p < 50 ? '#4ade80' : p < 80 ? '#facc15' : '#f87171'; }

/* Fallback names, used only until get_tray_options answers (or if it never does). */
const ORDER = ['claude', 'codex', 'cursor', 'gemini'];
const FALLBACK_LABEL = { claude:'Claude', codex:'Codex', cursor:'Cursor', gemini:'Antigravity' };
const RU_STATIC = {
  'Preview':'Предпросмотр', 'At the edge of your screen':'У правого края экрана', 'tools enabled':'инструмента на панели',
  'Ready':'Доступен',
  "Show usage beside the clock. Choose a layout, then select what each part displays.":"Лимиты рядом с часами. Выберите вид значка и показания для каждой его части.",
  "Numbers, bars, or the Codenotch icon.":"Числа, полосы или значок Codenotch.",
  "Preview at Windows display sizes.":"Предпросмотр при разных масштабах Windows.",
  "Choose a layout that stays readable at this size.":"Выберите вид, который хорошо читается в этом размере.",
  "Select a tool for each part of the icon.":"Выберите инструмент для каждой части значка.",
  "Startup, visibility, and language.":"Запуск, видимость и язык.",
  "Open Codenotch when you sign in to Windows.":"Открывать Codenotch при входе в Windows.",
  "Keep the panel or tray icon visible to reach Codenotch.":"Панель или значок в трее остаётся видимым для доступа к Codenotch.",
  "Show usage at the edge of the screen.":"Показывать лимиты у края экрана.",
  "Right-click for settings, refresh, and quit.":"Правый клик: настройки, обновление и выход.",
  "Turn the panel on before hiding the tray icon.":"Включите панель, чтобы скрыть значок в трее.",
  "“Follow system” uses your Windows language.":"«Как в системе» использует язык Windows.",
  "Live session activity from Claude Code.":"Текущая активность сеансов Claude Code.",
  "Add hooks to Claude Code settings for session start, work, waiting, and completion.":"Добавить хуки в настройки Claude Code для начала работы, ожидания ответа и завершения сеанса.",
  "Version, local data, and panel position.":"Версия, локальные данные и положение панели.",
  "Usage and local tools, always within reach.":"Лимиты и локальные инструменты под рукой.",
  "Settings, tasks, logs, and custom icons.":"Настройки, дела, журнал и собственные значки.",
  "Return the panel to the middle of the screen edge.":"Вернуть панель в середину края экрана.",
  'Settings':'Настройки', 'Sections':'Разделы', 'Tools':'Инструменты',
  'Your tools, one glance away.':'Нужные инструменты — у края экрана.',
  'Choose the rings shown at the edge of your screen.':'Выберите, какие инструменты показывать на панели.',
  'Adjust the size to suit your screen.':'Подберите удобный масштаб.',
  'Keep only what you use.':'Оставьте только то, чем пользуетесь.',
  'Your workspace':'Рабочее пространство', 'Optional tabs in the account panel.':'Дополнительные вкладки панели аккаунтов.',
  'Account details':'Детали аккаунта',
  'The account name and remaining allowance are always shown.':'Имя аккаунта и остаток лимита видны всегда.',
  'Model data':'Модели', 'Provider options':'Параметры Antigravity',
  'Codex account panel':'Панель аккаунтов Codex',
  'Tasks section':'Дела', 'Services section':'Сервисы', 'Knowledge section':'Память',
  'By default, only the account and remaining allowance are shown.':'По умолчанию — только аккаунт и остаток лимита.',
  'Header':'Заголовок', 'Plan':'Тариф', 'Reset time':'Время сброса',
  'Updated time':'Время обновления', 'Other limits':'Другие лимиты',
  'Action buttons':'Кнопки управления', 'Highlight default account':'Выделение основного аккаунта',
  'Could not save account panel preferences.':'Не удалось сохранить настройки панели аккаунтов.',
  'Could not load account panel preferences.':'Не удалось загрузить настройки панели аккаунтов.',
  'Could not follow account panel preferences.':'Не удалось получать изменения настроек панели аккаунтов.',
  'Codex accounts':'Аккаунты Codex',
  'View limits across your local Codex profiles.':'Лимиты ваших локальных профилей Codex.',
  'Open accounts':'Открыть аккаунты',
  'Settings sections':'Разделы настроек', 'Appearance':'Внешний вид', 'Taskbar icon':'Значок в трее',
  'Notch':'Панель', 'General':'Общие', 'Behaviour':'Поведение', 'Claude Code':'Claude Code', 'About':'О программе',
  'The small icon down by the clock. Codenotch draws your usage straight into it — 32 pixels square. Pick a layout, then click a part of the picture to choose what that part shows.':'Небольшой значок рядом с часами. Codenotch показывает в нём использование — 32 пикселя. Выберите макет и нажмите на часть изображения, чтобы настроить её.',
  'Layout':'Макет', 'What gets drawn into those 32 pixels.':'Что отображается в этих 32 пикселях.',
  'The plain Codenotch logo is used.':'Используется обычный логотип Codenotch.', 'No numbers are drawn.':'Числа не отображаются.',
  'Actual size':'Фактический размер', 'This is how big it really is in the taskbar.':'Такой размер значок имеет в панели задач.',
  'Windows picks one of these depending on the display. If a number is unreadable here, it will be unreadable in the taskbar.':'Windows выбирает один из вариантов в зависимости от масштаба экрана. Если число не читается здесь, в панели задач оно тоже не будет читаться.',
  'What each part shows':'Что показывает каждая часть', 'Pick the tool; each part draws that tool\'s ring.':'Выберите инструмент: каждая часть показывает его кольцо.',
  'The small black pill that floats against the right-hand edge of the screen. Each tool you tick gets one ring on it.':'Небольшая чёрная панель у правого края экрана. Каждый выбранный инструмент получает на ней своё кольцо.',
  'What appears on the pill':'Что отображается на панели', 'Click a name to switch its ring on or off.':'Нажмите на название, чтобы включить или выключить кольцо.',
  'Size':'Размер', 'How big the pill is drawn. The same slider sits at the foot of the pill\'s hover card, so it can be changed from either place.':'Размер панели. Такой же ползунок находится внизу карточки при наведении на панель.',
  'Whether the pill is on screen at all is a separate switch, under General → Behaviour.':'Видимость панели переключается отдельно в разделе «Общие → Поведение».',
  'When Codenotch runs, and what it puts on your screen.':'Когда запускается Codenotch и что он показывает на экране.',
  'Starting up':'Запуск', 'Start with Windows':'Запускать вместе с Windows',
  'Codenotch opens by itself every time you sign in to this computer, and waits quietly in the background until a coding session starts. Turn it off and you have to open Codenotch yourself.':'Codenotch запускается при входе в систему и тихо работает в фоне до начала сеанса разработки. Если выключить эту настройку, Codenotch нужно запускать вручную.',
  'What is on screen':'Что отображается на экране', 'Show the notch':'Показывать панель', 'Show the taskbar icon':'Показывать значок в панели задач',
  'Language':'Язык', 'Words used by Codenotch':'Язык Codenotch', 'Follow system':'Как в системе', 'English':'English', 'Русский':'Русский',
  'Claude Code can tell Codenotch the moment something happens in a session, instead of Codenotch having to guess from files on disk.':'Claude Code может сразу сообщать Codenotch о событиях сеанса, вместо того чтобы Codenotch угадывал их по файлам на диске.',
  'Session messages':'Сообщения сеанса', 'Let Claude Code notify Codenotch':'Разрешить Claude Code уведомлять Codenotch',
  'What this copy of Codenotch is, and where it keeps its files.':'Что это за копия Codenotch и где хранятся её файлы.', 'Version':'Версия',
  'Files':'Файлы', 'Data folder':'Папка данных', 'Open folder':'Открыть папку', 'If something looks wrong':'Если что-то работает неправильно',
  'Put the notch back':'Вернуть панель', 'Reset position':'Сбросить положение', 'Saved':'Сохранено',
  'Numbers':'Числа', 'two readings':'два показания', 'Bars':'Полосы', '1 to 5 columns':'от 1 до 5 столбцов', 'Plain icon':'Обычный значок', 'just the logo':'только логотип',
  'kept':'оставлено', 'Showing':'Показывается', 'Showing in':'Показывается в',
  'Notch reads':'Показания панели', 'Automatic':'Автоматически', '5-Hour Limit':'Лимит на 5 часов', 'Weekly Limit':'Недельный лимит',
  'Gemini Models':'Модели Gemini', 'Claude and GPT models':'Модели Claude и GPT',
  '"%@" is no longer available':'«%@» больше недоступен', '%@ — that slot now shows another provider.':'%@ — теперь слот показывает другого провайдера.',
  'One provider always stays ticked, so the pill is never empty.':'Хотя бы один провайдер всегда выбран, поэтому панель не бывает пустой.',
  'The taskbar icon shows the plain Codenotch logo.':'Значок в панели задач показывает обычный логотип Codenotch.',
  'Choose Numbers or Bars above to draw your usage into it.':'Выберите выше «Числа» или «Полосы», чтобы показывать в нём использование.',
  'What is on screen':'Что отображается на экране', 'Show the notch':'Показывать панель', 'Show the taskbar icon':'Показывать значок в панели задач',
  'Open the notch for a moment':'Ненадолго открыть панель', 'At least one provider stays on the notch':'На панели должен остаться хотя бы один провайдер',
  'The notch is back in the middle':'Панель возвращена в центр', 'Remove this column':'Удалить этот столбец', 'Add column':'Добавить столбец',
  'The taskbar icon has been kept on. With the notch hidden it is the only way left to open this window or to quit Codenotch, so Codenotch will not let both of them be switched off at the same time.':'Значок в панели задач оставлен включённым. При скрытой панели это единственный способ открыть окно или завершить работу Codenotch, поэтому оба элемента нельзя выключить одновременно.',
  'One of these two always stays on. If you hide the notch, the taskbar icon is held on for you, because with both of them gone there would be nothing left to click and no way back to this window.':'Один из этих элементов всегда остаётся включённым. Если скрыть панель, значок в панели задач останется включённым, иначе Codenotch будет неоткуда открыть.',
  'The black pill against the right-hand edge of the screen, with one ring per tool. Turn it off and the pill disappears; Codenotch keeps counting your usage either way.':'Чёрная панель у правого края экрана с отдельным кольцом для каждого инструмента. При выключении панель исчезает, но Codenotch продолжает считать использование.',
  'The small icon down by the clock. Right-clicking it opens this window, refreshes the readings, or quits Codenotch.':'Небольшой значок рядом с часами. Щелчок правой кнопкой открывает это окно, обновляет данные или завершает работу Codenotch.',
  'Held on: the notch is hidden, so this icon is the only way left to reach Codenotch. Switch the notch back on first if you want to hide it.':'Оставлен включённым: панель скрыта, поэтому этот значок — единственный способ открыть Codenotch. Сначала включите панель, если хотите скрыть значок.',
  'Sets the language used by Codenotch. “Follow system” uses the language Windows itself is set to.':'Задаёт язык Codenotch. Вариант «Как в системе» использует язык Windows.',
  'The small icon down by the clock. Codenotch draws your usage straight into it — 32 pixels square. Pick a layout, then click a part of the picture to choose what that part shows.':'Небольшой значок рядом с часами. Codenotch показывает в нём использование — 32 пикселя. Выберите макет и нажмите на часть изображения, чтобы настроить её.',
  'Turning this on adds a few lines to your Claude Code settings file so that Claude Code sends Codenotch a short message when a session starts, when it is working, when it is waiting for your answer, and when it finishes. That is what makes the ring spin and the amber ring pulse.':'При включении в файл настроек Claude Code добавляются строки, чтобы он сообщал Codenotch о начале работы, процессе, ожидании ответа и завершении сеанса. Благодаря этому кольцо вращается, а янтарное кольцо пульсирует.',
  'The file being changed is':'Изменяемый файл —',
  'in your user folder. A dated copy of it is saved before anything is written, and turning this switch off takes the lines out again. Any hooks you added yourself are left alone.':'в вашей папке пользователя. Перед изменением сохраняется копия с датой, а при выключении настройки добавленные строки удаляются. Ваши собственные хуки не затрагиваются.',
  'Shows how much of your Claude, Codex, Cursor and Antigravity allowance you have used, in the taskbar icon and in a pill at the edge of the screen.':'Показывает использование Claude, Codex, Cursor и Antigravity в значке панели задач и на панели у края экрана.',
  'Everything Codenotch remembers lives in one folder: your settings, its log file, and the "glyphs" folder where you can drop your own icons. Opens in File Explorer.':'Все данные Codenotch хранятся в одной папке: настройки, журнал и папка «glyphs» для собственных значков. Открывается в Проводнике.',
  'The pill can be dragged up and down the right-hand edge. If it has ended up somewhere you cannot see it — off the bottom of a screen you have unplugged, say — this drops it back into the middle of the edge.':'Панель можно перетаскивать вверх и вниз вдоль правого края. Если она оказалась за пределами экрана, эта кнопка возвращает её в середину края.',
  'The plain Codenotch logo is used.':'Используется обычный логотип Codenotch.', 'No numbers are drawn.':'Числа не отображаются.',
  'This is how big it really is in the taskbar.':'Такой размер значок имеет в панели задач.',
  'Windows picks one of these depending on the display. If a number is unreadable here, it will be unreadable in the taskbar.':'Windows выбирает один из вариантов в зависимости от масштаба экрана. Если число не читается здесь, в панели задач оно тоже не будет читаться.',
  'Notch size':'Размер панели', 'Codenotch':'Codenotch', 'Tray icon preview':'Предпросмотр значка', 'Codenotch logo':'Логотип Codenotch', 'Tray icon at':'Значок размером', 'pixels':'пикселей',
  'Down the right-hand edge':'У правого края', 'Down the left-hand edge':'У левого края', 'Top half':'Верхняя половина', 'Bottom half':'Нижняя половина', 'Column':'Столбец', 'Remove column':'Удалить столбец'
};
const STATUS_TEXT = {
  en:{ ok:'', stale:'last reading is old', needsAuth:'not signed in', absent:'not installed', none:'nothing to report', error:'not reachable' },
  ru:{ ok:'', stale:'данные устарели', needsAuth:'не выполнен вход', absent:'не установлен', none:'нет данных', error:'недоступен' }
};
let uiLang = 'en';
function ui(key, fallback){ return uiLang === 'ru' ? (RU_STATIC[key] || fallback) : fallback; }
function applyStaticUi(){
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while(walker.nextNode()) nodes.push(walker.currentNode);
  for(const node of nodes){
    if(node.parentElement && ['SCRIPT','STYLE'].indexOf(node.parentElement.tagName) >= 0) continue;
    if(node.__enText === undefined) node.__enText = node.nodeValue;
    const raw = node.__enText;
    const key = raw.trim();
    if(!key) continue;
    const translated = uiLang === 'ru' ? RU_STATIC[key] : null;
    node.nodeValue = raw.replace(key, translated || key);
  }
  for(const el of document.querySelectorAll('[aria-label],[title],[alt]')){
    for(const attr of ['aria-label','title','alt']){
      if(!el.hasAttribute(attr)) continue;
      const marker = '__en_' + attr.replace('-', '_');
      if(el[marker] === undefined) el[marker] = el.getAttribute(attr);
      const original = el[marker];
      el.setAttribute(attr, uiLang === 'ru' ? (RU_STATIC[original] || original) : original);
    }
  }
}
function setUiLanguage(lang){
  uiLang = lang === 'ru' || (lang === 'auto' && /^ru(?:-|$)/i.test(navigator.language || '')) ? 'ru' : 'en';
  applyStaticUi();
  render();
}
function setUiLanguageFromRaw(raw){
  if(raw !== 'auto'){
    setUiLanguage(raw);
    return Promise.resolve();
  }
  return call('get_lang_resolved', undefined, 'en').then(resolved => {
    setUiLanguage(typeof resolved === 'string' ? resolved : 'en');
  });
}
const MAX_BARS = 5, NUMBER_SLOTS = 2;

let options = [];                        // [{id,label,status,windows:[{id,label,used}]}]
let cfg = { mode:'off', slots:[] };      // the live tray configuration
let sel = 0;                             // which slot the picker is editing
let previewToken = 0;                    // guards against a slow preview overwriting a newer one
let scalePct = 100, scaleTimer = null;
let repairNote = '';                     // set when a saved slot had to be repaired

/* ---- small chrome ------------------------------------------------------ */
function strip(msg){
  const el = document.getElementById('strip');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._h);
  el._h = setTimeout(() => el.classList.remove('show'), 10000);
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg || 'Saved';
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 1200);
}

/* ---- the tabs -----------------------------------------------------------
   One pane visible at a time. The chosen tab is remembered in localStorage, so reopening the
   window comes back to where the user was. localStorage can throw in a locked-down WebView, so
   both the read and the write are wrapped. */
const TABS = ['tray', 'notch', 'modules', 'behaviour', 'hooks', 'about'];
const TAB_KEY = 'codenotch.settings.tab';
let curTab = TABS[0];

function showTab(id, moveFocus){
  if(TABS.indexOf(id) < 0) id = TABS[0];
  curTab = id;
  for(const t of TABS){
    const btn = document.getElementById('tab-' + t);
    const pane = document.getElementById('pane-' + t);
    const on = (t === id);
    if(btn){
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;      // one stop in the tab order; the arrows move within the list
    }
    if(pane) pane.hidden = !on;
  }
  const main = document.getElementById('main');
  if(main) main.scrollTop = 0;
  try { localStorage.setItem(TAB_KEY, id); } catch(e) { /* private mode: the tab simply is not remembered */ }
  if(moveFocus){
    const btn = document.getElementById('tab-' + id);
    if(btn) btn.focus();
  }
}
function savedTab(){
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.indexOf(v) >= 0 ? v : TABS[0];
  } catch(e) { return TABS[0]; }
}
document.getElementById('side').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if(b) showTab(b.id.slice(4));          // "tab-notch" -> "notch"
});
/* Up and down move between tabs while the list has focus; Home and End jump to the ends. */
document.getElementById('side').addEventListener('keydown', e => {
  const at = TABS.indexOf(curTab);
  let next = -1;
  if(e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (at + 1) % TABS.length;
  else if(e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (at - 1 + TABS.length) % TABS.length;
  else if(e.key === 'Home') next = 0;
  else if(e.key === 'End') next = TABS.length - 1;
  if(next < 0) return;
  e.preventDefault();
  showTab(TABS[next], true);
});

/* ---- the application mark ----------------------------------------------
   The shipped icon is a pure black glyph on transparency. That is right for a light taskbar and
   invisible on a dark one, and this window is dark too — so the bundled `tray.png` is only the
   fallback. Rust is asked first for the same mark tinted for the current taskbar, which is exactly
   what the taskbar itself will show. `data-fixed` stops a failing fallback from looping. */
let logoUrl = null, logoAsked = false;
function logoFallback(img){
  if(img.dataset.fixed) return;
  if(logoUrl){ img.dataset.fixed = '1'; img.src = logoUrl; return; }
  if(logoAsked) return;
  logoAsked = true;
  call('get_app_icon', undefined, null).then(u => {
    if(typeof u !== 'string' || u.indexOf('data:image/') !== 0) return;
    logoUrl = u;
    for(const el of document.querySelectorAll('img[data-logo]')){
      if(!el.dataset.fixed && el.naturalWidth === 0){ el.dataset.fixed = '1'; el.src = u; }
    }
  });
}
/* Fetched at start-up, not only when an image fails: the bundled file loads perfectly well, it
   simply cannot be seen, and a load event is no help against that. */
(function tintedLogo(){
  logoAsked = true;
  call('get_app_icon', undefined, null).then(u => {
    if(typeof u !== 'string' || u.indexOf('data:image/') !== 0) return;
    logoUrl = u;
    for(const el of document.querySelectorAll('img[data-logo]')){
      el.dataset.fixed = '1';
      el.src = u;
    }
  });
})();
(function wireLogos(){
  for(const img of document.querySelectorAll('img[data-logo]')){
    img.addEventListener('error', () => logoFallback(img));
    if(img.complete && img.naturalWidth === 0) logoFallback(img);   // it failed before we got here
  }
})();

/* ---- provider / window lookups ----------------------------------------- */
function provOf(id){ return options.find(o => o.id === id) || null; }
function provLabel(id){
  const p = provOf(id);
  return (p && p.label) || FALLBACK_LABEL[id] || id;
}
/* THE one source of truth for who the providers are: whatever get_tray_options answered, and the
   fallback names only until it does. The tray picker and the Notch section both read this list, so
   a provider is never named twice in this file. */
function providerList(){
  return options.length
    ? options
    : ORDER.map(id => ({ id, label:FALLBACK_LABEL[id], status:'', used:null }));
}
/* The one place a status code turns into words ("not signed in"), shared for the same reason. */
function statusText(p){
  const words = STATUS_TEXT[uiLang] || STATUS_TEXT.en;
  return words[p.status] !== undefined ? words[p.status] : String((p && p.status) || '');
}

/* Which provider to reach for when a slot has to be invented or repaired: one that is actually
   reporting a number first, then one that is at least healthy, then anything. */
function pickProvider(taken){
  const pool = providerList();
  const rank = o => {
    const has = o.used != null ? 0 : 2;
    const ok = o.status === 'ok' ? 0 : 1;
    return has + ok;
  };
  const free = pool.filter(o => taken.indexOf(o.id) < 0);
  const list = (free.length ? free : pool).slice().sort((a, b) => rank(a) - rank(b));
  return list.length ? list[0].id : 'claude';
}
function defaultSlot(existing){
  return { provider: pickProvider(existing.map(s => s.provider)) };
}

/* ---- configuration repair ----------------------------------------------
   A saved slot can point at a provider that no longer exists; it is replaced rather than left to
   break the icon. */
function fixSlot(s, notes){
  if(!s || typeof s !== 'object' || typeof s.provider !== 'string' || !s.provider){
    return { provider: pickProvider([]) };
  }
  if(options.length && !provOf(s.provider)){
    notes.push(ui('"%@" is no longer available', '"%@" is no longer available').replace('%@', s.provider));
    return { provider: pickProvider([]) };
  }
  return { provider: s.provider };
}
function normalize(){
  if(['numbers', 'bars', 'off'].indexOf(cfg.mode) < 0) cfg.mode = 'off';
  const notes = [];
  let slots = Array.isArray(cfg.slots) ? cfg.slots.map(s => fixSlot(s, notes)) : [];
  if(cfg.mode === 'numbers'){
    while(slots.length < NUMBER_SLOTS) slots.push(defaultSlot(slots));   // pad
    slots = slots.slice(0, NUMBER_SLOTS);                               // or trim
  } else {
    if(!slots.length) slots.push(defaultSlot(slots));                   // never empty
    slots = slots.slice(0, MAX_BARS);
  }
  cfg.slots = slots;
  if(sel >= cfg.slots.length) sel = cfg.slots.length - 1;
  if(sel < 0) sel = 0;
  repairNote = notes.length ? ui('%@ — that slot now shows another provider.', '%@ — that slot now shows another provider.').replace('%@', notes[0]) : '';
}

/* ---- saving ------------------------------------------------------------ */
function payload(){
  return { mode: cfg.mode, slots: cfg.slots.map(s => ({ provider:s.provider })) };
}
function persist(quiet){
  invoke('set_tray_config', { cfg: payload() })
    .then(() => { if(!quiet) toast(ui('Saved', 'Saved')); })
    .catch(e => strip('set_tray_config failed: ' + errText(e)));
}

/* ---- preview ------------------------------------------------------------
   The picture comes from Rust, so what is being edited is literally the pixels the taskbar will
   draw. Mode "off" answers null: the placeholder shows the real application mark instead. */
function refreshPreview(){
  const img = document.getElementById('pv');
  const ph = document.getElementById('ph');
  if(cfg.mode === 'off'){
    img.classList.add('hide');
    ph.classList.add('show');
    setTruth(null);
    return;
  }
  const token = ++previewToken;
  call('get_tray_preview', { cfg: payload() }, null).then(url => {
    if(token !== previewToken) return;                       // a newer request already answered
    if(typeof url === 'string' && url.indexOf('data:image/') === 0){
      img.src = url;
      img.classList.remove('hide');
      ph.classList.remove('show');
      setTruth(url);
    } else {
      img.classList.add('hide');
      ph.classList.add('show');
      setTruth(null);
    }
  });
}
function setTruth(url){
  if(!url&&cfg.mode==='off')url=document.querySelector('.ph-mark img')?.src||'tray.png';
  for(const im of document.querySelectorAll('.truthcell img')){
    if(url){ im.src = url; im.classList.remove('hide'); }
    else { im.classList.add('hide'); }
  }
}

/* ---- clickable regions --------------------------------------------------
   The overlays copy trayicon.rs's own arithmetic so a region sits exactly over the pixels it
   edits. Digits: two bands of 16 rows. Columns: one pixel of gap, the remainder centred. */
function barRegions(n){
  const S = 32, gap = n > 1 ? 1 : 0;
  const col = Math.floor((S - gap * (n - 1)) / n);
  if(col <= 0) return [];
  const used = col * n + gap * (n - 1);
  const ox = Math.floor((S - used) / 2);
  const out = [];
  for(let i = 0; i < n; i++){
    out.push({ left: (ox + i * (col + gap)) / S * 100, top: 0, width: col / S * 100, height: 100 });
  }
  return out;
}
function regionBoxes(){
  if(cfg.mode === 'numbers'){
    return [ { left:0, top:0, width:100, height:50 }, { left:0, top:50, width:100, height:50 } ];
  }
  if(cfg.mode === 'bars') return barRegions(cfg.slots.length);
  return [];
}
function slotName(i){
  if(cfg.mode === 'numbers') return i === 0 ? ui('Top half', 'Top half') : ui('Bottom half', 'Bottom half');
  return ui('Column', 'Column') + ' ' + (i + 1);
}

function renderRegions(){
  const host = document.getElementById('regions');
  const boxes = regionBoxes();
  let html = '';
  boxes.forEach((b, i) => {
    html += '<button class="region' + (i === sel ? ' on' : '') + '" data-i="' + i + '"'
      + ' style="left:' + b.left.toFixed(3) + '%;top:' + b.top + '%;width:' + b.width.toFixed(3) + '%;height:' + b.height + '%"'
      + ' title="' + esc(slotName(i) + ': ' + provLabel(cfg.slots[i].provider)) + '"'
      + ' aria-label="' + esc(slotName(i)) + '" aria-pressed="' + (i === sel) + '">'
      + '<span class="r-num">' + (i + 1) + '</span></button>';
  });
  host.innerHTML = html;
}

/* ---- mode switch ------------------------------------------------------- */
const MODES = [
  { id:'numbers', name:'Numbers', sub:'two readings' },
  { id:'bars', name:'Bars', sub:'1 to 5 columns' },
  { id:'off', name:'Plain icon', sub:'just the logo' }
];
function renderModes(){
  document.getElementById('modes').innerHTML = MODES.map(m =>
    '<button class="mode' + (cfg.mode === m.id ? ' on' : '') + '" data-m="' + m.id + '">'
    + esc(ui(m.name, m.name)) + '<span class="mode-sub">' + esc(ui(m.sub, m.sub)) + '</span></button>'
  ).join('');
}
function setMode(mode){
  if(cfg.mode === mode) return;
  cfg.mode = mode;
  normalize();          // numbers gets exactly 2 slots, bars at least 1, never empty
  sel = 0;
  render();
  persist();
}

/* ---- slot chips (the regions again, as text) --------------------------- */
function renderChips(){
  const host = document.getElementById('chips');
  if(cfg.mode === 'off'){ host.innerHTML = ''; return; }
  let html = '';
  cfg.slots.forEach((s, i) => {
    const text = provLabel(s.provider);
    html += '<span class="chip' + (i === sel ? ' on' : '') + '">'
      + '<button class="chip-pick" data-chip="' + i + '" aria-pressed="' + (i === sel) + '">'
      + '<b>' + esc(slotName(i)) + '</b><span class="ctext">' + esc(text) + '</span></button>'
      + (cfg.mode === 'bars' && cfg.slots.length > 1
        ? '<button class="chip-x" data-del="' + i + '" title="' + esc(ui('Remove this column', 'Remove this column')) + '" aria-label="' + esc(ui('Remove column', 'Remove column')) + ' ' + (i + 1) + '">&times;</button>'
        : '')
      + '</span>';
  });
  if(cfg.mode === 'bars' && cfg.slots.length < MAX_BARS){
    html += '<button class="chip chip-add" data-add="1">+ ' + esc(ui('Add column', 'Add column')) + '</button>';
  }
  host.innerHTML = html;
}

/* ---- the picker -------------------------------------------------------- */
function renderPicker(){
  const host = document.getElementById('picker');
  if(cfg.mode === 'off'){
    host.innerHTML = '<div class="c-note dim">' + esc(ui('The taskbar icon shows the plain Codenotch logo.', 'The taskbar icon shows the plain Codenotch logo.')) + ' '
      + esc(ui('Choose Numbers or Bars above to draw your usage into it.', 'Choose Numbers or Bars above to draw your usage into it.')) + '</div>';
    return;
  }
  const cur = cfg.slots[sel] || { provider:'' };
  let html = '<div class="p-head">' + esc(ui('Showing in', 'Showing in')) + ' <b>' + esc(slotName(sel)) + '</b>: '
    + esc(provLabel(cur.provider)) + '</div>';
  if(repairNote) html += '<div class="c-note dim" style="margin-bottom:8px">' + esc(repairNote) + '</div>';

  // One row per provider: a slot draws that provider's ring, so there is nothing else to choose
  for(const p of providerList()){
    const st = statusText(p), on = cur.provider === p.id;
    const pct = (typeof p.used === 'number' && isFinite(p.used)) ? p.used : null;
    html += '<button class="p-item' + (on ? ' on' : '') + '" data-p="' + esc(p.id) + '">'
      + '<span class="p-tick">' + (on ? '&#10003;' : '') + '</span>'
      + '<span class="p-label">' + esc(p.label || p.id) + '</span>'
      + '<span class="p-pct">' + (st ? '<span class="p-status warn">' + esc(st) + '</span>' : '')
      + (pct === null ? '' : '<span class="p-dot" style="background:' + band(pct) + '"></span>' + pct + '%')
      + '</span></button>';
  }
  host.innerHTML = html;
}

function chooseSlot(provider){
  if(!cfg.slots[sel]) return;
  cfg.slots[sel] = { provider: provider };
  repairNote = '';          // the user has now made a deliberate choice; the repair notice is spent
  render();
  refreshPreview();
  persist();
}

/* ---- render + wiring --------------------------------------------------- */
function render(){
  renderModes();
  renderRegions();
  renderChips();
  renderPicker();
  renderNotch();    // shares the provider list, so it follows the same refresh
  refreshPreview(); // the picture is part of the state; without this it only moved on the timer
}

document.getElementById('modes').addEventListener('click', e => {
  const b = e.target.closest('.mode');
  if(b) setMode(b.dataset.m);
});
document.getElementById('regions').addEventListener('click', e => {
  const b = e.target.closest('.region');
  if(!b) return;
  sel = Number(b.dataset.i) || 0;
  render();
});
document.getElementById('chips').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if(del){
    const i = Number(del.dataset.del);
    if(cfg.slots.length > 1){
      cfg.slots.splice(i, 1);
      if(sel >= cfg.slots.length) sel = cfg.slots.length - 1;
      render(); refreshPreview(); persist();
    }
    return;
  }
  if(e.target.closest('[data-add]')){
    if(cfg.slots.length < MAX_BARS){
      cfg.slots.push(defaultSlot(cfg.slots));
      sel = cfg.slots.length - 1;
      render(); refreshPreview(); persist();
    }
    return;
  }
  const chip = e.target.closest('[data-chip]');
  if(chip){ sel = Number(chip.dataset.chip) || 0; render(); }
});
document.getElementById('picker').addEventListener('click', e => {
  const b = e.target.closest('.p-item');
  if(b) chooseSlot(b.dataset.p);
});

/* ---- the notch's rings --------------------------------------------------
   The pill at the edge of the screen draws one ring per provider, each showing the window the Mac
   app shows for it. What is saved is which providers are on, as {provider} slots, exactly the
   shape the tray icon uses. An EMPTY list means every provider — the default. */
let notchSlots = [];       // exactly what is stored: [] = all of them

/* Antigravity is the one provider with a choice, as in the Mac app: "Notch reads" picks the lane's
   cadence, "Model data" the model family whose lanes it reads. */
const AG_LIMITS = [['automatic', 'Automatic'], ['5h', '5-Hour Limit'], ['weekly', 'Weekly Limit']];
const AG_MODELS = [['gemini', 'Gemini Models'], ['3p', 'Claude and GPT models']];
let agPrefs = { limit:'automatic', model:'gemini' };
function agPicker(key, name, choices, value, enabled){
  return '<label class="np-ag">' + esc(name) + '<select data-ag="' + key + '"' + (enabled ? '' : ' disabled') + '>'
    + choices.map(([v, t]) => '<option value="' + v + '"' + (v === value ? ' selected' : '') + '>' + esc(ui(t, t)) + '</option>').join('')
    + '</select></label>';
}

/* The effective slots, resolved against the providers that actually exist. A saved list that
   matches none of them is treated as "all" — the same fallback notch.html makes — so the pill is
   never drawn empty because of a stale name. */
function notchOn(){
  const ids = providerList().map(p => p.id);
  if(!notchSlots.length) return ids.map(id => ({ provider:id }));
  const on = notchSlots.filter(sl => sl && ids.indexOf(sl.provider) >= 0);
  return on.length ? on : ids.map(id => ({ provider:id }));
}
function notchSlotOf(id){
  for(const sl of notchOn()){ if(sl.provider === id) return sl; }
  return null;
}

function renderNotch(){
  const host = document.getElementById('notch-list');
  const note = document.getElementById('notch-note');
  if(!host || !note) return;
  const list = providerList();
  const on = notchOn();
  let html = '';
  for(const p of list){
    const sl = notchSlotOf(p.id);
    const ticked = !!sl;
    const only = ticked && on.length === 1;     // the last one standing: it cannot be unticked
    const st = statusText(p);                   // the tray picker's words: "not signed in", etc.
    html += '<div class="np-row">'
      + '<button class="p-item' + (ticked ? ' on' : '') + (only ? ' lock' : '') + '"'
      + ' data-np="' + esc(p.id) + '" role="checkbox" aria-checked="' + ticked + '">'
      + '<span class="provider-mark" data-provider="' + esc(p.id) + '" aria-hidden="true">' + settingsGlyph(p.id) + '</span>'
      + '<span class="provider-copy"><span class="p-label">' + esc(p.label || p.id) + '</span>'
      + '<span class="p-status">' + esc(st || ui('Ready','Ready')) + '</span></span>'
      + '<span class="provider-switch" aria-hidden="true"></span></button>';
    if(p.id === 'gemini'){
      html += '<details class="provider-options"><summary>' + esc(ui('Provider options','Provider options')) + '</summary>'
        + agPicker('limit', ui('Notch reads', 'Notch reads'), AG_LIMITS, agPrefs.limit, ticked)
        + agPicker('model', ui('Model data', 'Model data'), AG_MODELS, agPrefs.model, ticked) + '</details>';
    }
    html += '</div>';
  }
  host.innerHTML = html;
  note.textContent = '';
  renderNotchPreview();
}
function renderNotchPreview(){
  const host=document.getElementById('notch-live-preview');if(!host)return;
  const on=notchOn().filter(p=>settingsVisibility[p.provider]!==false);host.innerHTML=on.map(p=>'<span class="preview-provider">'+settingsGlyph(p.provider)+'</span>').join('');
  host.style.transform='scale('+(scalePct/100)+')';
  document.getElementById('notch-preview-count').textContent=on.length+' '+ui('tools enabled','tools enabled');
}

/* Everything ticked is stored as an EMPTY list, not as four slots. Empty means "all" to the Rust
   side, so a provider added in a future version turns up on the notch by itself; a list of today's
   four ids would silently exclude it forever. */
function saveNotch(next){
  const ids = providerList().map(p => p.id);
  const store = next.length === ids.length ? [] : next;
  const prev = notchSlots;
  notchSlots = store;
  renderNotch();
  invoke('set_notch_slots', { slots: store.map(sl => ({ provider:sl.provider })) })
    .then(() => toast(ui('Saved', 'Saved')))
    .catch(e => {
      notchSlots = prev;     // nothing was saved, so put it back rather than show a lie
      renderNotch();
      strip('set_notch_slots failed: ' + errText(e));
    });
}

function toggleNotch(id){
  const ids = providerList().map(p => p.id);
  if(ids.indexOf(id) < 0) return;
  let on = notchOn().slice();
  const at = on.findIndex(sl => sl.provider === id);
  if(at >= 0){
    /* Unticking the last one is refused rather than saved. An empty list means "all" everywhere
       below this window, so saving one would switch every provider back on — the opposite of what
       the click asked for. Holding the last tick is the only unambiguous answer. */
    if(on.length <= 1){ toast(ui('At least one provider stays on the notch', 'At least one provider stays on the notch')); return; }
    on.splice(at, 1);
  } else {
    on.push({ provider:id });
  }
  on.sort((a, b) => ids.indexOf(a.provider) - ids.indexOf(b.provider));  // fixed order, not click order
  saveNotch(on);
}

document.getElementById('notch-list').addEventListener('click', e => {
  const b = e.target.closest('[data-np]');
  if(b) toggleNotch(b.dataset.np);
});
document.getElementById('notch-list').addEventListener('change', e => {
  const box = e.target.closest('[data-ag]');
  if(!box) return;
  const want = Object.assign({}, agPrefs, { [box.dataset.ag]: box.value });
  invoke('set_antigravity_prefs', want)
    .then(v => { agPrefs = v; renderNotch(); toast(ui('Saved', 'Saved')); })
    .catch(err => { renderNotch(); strip('set_antigravity_prefs failed: ' + errText(err)); });
});

/* ---- optional account drawer details ----------------------------------- */
const DRAWER_KEYS = ['showTodos', 'showServices', 'showMemory', 'showHeader', 'showPlan', 'showReset', 'showUpdated', 'showExtras', 'showActions', 'showActive'];
let drawerPreferences = Object.fromEntries(DRAWER_KEYS.map(key => [key, false]));
let drawerPreferencesReady = false, drawerPreferencesBusy = false, drawerPreferencesRevision = 0;
function readDrawerPreferences(value){
  return Object.fromEntries(DRAWER_KEYS.map(key => [key, !!value && value[key] === true]));
}
function renderDrawerPreferences(){
  for(const box of document.querySelectorAll('[data-drawer-pref]')){
    box.checked = drawerPreferences[box.dataset.drawerPref] === true;
    box.disabled = !drawerPreferencesReady || drawerPreferencesBusy;
  }
}
function receiveDrawerPreferences(value){
  if(!value || typeof value !== 'object' || Array.isArray(value)) return;
  drawerPreferences = readDrawerPreferences(value);
  drawerPreferencesReady = true;
  drawerPreferencesRevision++;
  renderDrawerPreferences();
}
document.getElementById('drawer-preferences').addEventListener('change', e => {
  const box = e.target.closest('[data-drawer-pref]');
  if(!box || !DRAWER_KEYS.includes(box.dataset.drawerPref) || !drawerPreferencesReady || drawerPreferencesBusy) return;
  const preferences = Object.assign({}, drawerPreferences, { [box.dataset.drawerPref]: box.checked });
  drawerPreferencesBusy = true;
  for(const input of document.querySelectorAll('[data-drawer-pref]')) input.disabled = true;
  invoke('set_drawer_preferences', { preferences })
    .then(value => { receiveDrawerPreferences(value); toast(ui('Saved', 'Saved')); })
    .catch(() => strip(ui('Could not save account panel preferences.', 'Could not save account panel preferences.')))
    .finally(() => { drawerPreferencesBusy = false; renderDrawerPreferences(); });
});
function loadDrawerPreferences(){
  const revision = drawerPreferencesRevision;
  return invoke('get_drawer_preferences')
    .then(value => { if(drawerPreferencesRevision === revision) receiveDrawerPreferences(value); })
    .catch(() => strip(ui('Could not load account panel preferences.', 'Could not load account panel preferences.')));
}
function startDrawerPreferences(){
  renderDrawerPreferences();
  const event = window.__TAURI__ && window.__TAURI__.event;
  const subscription = event && typeof event.listen === 'function'
    ? event.listen('drawer_preferences', e => receiveDrawerPreferences(e.payload))
    : Promise.resolve();
  // Subscribe before reading so a concurrent settings change cannot be lost.
  Promise.resolve(subscription)
    .catch(() => strip(ui('Could not follow account panel preferences.', 'Could not follow account panel preferences.')))
    .then(loadDrawerPreferences);
}

/* ---- notch size -------------------------------------------------------- */
function clampPct(v){
  const n = Math.round(Number(v));
  return isFinite(n) ? Math.max(40, Math.min(100, n)) : 100;
}
(function wireScale(){
  const r = document.getElementById('scale-range');
  const lab = document.getElementById('scale-val');
  r.addEventListener('input', () => {
    scalePct = clampPct(r.value);
    renderNotchPreview();
    lab.textContent = scalePct + '%';
    clearTimeout(scaleTimer);        // one save when the drag settles, not one per pixel
    scaleTimer = setTimeout(() => {
      invoke('set_scale', { scale: scalePct / 100 })
        .then(() => toast(ui('Saved', 'Saved')))
        .catch(e => strip('set_scale failed: ' + errText(e)));
    }, 150);
  });
})();

/* ---- the truth strip (built once) -------------------------------------- */
(function buildTruth(){
  document.getElementById('truthstrip').innerHTML = [16, 20, 24].map(px =>
    '<div class="truthcell"><img width="' + px + '" height="' + px + '" alt="' + esc(ui('Tray icon at', 'Tray icon at')) + ' ' + px + ' ' + esc(ui('pixels', 'pixels')) + '">'
    + '<span>' + px + ' px</span></div>'
  ).join('');
})();

/* ---- switches ----------------------------------------------------------
   A switch never shows what was asked for, only what Rust says is true afterwards. */
function setSwitch(id, on, disabled){
  const el = document.getElementById(id);
  if(!el) return;
  el.setAttribute('aria-checked', on ? 'true' : 'false');
  if(disabled) el.setAttribute('disabled', '');
  else el.removeAttribute('disabled');
}

/* ---- what is on screen at all ------------------------------------------
   Two switches, one command. Hiding both would leave Codenotch running with nothing to click, so
   the Rust side forces the taskbar icon back on whenever the notch is hidden — and the answer to
   set_ui_flags says what was ACTUALLY stored. Everything below re-renders from that answer, never
   from the request, and says so on screen when the two differ. */
let flags = { notch:true, tray:true }, flagsBusy = false;

function readFlags(v){
  // Rust answers in snake_case; camelCase is accepted too so a future rename cannot blank the page.
  const nv = v && (v.notch_visible !== undefined ? v.notch_visible : v.notchVisible);
  const tv = v && (v.tray_visible !== undefined ? v.tray_visible : v.trayVisible);
  return { notch: nv !== false, tray: tv !== false };   // anything missing is read as "shown"
}
function renderFlags(){
  setSwitch('sw-notch', flags.notch, flagsBusy);
  // With the notch hidden the taskbar icon is the last way in, so its switch is held on
  setSwitch('sw-tray', flags.tray, flagsBusy || !flags.notch);
  const lock = document.getElementById('tray-lock');
  if(lock) lock.hidden = flags.notch;
}
function saveFlags(wantNotch, wantTray){
  if(flagsBusy) return;
  flagsBusy = true;
  /* While the command is in flight the switches show what was ASKED for, so the click is felt at
     once, and are locked so a second click cannot race the first. The answer overwrites them. */
  setSwitch('sw-notch', wantNotch, true);
  setSwitch('sw-tray', wantTray, true);
  const fix = document.getElementById('flags-fix');
  invoke('set_ui_flags', { notchVisible: wantNotch, trayVisible: wantTray })
    .then(v => {
      flags = readFlags(v);            // the answer is the truth; the request was only a request
      const corrected = (flags.notch !== wantNotch) || (flags.tray !== wantTray);
      if(fix){
        fix.hidden = !corrected;
        if(corrected){
          fix.textContent = ui('The taskbar icon has been kept on. With the notch hidden it is the '
            + 'only way left to open this window or to quit Codenotch, so Codenotch will not let '
            + 'both of them be switched off at the same time.',
            'The taskbar icon has been kept on. With the notch hidden it is the only way left to open this window or to quit Codenotch, so Codenotch will not let both of them be switched off at the same time.');
        }
      }
      toast(ui('Saved', 'Saved'));
    })
    .catch(e => strip('set_ui_flags failed: ' + errText(e)))   // flags untouched: the switches spring back
    .then(() => { flagsBusy = false; renderFlags(); });
}
document.getElementById('sw-notch').addEventListener('click', () => {
  const el = document.getElementById('sw-notch');
  if(el.hasAttribute('disabled')) return;
  saveFlags(!flags.notch, flags.tray);
});
document.getElementById('sw-tray').addEventListener('click', () => {
  const el = document.getElementById('sw-tray');
  if(el.hasAttribute('disabled')) return;
  saveFlags(flags.notch, !flags.tray);
});

/* ---- a boolean that lives in Rust --------------------------------------
   Start with Windows and the Claude Code hooks work the same way: a command that reads the real
   state, and a command that changes it AND CAN FAIL (a locked registry, a missing settings file).
   After every attempt the true state is read back and the switch is drawn from that, so a switch
   can never sit there showing something that did not happen. */
function remoteSwitch(id, getCmd, setCmd, label){
  const el = document.getElementById(id);
  let value = false, busy = false;

  function refresh(){
    return call(getCmd, undefined, null).then(v => {
      if(typeof v === 'boolean') value = v;
      setSwitch(id, value, busy);
      return value;
    });
  }
  if(el) el.addEventListener('click', () => {
    if(busy || el.hasAttribute('disabled')) return;
    const want = !value;
    busy = true;
    setSwitch(id, want, true);            // moves at once so the click is felt, but stays locked
    invoke(setCmd, { on: want })
      .catch(e => strip(label + ' could not be changed: ' + errText(e)))
      .then(() => { busy = false; return refresh(); })
      .then(() => { if(value === want) toast(ui('Saved', 'Saved')); });
  });
  return { refresh: refresh };
}
const autoSwitch = remoteSwitch('sw-autostart', 'get_autostart', 'set_autostart', 'Start with Windows');
const hooksSwitch = remoteSwitch('sw-hooks', 'get_hooks_installed', 'set_hooks_installed', 'The Claude Code messages');

/* ---- language ----------------------------------------------------------- */
const LANGS = ['auto', 'en', 'zh', 'ja', 'ko', 'ru'];
document.getElementById('lang').addEventListener('change', e => {
  const previous = e.target.dataset.previous || 'auto';
  const v = LANGS.indexOf(e.target.value) >= 0 ? e.target.value : 'auto';
  invoke('set_lang', { lang: v })
    .then(() => {
      e.target.dataset.previous = v;
      return setUiLanguageFromRaw(v).then(() => toast(ui('Saved', 'Saved')));
    })
    .catch(err => {
      e.target.value = previous;
      setUiLanguageFromRaw(previous).then(() => strip('set_lang failed: ' + errText(err)));
    });
});

/* ---- about --------------------------------------------------------------- */
document.getElementById('btn-accounts').addEventListener('click',()=>invoke('open_codex_accounts').catch(e=>strip(errText(e))));
document.getElementById('btn-data').addEventListener('click', () => {
  invoke('open_data_dir').catch(e => strip('open_data_dir failed: ' + errText(e)));
});
document.getElementById('btn-resetpos').addEventListener('click', () => {
  invoke('reset_notch_position')
    .then(() => toast(ui('The notch is back in the middle', 'The notch is back in the middle')))
    .catch(e => strip('reset_notch_position failed: ' + errText(e)));
});
/* The number printed above is the one in tauri.conf.json, kept here so the page works with no
   command at all. If the window is allowed to ask the application itself, the real number wins. */
(function realVersion(){
  const api = window.__TAURI__ && window.__TAURI__.app;
  const el = document.getElementById('about-version');
  if(!el || !api || typeof api.getVersion !== 'function') return;
  try {
    Promise.resolve(api.getVersion())
      .then(v => { if(typeof v === 'string' && v) el.textContent = v; })
      .catch(() => {});         // not permitted for this window: the built-in number stays
  } catch(e) { /* same */ }
})();

/* ---- start ------------------------------------------------------------- */
function boot(){
  decorateNavigation();
  invoke('get_glyphs').then(g=>{settingsGlyphs=g||{};renderNotch();}).catch(()=>{});
  invoke('get_provider_visibility').then(v=>{settingsVisibility=v||{};renderNotchPreview();}).catch(()=>{});
  startDrawerPreferences();
  setUiLanguage('auto');
  showTab(savedTab());
  render();   // draw something immediately, even if every command below fails

  Promise.all([
    call('get_tray_options', undefined, []),
    call('get_tray_config', undefined, null)
  ]).then(([opts, saved]) => {
    options = Array.isArray(opts) ? opts.filter(o => o && typeof o.id === 'string') : [];
    if(saved && typeof saved === 'object'){
      cfg = { mode: saved.mode, slots: Array.isArray(saved.slots) ? saved.slots : [] };
    }
    normalize();
    /* If a saved slot had to be repaired, write the repair back at once. Rust draws a dash for a
       window id it cannot find, so leaving the repair on screen only would show one thing here and
       another in the taskbar. Saved quietly — the user did not ask for anything yet. */
    if(repairNote) persist(true);
    render();
    refreshPreview();
  });

  call('get_notch_slots', undefined, []).then(v => {
    notchSlots = Array.isArray(v)
      ? v.filter(x => x && typeof x.provider === 'string')
          .map(x => ({ provider:x.provider }))
      : [];
    renderNotch();
  });

  call('get_antigravity_prefs', undefined, null).then(v => {
    if(v && typeof v === 'object'){ agPrefs = v; renderNotch(); }
  });

  call('get_scale', undefined, null).then(v => {
    const n = Number(v);
    if(isFinite(n) && n > 0) scalePct = clampPct(Math.round(n * 100));
    document.getElementById('scale-range').value = String(scalePct);
    document.getElementById('scale-val').textContent = scalePct + '%';
  });

  call('get_ui_flags', undefined, null).then(v => {
    if(v && typeof v === 'object') flags = readFlags(v);
    renderFlags();
  });

  Promise.all([
    call('get_lang', undefined, 'auto'),
    call('get_lang_resolved', undefined, 'en')
  ]).then(([raw, resolved]) => {
    const l = (typeof raw === 'string' && LANGS.indexOf(raw) >= 0) ? raw : 'auto';
    const effective = l === 'auto' && typeof resolved === 'string' ? resolved : l;
    document.getElementById('lang').value = l;
    document.getElementById('lang').dataset.previous = l;
    setUiLanguage(effective);
  });

  autoSwitch.refresh();
  hooksSwitch.refresh();
}
boot();

/* Readings move on their own, so the percentages in the picker and the pixels in the preview are
   refreshed on a slow timer. Nothing is saved here — this only redraws. */
setInterval(() => {
  call('get_tray_options', undefined, null).then(opts => {
    if(!Array.isArray(opts) || !opts.length) return;
    options = opts.filter(o => o && typeof o.id === 'string');
    const before = JSON.stringify(cfg.slots);
    normalize();
    if(JSON.stringify(cfg.slots) !== before) persist(true);   // a window disappeared while the window was open
    render();
    refreshPreview();
  });
}, 30000);
