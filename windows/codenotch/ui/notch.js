
const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;

/* Colour ramp (upstream palette values) */
const AMPLE='#00FF88', WATCH='#F2FF00', CRIT='#FF3F00';
const TRACK='#303030', AMBER='#FFBF00', RUNGREEN='#28E07B';
const tone=f=> f>=0.8?CRIT : f>=0.5?WATCH : AMPLE;

let usage={status:'',windows:[],fetched_at:0,note:''};
let codexSnap={status:'absent',windows:[],fetched_at:0,note:''};
let cursorSnap={status:'absent',windows:[],fetched_at:0,note:''};
let agSnap={status:'absent',windows:[],fetched_at:0,note:''};
let glyphs={}; // id → {kind:'mark'|'appicon', url}
let activity=[]; // working state of the non-Claude providers: {provider,state:'busy'|'waiting',name,detail,since}
let uiLang='en';
const RU_TEXT={
  'Included usage':'Включённое использование',
  'API usage':'Использование API',
  'On demand':'По запросу',
  'Usage':'Использование',
  'Current session':'Текущий сеанс',
  'Weekly (all models)':'Недельный (все модели)',
  'Weekly (Opus)':'Недельный (Opus)',
  'Weekly (model-scoped)':'Недельный (для выбранной модели)',
  'Weekly limit':'Недельный лимит',
  'Weekly Limit':'Недельный лимит',
  '5-Hour Limit':'Лимит на 5 часов',
  '5-hour Limit':'Лимит на 5 часов',
  'Gemini Models':'Модели Gemini',
  'Claude and GPT models':'Модели Claude и GPT',
  'Monthly limit':'Месячный лимит',
  'Monthly Limit':'Месячный лимит',
  'Longer window':'Более длительный период',
  'Requests today · no limit published':'Запросы сегодня · лимит не опубликован',
  'Updated':'Обновлено',
  'Resetting…':'Сброс…',
  'Resets at':'Сброс в',
  'Resets':'Сброс',
  'Used':'Использовано',
  'Working':'Работа',
  'Waiting':'Ожидание',
  'Streaming (network)':'Потоковая передача (сеть)',
  'Rate limited, retrying in':'Превышен лимит, повтор через',
  'Rate limited — retrying in':'Превышен лимит — повтор через',
  'request today':'запрос сегодня',
  'requests today':'запросов сегодня',
  'no requests today':'сегодня запросов нет',
  'Waiting for first reading…':'Ожидание первого показания…',
  'Sign in to Claude Code to see usage.':'Войдите в Claude Code, чтобы увидеть использование.',
  'Sign in to Cursor to see usage.':'Войдите в Cursor, чтобы увидеть использование.',
  'Sign in to Codex to see usage.':'Войдите в Codex, чтобы увидеть использование.',
  'Sign in to Antigravity to see usage.':'Войдите в Antigravity, чтобы увидеть использование.',
  'needs your input':'требуется ваш ответ',
  'Working in':'Работает в',
  'Notch size':'Размер панели'
};
function textCopy(value){
  if(!value) return '';
  if(uiLang!=='ru') return value;
  if(RU_TEXT[value]) return RU_TEXT[value];
  return String(value)
    .replace(/^(\d+)m limit$/,'Лимит на $1 мин')
    .replace(/^(\d+)h limit$/,'Лимит на $1 ч')
    .replace(/^(\d+)d limit$/,'Лимит на $1 дн.')
    .replace(/^Rate limited, retrying in (\d+)s$/,'Превышен лимит, повтор через $1 с')
    .replace(/^Rate limited — retrying in (\d+)s$/,'Превышен лимит — повтор через $1 с')
    .replace(/^Unlimited on the (.+) plan — nothing to meter$/,'Безлимитный тариф $1 — нечего измерять')
    .replace(/^The (.+) plan has nothing for Cursor to meter yet$/,'В тарифе $1 пока нечего измерять Cursor')
    .replace(/^(.+) · Google publishes no quota for this account$/,'$1 · Google не публикует лимит для этого аккаунта')
    .replace(/^Live read failed \((.+)\)$/,'Ошибка чтения онлайн-данных ($1)')
    .replace(/Weekly \(all models\)/g,'Недельный (все модели)')
    .replace(/Weekly \(Opus\)/g,'Недельный (Opus)')
    .replace(/Weekly \(model-scoped\)/g,'Недельный (для выбранной модели)')
    .replace(/Weekly limit/g,'Недельный лимит')
    .replace(/Monthly limit/g,'Месячный лимит')
    .replace(/\bWeekly\b/g,'Недельный')
    .replace(/\bMonthly\b/g,'Месячный')
    .replace(/ · via /g,' · через ')
    .replace(/needs your input/g,'требуется ваш ответ')
    .replace(/^Working in /,'Работает в ')
    .replace(/via Antigravity CLI/g,'через CLI Antigravity')
    .replace(/via Antigravity/g,'через Antigravity')
    .replace(/via Google/g,'через Google')
    .replace(/No Claude Code credential found/g,'Учётные данные Claude Code не найдены')
    .replace(/Credential expired — run any claude command \(or chat with Claude\) to refresh it/g,'Учётные данные истекли — выполните любую команду claude (или начните чат с Claude), чтобы обновить их')
    .replace(/Credential rejected \(switched accounts\?\)/g,'Учётные данные отклонены (вы сменили аккаунт?)')
    .replace(/Codex sign-in expired — open Codex once to refresh it/g,'Срок входа в Codex истёк — откройте Codex для обновления')
    .replace(/Codex rejected its sign-in — sign in to Codex again/g,'Codex отклонил вход — войдите в Codex снова')
    .replace(/Codex reported no usage windows/g,'Codex не сообщил окна использования')
    .replace(/Codex has not recorded a usage snapshot yet/g,'Codex ещё не записал снимок использования')
    .replace(/from last Codex run/g,'из последнего запуска Codex')
    .replace(/Waiting for Antigravity CLI quota/g,'Ожидание квоты Antigravity CLI')
    .replace(/Open Antigravity to read its quota/g,'Откройте Antigravity, чтобы получить квоту')
    .replace(/Antigravity's Google session was rejected — sign in again in Antigravity/g,'Сеанс Google в Antigravity отклонён — войдите в Antigravity снова')
    .replace(/Antigravity is closed — last reading kept/g,'Antigravity закрыт — сохранено последнее показание')
    .replace(/Sign in to Cursor \(the editor\) to see usage\./g,'Войдите в Cursor (редактор), чтобы увидеть использование.')
    .replace(/Cursor session was rejected — sign in again in the editor/g,'Сеанс Cursor отклонён — снова войдите в редакторе');
}
function setUiLanguage(lang){
  const next=lang==='ru'?'ru':'en';
  if(uiLang===next) return;
  uiLang=next;
  renderRing();
  if(card&&card.classList.contains('show')) renderCard();
}
// Notch size, as a percentage (40…100). Declared here with the rest of the page state so the card
// renderer can never reference it before it exists.
let scalePct=100, scaleDragging=false, scaleT=null, scaleSaveT=null;
// "Is it working?" per provider: Claude from the four-state engine, the others from the activity probe. Returns running | attention | idle
function workState(id){
  if(id==='claude'){
    if(stateSnap.agg==='running') return 'running';
    if(stateSnap.agg==='attention') return 'attention';
    // The engine cannot see cloud sessions: fall back to the desktop app's network activity
    if(activity.some(a=>a.provider==='claude'&&a.state==='busy')) return 'running';
    return 'idle';
  }
  const acts=activity.filter(a=>a.provider===id);
  if(acts.some(a=>a.state==='waiting')) return 'attention';
  if(acts.some(a=>a.state==='busy')) return 'running';
  return 'idle';
}
function glyphHtml(p,small){
  const g=glyphs[p.id];
  if(g && ['svg','png','appicon'].includes(g.kind) && /^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(g.url))
    return `<img class="${g.kind}" src="${g.url}" alt="${esc(p.name)}"${small?' style="width:16px;height:16px;border-radius:4px"':''}>`;
  return small?'':esc(p.glyph);
}
// Provider table (order = top to bottom in the pill). `glyph` is the fallback letter used when no mark is available
// Which providers get a ring: [{provider}]. null or an empty list means every provider.
let notchSlots=null;
let providerVisibility={};
function slotFor(id){
  if(!Array.isArray(notchSlots)) return null;
  for(const s of notchSlots){ if(s&&s.provider===id) return s; }
  return null;
}
function providers(){
  const list=[{id:'claude',name:'Claude',glyph:'C',snap:usage}];
  if(codexSnap.status!=='absent'||providerVisibility.codex===true) list.push({id:'codex',name:'Codex',glyph:'Cx',snap:codexSnap});
  if(cursorSnap.status!=='absent'||providerVisibility.cursor===true) list.push({id:'cursor',name:'Cursor',glyph:'Cu',snap:cursorSnap});
  if(agSnap.status!=='absent'||providerVisibility.gemini===true) list.push({id:'gemini',name:'Antigravity',glyph:'Ag',snap:agSnap});
  // The backend map reports effective eligibility (including Auto), not a forced-show mode.
  // Apply it before the user's slot selection so an enabled provider cannot override Settings.
  const enabled=list.filter(p=>providerVisibility[p.id]!==false);
  if(Array.isArray(notchSlots)&&notchSlots.length)return enabled.filter(p=>!!slotFor(p.id));
  return enabled;
}
// Antigravity's "Notch reads" and "Model data", as in the Mac app; chosen in settings
let agPrefs={limit:'automatic',model:'gemini'};
// The tightest metered window, ties going to the lower id so the choice never flickers
function tightestOf(ws){
  return ws.filter(w=>w.count==null).reduce((a,b)=>!a||b.used>a.used||(b.used===a.used&&b.id<a.id)?b:a,null);
}
function laneFamily(w){ const id=w.id.toLowerCase(); return id.startsWith('gemini')?'gemini':(id.startsWith('3p')||id.startsWith('claude'))?'3p':''; }
function laneIs(w,limit){
  const t=(w.id+' '+w.label).toLowerCase();
  return limit==='weekly'?t.includes('weekly'):['5h','5-hour','five hour','five-hour','hourly','session'].some(k=>t.includes(k));
}
// The window a provider's ring shows: the same rule as ring_window in main.rs, which draws the tray
function headlineOf(snap,id){
  const ws=snap.windows; if(!ws.length) return null;
  const byId=x=>ws.find(w=>w.id===x)||null;
  if(id==='claude') return byId('session');
  if(id==='codex') return ws[0];
  if(id==='cursor') return byId('included')||byId('api');
  const fam=ws.filter(w=>laneFamily(w)===agPrefs.model), lanes=fam.length?fam:ws;
  if(agPrefs.limit!=='automatic'){ const w=tightestOf(lanes.filter(w=>laneIs(w,agPrefs.limit))); if(w) return w; }
  return tightestOf(lanes.filter(w=>w.used<1))||tightestOf(lanes)||lanes[0];
}
function staleOf(snap){ if(snap.status==='stale') return true; return snap.fetched_at>0 && (Date.now()-snap.fetched_at)>5*60*1000; }
let stateSnap={sessions:[],agg:'idle'};

function svgArc(r,frac,color,width,extra=''){
  const C=2*Math.PI*r;
  return `<circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="${width}"
    stroke-dasharray="${(C*frac).toFixed(2)} ${C.toFixed(2)}" stroke-linecap="butt"
    transform="rotate(-90 28 28)" ${extra}/>`;
}

function isStale(){
  if(usage.status==='stale') return true;
  return usage.fetched_at>0 && (Date.now()-usage.fetched_at)>5*60*1000;
}

function renderRing(){
  const ps=providers();
  pill.style.display=ps.length?'':'none';
  // Rebuild the DOM only when the structure changes (never swap the element under the cursor)
  const want=ps.map(p=>p.id+':'+(glyphs[p.id]?glyphs[p.id].kind:'-')).join(',');
  if(pill.dataset.cells!==want){
    pill.innerHTML=ps.map(p=>`<div class="cell" data-p="${p.id}">
      <div class="ringwrap"><svg class="ring" viewBox="0 0 56 56"></svg><div class="activity-indicator" data-state="idle" aria-hidden="true"></div><div class="glyph ${(!glyphs[p.id]&&p.glyph.length>1)?'small':''}">${glyphHtml(p)}</div></div>
      <div class="pct">—</div></div>`).join('');
    pill.dataset.cells=want;
  }
  for(const p of ps){
    const cell=pill.querySelector(`.cell[data-p="${p.id}"]`); if(!cell) continue;
    const svg=cell.querySelector('svg.ring'), pct=cell.querySelector('.pct'), glyph=cell.querySelector('.glyph'), wrap=cell.querySelector('.ringwrap');
    const h=headlineOf(p.snap,p.id);
    let inner=`<circle cx="28" cy="28" r="22" fill="#2a2a2a"/><circle cx="28" cy="28" r="25" fill="none" stroke="${TRACK}" stroke-width="5"/>`;
    if(h && h.count==null) inner+=svgArc(25,Math.min(h.used,1),tone(h.used),5);
    const indicator=cell.querySelector('.activity-indicator'), ws=workState(p.id);
    if(indicator.dataset.state!==ws) indicator.dataset.state=ws;
    if(svg._ringMarkup!==inner){svg.innerHTML=inner;svg._ringMarkup=inner;}
    if(p.snap.status==='needsAuth'||p.snap.status==='none') pct.textContent='—';
    else if(h && h.count!=null) pct.textContent='~'+h.count;
    else if(h) pct.textContent=(h.derived?'~':'')+Math.round(h.used*100)+'%';
    else pct.textContent='…';
    glyph.classList.toggle('dim', !!(h && h.used>=1));
    wrap.classList.toggle('dim', staleOf(p.snap));
  }
  updateHitRegions();
}

function resetCopy(ms){
  if(!ms) return '';
  const diff=ms-Date.now();
  if(diff<=0) return uiLang==='ru'?'Сброс…':'Resetting…';
  if(diff<60*60*1000) return uiLang==='ru'
    ? `Сброс через ${Math.max(1,Math.round(diff/60000))} мин`
    : `Resets in ${Math.max(1,Math.round(diff/60000))} min`;
  const d=new Date(ms);
  const locale=uiLang==='ru'?'ru-RU':'en-US';
  const t=d.toLocaleTimeString(locale,{hour:'numeric',minute:'2-digit'});
  if(diff<24*60*60*1000) return `${uiLang==='ru'?'Сброс в':'Resets at'} ${t}`;
  return `${uiLang==='ru'?'Сброс':'Resets'} ${d.toLocaleDateString(locale,{weekday:'short'})} ${t}`;
}

function ago(ms){
  const m=Math.round((Date.now()-ms)/60000);
  if(uiLang==='ru') return m<60?`${m} мин назад`:`${Math.round(m/60)} ч назад`;
  return m<60?`${m}m ago`:`${Math.round(m/60)}h ago`;
}

const STATE_DOT={running:RUNGREEN,attention:AMBER,done:'#57c7ff'};

let hoverId='claude';
const expandedProviders=new Set();
function shortTaskName(value){
  const chars=Array.from(String(value||'Задача').replace(/\s+/g,' ').trim());
  return chars.length>88?chars.slice(0,87).join('')+'…':chars.join('');
}
function taskRows(provider){
  const rows=provider==='claude'
    ?stateSnap.sessions.filter(s=>['running','attention'].includes(s.state)).map(s=>({name:s.title,state:s.state}))
    :activity.filter(a=>a.provider===provider);
  return rows.slice().sort((a,b)=>Number(['waiting','attention'].includes(b.state))-Number(['waiting','attention'].includes(a.state)));
}
function renderTasks(provider){
  const rows=taskRows(provider), expanded=expandedProviders.has(provider);
  if(!rows.length)return '';
  let html='<div class="c-sessions">';
  for(const row of rows.slice(0,expanded?rows.length:3)){
    const waiting=['waiting','attention'].includes(row.state), done=row.state==='done';
    const status=waiting?(uiLang==='ru'?'Ждёт ответа':'Waiting'):done?(uiLang==='ru'?'Завершено':'Done'):(uiLang==='ru'?'Работает':'Working');
    const color=waiting?AMBER:done?'#57c7ff':RUNGREEN;
    html+=`<div class="s-row"><span class="s-dot" style="background:${color}"></span><div class="s-body"><div class="s-title">${esc(shortTaskName(row.name))}</div><span class="s-status">${status}</span></div></div>`;
  }
  if(rows.length>3)html+=`<button type="button" class="s-more" data-more="${provider}" aria-expanded="${expanded}">${expanded?(uiLang==='ru'?'Свернуть':'Show less'):(uiLang==='ru'?'Ещё ':'More ')+(rows.length-3)}</button>`;
  return html+'</div>';
}
function renderCard(){
  const c=document.getElementById('card');
  const p=providers().find(x=>x.id===hoverId)||providers()[0];
  if(!p){hideCard();return;}
  const snap=p.snap;
  const headIcon=glyphHtml(p,true);
  let html=`<div class="c-head">${headIcon}<span class="c-title">${uiLang==='ru'?'Использование '+p.name:p.name+' Usage'}</span></div>`;
  if(staleOf(snap)&&snap.fetched_at) html+=`<div class="c-sub">${textCopy('Updated')} ${ago(snap.fetched_at)}</div>`;
  if(snap.status==='needsAuth'){
    const who={claude:'Sign in to Claude Code to see usage.',cursor:'Sign in to Cursor to see usage.',codex:'Sign in to Codex to see usage.',gemini:'Sign in to Antigravity to see usage.'}[p.id]||'';
    html+=`<div class="c-note">${textCopy(who)}<br>${esc(textCopy(snap.note||''))}</div>`;
  }else if(!snap.windows.length){
    html+=`<div class="c-note">${esc(textCopy(snap.note||'Waiting for first reading…'))}</div>`;
  }else{
    // Windows that share a group (Antigravity's model families) sit in one box under its name, as on the Mac
    let group=null;
    for(const w of snap.windows){
      if((w.group||null)!==group){
        if(group) html+=`</div>`;
        group=w.group||null;
        if(group) html+=`<div class="g-head">${esc(textCopy(group))}</div><div class="g-box">`;
      }
      if(w.count!=null){
        html+=`<div class="win"><div class="w-row"><span class="w-label">${esc(textCopy(w.label))}</span></div>
          <div class="w-used">${w.count>0?`~${w.count} ${textCopy(w.count===1?'request today':'requests today')}`:textCopy('no requests today')}</div></div>`;
        continue;
      }
      html+=`<div class="win">
        <div class="w-row"><span class="w-label">${esc(textCopy(w.label))}</span><span class="w-reset">${resetCopy(w.resets_at)}</span></div>
        <div class="w-track"><div class="w-fill" style="width:${(Math.min(w.used,1)*100).toFixed(0)}%;background:${tone(w.used)}"></div></div>
        <div class="w-used">${w.derived?'~':''}${Math.round(w.used*100)}% ${textCopy('Used')}</div>
      </div>`;
    }
    if(group) html+=`</div>`;
    if(snap.note) html+=`<div class="c-note">${esc(textCopy(snap.note))}</div>`;
  }
  html+=renderTasks(p.id);
  html+=`<div class="c-scale"><input id="scale-range" type="range" min="40" max="100" step="5" value="${scalePct}" aria-label="${textCopy('Notch size')}" title="${textCopy('Notch size')}"><span class="c-scale-val" id="scale-val">${scalePct}%</span></div>`;
  if(p.id==='codex')html+=`<button type="button" class="accounts-open">${uiLang==='ru'?'Аккаунты Codex':'Codex accounts'} ↗</button>`;
  c.innerHTML=html;
  wireScaleRow();
  placeCard();
}
// The card follows the hovered cell: vertically centred on it (kept inside the window), tail pointing at it
function placeCard(){
  const cell=pill.querySelector(`.cell[data-p="${hoverId}"]`)||pill;
  const cr=cell.getBoundingClientRect();
  const cy=cr.top+cr.height/2;
  const H=innerHeight, ch=card.offsetHeight||0;
  let top=Math.round(cy-ch/2); top=Math.max(8,Math.min(top,H-ch-8));
  card.style.top=top+'px'; card.style.transform='none';
  // The tail's point on the hovered ring (not the cell, which includes the label below it), kept off the card's rounded corners
  const rr=(cell.querySelector('.ringwrap')||cell).getBoundingClientRect(), ry=rr.top+rr.height/2;
  const th=tail.offsetHeight||36, ty=Math.max(top+16+th/2,Math.min(top+ch-16-th/2,ry));
  tail.style.top=Math.round(ty-th/2)+'px';
}

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

/* Hover: stays expanded while either the pill or the card is under the cursor; collapses after a 250 ms grace period (upstream motion rule) */
const card=document.getElementById('card'), pill=document.getElementById('pill'), tail=document.getElementById('tail');
card.addEventListener('click',e=>{
  if(e.target.closest('.accounts-open'))invoke('open_codex_accounts').catch(e=>notice(String(e)));
  const button=e.target.closest('button[data-more]');if(!button)return;
  const id=button.dataset.more;if(expandedProviders.has(id))expandedProviders.delete(id);else expandedProviders.add(id);
  renderCard();armWatchdog();
});
let hideTimer=null;
function showCard(){clearTimeout(hideTimer);card.classList.add('show');renderCard();armWatchdog();} // show first, then render: placeCard needs offsetHeight
function hideCard(){expandedProviders.clear();card.classList.remove('show');reportHot();}
function scheduleHide(){clearTimeout(hideTimer);hideTimer=setTimeout(hideCard,250);}
// ===== Diagnostics + geometry =====
function jslog(m){invoke('log_js',{msg:String(m)}).catch(()=>{});}
function callq(cmd,args){ // invoke with visible failure: any command error is reported on screen (a silent .catch used to swallow them)
  return invoke(cmd,args).catch(e=>{notice(cmd+' failed: '+(e&&e.message||e));throw e;});
}
// Hot rectangles are reported in physical pixels (multiplied by this page's real DPR), so the Rust side does no conversion — WebView2's DPR and the window scale can disagree
function rectOf(el){const r=el.getBoundingClientRect(),k=window.devicePixelRatio||1;return [r.left*k,r.top*k,r.width*k,r.height*k];}
/* Rust gates click-through on these, so they are reported whenever the pill or card moves, not only
   when the card opens: a stale pill rectangle is a pill that cannot be clicked. */
function reportHot(){
  const open=card.classList.contains('show');
  const rects=open?[rectOf(pill),rectOf(tail),rectOf(card)]:[rectOf(pill)];
  callq('set_hot',{rects,expanded:open}).catch(()=>{});
  updateHitRegions();
}
let lastHitRegions='';
function visibleHitRects(){
  const p=rectOf(pill),k=window.devicePixelRatio||1,f=26*k*scalePct/100;
  const rects=pill.style.display==='none'?[]:[p,[p[0]+p[2]-f,p[1]-f,f,f],[p[0]+p[2]-f,p[1]+p[3],f,f]];
  if(rects.length&&card.classList.contains('show'))rects.push(rectOf(card),rectOf(tail));
  return rects;
}
function updateHitRegions(){
  const rects=visibleHitRects();
  const key=JSON.stringify(rects);if(key===lastHitRegions)return;lastHitRegions=key;
  invoke('set_hit_regions',{rects}).catch(e=>{lastHitRegions='';jslog('hit region failed: '+e);});
}
new ResizeObserver(updateHitRegions).observe(pill);
new ResizeObserver(updateHitRegions).observe(card);
/* ---- Notch size ---------------------------------------------------------
   The pill alone is scaled, with CSS `zoom` rather than `transform`: the pill is centred by
   `top:50%; transform:translateY(-50%)`, so assigning to `transform` here would wipe that out and
   throw the pill to the top of the screen. `zoom` changes the element's laid-out size instead, so
   the existing centring keeps working and `right:0` keeps it against the edge.
   The hover card is deliberately left at full size: it holds the slider, and a slider that shrank
   as it was dragged would slide out from under the cursor. */
function clampPct(v){const n=Math.round(Number(v));return isFinite(n)?Math.max(40,Math.min(100,n)):100;}
function applyPillScale(){ if(pill) pill.style.zoom=String(scalePct/100); }
function applyScale(v){
  scalePct=clampPct(v);
  const lab=document.getElementById('scale-val'); if(lab) lab.textContent=scalePct+'%';
  applyPillScale();                                       // draw it at once; do not wait on Rust
  // One save when the drag settles, not one per pixel: set_scale writes the config file and
  // broadcasts an event every time it is called. Same 150ms wait the settings window's slider uses.
  clearTimeout(scaleSaveT);
  scaleSaveT=setTimeout(()=>{invoke('set_scale',{scale:scalePct/100}).catch(()=>{});},150); // percent → fraction: 60 becomes 0.60
  // The pill just changed size, so the hot rectangles the watchdog checks are stale
  clearTimeout(scaleT);
  scaleT=setTimeout(()=>{if(card.classList.contains('show')){placeCard();armWatchdog();}},120);
}
function wireScaleRow(){
  const r=document.getElementById('scale-range'); if(!r) return;
  r.value=String(scalePct);
  r.addEventListener('input',()=>applyScale(r.value)); // live while dragging, and on arrow keys
  r.addEventListener('pointerdown',()=>{scaleDragging=true;});
  r.addEventListener('mousedown',()=>{scaleDragging=true;});
}
document.addEventListener('pointerup',()=>{scaleDragging=false;});
document.addEventListener('pointercancel',()=>{scaleDragging=false;});
document.addEventListener('mouseup',()=>{scaleDragging=false;});
function loadScale(){
  invoke('get_scale').then(v=>{
    const n=Number(v); if(isFinite(n)&&n>0) scalePct=clampPct(Math.round(n*100));
    applyPillScale(); wireScaleRow();
  }).catch(()=>{applyPillScale();});
}

function armWatchdog(){
  requestAnimationFrame(reportHot); // wait one frame so renderCard's new content is laid out before measuring
}
// Viewport fit (pure front-end fallback, independent of Rust): the window is NOTCH_W (360) × primary scale physical px,
// so if this page's CSS viewport is not 360 wide the WebView's DPR disagrees with the monitor; CSS zoom pulls the layout back to the design size.
function fitZoom(){
  const z=innerWidth/360;
  document.documentElement.style.zoom=(Math.abs(z-1)>0.02)?String(z):'';
  return z;
}
function reportDpr(){
  const z=fitZoom();
  jslog(`dpr=${window.devicePixelRatio} inner=${innerWidth}x${innerHeight} cssZoom=${z.toFixed(3)}`);
  callq('report_dpr',{dpr:window.devicePixelRatio||1,w:innerWidth,h:innerHeight}).catch(()=>{});
}
reportDpr();
window.addEventListener('resize',()=>{clearTimeout(window._dprT);window._dprT=setTimeout(()=>{reportDpr();reportHot();},120);});
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change',reportDpr);

/* Collapse test: no trust in element-level mouseenter/mouseleave/e.target at all —
   pure geometry: is the cursor (clientX/Y) inside pill rect ∪ card rect ∪ their bounding box?
   Leaving the window: document mouseout (relatedTarget=null) plus the Rust watchdog (system cursor) as a second line. */
function inRect(x,y,r,pad){return x>=r.left-pad&&y>=r.top-pad&&x<r.right+pad&&y<r.bottom+pad;}
function cellAt(x,y){
  for(const el of pill.querySelectorAll('.cell')){ if(inRect(x,y,el.getBoundingClientRect(),6)) return el.dataset.p; }
  return null;
}
function pointerInHot(x,y){
  const p=pill.getBoundingClientRect();
  if(inRect(x,y,p,4))return true;
  if(!card.classList.contains('show'))return false;
  const c=card.getBoundingClientRect();
  if(inRect(x,y,c,4))return true;
  const u={left:Math.min(p.left,c.left),top:Math.min(p.top,c.top),right:Math.max(p.right,c.right),bottom:Math.max(p.bottom,c.bottom)};
  return inRect(x,y,u,0);
}
let hideLogged=0;
document.addEventListener('mousemove',e=>{
  if(dragging)return; // no card while dragging
  const hot=pointerInHot(e.clientX,e.clientY);
  if(hot){
    clearTimeout(hideTimer);
    const id=cellAt(e.clientX,e.clientY);
    if(id&&id!==hoverId){ hoverId=id; if(card.classList.contains('show')){ renderCard(); armWatchdog(); } }
    if(!card.classList.contains('show')) showCard();
  }
  else if(card.classList.contains('show')){ if(hideLogged++<5) jslog(`mousemove left the hot area -> collapse at ${e.clientX},${e.clientY}`); scheduleHide(); }
});
document.addEventListener('mouseout',e=>{ // relatedTarget null = the cursor left the page
  if(!e.relatedTarget && card.classList.contains('show')){ if(hideLogged++<5) jslog('mouseout left the page -> collapse'); scheduleHide(); }
});
listen('pointer_left',()=>{if(scaleDragging)return;clearTimeout(hideTimer);hideCard();}).catch(()=>{});
// The size can also be changed from the settings window, which is a different window entirely.
// Ignore it while this page's own slider is being dragged, or the two would fight each other.
listen('scale',e=>{
  if(scaleDragging) return;
  const n=Number(e.payload); if(!isFinite(n)||n<=0) return;
  scalePct=clampPct(Math.round(n*100));
  applyPillScale();
  const r=document.getElementById('scale-range');
  if(r){r.value=String(scalePct);const lab=document.getElementById('scale-val');if(lab)lab.textContent=scalePct+'%';}
}).catch(()=>{});
// Card content changes change its height -> report the hot rectangles again
listen('usage',()=>{if(card.classList.contains('show'))armWatchdog();}).catch(()=>{});
listen('state',()=>{if(card.classList.contains('show'))armWatchdog();}).catch(()=>{});
/* The pill can be dragged up and down the right edge. Press and move more than 4 px = drag (handed to Rust,
   which follows the system cursor; the card is collapsed first); release without moving = click (opens the provider's usage page). */
let press=null, dragging=false;
pill.addEventListener('mousedown',e=>{ if(e.button!==0)return; press={x:e.clientX,y:e.clientY,id:cellAt(e.clientX,e.clientY)||hoverId}; });
document.addEventListener('mousemove',e=>{
  if(!press||dragging)return;
  if(Math.abs(e.clientY-press.y)>4||Math.abs(e.clientX-press.x)>4){
    dragging=true; clearTimeout(hideTimer); hideCard();
    invoke('drag_begin').catch(err=>{notice('drag_begin failed: '+err);dragging=false;});
  }
});
document.addEventListener('mouseup',e=>{
  if(e.button!==0)return;
  if(press&&!dragging) invoke('open_provider_page',{provider:press.id}).catch(()=>{});
  press=null;
});
listen('drag_end',()=>{dragging=false;press=null;reportHot();}).catch(()=>{});

function notice(msg){
  const n=document.getElementById('notice');
  n.textContent=msg;n.classList.add('show');
  clearTimeout(n._h);n._h=setTimeout(()=>n.classList.remove('show'),6000);
}

listen('usage',e=>{usage=e.payload||usage;renderRing();if(card.classList.contains('show'))renderCard();})
  .catch(e=>notice('listen(usage) failed: '+e));
listen('state',e=>{stateSnap=e.payload||stateSnap;setUiLanguage(stateSnap.lang_resolved);renderRing();if(card.classList.contains('show'))renderCard();})
  .catch(e=>notice('listen(state) failed: '+e));
listen('notice',e=>notice(e.payload)).catch(()=>{});
listen('codex',e=>{codexSnap=e.payload||codexSnap;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
listen('cursor',e=>{cursorSnap=e.payload||cursorSnap;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_provider_visibility').then(v=>{providerVisibility=v||{};renderRing();}).catch(e=>notice(String(e)));
listen('provider_visibility',e=>{providerVisibility=e.payload||{};renderRing();}).catch(()=>{});
invoke('get_cursor').then(u=>{cursorSnap=u||cursorSnap;renderRing();}).catch(()=>{});
listen('antigravity',e=>{agSnap=e.payload||agSnap;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_antigravity').then(u=>{agSnap=u||agSnap;renderRing();}).catch(()=>{});
loadScale();
invoke('get_notch_slots').then(v=>{if(Array.isArray(v)){notchSlots=v;renderRing();}}).catch(()=>{});
listen('notch_slots',e=>{
  notchSlots=Array.isArray(e.payload)?e.payload:null;
  renderRing();
  if(card.classList.contains('show')){renderCard();armWatchdog();}
}).catch(()=>{});
invoke('get_antigravity_prefs').then(p=>{if(p){agPrefs=p;renderRing();}}).catch(()=>{});
listen('antigravity_prefs',e=>{if(e.payload){agPrefs=e.payload;renderRing();}}).catch(()=>{});
listen('glyphs',e=>{glyphs=e.payload||glyphs;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
listen('activity',e=>{activity=e.payload||activity;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_activity').then(a=>{activity=a||activity;renderRing();}).catch(()=>{});
invoke('get_glyphs').then(g=>{glyphs=g||glyphs;renderRing();}).catch(()=>{});
invoke('get_codex').then(u=>{codexSnap=u||codexSnap;renderRing();}).catch(()=>{});
invoke('get_usage').then(u=>{usage=u||usage;renderRing();}).catch(e=>notice('get_usage failed: '+e));
invoke('get_state').then(s=>{stateSnap=s||stateSnap;setUiLanguage(stateSnap.lang_resolved);renderRing();}).catch(()=>{});
setInterval(renderRing,30_000); // stale state and reset copy move with time
